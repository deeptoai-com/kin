/**
 * RAG ingest pipeline (final spec R1, D4/D9/D10) — ONE idempotent pure-ish function.
 *
 * `ingestDocument(documentId)` runs identically inline (local dev, RAG_INGEST_INLINE)
 * and inside the BullMQ 'rag' worker. Stages: load → chunk → contextualize (free tier:
 * title + sectionPath prefix) → hash-skip if unchanged → embed (batched) → replace
 * chunks transactionally → Meili chunks index (best-effort) → toc/status/progress.
 */
import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from '~/db/db-config';
import { documents, documentChunks } from '~/db/schema/document.schema';
import { chunkMarkdown } from './chunker';
import { EMBED_DIM, EMBED_MODEL, embedTexts, splitBatches } from './zhipu';
import { indexChunks, removeChunksOfDocument } from '~/search/meilisearch';

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

export async function ingestDocument(documentId: string): Promise<IngestResult> {
  const [doc] = await db.select().from(documents).where(eq(documents.id, documentId)).limit(1);
  if (!doc) return { status: 'failed', reason: `document ${documentId} not found` };
  if (!doc.content?.trim()) {
    await setProgress(documentId, { ingestStatus: 'failed' });
    return { status: 'failed', reason: 'empty content' };
  }

  try {
    await setProgress(documentId, { ingestStatus: 'processing', ingestProgress: 5 });

    const { parents, children, toc } = chunkMarkdown(doc.title || doc.filename || '文档', doc.content);
    if (parents.length === 0) {
      await setProgress(documentId, { ingestStatus: 'failed' });
      return { status: 'failed', reason: 'no chunks produced' };
    }

    // One flat list: parents first (children reference them), order stable.
    const all = [
      ...parents.map((p) => ({ ...p, parentIndex: -1 })),
      ...children.map((c) => ({ sectionPath: c.sectionPath, text: c.text, parentIndex: c.parentIndex })),
    ];
    const hashes = all.map((c) => sha256(embedInput(c.sectionPath, c.text)));

    // Incremental skip (final spec D10): same model+dim and identical hash set → no re-embed.
    const existing = await db
      .select({ contentHash: documentChunks.contentHash })
      .from(documentChunks)
      .where(eq(documentChunks.documentId, documentId));
    const sameModel = doc.embedModel === EMBED_MODEL && doc.embedDim === EMBED_DIM;
    if (
      sameModel &&
      existing.length === all.length &&
      existing.every((e) => e.contentHash != null) &&
      new Set(existing.map((e) => e.contentHash)).size === new Set(hashes).size &&
      hashes.every((h, _, set) => set.includes(h) || true) && // order-insensitive compare below
      [...new Set(hashes)].every((h) => existing.some((e) => e.contentHash === h))
    ) {
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
      embedModel: EMBED_MODEL,
      embedDim: EMBED_DIM,
    });
    return { status: 'ready', chunks: all.length };
  } catch (err) {
    console.error('[rag-ingest] failed:', documentId, err);
    await setProgress(documentId, { ingestStatus: 'failed' }).catch(() => {});
    return { status: 'failed', reason: err instanceof Error ? err.message : String(err) };
  }
}
