/**
 * OCR standalone converter (OCR module O2 v2.2) — leftmost-rail "文字识别" module.
 *
 * 解析优先：文字 PDF 走 /api/ocr/parse；某页不对→逐页「用 AI 重识别」；扫描件→可识别全部；
 * OCR 可「停止」。左原图↔右文本，复制(整篇/本页)/导出/加入知识库。
 *  ① 单页复制  ③ 表格模式(查看/复制/AI 重新生成，不规则表→HTML)
 *  ② 历史：每次转换自动存(ocr_jobs)，空状态列「最近转换」，可重开/删除，刷新不丢。
 */
import { createFileRoute, useRouter } from '@tanstack/react-router';
import { useServerFn } from '@tanstack/react-start';
import { useCallback, useMemo, useRef, useState } from 'react';
import {
  ScanText, FileUp, Copy, Check, Download, BookPlus, ChevronLeft, ChevronRight,
  Loader2, AlertCircle, Sparkles, Square, Trash2, RotateCcw, Clock,
} from 'lucide-react';
import { StreamingMarkdown } from '~/components/claude-chat/streaming-markdown';
import { initDocumentUpload } from '~/server/function/documents.server';
import { saveOcrJob, listOcrJobs, getOcrJob, deleteOcrJob, addOcrJobToKb } from '~/server/function/ocr.server';

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
interface DetectedTable { key: string; page: number; md: string }
interface HistoryItem {
  id: string;
  title: string;
  fileName: string;
  mimeType: string | null;
  pageCount: number;
  scanned: boolean;
  createdAt: string | Date;
}

const ACCEPT = '.pdf,.png,.jpg,.jpeg,.webp';
const MEDIA: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' };
const TABLE_PROMPT =
  '只提取这张图里的表格。如果是标准规则表格（行列整齐、无合并单元格），输出 Markdown 表格；' +
  '如果表格不规则（有合并单元格/跨行跨列/嵌套表头），改用 HTML <table> 标签输出以保留结构。' +
  '只输出表格本身，不要任何额外文字或解释。看不清的单元格留空，不要编造。';

function fileToBase64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const s = String(r.result);
      const c = s.indexOf(',');
      resolve(c >= 0 ? s.slice(c + 1) : s);
    };
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
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/\son\w+\s*=\s*"[^"]*"/gi, '').replace(/\son\w+\s*=\s*'[^']*'/gi, '');
}
const isHtmlTable = (s: string) => /<table[\s>]/i.test(s);

