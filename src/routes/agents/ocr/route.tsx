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
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ScanText, FileUp, Copy, Check, Download, BookPlus, ChevronLeft, ChevronRight,
  Loader2, AlertCircle, Sparkles, Square, CheckSquare, Trash2, RotateCcw, Clock, Table as TableIcon,
} from 'lucide-react';
import { StreamingMarkdown } from '~/components/claude-chat/streaming-markdown';
import { initDocumentUpload } from '~/server/function/documents.server';
import { saveOcrJob, saveOcrTableResult, listOcrJobs, getOcrJob, deleteOcrJob, addOcrJobToKb } from '~/server/function/ocr.server';

interface RecognizedTable { pages: number[]; content: string }
const tableKey = (ps: number[]) => [...ps].sort((a, b) => a - b).join(',');
/** BUG-008: 单文件大小白名单 — 与后端 OCR_MAX_BODY_BYTES 25MB 留出 base64 inflation 余量。
 *  超限前端先拒，避免用户上传 80MB 后等几秒才收到 413。 */
const MAX_FILE_BYTES = 20 * 1024 * 1024;
/** BUG-008 返工: 前端 parse/render fetch 各自的客户端超时（与后端 90s 留余量到 100s，让 server
 *  超时先触发 → 客户端拿到的是 504 + 明确文案；client 端只兜 server 不响应这种最坏路径）。 */
const PARSE_RENDER_CLIENT_TIMEOUT_MS = 100_000;

/** BUG-008 返工: 给 fetch 套 AbortSignal + 超时 + r.ok 校验 + 明确错误回流。供 parse/render 用。 */
async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number, label: string): Promise<unknown> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    if (!res.ok) {
      let detail = `${label} HTTP ${res.status}`;
      try { const j = await res.json(); if (j?.error) detail = `${label} HTTP ${res.status}: ${j.error}`; } catch { /* not JSON */ }
      throw new Error(detail);
    }
    return await res.json();
  } catch (e) {
    if ((e as Error).name === 'AbortError') {
      throw new Error(`${label} 超时（${timeoutMs / 1000}s 内无响应），可重试`);
    }
    throw e;
  } finally {
    clearTimeout(t);
  }
}

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

/** OCR-nav: one row in the page-navigation strip — a lazily-rendered thumbnail (loads only when
 *  scrolled into view, via IntersectionObserver) with a status badge + page number overlaid.
 *  Why a real thumbnail (not just a status dot): our users (lawyers/finance) recognize pages by
 *  LAYOUT ("the signature page", "the financials table"), not by page number — a 96px-wide thumb
 *  is too small to READ but plenty to tell a table from prose from a title page. Cost is bounded:
 *  it renders at dpi=40 only for visible rows and reuses any full image already on hand. */
function PageThumb({
  page, label, statusColor, statusTitle, isActive, thumb, ocring, onClick, onVisible,
}: {
  page: number; label: string; statusColor: string; statusTitle: string; isActive: boolean;
  thumb: string | undefined; ocring: boolean; onClick: () => void; onVisible: () => void;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || thumb) return; // already have it → no need to observe
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) if (e.isIntersecting) { onVisible(); io.disconnect(); break; }
    }, { rootMargin: '200px' }); // prefetch slightly before it scrolls in
    io.observe(el);
    return () => io.disconnect();
  }, [thumb, onVisible]);
  return (
    <button ref={ref} type="button" onClick={onClick} title={`第 ${page} 页 · ${statusTitle}`}
      className={`group relative flex h-[8.5rem] w-full flex-col items-stretch overflow-hidden rounded-md border transition-colors ${isActive ? 'border-primary ring-1 ring-primary' : 'border-border hover:border-primary/50'}`}>
      <div className="relative min-h-0 flex-1 w-full bg-muted/40">
        {thumb ? (
          <img src={`data:image/png;base64,${thumb}`} alt={`第 ${page} 页`} loading="lazy" className="h-full w-full object-cover object-top" />
        ) : ocring ? (
          <div className="flex h-full items-center justify-center"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>
        ) : (
          <div className="flex h-full items-center justify-center text-[10px] text-muted-foreground/60">第 {page} 页</div>
        )}
        {/* status badge (top-right) + page number (bottom-left) overlaid on the thumb */}
        <span title={statusTitle} className={`absolute right-1 top-1 h-2.5 w-2.5 rounded-full ring-1 ring-background ${statusColor}`} />
        <span className="absolute bottom-0 left-0 rounded-tr bg-background/80 px-1 text-[10px] text-muted-foreground">{page}</span>
      </div>
      <span className={`truncate px-1 py-0.5 text-center text-[10px] ${isActive ? 'font-medium text-foreground' : 'text-muted-foreground'}`}>{label}</span>
    </button>
  );
}

