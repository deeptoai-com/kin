/**
 * RAG ingest pipeline (final spec R1, D4/D9/D10) — ONE idempotent pure-ish function.
 *
 * `ingestDocument(documentId)` runs identically inline (local dev, RAG_INGEST_INLINE)
 * and inside the BullMQ 'rag' worker. Stages: load → chunk → contextualize (free tier:
 * title + sectionPath prefix) → hash-skip if unchanged → embed (batched) → replace
 * chunks transactionally → Meili chunks index (best-effort) → toc/status/progress.
 */
import { createHash } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { db } from '~/db/db-config';
import { documents, documentChunks } from '~/db/schema/document.schema';
import { files } from '~/db/schema/file.schema';
import { chunkMarkdown } from './chunker';
import { chunkStrategy, estimateTokens, type ChunkStrategy } from './tier';
import { EMBED_DIM, embedModel, embedTexts } from './embedding';
import { splitBatches } from './zhipu';
import { extractPageMap, pageLookup, parsePdfViaSidecar, type PageBreak } from './parser-client';
import { ocrPdfToMarkdown, ocrImageToMarkdown } from './ocr-ingest';
import { indexChunks, removeChunksOfDocument } from '~/search/meilisearch';

/** Flat chunk shape fed to the embed+insert loop (parentIndex -1 = a top-level/single chunk). */
interface FlatChunk {
  sectionPath: string;
  text: string;
  parentIndex: number;
  pageStart: number | null;
  pageEnd: number | null;
}

/**
 * Build the chunk list per the doc's size (ingest-UX spec D6):
 *  - 'single'     → whole document as ONE chunk (no parent/child; kb_search returns it whole)
 *  - 'structured' → heading-scoped parents + paragraph-packed children
 * Returns the strategy too, so the caller can record it on the document row.
 * `pageMap` (from the parse stage / documents.page_map) feeds chunk page ranges.
 */
function buildChunks(
  title: string,
  content: string,
  pageMap: PageBreak[] | null,
): { all: FlatChunk[]; toc: ReturnType<typeof chunkMarkdown>['toc']; strategy: ChunkStrategy } {
  const strategy = chunkStrategy(estimateTokens(content));
  if (strategy === 'single') {
    const single: FlatChunk = {
      sectionPath: title,
      text: content.trim(),
      parentIndex: -1,
      pageStart: pageMap?.[0]?.page ?? null,
      pageEnd: pageMap?.length ? pageMap[pageMap.length - 1].page : null,
    };
    return { all: [single], toc: [], strategy };
  }
  const { parents, children, toc } = chunkMarkdown(title, content, pageLookup(pageMap));
  const all: FlatChunk[] = [
    ...parents.map((p) => ({ ...p, parentIndex: -1 })),
    ...children.map((c) => ({
      sectionPath: c.sectionPath,
      text: c.text,
      parentIndex: c.parentIndex,
      pageStart: c.pageStart,
      pageEnd: c.pageEnd,
    })),
  ];
  return { all, toc, strategy };
}

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

/** Embedding input = context prefix + text (final spec D9 free tier). */
const embedInput = (sectionPath: string, text: string) => `${sectionPath}\n${text}`;

async function setProgress(documentId: string, patch: Partial<typeof documents.$inferInsert>) {
  await db.update(documents).set(patch).where(eq(documents.id, documentId));
}

export interface IngestResult {
  status: 'ready' | 'failed' | 'skipped';
  chunks?: number;
  reason?: string;
}

/**
 * Parse pre-stage (U1, ingest-UX spec §4): a KB document created from a binary upload has
 * no content yet — fetch the file and run it through the parser sidecar, honoring the
 * user-chosen/recommended engine (documents.parse_method; default structured). Parse and
 * embed are SEPARATE state machines: a parse failure marks parse_status='failed'
 * (visible + retryable with another engine, spec DR-7) without touching chunk state.
 */
const IMAGE_EXT = /\.(png|jpe?g|webp)$/;
const imageMediaType = (name: string): string =>
  name.endsWith('.png') ? 'image/png' : name.endsWith('.webp') ? 'image/webp' : 'image/jpeg';

