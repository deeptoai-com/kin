/**
 * kb_search retrieval pipeline (final spec D7) — hybrid recall → RRF → rerank →
 * small-to-big → cited results.
 *
 * ISOLATION INVARIANT: both legs are scoped to the caller's visible documents via the
 * access resolver (visibleDocumentsWhere) — in SQL / in the Meili filter, never a
 * post-filter. The 非成员看不到 regression lives in scripts/rag-r2-smoke.ts.
 */
import { and, cosineDistance, eq, inArray } from 'drizzle-orm';
import { db } from '~/db/db-config';
import { documents, documentChunks } from '~/db/schema/document.schema';
import { kbDocuments } from '~/db/schema/kb-document.schema';
import { accessibleProjectIds, visibleDocumentsWhere } from '~/server/projects/access';
import { searchChunks } from '~/search/meilisearch';
import { embedTexts, rerankDocuments } from './zhipu';
import { rrfFuse } from './fuse';

export interface KbSearchParams {
  query: string;
  /** Results to return (default 8). */
  k?: number;
  /** Optional narrowing: a single document, or a knowledge base (via kb_documents). */
  documentId?: string;
  kbId?: string;
}

export interface KbSearchHit {
  documentId: string;
  documentTitle: string;
  sectionPath: string | null;
  text: string;
  pageStart: number | null;
  pageEnd: number | null;
  score: number;
}

const VECTOR_RECALL = 20;
const BM25_RECALL = 20;
const RERANK_POOL = 12;

/** Resolve the searchable document-id universe for this user (+ optional narrowing). */
async function visibleDocIds(userId: string, params: KbSearchParams): Promise<string[]> {
  const projectIds = await accessibleProjectIds(userId);
  const rows = await db
    .select({ id: documents.id, fileId: documents.fileId })
    .from(documents)
    .where(and(visibleDocumentsWhere(userId, projectIds), eq(documents.ingestStatus, 'ready')));

  let ids = rows;
  if (params.documentId) {
    ids = ids.filter((r) => r.id === params.documentId);
  } else if (params.kbId) {
    // kb_documents links a KB to FILES; documents hang off the same fileId.
    const kbFiles = await db
      .select({ fileId: kbDocuments.fileId })
      .from(kbDocuments)
      .where(eq(kbDocuments.kbId, params.kbId));
    const fileSet = new Set(kbFiles.map((f) => f.fileId));
    ids = ids.filter((r) => r.fileId && fileSet.has(r.fileId));
  }
  return ids.map((r) => r.id);
}

export async function searchKb(userId: string, params: KbSearchParams): Promise<KbSearchHit[]> {
  const k = Math.min(Math.max(params.k ?? 8, 1), 20);
  const query = params.query?.trim();
  if (!query) return [];

  const docIds = await visibleDocIds(userId, params);
  if (docIds.length === 0) return [];

  // ── Hybrid recall (both legs scoped to the SAME visible-doc universe) ─────────
  const [queryVec] = await embedTexts([query]);
  const distance = cosineDistance(documentChunks.embedding, queryVec);
  const vectorLegPromise = db
    .select({ id: documentChunks.id })
    .from(documentChunks)
    .where(inArray(documentChunks.documentId, docIds))
    .orderBy(distance)
    .limit(VECTOR_RECALL);
  const bm25LegPromise = searchChunks(query, docIds, BM25_RECALL).catch((err) => {
    // Meili down → degrade to vector-only rather than failing the search.
    console.warn('[rag-search] BM25 leg failed (degrading to vector-only):', err);
    return [] as Array<{ id: string }>;
  });
  const [vectorLeg, bm25Leg] = await Promise.all([vectorLegPromise, bm25LegPromise]);

  // ── RRF fuse → load candidate rows ────────────────────────────────────────────
  const fused = rrfFuse([vectorLeg.map((r) => r.id), bm25Leg.map((h) => h.id)]);
  const candidateIds = [...fused.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, RERANK_POOL)
    .map(([id]) => id);
  if (candidateIds.length === 0) return [];

  const candidates = await db
    .select()
    .from(documentChunks)
    .where(inArray(documentChunks.id, candidateIds));
  const byId = new Map(candidates.map((c) => [c.id, c]));
  const ordered = candidateIds.map((id) => byId.get(id)).filter((c) => c != null);

  // ── Rerank (precision stage; degrade to RRF order if the endpoint fails) ──────
  let rankedChunks = ordered;
  try {
    const reranked = await rerankDocuments(
      query,
      ordered.map((c) => `${c.sectionPath ?? ''}\n${c.text}`),
    );
    rankedChunks = reranked.map((r) => ordered[r.index]);
  } catch (err) {
    console.warn('[rag-search] rerank failed (keeping RRF order):', err);
  }

  // ── small-to-big: child hit → return its parent section; dedup by surface id ──
  const parentIds = rankedChunks.map((c) => c.parentChunkId).filter((p): p is string => !!p);
  const parents = parentIds.length
    ? await db.select().from(documentChunks).where(inArray(documentChunks.id, parentIds))
    : [];
  const parentById = new Map(parents.map((p) => [p.id, p]));

  const docTitles = new Map(
    (await db
      .select({ id: documents.id, title: documents.title })
      .from(documents)
      .where(inArray(documents.id, docIds))).map((d) => [d.id, d.title]),
  );

  const seen = new Set<string>();
  const hits: KbSearchHit[] = [];
  for (let i = 0; i < rankedChunks.length && hits.length < k; i++) {
    const chunk = rankedChunks[i];
    const surface = (chunk.parentChunkId && parentById.get(chunk.parentChunkId)) || chunk;
    if (seen.has(surface.id)) continue;
    seen.add(surface.id);
    hits.push({
      documentId: surface.documentId!,
      documentTitle: docTitles.get(surface.documentId!) ?? '',
      sectionPath: surface.sectionPath,
      text: surface.text,
      pageStart: surface.pageStart,
      pageEnd: surface.pageEnd,
      score: 1 - i / rankedChunks.length,
    });
  }
  return hits;
}
