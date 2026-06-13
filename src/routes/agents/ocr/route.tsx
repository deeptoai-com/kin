/**
 * OCR standalone converter (OCR module O2) — the leftmost-rail "文字识别" module.
 *
 * 极简: 拖入 PDF/图片 → 逐页即显 OCR → 左右对照(原图↔文本) → 格式切换 → 复制/导出/加入知识库.
 * No wizard, no config. Non-chat utility page. Engine = server-side OCR_PROVIDER (doubao).
 *
 * Flow: PDF → /api/ocr/render (page PNGs) → per-page /api/ocr (concurrency 2, progressive).
 * Image → /api/ocr directly (1 page). Format toggle derives from the canonical markdown
 * locally (text = strip, html = lightweight md→html) — instant, zero extra calls.
 */
import { createFileRoute } from '@tanstack/react-router';
import { useServerFn } from '@tanstack/react-start';
import { useCallback, useRef, useState } from 'react';
import {
  ScanText,
  FileUp,
  Copy,
  Check,
  Download,
  BookPlus,
  ChevronLeft,
  ChevronRight,
  Loader2,
  AlertCircle,
} from 'lucide-react';
import { StreamingMarkdown } from '~/components/claude-chat/streaming-markdown';
import { initDocumentUpload, completeDocumentUpload } from '~/server/function/documents.server';

export const Route = createFileRoute('/agents/ocr')({
  component: OcrConverterPage,
});

type OutputFormat = 'markdown' | 'text' | 'html';
interface OcrPage {
  page: number;
  imageUrl: string; // data-url for the left pane
  imageB64: string; // raw base64 for the OCR call
  mediaType: string;
  md: string | null; // null = pending
  error?: boolean;
}

const ACCEPT = '.pdf,.png,.jpg,.jpeg,.webp';
const MEDIA: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' };

function fileToBase64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const r = String(reader.result);
      const c = r.indexOf(',');
      resolve(c >= 0 ? r.slice(c + 1) : r);
    };
    reader.onerror = () => reject(reader.error ?? new Error('read failed'));
    reader.readAsDataURL(file);
  });
}