async function parseStage(
  doc: typeof documents.$inferSelect,
): Promise<{ markdown: string; pageMap: PageBreak[] } | null> {
  if (!doc.fileId) return null;
  const [file] = await db.select().from(files).where(eq(files.id, doc.fileId)).limit(1);
  const name = (file?.name || doc.filename || '').toLowerCase();
  const isPdf = name.endsWith('.pdf');
  const isImage = IMAGE_EXT.test(name);
  if (!file || (!isPdf && !isImage)) return null; // non-PDF/non-image rich types stay on markitdown (U1 scope)

  await setProgress(doc.id, { parseStatus: 'processing' });
  try {
    // Lazy import: ~/server/s3 pulls in ~/conf/file whose env validation requires S3_*
    // vars — only environments that actually parse uploads (worker/app in compose) have
    // them; importing eagerly would crash host-local tools that never touch S3.
    const { S3StaticFileImpl } = await import('~/server/s3/s3');
    const url = await new S3StaticFileImpl().getFullFileUrl(file.key);
    const blob = await fetch(url);
    if (!blob.ok) throw new Error(`file fetch HTTP ${blob.status}`);
    const bytes = Buffer.from(await blob.arrayBuffer());

    // OCR branch (O1-c): an image upload IS one page → OCR directly; a PDF goes to OCR when
    // the user/probe chose it (parseMethod='ocr') or when text-layer parse comes back empty
    // (scanned PDF — the U3 hole). OCR output carries `<!-- odl-page N -->` markers so the
    // existing extractPageMap → chunker → page-citation downstream is reused unchanged.
    let rawMarkdown: string | null = null;
    let resolvedMethod = doc.parseMethod || 'structured';

    if (isImage) {
      rawMarkdown = await ocrImageToMarkdown(bytes, imageMediaType(name));
      resolvedMethod = 'ocr';
    } else if (doc.parseMethod === 'ocr') {
      rawMarkdown = await ocrPdfToMarkdown(bytes);
      resolvedMethod = 'ocr';
    } else {
      const mode = doc.parseMethod === 'simple' ? 'simple' : 'structured';
      const parsed = await parsePdfViaSidecar(bytes, mode);
      if (parsed.ok && parsed.markdown?.trim()) {
        rawMarkdown = parsed.markdown;
        resolvedMethod = mode;
      } else {
        // Empty text layer → scanned PDF; auto-fall back to OCR (closes U3 so uploads "just work").
        console.warn('[rag-ingest] empty text layer, falling back to OCR:', doc.id);
        rawMarkdown = await ocrPdfToMarkdown(bytes);
        resolvedMethod = 'ocr';
      }
    }

    if (!rawMarkdown?.trim()) {
      throw new Error('parser/OCR produced no text');
    }
    const { markdown, pageMap } = extractPageMap(rawMarkdown);
    await setProgress(doc.id, {
      content: markdown,
      pageMap: pageMap.length ? pageMap : null,
      parseStatus: 'ready',
      parseMethod: resolvedMethod,
      tokenEstimate: estimateTokens(markdown),
      totalCharCount: markdown.length,
      totalLineCount: markdown.split(/\r?\n/).length,
    });
    return { markdown, pageMap };
  } catch (err) {
    console.error('[rag-ingest] parse stage failed:', doc.id, err);
    await setProgress(doc.id, { parseStatus: 'failed' }).catch(() => {});
    return null;
  }
}

