/**
 * OCR standalone converter (OCR module O2 v3) — leftmost-rail "文字识别" module.
 *
 * 解析优先：文字 PDF 走 /api/ocr/parse；某页不对→逐页「用 AI 重识别」；扫描件→可识别全部；可「停止」。
 * 左原图↔右文本，复制(整篇/本页)/导出/加入知识库。历史：每次转换自动存(ocr_jobs)，可重开/删除。
 *
 * 表格 v3（Owner 真实意图）：解析器只「检测/定位」（/api/ocr/tables → 每表 {页,bbox,行×列}），
 * 不强求提取。前端列出哪些页有表 + 在页图上画 bbox 框；用户选一页或连续多页（跨页表）→ 交给 VLM
 * 一起识别（/api/ocr images[]）。分工：解析器发现，VLM 读，用户掌控选页。
 */
import { createFileRoute, useRouter } from '@tanstack/react-router';
import { useServerFn } from '@tanstack/react-start';
import { useCallback, useRef, useState } from 'react';
import {
  ScanText, FileUp, Copy, Check, Download, BookPlus, ChevronLeft, ChevronRight,
  Loader2, AlertCircle, Sparkles, Square, CheckSquare, Trash2, RotateCcw, Clock, Table as TableIcon,
} from 'lucide-react';
import { StreamingMarkdown } from '~/components/claude-chat/streaming-markdown';
import { initDocumentUpload } from '~/server/function/documents.server';
import { saveOcrJob, saveOcrTableResult, listOcrJobs, getOcrJob, deleteOcrJob, addOcrJobToKb } from '~/server/function/ocr.server';

interface RecognizedTable { pages: number[]; content: string }
const tableKey = (ps: number[]) => [...ps].sort((a, b) => a - b).join(',');

export const Route = createFileRoute('/agents/ocr')({
  loader: async () => ({ history: await listOcrJobs() }),
  component: OcrConverterPage,
});

type OutputFormat = 'markdown' | 'text' | 'tables';
interface OcrPage {
  page: number;
  imageUrl: string | null;
  imageB64: string | null;
  mediaType: string;
  text: string | null;
  source: 'parse' | 'ocr' | null;
  ocring: boolean;
  error?: boolean;
}
interface TablePage { page: number; cells: number; big: boolean; via: 'parser' | 'heuristic' }
interface HistoryItem {
  id: string; title: string; fileName: string; mimeType: string | null;
  pageCount: number; scanned: boolean; createdAt: string | Date;
}

const ACCEPT = '.pdf,.png,.jpg,.jpeg,.webp';
const MEDIA: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' };
const TABLE_PROMPT =
  '提取这些图里的表格（可能跨页，请合并成一个表）。如果是标准规则表格（行列整齐、无合并单元格），输出 ' +
  'Markdown 表格；如果不规则（合并单元格/跨行跨列/嵌套表头），改用 HTML <table> 保留结构。' +
  '只输出表格本身，看不清的单元格留空，不要编造。';

function fileToBase64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => { const s = String(r.result); const c = s.indexOf(','); resolve(c >= 0 ? s.slice(c + 1) : s); };
    r.onerror = () => reject(r.error ?? new Error('read failed'));
    r.readAsDataURL(file);
  });
}
function mdToText(md: string): string {
  return md
    .replace(/<!-- odl-page \d+ -->/g, '').replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1').replace(/\*([^*]+)\*/g, '$1').replace(/`([^`]+)`/g, '$1')
    .replace(/^\s*[-*]\s+/gm, '• ').replace(/\n{3,}/g, '\n\n').trim();
}
function sanitizeHtml(html: string): string {
  return html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/\son\w+\s*=\s*"[^"]*"/gi, '').replace(/\son\w+\s*=\s*'[^']*'/gi, '');
}
const isHtmlTable = (s: string) => /<table[\s>]/i.test(s);

/**
 * Find table-bearing pages from the ALREADY-PARSED text — full doc coverage, instant. Two signals:
 *  (1) PARSER-tagged tables: <td>/<th> in <table> blocks (cluster+markdown-with-html) + markdown
 *      pipe cells. High confidence, but the parser's cluster detector is INCONSISTENT — it
 *      flattens many financial tables to plain flowing text (no <table>), so it misses them.
 *  (2) NUMBER-DENSITY heuristic (catches the parser misses): financial tables are full of "–"
 *      no-data markers + aligned number columns; prose almost never has runs of standalone dashes.
 *      So a page with ≥4 standalone dashes is treated as a data-table page even when untagged.
 * Since the VLM reads the whole page anyway, over-flagging a number-dense page is acceptable.
 * Rank by cell/token count so big data tables surface first.
 */