/** Strip markdown to plain text (good-enough, no deps). */
function mdToText(md: string): string {
  return md
    .replace(/<!-- odl-page \d+ -->/g, '')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^\s*[-*]\s+/gm, '• ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Lightweight markdown → HTML (headings, bold, tables-as-is, paragraphs). */
function mdToHtml(md: string): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return md
    .replace(/<!-- odl-page \d+ -->/g, '')
    .split(/\n{2,}/)
    .map((block) => {
      const h = block.match(/^(#{1,6})\s+(.*)$/);
      if (h) return `<h${h[1].length}>${esc(h[2])}</h${h[1].length}>`;
      if (/^\s*\|.*\|/.test(block)) return `<pre>${esc(block)}</pre>`;
      return `<p>${esc(block).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')}</p>`;
    })
    .join('\n');
}

function OcrConverterPage() {
  const [fileName, setFileName] = useState<string | null>(null);
  const [pages, setPages] = useState<OcrPage[]>([]);
  const [active, setActive] = useState(0);
  const [format, setFormat] = useState<OutputFormat>('markdown');
  const [phase, setPhase] = useState<'idle' | 'rendering' | 'ocr' | 'done'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [savedToKb, setSavedToKb] = useState<'idle' | 'saving' | 'done'>('idle');
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<File | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const initUpload = useServerFn(initDocumentUpload);
  const completeUpload = useServerFn(completeDocumentUpload);

  const ocrPage = useCallback(async (imageB64: string, mediaType: string): Promise<string> => {
    const res = await fetch('/api/ocr', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contentBase64: imageB64, mediaType }),
    });
    if (!res.ok) throw new Error(`OCR HTTP ${res.status}`);
    const { markdown } = await res.json();
    return markdown ?? '';
  }, []);

  const runConvert = useCallback(
    async (file: File) => {
      fileRef.current = file;
      setFileName(file.name);
      setError(null);
      setSavedToKb('idle');
      setActive(0);
      setPages([]);
      const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
      try {
        let work: OcrPage[];
        if (ext === 'pdf') {
          setPhase('rendering');
          const res = await fetch('/api/ocr/render', {
            method: 'POST',
            headers: { 'Content-Type': 'application/pdf' },
            body: file,
          });
          if (!res.ok) throw new Error(`渲染失败（HTTP ${res.status}）`);
          const { pages: rendered } = (await res.json()) as { pages: { page: number; image: string }[] };
          work = rendered.map((p) => ({
            page: p.page,
            imageUrl: `data:image/png;base64,${p.image}`,
            imageB64: p.image,
            mediaType: 'image/png',
            md: null,
          }));
        } else {
          const b64 = await fileToBase64(file);
          const mt = MEDIA[ext] ?? 'image/jpeg';
          work = [{ page: 1, imageUrl: `data:${mt};base64,${b64}`, imageB64: b64, mediaType: mt, md: null }];
        }
        if (work.length === 0) throw new Error('没有可识别的页面');
        setPages(work);
        setPhase('ocr');

        // Per-page OCR, concurrency 2, fill in as each completes (逐页即显).
        let cursor = 0;
        const worker = async () => {
          while (cursor < work.length) {
            const i = cursor++;
            try {
              const md = await ocrPage(work[i].imageB64, work[i].mediaType);
              setPages((prev) => prev.map((p, idx) => (idx === i ? { ...p, md } : p)));
            } catch {
              setPages((prev) => prev.map((p, idx) => (idx === i ? { ...p, md: '', error: true } : p)));
            }
          }
        };
        await Promise.all([worker(), worker()]);
        setPhase('done');
      } catch (err) {
        setError(err instanceof Error ? err.message : '识别失败');
        setPhase('idle');
      }
    },
    [ocrPage],
  );

  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) void runConvert(f);
  };
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f) void runConvert(f);
  };

  const assembled = pages.map((p) => p.md ?? '').filter(Boolean).join('\n\n');
  const output = format === 'text' ? mdToText(assembled) : format === 'html' ? mdToHtml(assembled) : assembled;
  const doneCount = pages.filter((p) => p.md !== null).length;
  const current = pages[active];

  const copyOut = async () => {
    await navigator.clipboard.writeText(output);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };
  const exportOut = () => {
    const ext = format === 'html' ? 'html' : format === 'text' ? 'txt' : 'md';
    const mime = format === 'html' ? 'text/html' : format === 'text' ? 'text/plain' : 'text/markdown';
    const blob = new Blob([output], { type: mime });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${(fileName ?? 'ocr').replace(/\.[^.]+$/, '')}.${ext}`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const addToKb = async () => {
    const file = fileRef.current;
    if (!file || savedToKb === 'saving') return;
    setSavedToKb('saving');
    try {
      const init = (await initUpload({
        data: {
          originalName: file.name,
          mimeType: file.type || 'application/octet-stream',
          size: file.size,
          title: file.name.replace(/\.[^.]+$/, ''),
          content: assembled, // pre-filled OCR markdown → ingest skips parse, just chunk+embed
          addToKnowledgeBase: true,
        },
      })) as { id: string; key: string };
      await fetch(`/api/documents/upload?id=${encodeURIComponent(init.id)}&key=${encodeURIComponent(init.key)}`, {
        method: 'PUT',
        headers: { 'Content-Type': file.type || 'application/octet-stream' },
        body: file,
      });
      await completeUpload({ data: { id: init.id, key: init.key } });
      setSavedToKb('done');
    } catch {
      setSavedToKb('idle');
      setError('加入知识库失败，请重试');
    }
  };

  // ---- empty state ----
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
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          className={`flex w-full max-w-xl flex-col items-center gap-3 rounded-xl border-2 border-dashed px-8 py-16 transition-colors ${
            dragOver ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50 hover:bg-accent/30'
          }`}
        >
          <FileUp className="h-9 w-9 text-primary" />
          <span className="text-base font-medium text-foreground">拖入 PDF 或图片，转成可编辑文本</span>
          <span className="text-xs text-muted-foreground">扫描件 / 照片 / 无文字层 PDF 都行</span>
        </button>
        {error && (
          <p className="mt-4 flex items-center gap-1.5 text-sm text-destructive">
            <AlertCircle className="h-4 w-4" />
            {error}
          </p>
        )}
        <input ref={inputRef} type="file" accept={ACCEPT} className="hidden" onChange={onPick} />
      </div>
    );
  }

  // ---- result / progress ----
  return (
    <div className="flex h-[calc(100vh-theme(spacing.16))] flex-col">
      {/* header */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2.5">
        <span className="flex min-w-0 items-center gap-2 text-sm font-medium">
          <ScanText className="h-4 w-4 shrink-0 text-primary" />
          <span className="truncate">{fileName}</span>
          {phase !== 'done' ? (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              {phase === 'rendering' ? '准备页面…' : `识别中 ${doneCount}/${pages.length} 页`}
            </span>
          ) : (
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] text-primary">完成 · {pages.length} 页</span>
          )}
        </span>
        <div className="flex items-center gap-1 rounded-lg bg-muted p-0.5">
          {(['markdown', 'text', 'html'] as OutputFormat[]).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFormat(f)}
              className={`rounded-md px-2.5 py-1 text-xs transition-colors ${
                format === f ? 'bg-background font-medium text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {f === 'markdown' ? 'Markdown' : f === 'text' ? '纯文本' : 'HTML'}
            </button>
          ))}
        </div>
      </div>

      {/* split body */}
      <div className="grid min-h-0 flex-1 grid-cols-2">
        <div className="min-h-0 overflow-auto border-r p-3">
          <div className="mb-2 text-[11px] text-muted-foreground">原始页 · 第 {current?.page ?? 1} 页</div>
          {current && (
            <img src={current.imageUrl} alt={`page ${current.page}`} className="w-full rounded-md border" />
          )}
        </div>
        <div className="min-h-0 overflow-auto p-4">
          <div className="mb-2 text-[11px] text-muted-foreground">识别文本（可编辑 / 可复制）</div>
          {current?.md === null ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              识别中…
            </div>
          ) : current?.error ? (
            <p className="text-sm text-destructive">本页识别失败</p>
          ) : format === 'markdown' ? (
            <StreamingMarkdown content={current?.md || ''} isStreaming={false} mode="minimal" />
          ) : (
            <pre className="whitespace-pre-wrap font-mono text-xs leading-relaxed text-foreground">
              {format === 'text' ? mdToText(current?.md || '') : mdToHtml(current?.md || '')}
            </pre>
          )}
        </div>
      </div>

      {/* footer */}
      <div className="flex items-center justify-between gap-2 border-t px-4 py-2">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <button type="button" disabled={active === 0} onClick={() => setActive((a) => Math.max(0, a - 1))} className="disabled:opacity-30">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span>{(current?.page ?? 1)} / {pages.length}</span>
          <button
            type="button"
            disabled={active >= pages.length - 1}
            onClick={() => setActive((a) => Math.min(pages.length - 1, a + 1))}
            className="disabled:opacity-30"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={copyOut}
            disabled={!assembled}
            className="flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs hover:bg-accent disabled:opacity-40"
          >
            {copied ? <Check className="h-3.5 w-3.5 text-primary" /> : <Copy className="h-3.5 w-3.5" />}
            {copied ? '已复制' : '复制'}
          </button>
          <button
            type="button"
            onClick={exportOut}
            disabled={!assembled}
            className="flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs hover:bg-accent disabled:opacity-40"
          >
            <Download className="h-3.5 w-3.5" />
            导出
          </button>
          <button
            type="button"
            onClick={addToKb}
            disabled={!assembled || savedToKb !== 'idle'}
            className="flex items-center gap-1.5 rounded-lg bg-primary px-2.5 py-1.5 text-xs text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {savedToKb === 'saving' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : savedToKb === 'done' ? <Check className="h-3.5 w-3.5" /> : <BookPlus className="h-3.5 w-3.5" />}
            {savedToKb === 'done' ? '已加入' : '加入知识库'}
          </button>
        </div>
      </div>
      {error && <p className="border-t px-4 py-1.5 text-xs text-destructive">{error}</p>}
    </div>
  );
}