export async function ingestDocument(documentId: string): Promise<IngestResult> {
  const [doc] = await db.select().from(documents).where(eq(documents.id, documentId)).limit(1);
  if (!doc) return { status: 'failed', reason: `document ${documentId} not found` };
  let pageMap = (doc.pageMap as PageBreak[] | null) ?? null;
  if (!doc.content?.trim()) {
    const parsed = await parseStage(doc);
    if (!parsed) {
      await setProgress(documentId, { ingestStatus: 'failed' });
      return { status: 'failed', reason: 'empty content (parse pre-stage unavailable or failed)' };
    }
    doc.content = parsed.markdown;
    pageMap = parsed.pageMap.length ? parsed.pageMap : null;
  }

  try {
    await setProgress(documentId, { ingestStatus: 'processing', ingestProgress: 5 });

    const { all, toc, strategy } = buildChunks(doc.title || doc.filename || '文档', doc.content, pageMap);
    if (all.length === 0) {
      await setProgress(documentId, { ingestStatus: 'failed' });
      return { status: 'failed', reason: 'no chunks produced' };
    }
    const hashes = all.map((c) => sha256(embedInput(c.sectionPath, c.text)));

    // Incremental skip (final spec D10): same model+dim and identical hash set → no re-embed.
    const existing = await db
      .select({ contentHash: documentChunks.contentHash })
      .from(documentChunks)
      .where(eq(documentChunks.documentId, documentId));
    const sameModel = doc.embedModel === embedModel() && doc.embedDim === EMBED_DIM;
    if (
      sameModel &&
      existing.length === all.length &&
      existing.every((e) => e.contentHash != null) &&
      new Set(existing.map((e) => e.contentHash)).size === new Set(hashes).size &&
      hashes.every((h, _, set) => set.includes(h) || true) && // order-insensitive compare below
      [...new Set(hashes)].every((h) => existing.some((e) => e.contentHash === h))
    ) {
      // Page ranges are NOT part of the content hash, so a re-parse with the same engine
      // lands here with identical chunks — backfill pages onto the existing rows (and the
      // page-aware toc) without paying for re-embedding.
      if (pageMap?.length) {
        for (let i = 0; i < all.length; i++) {
          await db
            .update(documentChunks)
            .set({ pageStart: all[i].pageStart, pageEnd: all[i].pageEnd })
            .where(
              and(
                eq(documentChunks.documentId, documentId),
                eq(documentChunks.contentHash, hashes[i]),
              ),
            );
        }
        await setProgress(documentId, { toc });
      }
      await setProgress(documentId, { ingestStatus: 'ready', ingestProgress: 100 });
      return { status: 'skipped', chunks: existing.length };
    }

    await setProgress(documentId, { ingestProgress: 15 });

    // Embed in explicit batches so progress moves 15 → 80 as batches complete.
    const inputs = all.map((c) => embedInput(c.sectionPath, c.text));
    const batches = splitBatches(inputs);
    const vectors: number[][] = [];
    for (let i = 0; i < batches.length; i++) {
      vectors.push(...(await embedTexts(batches[i])));
      await setProgress(documentId, {
        ingestProgress: 15 + Math.round(((i + 1) / batches.length) * 65),
      });
    }

    // Replace chunks transactionally: parents first (capture ids), then children.
    const insertedIds = await db.transaction(async (tx) => {
      await tx.delete(documentChunks).where(eq(documentChunks.documentId, documentId));
      const ids: string[] = [];
      for (let i = 0; i < all.length; i++) {
        const chunk = all[i];
        const [row] = await tx
          .insert(documentChunks)
          .values({
            documentId,
            fileId: doc.fileId!,
            chunkIndex: i,
            text: chunk.text,
            embedding: vectors[i],
            sectionPath: chunk.sectionPath,
            pageStart: chunk.pageStart,
            pageEnd: chunk.pageEnd,
            parentChunkId: chunk.parentIndex >= 0 ? ids[chunk.parentIndex] : null,
            contentHash: hashes[i],
            contextPrefix: chunk.sectionPath,
          })
          .returning({ id: documentChunks.id });
        ids.push(row.id);
      }
      return ids;
    });

    // BM25 leg (final spec D7) — best-effort: Meili down must not fail the ingest.
    try {
      await removeChunksOfDocument(documentId);
      await indexChunks(
        all.map((c, i) => ({
          id: insertedIds[i],
          documentId,
          sectionPath: c.sectionPath,
          text: c.text,
        })),
      );
    } catch (err) {
      console.warn('[rag-ingest] Meili chunk indexing failed (non-fatal):', err);
    }

    await setProgress(documentId, {
      ingestStatus: 'ready',
      ingestProgress: 100,
      toc,
      ragTier: strategy,
      embedModel: embedModel(),
      embedDim: EMBED_DIM,
    });
    return { status: 'ready', chunks: all.length };
  } catch (err) {
    console.error('[rag-ingest] failed:', documentId, err);
    await setProgress(documentId, { ingestStatus: 'failed' }).catch(() => {});
    return { status: 'failed', reason: err instanceof Error ? err.message : String(err) };
  }
}
