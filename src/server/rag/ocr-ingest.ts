/**
 * OCR → ingestable markdown (OCR module O1-c) — the scanned-file branch of the RAG
 * parse stage. Bridges the OCR engine (src/server/ocr/provider) into the EXISTING
 * ingest downstream: by emitting the same `<!-- odl-page N -->` markers the parser
 * sidecar uses, the assembled OCR markdown flows straight through extractPageMap →
 * chunker → embed → page citations with ZERO downstream changes.
 *
 * PDF: render each page to PNG (sidecar /render) → OCR each page (concurrency-limited)
 *      → assemble page-marked markdown.
 * Image: OCR the single image directly (it IS one page).
 */
import { ocrImage, type OcrProvider } from '~/server/ocr/provider';
import { renderPdfViaSidecar } from './parser-client';

/** Per-page marker (mirrors the parser sidecar) so extractPageMap maps OCR chunks → pages. */
export const PAGE_MARK = (n: number) => `<!-- odl-page ${n} -->`;

/** Limited-concurrency map — keep VLM calls bounded (cost/rate) yet parallel. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

export interface OcrIngestOptions {
  provider?: OcrProvider;
  dpi?: number;
  maxPages?: number;
  concurrency?: number;
  signal?: AbortSignal;
}

/** Render a PDF and OCR every page → page-marked markdown (feeds extractPageMap unchanged). */
export async function ocrPdfToMarkdown(
  bytes: Uint8Array | Buffer,
  opts: OcrIngestOptions = {},
): Promise<string | null> {
  const rendered = await renderPdfViaSidecar(bytes, { dpi: opts.dpi ?? 150, maxPages: opts.maxPages });
  if (!rendered.ok || !rendered.pages?.length) return null;
  const texts = await mapLimit(rendered.pages, opts.concurrency ?? 4, (p) =>
    ocrImage(p.image, 'image/png', { provider: opts.provider, signal: opts.signal }).catch(() => ''),
  );
  const blocks = rendered.pages
    .map((p, i) => `${PAGE_MARK(p.page)}\n${texts[i] ?? ''}`.trim())
    .filter((b) => b.replace(/<!-- odl-page \d+ -->/g, '').trim().length > 0);
  return blocks.length ? blocks.join('\n\n') : null;
}

/** OCR a single image upload → markdown (one page; no markers needed). */
export async function ocrImageToMarkdown(
  bytes: Uint8Array | Buffer,
  mediaType: string,
  opts: OcrIngestOptions = {},
): Promise<string | null> {
  const b64 = Buffer.from(bytes).toString('base64');
  const md = await ocrImage(b64, mediaType, { provider: opts.provider, signal: opts.signal });
  return md.trim() || null;
}
