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
import { ragSearchTrace } from '~/db/schema/rag-trace.schema';
import { accessibleProjectIds, visibleDocumentsWhere } from '~/server/projects/access';
import { searchChunks } from '~/search/meilisearch';
import { embedTexts } from './embedding';
import { rerankDocuments } from './zhipu';
import { rrfFuse } from './fuse';

export interface KbSearchParams {
  query: string;
  /** Results to return (default 8). */
  k?: number;
  /** Optional narrowing: a single document, or knowledge base(s) (via kb_documents). */
  documentId?: string;
  kbId?: string;
  /** Session-selected scope (KB 面板勾选, prd 阶段3): union of these KBs. kbId wins if set. */
  kbIds?: string[];
  /** Ablation knobs for the golden-set eval (R4) — production callers leave them unset. */
  skipRerank?: boolean;
  skipBm25?: boolean;
  /** Disable trace recording (eval runs would pollute the trace stream). Default on. */
  trace?: boolean;
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

/**
 * Rerank default-OFF, by golden-set evidence (R4-① first run, 2026-06-11): Zhipu rerank
 * DROPPED R@1 from 100% → 86% (paraphrase cases demoted from rank 1) while costing
 * ~1.4s/query — consistent with the T0 probe's weak score separation (1.0 vs 0.99998).
 * Re-evaluate on the real-document golden set (v2) before flipping this on.
 */
function rerankEnabled(): boolean {
  return process.env.RAG_RERANK_ENABLED === 'true';
}

/** Resolve the searchable document-id universe for this user (+ optional narrowing). */
async function visibleDocIds(userId: string, params: KbSearchParams): Promise<string[]> {
  const projectIds = await accessibleProjectIds(userId);
  const rows = await db
    .select({ id: documents.id, fileId: documents.fileId })
    .from(documents)
    .where(and(visibleDocumentsWhere(userId, projectIds), eq(documents.ingestStatus, 'ready')));

  let ids = rows;
  const kbScope = params.kbId ? [params.kbId] : (params.kbIds ?? []);
  if (params.documentId) {
    ids = ids.filter((r) => r.id === params.documentId);
  } else if (kbScope.length > 0) {
    // kb_documents links KBs to FILES; documents hang off the same fileId. Multiple
    // selected KBs = the union of their files (session scope picker, prd 阶段3).
    const kbFiles = await db
      .select({ fileId: kbDocuments.fileId })
      .from(kbDocuments)
      .where(inArray(kbDocuments.kbId, kbScope));
    const fileSet = new Set(kbFiles.map((f) => f.fileId));
    ids = ids.filter((r) => r.fileId && fileSet.has(r.fileId));
  }
  return ids.map((r) => r.id);
}

export async function searchKb(userId: string, params: KbSearchParams): Promise<KbSearchHit[]> {
  const startedAt = Date.now();
  const k = Math.min(Math.max(params.k ?? 8, 1), 20);
  const query = params.query?.trim();
  if (!query) return [];

  const docIds = await visibleDocIds(userId, params);
  if (docIds.length === 0) return [];

  let bm25Degraded = false;
  let rerankDegraded = false;

  // ── Hybrid recall (both legs scoped to the SAME visible-doc universe) ─────────
  const [queryVec] = await embedTexts([query]);
  const distance = cosineDistance(documentChunks.embedding, queryVec);
  const vectorLegPromise = db
    .select({ id: documentChunks.id })
    .from(documentChunks)
    .where(inArray(documentChunks.documentId, docIds))
    .orderBy(distance)
    .limit(VECTOR_RECALL);
  const bm25LegPromise = params.skipBm25
    ? Promise.resolve([] as Array<{ id: string }>)
    : searchChunks(query, docIds, BM25_RECALL).catch((err) => {
        // Meili down → degrade to vector-only rather than failing the search.
        console.warn('[rag-search] BM25 leg failed (degrading to vector-only):', err);
        bm25Degraded = true;
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
  const useRerank = params.skipRerank != null ? !params.skipRerank : rerankEnabled();
  if (useRerank) {
    try {
      const reranked = await rerankDocuments(
        query,
        ordered.map((c) => `${c.sectionPath ?? ''}\n${c.text}`),
      );
      rankedChunks = reranked.map((r) => ordered[r.index]);
    } catch (err) {
      console.warn('[rag-search] rerank failed (keeping RRF order):', err);
      rerankDegraded = true;
    }
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
  const returnedIds: string[] = [];
  for (let i = 0; i < rankedChunks.length && hits.length < k; i++) {
    const chunk = rankedChunks[i];
    const surface = (chunk.parentChunkId && parentById.get(chunk.parentChunkId)) || chunk;
    if (seen.has(surface.id)) continue;
    seen.add(surface.id);
    returnedIds.push(surface.id);
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

  // ── Trace (R4): insert-only, fire-and-forget — must never fail or slow a search ──
  if (params.trace !== false) {
    const degraded =
      [bm25Degraded ? 'bm25' : null, rerankDegraded ? 'rerank' : null].filter(Boolean).join('+') ||
      'ok';
    void db
      .insert(ragSearchTrace)
      .values({
        userId,
        query,
        params: { k: params.k, documentId: params.documentId, kbId: params.kbId },
        visibleDocCount: docIds.length,
        vectorIds: vectorLeg.map((r) => r.id),
        bm25Ids: bm25Leg.map((h) => h.id),
        fusedIds: candidateIds,
        rerankedIds: useRerank ? rankedChunks.map((c) => c.id) : null,
        returnedIds,
        degraded: degraded === 'ok' ? 'ok' : `${degraded}_degraded`,
        latencyMs: Date.now() - startedAt,
      })
      .catch((err) => console.warn('[rag-search] trace insert failed (non-fatal):', err));
  }

  return hits;
}