function findTablePages(pages: OcrPage[]): TablePage[] {
  const out: TablePage[] = [];
  for (const p of pages) {
    if (!p.text) continue;
    let cells = 0;
    let via: 'parser' | 'heuristic' = 'parser';
    for (const t of p.text.match(/<table[\s\S]*?<\/table>/gi) ?? []) cells += (t.match(/<t[dh][\s>]/gi) ?? []).length;
    const mdRows = p.text.replace(/<table[\s\S]*?<\/table>/gi, '').split('\n')
      .filter((l) => /^\s*\|.*\|/.test(l) && !/^\s*\|?[\s:|-]+\|?\s*$/.test(l));
    for (const r of mdRows) cells += Math.max(0, (r.match(/\|/g)?.length ?? 1) - 1);
    if (cells === 0) {
      // (2) heuristic: standalone EN/EM dashes (no-data cells) on a number-dense page. Use
      // EN/EM dash ONLY — hyphen-minus "-" is the markdown list marker (bulleted prose pages
      // would false-positive otherwise; verified: prose page drops from 9→2 dashes).
      const dashes = (p.text.match(/(?:^|\s)[–—](?=\s|$)/gm) ?? []).length;
      if (dashes >= 4) {
        const numbers = (p.text.match(/\d[\d,]*\.?\d*/g) ?? []).length;
        cells = dashes + numbers;
        via = 'heuristic';
      }
    }
    if (cells >= 4) out.push({ page: p.page, cells, big: cells >= 12, via });
  }
  return out.sort((a, b) => a.page - b.page); // page order (Owner: 按页数排序)
}

