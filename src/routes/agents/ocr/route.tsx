/**
 * OCR standalone converter (OCR module O2 v2) — the leftmost-rail "文字识别" module.
 *
 * 极简且正确（Owner 反馈后重做）：
 *  - PDF → 先用解析器抽文字层（/api/ocr/parse，快/准/免费），不 raster+OCR。
 *  - 某页不对 → 用户手动「用 VLM 重新识别这页」（/api/ocr，只 OCR 这一页）。
 *  - 扫描件（无文字层）→ 提示，逐页或「识别全部」OCR。
 *  - 任何 OCR 可「停止」（AbortController）。选页 = 直接点你要的那几页。
 *  - 左原图 ↔ 右文本，格式切换 MD/文本/HTML（本地派生），复制/导出/加入知识库。
 */
import { createFileRoute } from '@tanstack/react-router';
import { useServerFn } from '@tanstack/react-start';
import { useCallback, useRef, useState } from 'react';
import {
  ScanText, FileUp, Copy, Check, Download, BookPlus, ChevronLeft, ChevronRight,
  Loader2, AlertCircle, Sparkles, Square,
} from 'lucide-react';
import { StreamingMarkdown } from '~/components/claude-chat/streaming-markdown';
import { initDocumentUpload, completeDocumentUpload } from '~/server/function/documents.server';

export const Route = createFileRoute('/agents/ocr')({ component: OcrConverterPage });

type OutputFormat = 'markdown' | 'text' | 'html';
interface OcrPage {
  page: number;
  imageUrl: string | null; // data-url for the left pane (null = beyond render cap)
  imageB64: string | null; // raw base64 for re-OCR (null if no image)
  mediaType: string;
  text: string | null; // null = no text yet (scanned page, not OCR'd)
  source: 'parse' | 'ocr' | null;
  ocring: boolean;
  error?: boolean;
}