function detectTables(pages: OcrPage[]): DetectedTable[] {
  const tables: DetectedTable[] = [];
  for (const p of pages) {
    if (!p.text) continue;
    // 1) HTML <table> blocks (the parser's primary table output with --markdown-with-html;
    //    borderless financial tables come through here thanks to --table-method cluster).
    const htmlBlocks = p.text.match(/<table[\s\S]*?<\/table>/gi) ?? [];
    for (const html of htmlBlocks) {
      tables.push({ key: `${p.page}-${tables.length}`, page: p.page, md: html.trim() });
    }
    // 2) Markdown pipe-tables (fallback for any emitted as | ... | with a |---| separator).
    const lines = p.text.replace(/<table[\s\S]*?<\/table>/gi, '').split('\n');
    let buf: string[] = [];
    const flush = () => {
      const hasSep = buf.some((l) => /-/.test(l) && /^\s*\|?[\s:|-]+\|?\s*$/.test(l));
      if (buf.length >= 2 && hasSep) tables.push({ key: `${p.page}-${tables.length}`, page: p.page, md: buf.join('\n').trim() });
      buf = [];
    };
    for (const line of lines) {
      if (/^\s*\|.*\|/.test(line) || (buf.length > 0 && /^\s*\|/.test(line))) buf.push(line);
      else flush();
    }
    flush();
  }
  return tables;
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
  const [tableOverrides, setTableOverrides] = useState<Record<string, string>>({});
  const [tableRegen, setTableRegen] = useState<Record<string, boolean>>({});
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

  /** ② Auto-save / update the conversion in history (upload file once, then upsert job). */
  const persist = useCallback(
    async (curPages: OcrPage[], opts: { scanned: boolean }) => {
      const file = fileRef.current;
      const withText = curPages.filter((p) => p.text).map((p) => ({ page: p.page, text: p.text!, source: (p.source ?? 'ocr') as 'parse' | 'ocr' }));
      if (!file || withText.length === 0 || persistingRef.current) return;
      persistingRef.current = true;
      try {
        if (!uploadedFileIdRef.current) {
          const init = (await initUpload({
            data: { originalName: file.name, mimeType: file.type || 'application/octet-stream', size: file.size },
          })) as { id: string; key: string };
          await fetch(`/api/documents/upload?id=${encodeURIComponent(init.id)}&key=${encodeURIComponent(init.key)}`, {
            method: 'PUT', headers: { 'Content-Type': file.type || 'application/octet-stream' }, body: file,
          });
          uploadedFileIdRef.current = init.id;
        }
        const { id } = (await saveJob({
          data: {
            id: jobIdRef.current ?? undefined,
            fileId: uploadedFileIdRef.current ?? undefined,
            title: file.name.replace(/\.[^.]+$/, ''),
            fileName: file.name,
            mimeType: file.type || undefined,
            scanned: opts.scanned,
            pages: withText,
          },
        })) as { id: string };
        jobIdRef.current = id;
        refreshHistory();
      } catch {
        /* history is best-effort; don't block the converter */
      } finally {
        persistingRef.current = false;
      }
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

  const stopOcr = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setBatchRunning(false);
  }, []);

  const regenerateTable = useCallback(
    async (t: DetectedTable) => {
      const pg = pages.find((p) => p.page === t.page);
      if (!pg?.imageB64) return;
      setTableRegen((m) => ({ ...m, [t.key]: true }));
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      try {
        const out = await callOcr(pg.imageB64, pg.mediaType, ctrl.signal, TABLE_PROMPT);
        setTableOverrides((m) => ({ ...m, [t.key]: out.trim() }));
      } catch {
        /* leave original */
      } finally {
        setTableRegen((m) => ({ ...m, [t.key]: false }));
      }
    },
    [pages, callOcr],
  );

  const resetState = useCallback(() => {
    fileRef.current = null;
    jobIdRef.current = null;
    uploadedFileIdRef.current = null;
    setFileName(null);
    setPages([]);
    setActive(0);
    setScanned(false);
    setError(null);
    setSavedToKb('idle');
    setTableOverrides({});
    setTableRegen({});
    setPhase('idle');
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
            page: n,
            imageUrl: images[n] ? `data:image/png;base64,${images[n]}` : null,
            imageB64: images[n] ?? null,
            mediaType: 'image/png',
            text: !isScanned && textByPage[n] ? textByPage[n] : null,
            source: !isScanned && textByPage[n] ? 'parse' : null,
            ocring: false,
          }));
          if (work.length === 0) throw new Error('无法读取该 PDF');
          setPages(work);
          setPhase('ready');
          if (!isScanned) void persist(work, { scanned: false }); // text PDF → save parsed text now
        } else {
          const b64 = await fileToBase64(file);
          const mt = MEDIA[ext] ?? 'image/jpeg';
          const base: OcrPage = { page: 1, imageUrl: `data:${mt};base64,${b64}`, imageB64: b64, mediaType: mt, text: null, source: null, ocring: true };
          setPages([base]);
          setPhase('ready');
          const ctrl = new AbortController();
          abortRef.current = ctrl;
          try {
            const text = await callOcr(b64, mt, ctrl.signal);
            const next = [{ ...base, text, source: 'ocr' as const, ocring: false }];
            setPages(next);
            void persist(next, { scanned: true });
          } catch (e) {
            const aborted = (e as Error).name === 'AbortError';
            setPages((prev) => prev.map((p, i) => (i === 0 ? { ...p, ocring: false, error: !aborted } : p)));
          }
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : '读取失败');
        setPhase('idle');
      }
    },
    [resetState, callOcr, persist],
  );

  const reopen = useCallback(
    async (id: string) => {
      resetState();
      try {
        const job = (await getJob({ data: { id } })) as {
          id: string; title: string; fileName: string; scanned: boolean;
          pages: { page: number; text: string; source: 'parse' | 'ocr' }[];
        };
        jobIdRef.current = job.id;
        setFileName(job.fileName);
        setScanned(job.scanned);
        setPages(
          job.pages.map((p) => ({
            page: p.page, imageUrl: null, imageB64: null, mediaType: 'image/png',
            text: p.text, source: p.source, ocring: false,
          })),
        );
        setPhase('ready');
      } catch {
        setError('打开历史失败');
      }
    },
    [resetState, getJob],
  );

  const removeJob = useCallback(
    async (id: string, e: React.MouseEvent) => {
      e.stopPropagation();
      try {
        await delJob({ data: { id } });
        refreshHistory();
      } catch {
        /* ignore */
      }
    },
    [delJob, refreshHistory],
  );

  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) void runLoad(f);
  };
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f) void runLoad(f);
  };

  const tables = useMemo(() => detectTables(pages), [pages]);
  const assembled = pages.map((p) => p.text ?? '').filter(Boolean).join('\n\n');
  const current = pages[active];
  const pendingCount = pages.filter((p) => p.imageB64 && p.text === null).length;

  const flashCopy = (id: string, text: string) => {
    void navigator.clipboard.writeText(text);
    setCopied(id);
    setTimeout(() => setCopied((c) => (c === id ? null : c)), 1600);
  };
  const copyAll = () => flashCopy('all', format === 'text' ? mdToText(assembled) : assembled);
  const copyPage = () => current?.text && flashCopy('page', format === 'text' ? mdToText(current.text) : current.text);
  const exportOut = () => {
    const body = format === 'text' ? mdToText(assembled) : assembled;
    const ext = format === 'text' ? 'txt' : 'md';
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([body], { type: 'text/plain' }));
    a.download = `${(fileName ?? 'ocr').replace(/\.[^.]+$/, '')}.${ext}`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const addToKb = async () => {
    if (savedToKb !== 'idle' || !assembled) return;
    setSavedToKb('saving');
    try {
      if (!jobIdRef.current) await persist(pages, { scanned }); // ensure persisted (have a job + file)
      if (!jobIdRef.current) throw new Error('no job');
      await addToKbFn({ data: { id: jobIdRef.current } });
      setSavedToKb('done');
    } catch {
      setSavedToKb('idle');
      setError('加入知识库失败，请重试');
    }
  };

  const fmtDate = (d: unknown) => {
    try { return new Date(d as string).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }); }
    catch { return ''; }
  };

  if (phase === 'idle' && pages.length === 0) {
    return (
      <div className="mx-auto flex h-[calc(100vh-theme(spacing.16))] w-full max-w-2xl flex-col items-center justify-center gap-6 p-8">
        <div className="flex items-center gap-2 text-lg font-medium">
          <ScanText className="h-5 w-5 text-primary" />文字识别
        </div>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          className={`flex w-full flex-col items-center gap-3 rounded-xl border-2 border-dashed px-8 py-14 transition-colors ${
            dragOver ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50 hover:bg-accent/30'
          }`}
        >
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
                <button key={h.id} type="button" onClick={() => void reopen(h.id)}
                  className="group flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left transition-colors hover:bg-accent/40">
                  <ScanText className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate text-sm">{h.title}</span>
                  {h.scanned && <span className="shrink-0 rounded bg-amber-500/10 px-1.5 text-[10px] text-amber-600">扫描</span>}
                  <span className="shrink-0 text-[11px] text-muted-foreground">{h.pageCount} 页 · {fmtDate(h.createdAt)}</span>
                  <span role="button" tabIndex={-1} onClick={(e) => void removeJob(h.id, e)}
                    className="shrink-0 rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100">
                    <Trash2 className="h-3.5 w-3.5" />
                  </span>
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
          <button type="button" onClick={resetState} title="新转换 / 返回" className="shrink-0 rounded-md border px-1.5 py-1 text-muted-foreground hover:bg-accent">
            <RotateCcw className="h-3.5 w-3.5" />
          </button>
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
          {(batchRunning || pages.some((p) => p.ocring)) && (
            <button type="button" onClick={stopOcr} className="flex items-center gap-1 rounded-md border border-destructive/40 px-2 py-1 text-xs text-destructive hover:bg-destructive/10">
              <Square className="h-3 w-3" />停止
            </button>
          )}
          {pendingCount > 0 && !batchRunning && (
            <button type="button" onClick={() => void ocrAll()} className="flex items-center gap-1 rounded-md border px-2 py-1 text-xs hover:bg-accent">
              <Sparkles className="h-3 w-3" />识别全部 {pendingCount} 页
            </button>
          )}
          <div className="flex items-center gap-1 rounded-lg bg-muted p-0.5">
            {(['markdown', 'text', 'tables'] as OutputFormat[]).map((f) => (
              <button key={f} type="button" onClick={() => setFormat(f)}
                className={`rounded-md px-2.5 py-1 text-xs transition-colors ${format === f ? 'bg-background font-medium text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>
                {f === 'markdown' ? 'Markdown' : f === 'text' ? '纯文本' : `表格${tables.length ? ` ${tables.length}` : ''}`}
              </button>
            ))}
          </div>
        </div>
      </div>

      {format === 'tables' ? (
        <div className="min-h-0 flex-1 overflow-auto p-4">
          {tables.length === 0 ? (
            <p className="text-sm text-muted-foreground">未检测到表格。若原文有表格未识别出，可在「Markdown」视图对该页「用 AI 重新识别」。</p>
          ) : (
            <div className="space-y-4">
              {tables.map((t) => {
                const content = tableOverrides[t.key] ?? t.md;
                const html = isHtmlTable(content);
                return (
                  <div key={t.key} className="rounded-lg border">
                    <div className="flex items-center justify-between border-b px-3 py-1.5">
                      <span className="text-[11px] text-muted-foreground">第 {t.page} 页{html ? ' · HTML' : ''}{tableOverrides[t.key] ? ' · AI 重生成' : ''}</span>
                      <div className="flex items-center gap-1.5">
                        <button type="button" onClick={() => flashCopy(`t-${t.key}`, content)} className="flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] hover:bg-accent">
                          {copied === `t-${t.key}` ? <Check className="h-3 w-3 text-primary" /> : <Copy className="h-3 w-3" />}复制
                        </button>
                        <button type="button" disabled={tableRegen[t.key]} onClick={() => void regenerateTable(t)} className="flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] hover:bg-accent disabled:opacity-50">
                          {tableRegen[t.key] ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}AI 重新生成
                        </button>
                      </div>
                    </div>
                    <div className="overflow-auto p-3 text-sm">
                      {html ? <div className="ocr-html-table" dangerouslySetInnerHTML={{ __html: sanitizeHtml(content) }} /> : <StreamingMarkdown content={content} isStreaming={false} mode="minimal" />}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-2">
          <div className="min-h-0 overflow-auto border-r p-3">
            <div className="mb-2 text-[11px] text-muted-foreground">原始页 · 第 {current?.page ?? 1} 页</div>
            {current?.imageUrl ? (
              <img src={current.imageUrl} alt={`page ${current.page}`} className="w-full rounded-md border" />
            ) : (
              <div className="rounded-md border border-dashed p-8 text-center text-xs text-muted-foreground">本页无预览图（历史记录只存文本）</div>
            )}
          </div>
          <div className="min-h-0 overflow-auto p-4">
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="text-[11px] text-muted-foreground">
                识别文本{current?.source === 'parse' ? '（解析器）' : current?.source === 'ocr' ? '（AI 识别）' : ''}
              </span>
              <div className="flex items-center gap-1.5">
                {current?.text && (
                  <button type="button" onClick={copyPage} className="flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] hover:bg-accent">
                    {copied === 'page' ? <Check className="h-3 w-3 text-primary" /> : <Copy className="h-3 w-3" />}复制本页
                  </button>
                )}
                {current?.imageB64 && !current.ocring && (
                  <button type="button" onClick={() => void ocrOnePage(active)} className="flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] hover:bg-accent">
                    <Sparkles className="h-3 w-3" />{current.text === null ? '识别这页' : '用 AI 重新识别'}
                  </button>
                )}
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
              <button type="button" disabled={active === 0} onClick={() => setActive((a) => Math.max(0, a - 1))} className="disabled:opacity-30"><ChevronLeft className="h-4 w-4" /></button>
              <span>{current?.page ?? 1} / {pages.length}</span>
              <button type="button" disabled={active >= pages.length - 1} onClick={() => setActive((a) => Math.min(pages.length - 1, a + 1))} className="disabled:opacity-30"><ChevronRight className="h-4 w-4" /></button>
            </>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={copyAll} disabled={!assembled} className="flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs hover:bg-accent disabled:opacity-40">
            {copied === 'all' ? <Check className="h-3.5 w-3.5 text-primary" /> : <Copy className="h-3.5 w-3.5" />}{copied === 'all' ? '已复制' : '复制全文'}
          </button>
          <button type="button" onClick={exportOut} disabled={!assembled} className="flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs hover:bg-accent disabled:opacity-40">
            <Download className="h-3.5 w-3.5" />导出
          </button>
          <button type="button" onClick={addToKb} disabled={!assembled || savedToKb !== 'idle'} className="flex items-center gap-1.5 rounded-lg bg-primary px-2.5 py-1.5 text-xs text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
            {savedToKb === 'saving' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : savedToKb === 'done' ? <Check className="h-3.5 w-3.5" /> : <BookPlus className="h-3.5 w-3.5" />}
            {savedToKb === 'done' ? '已加入' : '加入知识库'}
          </button>
        </div>
      </div>
      {error && <p className="border-t px-4 py-1.5 text-xs text-destructive">{error}</p>}
    </div>
  );
}