function OcrConverterPage() {
  const { history: initialHistory } = Route.useLoaderData() as { history: HistoryItem[] };
  const router = useRouter();
  const [fileName, setFileName] = useState<string | null>(null);
  const [pages, setPages] = useState<OcrPage[]>([]);
  const [active, setActive] = useState(0);
  const [format, setFormat] = useState<OutputFormat>('markdown');
  const [phase, setPhase] = useState<'idle' | 'loading' | 'ready'>('idle');
  const [scanned, setScanned] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [savedToKb, setSavedToKb] = useState<'idle' | 'saving' | 'done'>('idle');
  const [dragOver, setDragOver] = useState(false);
  const [batchRunning, setBatchRunning] = useState(false);
  // table-v3.1: detection derived from parsed text (full coverage); selection → VLM read
  const [selPages, setSelPages] = useState<number[]>([]);
  const [recognizedTables, setRecognizedTables] = useState<RecognizedTable[]>([]); // persisted VLM tables
  const [tableReading, setTableReading] = useState(false);
  const [tableError, setTableError] = useState<string | null>(null);
  const [rendering, setRendering] = useState<number | null>(null); // page being lazily rendered
  const fileRef = useRef<File | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const jobIdRef = useRef<string | null>(null);
  const uploadedFileIdRef = useRef<string | null>(null);
  const persistingRef = useRef(false);
  const initUpload = useServerFn(initDocumentUpload);
  const saveJob = useServerFn(saveOcrJob);
  const getJob = useServerFn(getOcrJob);
  const delJob = useServerFn(deleteOcrJob);
  const addToKbFn = useServerFn(addOcrJobToKb);
  const saveTableFn = useServerFn(saveOcrTableResult);

  const refreshHistory = useCallback(() => { void router.invalidate(); }, [router]);

  const callOcr = useCallback(
    async (imageB64: string, mediaType: string, signal: AbortSignal, prompt?: string): Promise<string> => {
      const res = await fetch('/api/ocr', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal,
        body: JSON.stringify({ contentBase64: imageB64, mediaType, prompt }),
      });
      if (!res.ok) throw new Error(`OCR HTTP ${res.status}`);
      const { markdown } = await res.json();
      return markdown ?? '';
    },
    [],
  );

  const persist = useCallback(
    async (curPages: OcrPage[], opts: { scanned: boolean }) => {
      const file = fileRef.current;
      const withText = curPages.filter((p) => p.text).map((p) => ({ page: p.page, text: p.text!, source: (p.source ?? 'ocr') as 'parse' | 'ocr' }));
      if (!file || withText.length === 0 || persistingRef.current) return;
      persistingRef.current = true;
      try {
        if (!uploadedFileIdRef.current) {
          const init = (await initUpload({ data: { originalName: file.name, mimeType: file.type || 'application/octet-stream', size: file.size } })) as { id: string; key: string };
          await fetch(`/api/documents/upload?id=${encodeURIComponent(init.id)}&key=${encodeURIComponent(init.key)}`, {
            method: 'PUT', headers: { 'Content-Type': file.type || 'application/octet-stream' }, body: file,
          });
          uploadedFileIdRef.current = init.id;
        }
        const { id } = (await saveJob({
          data: {
            id: jobIdRef.current ?? undefined, fileId: uploadedFileIdRef.current ?? undefined,
            title: file.name.replace(/\.[^.]+$/, ''), fileName: file.name, mimeType: file.type || undefined,
            scanned: opts.scanned, pages: withText,
          },
        })) as { id: string };
        jobIdRef.current = id;
        refreshHistory();
      } catch { /* history is best-effort */ } finally { persistingRef.current = false; }
    },
    [initUpload, saveJob, refreshHistory],
  );

  const ocrOnePage = useCallback(
    async (i: number) => {
      const pg = pages[i];
      if (!pg?.imageB64) return;
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      setPages((prev) => prev.map((p, idx) => (idx === i ? { ...p, ocring: true, error: false } : p)));
      try {
        const text = await callOcr(pg.imageB64, pg.mediaType, ctrl.signal);
        const next = pages.map((p, idx) => (idx === i ? { ...p, text, source: 'ocr' as const, ocring: false } : p));
        setPages(next);
        void persist(next, { scanned });
      } catch (e) {
        const aborted = (e as Error).name === 'AbortError';
        setPages((prev) => prev.map((p, idx) => (idx === i ? { ...p, ocring: false, error: !aborted } : p)));
      }
    },
    [pages, callOcr, persist, scanned],
  );

  const ocrAll = useCallback(async () => {
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setBatchRunning(true);
    const targets = pages.map((p, i) => ({ p, i })).filter(({ p }) => p.imageB64 && p.text === null);
    let cursor = 0;
    const worker = async () => {
      while (cursor < targets.length && !ctrl.signal.aborted) {
        const { p, i } = targets[cursor++];
        setPages((prev) => prev.map((q, idx) => (idx === i ? { ...q, ocring: true } : q)));
        try {
          const text = await callOcr(p.imageB64!, p.mediaType, ctrl.signal);
          setPages((prev) => prev.map((q, idx) => (idx === i ? { ...q, text, source: 'ocr', ocring: false } : q)));
        } catch (e) {
          const aborted = (e as Error).name === 'AbortError';
          setPages((prev) => prev.map((q, idx) => (idx === i ? { ...q, ocring: false, error: !aborted } : q)));
          if (aborted) break;
        }
      }
    };
    await Promise.all([worker(), worker()]);
    setBatchRunning(false);
    setPages((cur) => { void persist(cur, { scanned }); return cur; });
  }, [pages, callOcr, persist, scanned]);

  const stopOcr = useCallback(() => { abortRef.current?.abort(); abortRef.current = null; setBatchRunning(false); setTableReading(false); }, []);

  /** Lazily render a single deep page (beyond the bulk render cap). Returns its base64 (or null). */
  const ensurePageImage = useCallback(
    async (pn: number): Promise<string | null> => {
      const file = fileRef.current;
      const pg = pages.find((p) => p.page === pn);
      if (pg?.imageB64) return pg.imageB64;
      if (!file || !pg || file.name.split('.').pop()?.toLowerCase() !== 'pdf') return null;
      setRendering(pn);
      try {
        const res = await fetch(`/api/ocr/render?page=${pn}`, { method: 'POST', headers: { 'Content-Type': 'application/pdf' }, body: file });
        const j = await res.json();
        const img = (j.pages ?? [])[0]?.image as string | undefined;
        if (img) {
          setPages((prev) => prev.map((p) => (p.page === pn ? { ...p, imageB64: img, imageUrl: `data:image/png;base64,${img}` } : p)));
          return img;
        }
        return null;
      } catch {
        return null;
      } finally {
        setRendering((r) => (r === pn ? null : r));
      }
    },
    [pages],
  );

  const toggleSelPage = useCallback((pn: number) => {
    setSelPages((prev) => (prev.includes(pn) ? prev.filter((x) => x !== pn) : [...prev, pn].sort((a, b) => a - b)));
    setTableError(null);
    void ensurePageImage(pn);
  }, [ensurePageImage]);

  /** Read the selected page(s) with the VLM, then PERSIST the result (survives reopen + gets
   *  injected into the doc on 加入知识库 — these tables are for the Agent, not just display). */
  const readSelectedTables = useCallback(async () => {
    const sel = [...selPages];
    const imgs = (await Promise.all(sel.map((pn) => ensurePageImage(pn)))).filter((b): b is string => !!b);
    if (imgs.length === 0) return;
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setTableReading(true); setTableError(null);
    try {
      const res = await fetch('/api/ocr', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: ctrl.signal,
        body: JSON.stringify({ images: imgs, mediaType: 'image/png', prompt: TABLE_PROMPT }),
      });
      const { markdown } = await res.json();
      const md = (markdown ?? '').trim();
      if (!md) { setTableError('识别为空，可重试'); return; }
      setRecognizedTables((prev) => [...prev.filter((t) => tableKey(t.pages) !== tableKey(sel)), { pages: sel, content: md }].sort((a, b) => a.pages[0] - b.pages[0]));
      // persist: ensure the job exists (file already uploaded by load), then save the table.
      if (!jobIdRef.current) await persist(pages, { scanned });
      if (jobIdRef.current) await saveTableFn({ data: { id: jobIdRef.current, pages: sel, content: md } }).catch(() => {});
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setTableError('识别失败，可重试');
    } finally { setTableReading(false); }
  }, [selPages, ensurePageImage, persist, pages, scanned, saveTableFn]);

  const resetState = useCallback(() => {
    fileRef.current = null; jobIdRef.current = null; uploadedFileIdRef.current = null;
    setFileName(null); setPages([]); setActive(0); setScanned(false); setError(null); setSavedToKb('idle');
    setSelPages([]); setRecognizedTables([]); setTableError(null); setRendering(null); setFormat('markdown'); setPhase('idle');
  }, []);

  const runLoad = useCallback(
    async (file: File) => {
      resetState();
      fileRef.current = file;
      setFileName(file.name);
      const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
      try {
        if (ext === 'pdf') {
          setPhase('loading');
          const [parseRes, renderRes] = await Promise.all([
            fetch('/api/ocr/parse', { method: 'POST', headers: { 'Content-Type': 'application/pdf' }, body: file }).then((r) => r.json()),
            fetch('/api/ocr/render', { method: 'POST', headers: { 'Content-Type': 'application/pdf' }, body: file }).then((r) => r.json()),
          ]);
          const images: Record<number, string> = {};
          for (const p of (renderRes.pages ?? []) as { page: number; image: string }[]) images[p.page] = p.image;
          const textByPage: Record<number, string> = {};
          for (const p of (parseRes.pages ?? []) as { page: number; text: string }[]) textByPage[p.page] = p.text;
          const isScanned = !!parseRes.scanned;
          setScanned(isScanned);
          const nums = Array.from(new Set([...Object.keys(images), ...Object.keys(textByPage)].map(Number))).sort((a, b) => a - b);
          const work: OcrPage[] = nums.map((n) => ({
            page: n, imageUrl: images[n] ? `data:image/png;base64,${images[n]}` : null, imageB64: images[n] ?? null,
            mediaType: 'image/png', text: !isScanned && textByPage[n] ? textByPage[n] : null,
            source: !isScanned && textByPage[n] ? 'parse' : null, ocring: false,
          }));
          if (work.length === 0) throw new Error('无法读取该 PDF');
          setPages(work);
          setPhase('ready');
          if (!isScanned) void persist(work, { scanned: false });
        } else {
          const b64 = await fileToBase64(file);
          const mt = MEDIA[ext] ?? 'image/jpeg';
          const base: OcrPage = { page: 1, imageUrl: `data:${mt};base64,${b64}`, imageB64: b64, mediaType: mt, text: null, source: null, ocring: true };
          setPages([base]); setPhase('ready');
          const ctrl = new AbortController(); abortRef.current = ctrl;
          try {
            const text = await callOcr(b64, mt, ctrl.signal);
            const next = [{ ...base, text, source: 'ocr' as const, ocring: false }];
            setPages(next); void persist(next, { scanned: true });
          } catch (e) {
            const aborted = (e as Error).name === 'AbortError';
            setPages((prev) => prev.map((p, i) => (i === 0 ? { ...p, ocring: false, error: !aborted } : p)));
          }
        }
      } catch (err) { setError(err instanceof Error ? err.message : '读取失败'); setPhase('idle'); }
    },
    [resetState, callOcr, persist],
  );

  const reopen = useCallback(
    async (id: string) => {
      resetState();
      try {
        const job = (await getJob({ data: { id } })) as { id: string; title: string; fileName: string; mimeType: string | null; scanned: boolean; pages: { page: number; text: string; source: 'parse' | 'ocr' }[]; tables?: RecognizedTable[] };
        jobIdRef.current = job.id;
        uploadedFileIdRef.current = 'reopened'; // file already in S3; don't re-upload on persist
        setFileName(job.fileName); setScanned(job.scanned);
        setPages(job.pages.map((p) => ({ page: p.page, imageUrl: null, imageB64: null, mediaType: 'image/png', text: p.text, source: p.source, ocring: false })));
        setRecognizedTables(job.tables ?? []); // restore previously-recognized tables
        setPhase('ready');
        // Pull the stored original back so previews can render + tables can be read (deep pages
        // render lazily). MinIO isn't browser-reachable → the app proxies the bytes.
        try {
          const res = await fetch(`/api/ocr/file?jobId=${encodeURIComponent(id)}`);
          if (res.ok) {
            const blob = await res.blob();
            fileRef.current = new File([blob], job.fileName, { type: job.mimeType || blob.type || 'application/octet-stream' });
            if (job.fileName.toLowerCase().endsWith('.pdf') && job.pages[0]) void ensurePageImage(job.pages[0].page);
          }
        } catch { /* original unavailable; text-only reopen */ }
      } catch { setError('打开历史失败'); }
    },
    [resetState, getJob, ensurePageImage],
  );

  const removeJob = useCallback(async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try { await delJob({ data: { id } }); refreshHistory(); } catch { /* ignore */ }
  }, [delJob, refreshHistory]);

  /** Navigate pages in the normal view, lazily rendering the target image (reopen / deep pages). */
  const goToPage = useCallback((idx: number) => {
    const clamped = Math.max(0, Math.min(pages.length - 1, idx));
    setActive(clamped);
    const pg = pages[clamped];
    if (pg && !pg.imageB64) void ensurePageImage(pg.page);
  }, [pages, ensurePageImage]);

  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => { const f = e.target.files?.[0]; if (f) void runLoad(f); };
  const onDrop = (e: React.DragEvent) => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files?.[0]; if (f) void runLoad(f); };

  const assembled = pages.map((p) => p.text ?? '').filter(Boolean).join('\n\n');
  const current = pages[active];
  const pendingCount = pages.filter((p) => p.imageB64 && p.text === null).length;
  const tablePages = findTablePages(pages); // full-doc, instant (from already-parsed text)
  const previewPage = selPages.length ? pages.find((p) => p.page === selPages[selPages.length - 1]) : undefined;

  const flashCopy = (id: string, text: string) => { void navigator.clipboard.writeText(text); setCopied(id); setTimeout(() => setCopied((c) => (c === id ? null : c)), 1600); };
  const copyAll = () => flashCopy('all', format === 'text' ? mdToText(assembled) : assembled);
  const copyPage = () => current?.text && flashCopy('page', format === 'text' ? mdToText(current.text) : current.text);
  const exportOut = () => {
    const body = format === 'text' ? mdToText(assembled) : assembled;
    const ext = format === 'text' ? 'txt' : 'md';
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([body], { type: 'text/plain' }));
    a.download = `${(fileName ?? 'ocr').replace(/\.[^.]+$/, '')}.${ext}`;
    a.click(); URL.revokeObjectURL(a.href);
  };
  const addToKb = async () => {
    if (savedToKb !== 'idle' || !assembled) return;
    setSavedToKb('saving');
    try {
      if (!jobIdRef.current) await persist(pages, { scanned });
      if (!jobIdRef.current) throw new Error('no job');
      await addToKbFn({ data: { id: jobIdRef.current } });
      setSavedToKb('done');
    } catch { setSavedToKb('idle'); setError('加入知识库失败，请重试'); }
  };
  const fmtDate = (d: unknown) => { try { return new Date(d as string).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }); } catch { return ''; } };

  if (phase === 'idle' && pages.length === 0) {
    return (
      <div className="mx-auto flex h-[calc(100vh-theme(spacing.16))] w-full max-w-2xl flex-col items-center justify-center gap-6 p-8">
        <div className="flex items-center gap-2 text-lg font-medium"><ScanText className="h-5 w-5 text-primary" />文字识别</div>
        <button type="button" onClick={() => inputRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }} onDragLeave={() => setDragOver(false)} onDrop={onDrop}
          className={`flex w-full flex-col items-center gap-3 rounded-xl border-2 border-dashed px-8 py-14 transition-colors ${dragOver ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50 hover:bg-accent/30'}`}>
          <FileUp className="h-9 w-9 text-primary" />
          <span className="text-base font-medium text-foreground">拖入 PDF 或图片，转成可编辑文本</span>
          <span className="text-xs text-muted-foreground">文字版 PDF 直接解析；扫描件 / 照片用 AI 识别</span>
        </button>
        {error && <p className="flex items-center gap-1.5 text-sm text-destructive"><AlertCircle className="h-4 w-4" />{error}</p>}
        {initialHistory.length > 0 && (
          <div className="w-full">
            <div className="mb-2 flex items-center gap-1.5 text-xs text-muted-foreground"><Clock className="h-3.5 w-3.5" />最近转换</div>
            <div className="space-y-1">
              {initialHistory.map((h) => (
                <button key={h.id} type="button" onClick={() => void reopen(h.id)} className="group flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left transition-colors hover:bg-accent/40">
                  <ScanText className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate text-sm">{h.title}</span>
                  {h.scanned && <span className="shrink-0 rounded bg-amber-500/10 px-1.5 text-[10px] text-amber-600">扫描</span>}
                  <span className="shrink-0 text-[11px] text-muted-foreground">{h.pageCount} 页 · {fmtDate(h.createdAt)}</span>
                  <span role="button" tabIndex={-1} onClick={(e) => void removeJob(h.id, e)} className="shrink-0 rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"><Trash2 className="h-3.5 w-3.5" /></span>
                </button>
              ))}
            </div>
          </div>
        )}
        <input ref={inputRef} type="file" accept={ACCEPT} className="hidden" onChange={onPick} />
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-theme(spacing.16))] flex-col">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2.5">
        <span className="flex min-w-0 items-center gap-2 text-sm font-medium">
          <button type="button" onClick={resetState} title="新转换 / 返回" className="shrink-0 rounded-md border px-1.5 py-1 text-muted-foreground hover:bg-accent"><RotateCcw className="h-3.5 w-3.5" /></button>
          <ScanText className="h-4 w-4 shrink-0 text-primary" />
          <span className="truncate">{fileName}</span>
          {phase === 'loading' ? (
            <span className="flex items-center gap-1 text-xs text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" />解析中…</span>
          ) : scanned ? (
            <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] text-amber-600">扫描件 · 需 AI 识别</span>
          ) : (
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] text-primary">已解析 · {pages.length} 页</span>
          )}
        </span>
        <div className="flex items-center gap-2">
          {(batchRunning || pages.some((p) => p.ocring) || tableReading) && (
            <button type="button" onClick={stopOcr} className="flex items-center gap-1 rounded-md border border-destructive/40 px-2 py-1 text-xs text-destructive hover:bg-destructive/10"><Square className="h-3 w-3" />停止</button>
          )}
          {pendingCount > 0 && !batchRunning && format !== 'tables' && (
            <button type="button" onClick={() => void ocrAll()} className="flex items-center gap-1 rounded-md border px-2 py-1 text-xs hover:bg-accent"><Sparkles className="h-3 w-3" />识别全部 {pendingCount} 页</button>
          )}
          <div className="flex items-center gap-1 rounded-lg bg-muted p-0.5">
            {(['markdown', 'text', 'tables'] as OutputFormat[]).map((f) => (
              <button key={f} type="button" onClick={() => setFormat(f)}
                className={`rounded-md px-2.5 py-1 text-xs transition-colors ${format === f ? 'bg-background font-medium text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>
                {f === 'markdown' ? 'Markdown' : f === 'text' ? '纯文本' : `表格${tablePages.length ? ` ${tablePages.length}` : ''}`}
              </button>
            ))}
          </div>
        </div>
      </div>

      {format === 'tables' ? (
        <div className="grid min-h-0 flex-1 grid-cols-[300px_1fr]">
          {/* left: table-page list (scrolls) + ALWAYS-VISIBLE action footer */}
          <div className="flex min-h-0 flex-col border-r">
            <div className="flex items-center justify-between gap-1.5 border-b px-3 py-2 text-[11px] text-muted-foreground">
              <span className="flex items-center gap-1.5"><TableIcon className="h-3.5 w-3.5" />检测到的表格{tablePages.length ? ` · ${tablePages.length}` : ''}</span>
              {selPages.length > 0 && <button type="button" onClick={() => setSelPages([])} className="hover:text-foreground">清空</button>}
            </div>
            <div className="min-h-0 flex-1 overflow-auto p-3">
              {!fileRef.current ? (
                <p className="text-xs text-muted-foreground">历史记录未保留原文件，无法读取表格。请重新上传该文件。</p>
              ) : tablePages.length === 0 ? (
                <p className="text-xs text-muted-foreground">未在解析结果中检测到表格。</p>
              ) : (
                <div className="space-y-1">
                  {tablePages.map((t) => {
                    const sel = selPages.includes(t.page);
                    return (
                      <button key={t.page} type="button" onClick={() => toggleSelPage(t.page)}
                        className={`flex w-full items-center gap-2 rounded-md border px-2 py-1.5 text-left text-xs transition-colors ${sel ? 'border-primary bg-primary/5' : 'hover:bg-accent/40'}`}>
                        {sel ? <CheckSquare className="h-3.5 w-3.5 shrink-0 text-primary" /> : <Square className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
                        <span className="flex-1">第 {t.page} 页</span>
                        {t.via === 'heuristic' && <span className="rounded bg-amber-500/10 px-1 text-[10px] text-amber-600">推测</span>}
                        <span className="text-muted-foreground">{t.cells} 项</span>
                        {t.big && <span className="rounded bg-primary/10 px-1 text-[10px] text-primary">大表</span>}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
            <div className="border-t p-3">
              {selPages.length > 0 ? (
                <button type="button" disabled={tableReading} onClick={() => void readSelectedTables()}
                  className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-primary px-2 py-2 text-xs text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
                  {tableReading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                  用 AI 识别选中 {selPages.length} 页{selPages.length > 1 ? '（跨页合并）' : ''}
                </button>
              ) : (
                <p className="text-[10px] leading-relaxed text-muted-foreground">勾选 1 页（连续多页 = 跨页表）→ 点「用 AI 识别」。AI 读整页，定位不准也无妨。</p>
              )}
            </div>
          </div>
          {/* right: selected-page preview + prominent read button + AI result */}
          <div className="min-h-0 overflow-auto p-3">
            {selPages.length > 0 && !tableReading && (
              <button type="button" onClick={() => void readSelectedTables()}
                className="mb-3 flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90">
                <Sparkles className="h-4 w-4" />{recognizedTables.some((t) => tableKey(t.pages) === tableKey(selPages)) ? '重新识别' : '用 AI 识别'}选中 {selPages.length} 页{selPages.length > 1 ? '（跨页合并）' : ''}
              </button>
            )}
            {tableReading && <div className="mb-3 flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />AI 识别中…</div>}
            {tableError && <p className="mb-3 text-sm text-destructive">{tableError}</p>}
            {rendering !== null && selPages.includes(rendering) ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />正在渲染第 {rendering} 页…</div>
            ) : previewPage?.imageUrl ? (
              <img src={previewPage.imageUrl} alt={`page ${previewPage.page}`} className="w-full max-w-[560px] rounded-md border" />
            ) : (
              <p className="text-xs text-muted-foreground">{selPages.length ? '本页无预览图' : '← 从左侧勾选有表格的页面'}</p>
            )}
            {recognizedTables.length > 0 && (
              <div className="mt-4 space-y-3">
                <div className="text-[11px] text-muted-foreground">已识别并保存的表格（{recognizedTables.length}）· 加入知识库时随文档一起交给 AI 检索</div>
                {recognizedTables.map((t) => (
                  <div key={tableKey(t.pages)} className="rounded-lg border">
                    <div className="flex items-center justify-between border-b px-3 py-1.5">
                      <span className="text-[11px] text-muted-foreground">第 {t.pages.join('、')} 页{isHtmlTable(t.content) ? ' · HTML' : ''}</span>
                      <button type="button" onClick={() => flashCopy(`rt-${tableKey(t.pages)}`, t.content)} className="flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] hover:bg-accent">
                        {copied === `rt-${tableKey(t.pages)}` ? <Check className="h-3 w-3 text-primary" /> : <Copy className="h-3 w-3" />}复制
                      </button>
                    </div>
                    <div className="overflow-auto p-3 text-sm">
                      {isHtmlTable(t.content) ? <div dangerouslySetInnerHTML={{ __html: sanitizeHtml(t.content) }} /> : <StreamingMarkdown content={t.content} isStreaming={false} mode="minimal" />}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-2">
          <div className="min-h-0 overflow-auto border-r p-3">
            <div className="mb-2 text-[11px] text-muted-foreground">原始页 · 第 {current?.page ?? 1} 页</div>
            {current?.imageUrl ? (
              <img src={current.imageUrl} alt={`page ${current.page}`} className="w-full rounded-md border" />
            ) : rendering !== null && current?.page === rendering ? (
              <div className="flex items-center gap-2 rounded-md border border-dashed p-8 text-xs text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />正在渲染本页…</div>
            ) : (
              <div className="rounded-md border border-dashed p-8 text-center text-xs text-muted-foreground">{fileRef.current ? '加载中…' : '本页无预览图'}</div>
            )}
          </div>
          <div className="min-h-0 overflow-auto p-4">
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="text-[11px] text-muted-foreground">识别文本{current?.source === 'parse' ? '（解析器）' : current?.source === 'ocr' ? '（AI 识别）' : ''}</span>
              <div className="flex items-center gap-1.5">
                {current?.text && <button type="button" onClick={copyPage} className="flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] hover:bg-accent">{copied === 'page' ? <Check className="h-3 w-3 text-primary" /> : <Copy className="h-3 w-3" />}复制本页</button>}
                {current?.imageB64 && !current.ocring && <button type="button" onClick={() => void ocrOnePage(active)} className="flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] hover:bg-accent"><Sparkles className="h-3 w-3" />{current.text === null ? '识别这页' : '用 AI 重新识别'}</button>}
              </div>
            </div>
            {current?.ocring ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />AI 识别中…</div>
            ) : current?.error ? (
              <p className="text-sm text-destructive">本页识别失败，可重试</p>
            ) : current?.text === null ? (
              <p className="text-sm text-muted-foreground">此页无文字层。点上方「识别这页」用 AI 识别。</p>
            ) : format === 'text' ? (
              <pre className="whitespace-pre-wrap font-mono text-xs leading-relaxed text-foreground">{mdToText(current?.text || '')}</pre>
            ) : (
              <StreamingMarkdown content={current?.text || ''} isStreaming={false} mode="minimal" />
            )}
          </div>
        </div>
      )}

      <div className="flex items-center justify-between gap-2 border-t px-4 py-2">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          {format !== 'tables' && (
            <>
              <button type="button" disabled={active === 0} onClick={() => goToPage(active - 1)} className="disabled:opacity-30"><ChevronLeft className="h-4 w-4" /></button>
              <span>{current?.page ?? 1} / {pages.length}</span>
              <button type="button" disabled={active >= pages.length - 1} onClick={() => goToPage(active + 1)} className="disabled:opacity-30"><ChevronRight className="h-4 w-4" /></button>
            </>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={copyAll} disabled={!assembled} className="flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs hover:bg-accent disabled:opacity-40">{copied === 'all' ? <Check className="h-3.5 w-3.5 text-primary" /> : <Copy className="h-3.5 w-3.5" />}{copied === 'all' ? '已复制' : '复制全文'}</button>
          <button type="button" onClick={exportOut} disabled={!assembled} className="flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs hover:bg-accent disabled:opacity-40"><Download className="h-3.5 w-3.5" />导出</button>
          <button type="button" onClick={addToKb} disabled={!assembled || savedToKb !== 'idle'} className="flex items-center gap-1.5 rounded-lg bg-primary px-2.5 py-1.5 text-xs text-primary-foreground hover:bg-primary/90 disabled:opacity-50">{savedToKb === 'saving' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : savedToKb === 'done' ? <Check className="h-3.5 w-3.5" /> : <BookPlus className="h-3.5 w-3.5" />}{savedToKb === 'done' ? '已加入' : '加入知识库'}</button>
        </div>
      </div>
      {error && <p className="border-t px-4 py-1.5 text-xs text-destructive">{error}</p>}
    </div>
  );
}