const ACCEPT = '.pdf,.png,.jpg,.jpeg,.webp';
const MEDIA: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' };

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
function mdToHtml(md: string): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return md
    .replace(/<!-- odl-page \d+ -->/g, '').split(/\n{2,}/)
    .map((b) => {
      const h = b.match(/^(#{1,6})\s+(.*)$/);
      if (h) return `<h${h[1].length}>${esc(h[2])}</h${h[1].length}>`;
      if (/^\s*\|.*\|/.test(b)) return `<pre>${esc(b)}</pre>`;
      return `<p>${esc(b).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')}</p>`;
    })
    .join('\n');
}

function OcrConverterPage() {
  const [fileName, setFileName] = useState<string | null>(null);
  const [pages, setPages] = useState<OcrPage[]>([]);
  const [active, setActive] = useState(0);
  const [format, setFormat] = useState<OutputFormat>('markdown');
  const [phase, setPhase] = useState<'idle' | 'loading' | 'ready'>('idle');
  const [scanned, setScanned] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [savedToKb, setSavedToKb] = useState<'idle' | 'saving' | 'done'>('idle');
  const [dragOver, setDragOver] = useState(false);
  const [batchRunning, setBatchRunning] = useState(false);
  const fileRef = useRef<File | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const initUpload = useServerFn(initDocumentUpload);
  const completeUpload = useServerFn(completeDocumentUpload);

  const callOcr = useCallback(async (imageB64: string, mediaType: string, signal: AbortSignal): Promise<string> => {
    const res = await fetch('/api/ocr', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal,
      body: JSON.stringify({ contentBase64: imageB64, mediaType }),
    });
    if (!res.ok) throw new Error(`OCR HTTP ${res.status}`);
    const { markdown } = await res.json();
    return markdown ?? '';
  }, []);

  /** Re-OCR a single page (user-triggered). Shares abortRef so 「停止」 cancels it. */
  const ocrOnePage = useCallback(
    async (i: number) => {
      const pg = pages[i];
      if (!pg?.imageB64) return;
      const ctrl = abortRef.current ?? new AbortController();
      abortRef.current = ctrl;
      setPages((prev) => prev.map((p, idx) => (idx === i ? { ...p, ocring: true, error: false } : p)));
      try {
        const text = await callOcr(pg.imageB64, pg.mediaType, ctrl.signal);
        setPages((prev) => prev.map((p, idx) => (idx === i ? { ...p, text, source: 'ocr', ocring: false } : p)));
      } catch (e) {
        const aborted = (e as Error).name === 'AbortError';
        setPages((prev) => prev.map((p, idx) => (idx === i ? { ...p, ocring: false, error: !aborted } : p)));
      }
    },
    [pages, callOcr],
  );

  /** OCR every page lacking text (scanned doc / re-do all). Cancellable. */
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
  }, [pages, callOcr]);

  const stopOcr = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setBatchRunning(false);
  }, []);

  const runLoad = useCallback(
    async (file: File) => {
      fileRef.current = file;
      setFileName(file.name);
      setError(null);
      setScanned(false);
      setSavedToKb('idle');
      setActive(0);
      setPages([]);
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
          const allPages = Array.from(new Set([...Object.keys(images), ...Object.keys(textByPage)].map(Number))).sort((a, b) => a - b);
          const work: OcrPage[] = (allPages.length ? allPages : Object.keys(images).map(Number)).map((n) => ({
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
        } else {
          // Image upload: it IS one page with no text layer → OCR directly (1 call, fast).
          const b64 = await fileToBase64(file);
          const mt = MEDIA[ext] ?? 'image/jpeg';
          setPages([{ page: 1, imageUrl: `data:${mt};base64,${b64}`, imageB64: b64, mediaType: mt, text: null, source: null, ocring: true }]);
          setPhase('ready');
          const ctrl = new AbortController();
          abortRef.current = ctrl;
          try {
            const text = await callOcr(b64, mt, ctrl.signal);
            setPages((prev) => prev.map((p, i) => (i === 0 ? { ...p, text, source: 'ocr', ocring: false } : p)));
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
    [callOcr],
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

  const assembled = pages.map((p) => p.text ?? '').filter(Boolean).join('\n\n');
  const output = format === 'text' ? mdToText(assembled) : format === 'html' ? mdToHtml(assembled) : assembled;
  const current = pages[active];
  const pendingCount = pages.filter((p) => p.imageB64 && p.text === null).length;

  const copyOut = async () => {
    await navigator.clipboard.writeText(output);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };
  const exportOut = () => {
    const ext = format === 'html' ? 'html' : format === 'text' ? 'txt' : 'md';
    const mime = format === 'html' ? 'text/html' : format === 'text' ? 'text/plain' : 'text/markdown';
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([output], { type: mime }));
    a.download = `${(fileName ?? 'ocr').replace(/\.[^.]+$/, '')}.${ext}`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const addToKb = async () => {
    const file = fileRef.current;
    if (!file || savedToKb !== 'idle' || !assembled) return;
    setSavedToKb('saving');
    try {
      const init = (await initUpload({
        data: {
          originalName: file.name, mimeType: file.type || 'application/octet-stream', size: file.size,
          title: file.name.replace(/\.[^.]+$/, ''), content: assembled, addToKnowledgeBase: true,
        },
      })) as { id: string; key: string };
      await fetch(`/api/documents/upload?id=${encodeURIComponent(init.id)}&key=${encodeURIComponent(init.key)}`, {
        method: 'PUT', headers: { 'Content-Type': file.type || 'application/octet-stream' }, body: file,
      });
      await completeUpload({ data: { id: init.id, key: init.key } });
      setSavedToKb('done');
    } catch {
      setSavedToKb('idle');
      setError('加入知识库失败，请重试');
    }
  };

  if (phase === 'idle' && pages.length === 0) {
    return (
      <div className="flex h-[calc(100vh-theme(spacing.16))] flex-col items-center justify-center p-8">
        <div className="mb-6 flex items-center gap-2 text-lg font-medium">
          <ScanText className="h-5 w-5 text-primary" />
          文字识别
        </div>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          className={`flex w-full max-w-xl flex-col items-center gap-3 rounded-xl border-2 border-dashed px-8 py-16 transition-colors ${
            dragOver ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50 hover:bg-accent/30'
          }`}
        >
          <FileUp className="h-9 w-9 text-primary" />
          <span className="text-base font-medium text-foreground">拖入 PDF 或图片，转成可编辑文本</span>
          <span className="text-xs text-muted-foreground">文字版 PDF 直接解析；扫描件 / 照片用 AI 识别</span>
        </button>
        {error && (
          <p className="mt-4 flex items-center gap-1.5 text-sm text-destructive"><AlertCircle className="h-4 w-4" />{error}</p>
        )}
        <input ref={inputRef} type="file" accept={ACCEPT} className="hidden" onChange={onPick} />
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-theme(spacing.16))] flex-col">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2.5">
        <span className="flex min-w-0 items-center gap-2 text-sm font-medium">
          <ScanText className="h-4 w-4 shrink-0 text-primary" />
          <span className="truncate">{fileName}</span>
          {phase === 'loading' ? (
            <span className="flex items-center gap-1 text-xs text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" />解析中…</span>
          ) : scanned ? (
            <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] text-amber-600">扫描件 · 无文字层，需 AI 识别</span>
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
            {(['markdown', 'text', 'html'] as OutputFormat[]).map((f) => (
              <button key={f} type="button" onClick={() => setFormat(f)}
                className={`rounded-md px-2.5 py-1 text-xs transition-colors ${format === f ? 'bg-background font-medium text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>
                {f === 'markdown' ? 'Markdown' : f === 'text' ? '纯文本' : 'HTML'}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-2">
        <div className="min-h-0 overflow-auto border-r p-3">
          <div className="mb-2 text-[11px] text-muted-foreground">原始页 · 第 {current?.page ?? 1} 页</div>
          {current?.imageUrl ? (
            <img src={current.imageUrl} alt={`page ${current.page}`} className="w-full rounded-md border" />
          ) : (
            <div className="rounded-md border border-dashed p-8 text-center text-xs text-muted-foreground">本页无预览图</div>
          )}
        </div>
        <div className="min-h-0 overflow-auto p-4">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[11px] text-muted-foreground">
              识别文本{current?.source === 'parse' ? '（解析器）' : current?.source === 'ocr' ? '（AI 识别）' : ''}
            </span>
            {current?.imageB64 && !current.ocring && (
              <button type="button" onClick={() => void ocrOnePage(active)} className="flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] hover:bg-accent">
                <Sparkles className="h-3 w-3" />{current.text === null ? '识别这页' : '用 AI 重新识别'}
              </button>
            )}
          </div>
          {current?.ocring ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />AI 识别中…</div>
          ) : current?.error ? (
            <p className="text-sm text-destructive">本页识别失败，可重试</p>
          ) : current?.text === null ? (
            <p className="text-sm text-muted-foreground">此页无文字层。点上方「识别这页」用 AI 识别。</p>
          ) : format === 'markdown' ? (
            <StreamingMarkdown content={current?.text || ''} isStreaming={false} mode="minimal" />
          ) : (
            <pre className="whitespace-pre-wrap font-mono text-xs leading-relaxed text-foreground">
              {format === 'text' ? mdToText(current?.text || '') : mdToHtml(current?.text || '')}
            </pre>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between gap-2 border-t px-4 py-2">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <button type="button" disabled={active === 0} onClick={() => setActive((a) => Math.max(0, a - 1))} className="disabled:opacity-30"><ChevronLeft className="h-4 w-4" /></button>
          <span>{current?.page ?? 1} / {pages.length}</span>
          <button type="button" disabled={active >= pages.length - 1} onClick={() => setActive((a) => Math.min(pages.length - 1, a + 1))} className="disabled:opacity-30"><ChevronRight className="h-4 w-4" /></button>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={copyOut} disabled={!assembled} className="flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs hover:bg-accent disabled:opacity-40">
            {copied ? <Check className="h-3.5 w-3.5 text-primary" /> : <Copy className="h-3.5 w-3.5" />}{copied ? '已复制' : '复制'}
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