const ACCEPT = '.pdf,.png,.jpg,.jpeg,.webp';
const MEDIA: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' };
// We give the VLM the page IMAGE + the parser's text (prose right, table mangled) and ask it to
// return the WHOLE page with ONLY the table swapped for a correct HTML <table>. The page image is
// the source of truth for the table; the parser text keeps the prose faithful (no prose re-OCR).
// Output = the corrected full page → it REPLACES the parser page for display AND for the Agent.
const PAGE_PROMPT =
  '下面是文档某一页的图片，以及解析器从这页提取的文字——正文基本正确，但其中的表格被压平成了错乱文字。' +
  '请输出这一页的完整内容（HTML）：正文照抄解析器文字、保持原样，用 <p> 分段；把错乱的表格部分替换为' +
  '按图片还原的正确表格，用 <table>（含 <thead>/<tbody>/<tr>/<th>/<td>，还原表头层级、合并单元格与数字，' +
  '看不清的留空、不要编造）。若跨多页同属一张表请合并。按阅读顺序排列，只输出该页内容本身的 HTML，' +
  '不要解释、不要用 ``` 代码块包裹。';

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
  /** BUG-008 返工：阶段进度细化。OCR-UX-C：parse/render 是并行 allSettled，旧的 'parse'|'render'
   *  两态从不切到 'render' → "渲染中…"是死分支。改成并行时显示"解析+渲染中…"（一个布尔即可）。 */
  const [loadingStage, setLoadingStage] = useState<boolean>(false);
  const [scanned, setScanned] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [savedToKb, setSavedToKb] = useState<'idle' | 'saving' | 'done'>('idle');
  const [dragOver, setDragOver] = useState(false);
  const [batchRunning, setBatchRunning] = useState(false);
  // table-v3.1: detection derived from parsed text (full coverage); selection → VLM read
  const [selPages, setSelPages] = useState<number[]>([]); // ☑️-checked pages (for cross-page merge)
  const [viewPage, setViewPage] = useState<number | null>(null); // page being VIEWED in the comparison
  const [recognizedTables, setRecognizedTables] = useState<RecognizedTable[]>([]); // persisted VLM tables
  const [tableReading, setTableReading] = useState(false);
  const [tableError, setTableError] = useState<string | null>(null);
  const [tableBatch, setTableBatch] = useState<{ done: number; total: number } | null>(null); // 全选批量进度
  const [rendering, setRendering] = useState<number | null>(null); // page being lazily rendered
  /** OCR-nav: per-page thumbnail base64 (low-DPI, rendered lazily on scroll-into-view). Separate
   *  from the full DPI-150 page image so the thumb is cheap; if a full image already exists we
   *  reuse it (CSS-scaled) and skip a render. Keyed by page number. */
  const [thumbs, setThumbs] = useState<Record<number, string>>({});
  const thumbInflight = useRef<Set<number>>(new Set()); // pages whose thumb fetch is in flight
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
      if (!res.ok) {
        // BUG-008: 把后端的明确错误（413 文件过大 / 504 超时 / 422 空结果 / 500 上游错）原样
        // 抛给上层，让 UI 能区分「真错」和「超时可重试」。旧版只丢 HTTP 码 → 用户看不出原因。
        let detail = `OCR HTTP ${res.status}`;
        try {
          const j = await res.json();
          if (j?.error) detail = `OCR HTTP ${res.status}: ${j.error}`;
        } catch { /* not JSON */ }
        throw new Error(detail);
      }
      const { markdown, error } = await res.json();
      if (error) throw new Error(error);
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
        // BUG-008: 把后端的明确错误（413/504/422/500）抬到顶部 error 横条，便于诊断 + 重试入口已在页面右侧。
        if (!aborted) setError(e instanceof Error ? e.message : 'OCR 失败');
        setPages((prev) => prev.map((p, idx) => (idx === i ? { ...p, ocring: false, error: !aborted } : p)));
      }
    },
    [pages, callOcr, persist, scanned],
  );

  const ocrAll = useCallback(async () => {
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setError(null); // BUG-008: 启动批量前清空旧错误条，避免误导
    setBatchRunning(true);
    const targets = pages.map((p, i) => ({ p, i })).filter(({ p }) => p.imageB64 && p.text === null);
    let cursor = 0;
    let firstError: string | null = null;
    const worker = async () => {
      while (cursor < targets.length && !ctrl.signal.aborted) {
        const { p, i } = targets[cursor++];
        setPages((prev) => prev.map((q, idx) => (idx === i ? { ...q, ocring: true } : q)));
        try {
          const text = await callOcr(p.imageB64!, p.mediaType, ctrl.signal);
          setPages((prev) => prev.map((q, idx) => (idx === i ? { ...q, text, source: 'ocr', ocring: false } : q)));
        } catch (e) {
          const aborted = (e as Error).name === 'AbortError';
          if (!aborted && !firstError) firstError = e instanceof Error ? e.message : 'OCR 失败';
          setPages((prev) => prev.map((q, idx) => (idx === i ? { ...q, ocring: false, error: !aborted } : q)));
          if (aborted) break;
        }
      }
    };
    await Promise.all([worker(), worker()]);
    setBatchRunning(false);
    // BUG-008: 批量结束后只展示第一个非 abort 错误，避免错误条疯狂闪
    if (firstError) setError(firstError);
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
      // BUG-008 返工: 单页懒渲染同样套超时 + r.ok，否则查看深页时同样会"渲染中"无限转。
      try {
        const j = (await fetchWithTimeout(
          `/api/ocr/render?page=${pn}`,
          { method: 'POST', headers: { 'Content-Type': 'application/pdf' }, body: file },
          PARSE_RENDER_CLIENT_TIMEOUT_MS,
          '渲染',
        )) as { pages?: { image: string }[] };
        const img = (j.pages ?? [])[0]?.image as string | undefined;
        if (img) {
          setPages((prev) => prev.map((p) => (p.page === pn ? { ...p, imageB64: img, imageUrl: `data:image/png;base64,${img}` } : p)));
          setThumbs((t) => (t[pn] ? t : { ...t, [pn]: img })); // OCR-nav: reuse the full image as the strip thumb (free)
          return img;
        }
        return null;
      } catch (e) {
        // 单页懒渲染失败不阻塞主流程：报到 tableError 让用户看见，但不影响其他页。
        setTableError(e instanceof Error ? e.message : '渲染失败');
        return null;
      } finally {
        setRendering((r) => (r === pn ? null : r));
      }
    },
    [pages],
  );

  // checkbox ONLY: toggle a page in the cross-page-merge selection (does NOT view it).
  const toggleSelPage = useCallback((pn: number) => {
    setSelPages((prev) => (prev.includes(pn) ? prev.filter((x) => x !== pn) : [...prev, pn].sort((a, b) => a - b)));
  }, []);

  /** OCR-nav: lazily fetch a LOW-DPI thumbnail for the page-strip. Cost control:
   *  - reuse the full DPI-150 image if it already exists (主视图/对比 already rendered it) — 0 cost;
   *  - else render at dpi=40 (~1/4 linear → ~1/14 the pixels/bytes of a 150-dpi page);
   *  - dedup in-flight requests; non-PDF / no-file → no-op (the upload b64 already serves as thumb). */
  const ensureThumb = useCallback(
    async (pn: number) => {
      if (thumbs[pn] || thumbInflight.current.has(pn)) return;
      const file = fileRef.current;
      const pg = pages.find((p) => p.page === pn);
      if (!pg) return;
      // reuse a full image if we already have one (free).
      if (pg.imageB64) { setThumbs((t) => (t[pn] ? t : { ...t, [pn]: pg.imageB64! })); return; }
      if (!file || file.name.split('.').pop()?.toLowerCase() !== 'pdf') return;
      thumbInflight.current.add(pn);
      try {
        const j = (await fetchWithTimeout(
          `/api/ocr/render?page=${pn}&dpi=40`,
          { method: 'POST', headers: { 'Content-Type': 'application/pdf' }, body: file },
          PARSE_RENDER_CLIENT_TIMEOUT_MS,
          '缩略图',
        )) as { pages?: { image: string }[] };
        const img = (j.pages ?? [])[0]?.image;
        if (img) setThumbs((t) => ({ ...t, [pn]: img }));
      } catch { /* thumbnail is best-effort; the status dot + page number still navigate. */ }
      finally { thumbInflight.current.delete(pn); }
    },
    [pages, thumbs],
  );

  // row click: VIEW a page in the comparison (no selection). If it belongs to a recognized
  // cross-page correction, view the whole set so 原图/文字/AI 三栏对齐.
  const viewTablePage = useCallback((pn: number) => {
    setViewPage(pn);
    setTableError(null);
    const corr = recognizedTables.find((t) => t.pages.includes(pn));
    for (const p of corr ? corr.pages : [pn]) void ensurePageImage(p);
  }, [recognizedTables, ensurePageImage]);

  /** Render → VLM-recognize → PERSIST one page-set. Returns the markdown ('' = empty/failed).
   *  Persisted results survive reopen AND get injected into the doc on 加入知识库 — for the Agent.
   *  Shared by manual select-read and 全选 batch. Caller owns the AbortController + UI state. */
  const recognizeOne = useCallback(
    async (sel: number[], signal: AbortSignal): Promise<string> => {
      const imgs = (await Promise.all(sel.map((pn) => ensurePageImage(pn)))).filter((b): b is string => !!b);
      if (imgs.length === 0) return '';
      // hand the VLM the parser text too → it keeps prose, only fixes the table (returns full page).
      const parserText = sel.map((pn) => pages.find((p) => p.page === pn)?.text).filter(Boolean).join('\n\n');
      const prompt = parserText ? `${PAGE_PROMPT}\n\n【解析器文字】\n${parserText}` : PAGE_PROMPT;
      const res = await fetch('/api/ocr', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal,
        body: JSON.stringify({ images: imgs, mediaType: 'image/png', prompt }),
      });
      if (!res.ok) {
        // BUG-008: 表格识别同款明确错误回流，不再让 UI 静默吞掉 413 / 504。
        let detail = `OCR HTTP ${res.status}`;
        try { const j = await res.json(); if (j?.error) detail = `OCR HTTP ${res.status}: ${j.error}`; } catch {}
        throw new Error(detail);
      }
      const { markdown, error } = await res.json();
      if (error) throw new Error(error);
      const md = (markdown ?? '').trim().replace(/^```(?:html)?\s*/i, '').replace(/```\s*$/i, '').trim();
      if (!md) return '';
      setRecognizedTables((prev) => [...prev.filter((t) => tableKey(t.pages) !== tableKey(sel)), { pages: sel, content: md }].sort((a, b) => a.pages[0] - b.pages[0]));
      if (!jobIdRef.current) await persist(pages, { scanned });
      if (jobIdRef.current) await saveTableFn({ data: { id: jobIdRef.current, pages: sel, content: md } }).catch(() => {});
      return md;
    },
    [ensurePageImage, persist, pages, scanned, saveTableFn],
  );

  /** Recognize a given page-set as ONE table (single page, or cross-page merged). */
  const readTables = useCallback(async (sel: number[]) => {
    if (sel.length === 0) return;
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setTableReading(true); setTableError(null);
    try {
      const md = await recognizeOne(sel, ctrl.signal);
      if (!md) setTableError('识别为空，可重试');
    } catch (e) {
      // BUG-008: 把 recognizeOne 抛出的明确错误（413 文件过大 / 504 超时 / 500 上游错）
      // 显示出来，旧版只 fallback 「识别失败，可重试」一句话用户摸不着头脑。
      if ((e as Error).name !== 'AbortError') {
        const msg = e instanceof Error ? e.message : '识别失败';
        setTableError(msg);
      }
    } finally { setTableReading(false); }
  }, [recognizeOne]);

  /** Footer: recognize the ☑️-checked pages as one (cross-page) table, then view the result. */
  const readChecked = useCallback(async () => {
    const sel = [...selPages];
    if (sel.length === 0) return;
    await readTables(sel);
    setViewPage(sel[0]); // jump the comparison to the just-recognized set
  }, [selPages, readTables]);

  /** 全选一键: VLM-recognize EVERY detected table page individually (each page = its own table,
   *  NOT merged), concurrency 2, cancellable, with progress. Re-recognizes pages already done. */
  const recognizeAllTables = useCallback(async () => {
    const targets = findTablePages(pages).map((t) => t.page);
    if (targets.length === 0) return;
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setTableError(null);
    setTableBatch({ done: 0, total: targets.length });
    if (!jobIdRef.current) await persist(pages, { scanned }); // create job once up-front (avoid worker race)
    let idx = 0;
    const worker = async () => {
      while (idx < targets.length && !ctrl.signal.aborted) {
        const pn = targets[idx++];
        try { await recognizeOne([pn], ctrl.signal); }
        catch (e) { if ((e as Error).name === 'AbortError') return; }
        setTableBatch((b) => (b ? { ...b, done: b.done + 1 } : b));
      }
    };
    try { await Promise.all([worker(), worker()]); }
    finally { setTableBatch(null); }
  }, [recognizeOne, persist, pages, scanned]);

  const resetState = useCallback(() => {
    fileRef.current = null; jobIdRef.current = null; uploadedFileIdRef.current = null;
    setFileName(null); setPages([]); setActive(0); setScanned(false); setError(null); setSavedToKb('idle');
    setSelPages([]); setViewPage(null); setRecognizedTables([]); setTableError(null); setRendering(null); setFormat('markdown'); setPhase('idle');
    setLoadingStage(false);
    setThumbs({}); thumbInflight.current.clear();
  }, []);

  const runLoad = useCallback(
    async (file: File) => {
      resetState();
      // BUG-008: 上传前先检查大小，超限直接报错（不再让用户等几秒看 413）。
      if (file.size > MAX_FILE_BYTES) {
        setError(`文件过大（${(file.size / 1024 / 1024).toFixed(1)} MB），单次 OCR 上限 ${MAX_FILE_BYTES / 1024 / 1024} MB。请压缩或分卷后重试。`);
        return;
      }
      fileRef.current = file;
      setFileName(file.name);
      const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
      try {
        if (ext === 'pdf') {
          setPhase('loading');
          // BUG-008 返工: parse/render fetch 都套 AbortSignal+超时+r.ok（之前完全没有）。
          // parse/render 并行（Promise.allSettled）：两段独立 bail，一段超时不拖死另一段；
          // 一段成功 + 另一段失败仍能告诉用户哪段挂了。loadingStage=true 期间显示"解析+渲染中…"。
          setLoadingStage(true);
          const [parseSettled, renderSettled] = await Promise.allSettled([
            fetchWithTimeout('/api/ocr/parse', { method: 'POST', headers: { 'Content-Type': 'application/pdf' }, body: file }, PARSE_RENDER_CLIENT_TIMEOUT_MS, '解析'),
            fetchWithTimeout('/api/ocr/render', { method: 'POST', headers: { 'Content-Type': 'application/pdf' }, body: file }, PARSE_RENDER_CLIENT_TIMEOUT_MS, '渲染'),
          ]);
          // 双段都失败 → 统一报错，phase 回 idle，用户能直接重试。
          if (parseSettled.status === 'rejected' && renderSettled.status === 'rejected') {
            const pe = (parseSettled.reason as Error).message;
            const re = (renderSettled.reason as Error).message;
            throw new Error(`解析与渲染都失败：${pe} / ${re}`);
          }
          // 单段失败：解析失败但渲染成功 → 当扫描件处理（用户仍可逐页 AI 识别）；
          //         渲染失败但解析成功 → 没有原图但有文字层（仍可呈现文字 + 后续以 ensurePageImage 兜底）。
          // 这两种降级都把错误"提示出来"，但不阻塞流程——比"一直转"或"报错回 idle"对用户友好。
          const parseRes = parseSettled.status === 'fulfilled' ? (parseSettled.value as { scanned?: boolean; pages?: { page: number; text: string }[]; error?: string }) : { scanned: true, pages: [], error: (parseSettled.reason as Error).message };
          const renderRes = renderSettled.status === 'fulfilled' ? (renderSettled.value as { pages?: { page: number; image: string }[]; error?: string }) : { pages: [], error: (renderSettled.reason as Error).message };
          if (parseSettled.status === 'rejected') setError(`解析失败：${(parseSettled.reason as Error).message}（已退化为扫描件，可逐页 AI 识别）`);
          else if (renderSettled.status === 'rejected') setError(`渲染失败：${(renderSettled.reason as Error).message}（无页面预览图，文字内容仍可读）`);
          setLoadingStage(false);

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
          if (work.length === 0) throw new Error('无法读取该 PDF（可能已损坏或不含可识别页面）');
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
            // BUG-008: 把 callOcr 的明确错误冒泡到顶部 error 横条，不再让"图标常转"。
            if (!aborted) {
              const msg = e instanceof Error ? e.message : 'OCR 失败';
              setError(msg);
            }
            setPages((prev) => prev.map((p, i) => (i === 0 ? { ...p, ocring: false, error: !aborted } : p)));
          }
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : '读取失败');
        setPhase('idle');
        setLoadingStage(false);
      }
    },
    [resetState, callOcr, persist],
  );

  /** Rebuild the FULL page set for a reopened job from its original file.
   *
   *  OCR-UX-A 根因修复：旧版 reopen 只把存下来的页（`persist` 只存有 text 的页）放回 UI →
   *  100 页文档只 OCR 4 页时，reopen 后只剩 4 页、剩 96 页消失、无法续 OCR。这里取回原文件后：
   *  - PDF：重跑 parse/render（已带 BUG-008 超时）拿回全部页 + 图，再把存下来的 OCR 文字按页号 overlay 回去
   *    （存过的页保留既有文字 + source；未 OCR 的页 text=null，可继续逐页/「识别全部」补完）。
   *  - 单图：本来就 1 页，直接用既有文字。
   *  失败（原文件取不回 / parse&render 都挂）→ 退化为「只有存下来的页」的纯文本 reopen（至少不空白）。 */
  const rebuildFromFile = useCallback(
    async (file: File, job: { fileName: string; scanned: boolean; pages: { page: number; text: string; source: 'parse' | 'ocr' }[] }) => {
      const isPdf = job.fileName.toLowerCase().endsWith('.pdf');
      const storedText = new Map<number, { text: string; source: 'parse' | 'ocr' }>();
      for (const p of job.pages) storedText.set(p.page, { text: p.text, source: p.source });

      if (!isPdf) {
        // single image: one page; stored OCR text (if any) goes back on it.
        const b64 = await fileToBase64(file);
        const ext = job.fileName.split('.').pop()?.toLowerCase() ?? '';
        const mt = MEDIA[ext] ?? 'image/jpeg';
        const stored = storedText.get(1);
        setPages([{ page: 1, imageUrl: `data:${mt};base64,${b64}`, imageB64: b64, mediaType: mt, text: stored?.text ?? null, source: stored?.source ?? null, ocring: false }]);
        return;
      }

      // PDF: re-derive the full page set (parse for text-layer pages count + render for images).
      setLoadingStage(true);
      const [parseSettled, renderSettled] = await Promise.allSettled([
        fetchWithTimeout('/api/ocr/parse', { method: 'POST', headers: { 'Content-Type': 'application/pdf' }, body: file }, PARSE_RENDER_CLIENT_TIMEOUT_MS, '解析'),
        fetchWithTimeout('/api/ocr/render', { method: 'POST', headers: { 'Content-Type': 'application/pdf' }, body: file }, PARSE_RENDER_CLIENT_TIMEOUT_MS, '渲染'),
      ]);
      setLoadingStage(false);
      // both failed → keep the text-only restore that reopen already set (don't blow it away).
      if (parseSettled.status === 'rejected' && renderSettled.status === 'rejected') {
        setError(`重建完整页集失败（解析与渲染都失败），仅恢复已识别的 ${job.pages.length} 页。可重新上传原文件继续。`);
        return;
      }
      const parseRes = parseSettled.status === 'fulfilled' ? (parseSettled.value as { pages?: { page: number; text: string }[] }) : { pages: [] };
      const renderRes = renderSettled.status === 'fulfilled' ? (renderSettled.value as { pages?: { page: number; image: string }[] }) : { pages: [] };
      if (parseSettled.status === 'rejected') setError(`解析失败：${(parseSettled.reason as Error).message}（页面预览可用，文字层未重建）`);
      else if (renderSettled.status === 'rejected') setError(`渲染失败：${(renderSettled.reason as Error).message}（无预览图，文字内容仍可读）`);

      const images: Record<number, string> = {};
      for (const p of (renderRes.pages ?? []) as { page: number; image: string }[]) images[p.page] = p.image;
      const freshText: Record<number, string> = {};
      for (const p of (parseRes.pages ?? []) as { page: number; text: string }[]) freshText[p.page] = p.text;

      // page universe = every page seen anywhere (render images ∪ fresh parse ∪ stored pages).
      const nums = Array.from(new Set([
        ...Object.keys(images).map(Number),
        ...Object.keys(freshText).map(Number),
        ...job.pages.map((p) => p.page),
      ])).sort((a, b) => a - b);
      if (nums.length === 0) {
        setError('无法重建该 PDF 的页面（可能原文件已损坏）。');
        return;
      }
      const work: OcrPage[] = nums.map((n) => {
        const stored = storedText.get(n);
        // priority: stored OCR/correction text (user's work) > fresh parse text (text-layer) > null (needs OCR).
        const text = stored?.text ?? (!job.scanned ? freshText[n] ?? null : null);
        const source = stored?.source ?? (text && freshText[n] ? 'parse' : null);
        return {
          page: n, imageUrl: images[n] ? `data:image/png;base64,${images[n]}` : null, imageB64: images[n] ?? null,
          mediaType: 'image/png', text, source, ocring: false,
        };
      });
      setPages(work);
    },
    [],
  );

  const reopen = useCallback(
    async (id: string) => {
      resetState();
      try {
        const job = (await getJob({ data: { id } })) as { id: string; title: string; fileName: string; mimeType: string | null; scanned: boolean; pages: { page: number; text: string; source: 'parse' | 'ocr' }[]; tables?: RecognizedTable[] };
        jobIdRef.current = job.id;
        uploadedFileIdRef.current = 'reopened'; // file already in S3; don't re-upload on persist
        setFileName(job.fileName); setScanned(job.scanned);
        // immediate text-only restore so the UI isn't blank while we fetch the original.
        setPages(job.pages.map((p) => ({ page: p.page, imageUrl: null, imageB64: null, mediaType: 'image/png', text: p.text, source: p.source, ocring: false })));
        setRecognizedTables(job.tables ?? []); // restore previously-recognized tables
        setPhase('ready');
        // OCR-UX-A: pull the original back AND rebuild the FULL page set (not just the saved pages),
        // so missing/un-OCR'd pages reappear, render lazily, and 「识别这页/识别全部」can finish them.
        try {
          const res = await fetch(`/api/ocr/file?jobId=${encodeURIComponent(id)}`);
          if (res.ok) {
            const blob = await res.blob();
            const file = new File([blob], job.fileName, { type: job.mimeType || blob.type || 'application/octet-stream' });
            fileRef.current = file;
            await rebuildFromFile(file, job);
          } else {
            // original gone (purged) → keep text-only restore + tell the user tables/续OCR需重新上传.
            setError('历史记录的原文件已不可用，仅恢复已识别的文字。续识别 / 表格需重新上传原文件。');
          }
        } catch { /* original unavailable; the text-only restore above stands */ }
      } catch { setError('打开历史失败'); }
    },
    [resetState, getJob, rebuildFromFile],
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
    if (pg) void ensureThumb(pg.page); // make sure the strip shows the jumped-to page too
  }, [pages, ensurePageImage, ensureThumb]);

  // OCR-UX-B: keyboard nav for the normal (non-tables) view — ←/→ page, Home/End jump.
  // Skips when typing in an input/textarea or in tables mode; only active once pages are loaded.
  useEffect(() => {
    if (format === 'tables' || pages.length === 0) return;
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement | null)?.isContentEditable) return;
      if (e.key === 'ArrowLeft') { e.preventDefault(); goToPage(active - 1); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); goToPage(active + 1); }
      else if (e.key === 'Home') { e.preventDefault(); goToPage(0); }
      else if (e.key === 'End') { e.preventDefault(); goToPage(pages.length - 1); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [format, pages.length, active, goToPage]);

  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => { const f = e.target.files?.[0]; if (f) void runLoad(f); };
  const onDrop = (e: React.DragEvent) => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files?.[0]; if (f) void runLoad(f); };

  const assembled = pages.map((p) => p.text ?? '').filter(Boolean).join('\n\n');
  const current = pages[active];
  const pendingCount = pages.filter((p) => p.imageB64 && p.text === null).length;
  const tablePages = findTablePages(pages); // full-doc, instant (from already-parsed text)
  // table-mode comparison (原图 / 文字识别 / VLM): everything derived for the current selection.
  const recognizedSet = new Set(recognizedTables.flatMap((t) => t.pages)); // which pages have a saved table
  // comparison is driven by the VIEWED page (+ its correction set if cross-page), not the checkboxes.
  const activeCorrection = viewPage != null ? recognizedTables.find((t) => t.pages.includes(viewPage)) : undefined;
  const activeSet = activeCorrection ? activeCorrection.pages : viewPage != null ? [viewPage] : [];
  const cmpImages = activeSet.map((pn) => pages.find((p) => p.page === pn)).filter((p): p is OcrPage => !!p?.imageUrl);
  const cmpParserText = activeSet.map((pn) => pages.find((p) => p.page === pn)?.text).filter(Boolean).join('\n\n');
  const cmpVlm = activeCorrection?.content ?? null;

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
      {/* render the VLM's full-page HTML readably: bordered tables, paragraph spacing. */}
      <style>{`.ocr-page p{margin:.4em 0}.ocr-page table{border-collapse:collapse;width:100%;font-size:12px;margin:.5em 0}.ocr-page th,.ocr-page td{border:1px solid var(--border);padding:3px 6px;text-align:left;vertical-align:top}.ocr-page th{background:var(--muted);font-weight:600}.ocr-page h1,.ocr-page h2,.ocr-page h3{font-weight:600;margin:.5em 0}`}</style>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2.5">
        <span className="flex min-w-0 items-center gap-2 text-sm font-medium">
          <button type="button" onClick={resetState} title="新转换 / 返回" className="shrink-0 rounded-md border px-1.5 py-1 text-muted-foreground hover:bg-accent"><RotateCcw className="h-3.5 w-3.5" /></button>
          <ScanText className="h-4 w-4 shrink-0 text-primary" />
          <span className="truncate">{fileName}</span>
          {phase === 'loading' ? (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              {loadingStage ? '解析 + 渲染中…' : '加载中…'}
            </span>
          ) : scanned ? (
            <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] text-amber-600">扫描件 · 需 AI 识别</span>
          ) : (
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] text-primary">已解析 · {pages.length} 页</span>
          )}
        </span>
        <div className="flex items-center gap-2">
          {(batchRunning || pages.some((p) => p.ocring) || tableReading || tableBatch !== null) && (
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
        <div className="grid min-h-0 flex-1 grid-cols-[240px_1fr]">
          {/* left: table-page list (scrolls) + ALWAYS-VISIBLE action footer */}
          <div className="flex min-h-0 flex-col border-r">
            <div className="flex items-center justify-between gap-1.5 border-b px-3 py-2 text-[11px] text-muted-foreground">
              <span className="flex items-center gap-1.5"><TableIcon className="h-3.5 w-3.5" />检测到的表格{tablePages.length ? ` · ${tablePages.length}` : ''}</span>
              {recognizedSet.size > 0 && <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-600">已修正 {recognizedSet.size} 页</span>}
            </div>
            <div className="min-h-0 flex-1 overflow-auto p-3">
              {!fileRef.current ? (
                <p className="text-xs text-muted-foreground">历史记录的原文件已不可用，无法读取表格。请重新上传该文件。</p>
              ) : tablePages.length === 0 ? (
                <p className="text-xs text-muted-foreground">未在解析结果中检测到表格。</p>
              ) : (
                <div className="space-y-1">
                  {tablePages.map((t) => {
                    const checked = selPages.includes(t.page);
                    const focused = viewPage === t.page;
                    const done = recognizedSet.has(t.page);
                    return (
                      // row click = VIEW; only the ☑️ toggles selection.
                      <div key={t.page} onClick={() => viewTablePage(t.page)}
                        className={`flex w-full cursor-pointer items-center gap-1.5 rounded-md border px-2 py-1.5 text-xs transition-colors ${focused ? 'border-primary bg-primary/5' : 'hover:bg-accent/40'}`}>
                        <button type="button" title={checked ? '取消勾选' : '勾选（用于跨页合并识别）'}
                          onClick={(e) => { e.stopPropagation(); toggleSelPage(t.page); }} className="shrink-0 text-muted-foreground hover:text-foreground">
                          {checked ? <CheckSquare className="h-3.5 w-3.5 text-primary" /> : <Square className="h-3.5 w-3.5" />}
                        </button>
                        <span className="flex-1">第 {t.page} 页</span>
                        {done ? (
                          <span className="flex shrink-0 items-center gap-0.5 rounded bg-emerald-500/10 px-1 text-[10px] font-medium text-emerald-600"><Check className="h-3 w-3" />已修正</span>
                        ) : (
                          <>
                            {t.via === 'heuristic' && <span className="rounded bg-amber-500/10 px-1 text-[10px] text-amber-600">推测</span>}
                            {t.big && <span className="rounded bg-primary/10 px-1 text-[10px] text-primary">大表</span>}
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
            <div className="space-y-2 border-t p-3">
              {tableBatch ? (
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" />一键识别中 {tableBatch.done}/{tableBatch.total}…</div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted"><div className="h-full bg-primary transition-all" style={{ width: `${tableBatch.total ? (tableBatch.done / tableBatch.total) * 100 : 0}%` }} /></div>
                </div>
              ) : tablePages.length > 0 && fileRef.current ? (
                <>
                  <button type="button" onClick={() => void recognizeAllTables()}
                    className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-primary px-2 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90">
                    <Sparkles className="h-3.5 w-3.5" />一键识别全部 {tablePages.length} 个表
                  </button>
                  {selPages.length > 0 && (
                    <button type="button" disabled={tableReading} onClick={() => void readChecked()}
                      className="flex w-full items-center justify-center gap-1.5 rounded-lg border px-2 py-2 text-xs hover:bg-accent disabled:opacity-50">
                      {tableReading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                      识别勾选的 {selPages.length} 页{selPages.length > 1 ? '（跨页合并）' : ''}
                    </button>
                  )}
                  <p className="text-[10px] leading-relaxed text-muted-foreground">点页码看对比 · 勾选 ☑️ 用于跨页合并。AI 识别会用正确表格<span className="text-foreground">替换</span>文字识别的错误结果——入库后 Agent 读到的就是对的。</p>
                </>
              ) : null}
            </div>
          </div>
          {/* right: 三栏对比 —— PDF 原图 / 文字识别（解析器）/ AI 识别（VLM），让"前→后"提升一眼可见 */}
          <div className="min-h-0 overflow-hidden">
            {viewPage == null ? (
              <div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground">
                ← 点左侧某一页，查看「PDF 原图 / 文字识别 / AI 识别」三栏对比
              </div>
            ) : (
              <div className="flex h-full flex-col">
                <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
                  <span className="text-xs font-medium">第 {activeSet.join('、')} 页 · 对比</span>
                  <button type="button" disabled={tableReading} onClick={() => void readTables(activeSet)}
                    className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
                    {tableReading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                    {cmpVlm ? '重新识别' : '用 AI 识别'}{activeSet.length > 1 ? '（跨页合并）' : ''}
                  </button>
                </div>
                {tableError && <p className="border-b bg-destructive/5 px-3 py-1.5 text-xs text-destructive">{tableError}</p>}
                {/* the replacement is the whole point — say it loudly once the page is corrected. */}
                {cmpVlm ? (
                  <p className="flex items-center gap-1.5 border-b border-emerald-500/20 bg-emerald-500/5 px-3 py-1.5 text-xs text-emerald-700"><Check className="h-3.5 w-3.5 shrink-0" /><span>这一页已用 <b>AI 识别</b> 替换文字识别的错误表格 · 加入知识库后，Agent 读到的就是右侧这份正确内容。</span></p>
                ) : (
                  <p className="border-b bg-muted/30 px-3 py-1.5 text-xs text-muted-foreground">尚未识别 · 点「用 AI 识别」用图片还原表格，<span className="text-foreground">替换</span>中间文字识别的错误结果。</p>
                )}
                <div className="grid min-h-0 flex-1 grid-cols-3 divide-x">
                  {/* col 1: PDF 原图 */}
                  <div className="flex min-h-0 flex-col">
                    <div className="border-b bg-muted/30 px-2 py-1 text-[11px] font-medium text-muted-foreground">PDF 原图</div>
                    <div className="min-h-0 flex-1 space-y-2 overflow-auto p-2">
                      {rendering !== null && activeSet.includes(rendering) ? (
                        <div className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" />渲染中…</div>
                      ) : cmpImages.length ? (
                        cmpImages.map((p) => <img key={p.page} src={p.imageUrl!} alt={`page ${p.page}`} className="w-full rounded border" />)
                      ) : (
                        <p className="text-xs text-muted-foreground">本页无预览图</p>
                      )}
                    </div>
                  </div>
                  {/* col 2: 文字识别（解析器）— the "before". Once replaced, visibly superseded. */}
                  <div className="flex min-h-0 flex-col">
                    <div className={`flex items-center justify-between border-b px-2 py-1 text-[11px] font-medium ${cmpVlm ? 'bg-destructive/5 text-destructive' : 'bg-muted/30 text-muted-foreground'}`}>
                      <span className={cmpVlm ? 'line-through decoration-destructive/50' : ''}>文字识别（解析器）</span>
                      <span className={`rounded px-1 text-[10px] ${cmpVlm ? 'bg-destructive/10 text-destructive' : 'bg-muted'}`}>{cmpVlm ? '✗ 已被替换' : '识别前'}</span>
                    </div>
                    <div className={`min-h-0 flex-1 overflow-auto whitespace-pre-wrap p-2 text-xs leading-relaxed text-muted-foreground ${cmpVlm ? 'opacity-40 grayscale' : ''}`}>
                      {cmpParserText || '（解析器在此页未提取到文字）'}
                    </div>
                  </div>
                  {/* col 3: AI 识别（VLM）— the "after". When present it's the authoritative version. */}
                  <div className={`flex min-h-0 flex-col ${cmpVlm ? 'ring-2 ring-inset ring-emerald-500/40' : ''}`}>
                    <div className={`flex items-center justify-between border-b px-2 py-1 text-[11px] font-medium ${cmpVlm ? 'bg-emerald-500/10 text-emerald-700' : 'bg-primary/5 text-primary'}`}>
                      <span className="flex items-center gap-1">AI 识别<span className={`rounded px-1 text-[10px] ${cmpVlm ? 'bg-emerald-500/15 text-emerald-700' : 'bg-primary/10'}`}>{cmpVlm ? '✓ 生效中' : '识别后'}</span></span>
                      {cmpVlm && <button type="button" onClick={() => flashCopy('selvlm', cmpVlm)} className="flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-accent">{copied === 'selvlm' ? <Check className="h-3 w-3 text-primary" /> : <Copy className="h-3 w-3" />}复制</button>}
                    </div>
                    <div className="ocr-page min-h-0 flex-1 overflow-auto p-2 text-sm">
                      {tableReading ? (
                        <div className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" />AI 识别中…</div>
                      ) : cmpVlm ? (
                        <div dangerouslySetInnerHTML={{ __html: sanitizeHtml(cmpVlm) }} />
                      ) : (
                        <p className="text-xs text-muted-foreground">点上方「用 AI 识别」→ 用图片还原这一页的正确表格</p>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-[240px_1fr_1fr]">
          {/* OCR-nav: 缩略图导航栏 — 懒渲染低 DPI 缩略图 + 状态徽标 + 页码。用户靠"版式"认页
              （那页是表/是图/是签字页），不是靠页码；缩略图只需"认得出版式"不需"读得清字"。 */}
          <div className="flex min-h-0 flex-col border-r">
            <div className="flex items-center justify-between gap-1 border-b px-2 py-1.5 text-[10px] text-muted-foreground">
              <span>全部 {pages.length} 页</span>
              {pendingCount > 0 && <span className="rounded bg-amber-500/10 px-1 text-amber-600">待识别 {pendingCount}</span>}
            </div>
            <div className="grid min-h-0 flex-1 grid-cols-2 content-start gap-1.5 overflow-auto p-1.5">
              {pages.map((p, i) => {
                const st = p.ocring ? 'ocring' : p.error ? 'error' : p.text !== null ? (p.source === 'ocr' ? 'ocr' : 'parse') : 'pending';
                const color = st === 'error' ? 'bg-destructive' : st === 'ocr' ? 'bg-emerald-500' : st === 'parse' ? 'bg-primary' : st === 'ocring' ? 'bg-primary' : 'bg-amber-400';
                const title = st === 'pending' ? '待识别' : st === 'error' ? '识别失败' : st === 'ocr' ? '已 AI 识别' : st === 'ocring' ? '识别中' : '已解析';
                const label = st === 'pending' ? '待识别' : st === 'error' ? '失败' : st === 'ocr' ? 'AI' : st === 'ocring' ? '识别中' : '已解析';
                return (
                  <PageThumb key={p.page} page={p.page} label={label} statusColor={color} statusTitle={title}
                    isActive={i === active} thumb={thumbs[p.page]} ocring={p.ocring}
                    onClick={() => goToPage(i)} onVisible={() => void ensureThumb(p.page)} />
                );
              })}
            </div>
          </div>
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
          {format !== 'tables' && pages.length > 0 && (
            <>
              <button type="button" disabled={active === 0} onClick={() => goToPage(active - 1)} title="上一页 (←)" className="disabled:opacity-30"><ChevronLeft className="h-4 w-4" /></button>
              {/* OCR-UX-B: 输入页号直达 */}
              <span className="flex items-center gap-1">
                <input type="number" min={1} max={pages.length} value={current?.page ?? 1}
                  onChange={(e) => { const n = Number(e.target.value); const idx = pages.findIndex((p) => p.page === n); if (idx >= 0) goToPage(idx); else if (n >= 1 && n <= pages.length) goToPage(n - 1); }}
                  className="w-12 rounded border bg-background px-1 py-0.5 text-center text-xs text-foreground" />
                <span className="text-xs">/ {pages.length}</span>
              </span>
              <button type="button" disabled={active >= pages.length - 1} onClick={() => goToPage(active + 1)} title="下一页 (→)" className="disabled:opacity-30"><ChevronRight className="h-4 w-4" /></button>
              <span className="ml-1 hidden text-[10px] text-muted-foreground/70 sm:inline">← / → 翻页 · Home/End 首末页</span>
            </>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={copyAll} disabled={!assembled} className="flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs hover:bg-accent disabled:opacity-40">{copied === 'all' ? <Check className="h-3.5 w-3.5 text-primary" /> : <Copy className="h-3.5 w-3.5" />}{copied === 'all' ? '已复制' : '复制全文'}</button>
          <button type="button" onClick={exportOut} disabled={!assembled} className="flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs hover:bg-accent disabled:opacity-40"><Download className="h-3.5 w-3.5" />导出</button>
          <button type="button" onClick={addToKb} disabled={!assembled || savedToKb !== 'idle'} className="flex items-center gap-1.5 rounded-lg bg-primary px-2.5 py-1.5 text-xs text-primary-foreground hover:bg-primary/90 disabled:opacity-50">{savedToKb === 'saving' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : savedToKb === 'done' ? <Check className="h-3.5 w-3.5" /> : <BookPlus className="h-3.5 w-3.5" />}{savedToKb === 'done' ? '已加入' : '加入知识库'}</button>
        </div>
      </div>
      {error && (
        <div className="flex items-center justify-between gap-2 border-t bg-destructive/5 px-4 py-1.5">
          <p className="flex items-center gap-1.5 text-xs text-destructive"><AlertCircle className="h-3.5 w-3.5 shrink-0" />{error}</p>
          {/* BUG-008 返工: parse/render/识别失败时给一个明确的"重试"入口，避免用户只能刷新页面。
              重试 = 用同一份文件重跑 runLoad（或者点 RotateCcw 重置）。 */}
          {fileRef.current && phase !== 'loading' && (
            <button type="button" onClick={() => fileRef.current && void runLoad(fileRef.current)}
              className="flex shrink-0 items-center gap-1 rounded border border-destructive/40 px-2 py-0.5 text-[11px] text-destructive hover:bg-destructive/10">
              <RotateCcw className="h-3 w-3" />重试
            </button>
          )}
        </div>
      )}
    </div>
  );
}
