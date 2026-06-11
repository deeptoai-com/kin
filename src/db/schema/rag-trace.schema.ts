import { generateId } from '~/utils/id-generator';
import { index, integer, jsonb, pgTable, text } from 'drizzle-orm/pg-core';
import { timestamps } from './_shared';

/**
 * rag_search_trace — one row per kb_search execution (final spec R4 / 复工计划 R4-③).
 *
 * Answers "why did it answer wrong" without guesswork: what each recall leg returned,
 * how RRF fused them, what rerank changed, and what was finally surfaced. Also the
 * candidate source for golden-set questions (real queries → eval cases).
 * Insert-only, fire-and-forget — tracing must never fail or slow a search.
 */
export const ragSearchTrace = pgTable(
  'rag_search_trace',
  {
    id: text('id')
      .$defaultFn(() => generateId('rtrace'))
      .primaryKey(),
    userId: text('user_id').notNull(),
    query: text('query').notNull(),
    /** Narrowing params as sent: { k, documentId, kbId } */
    params: jsonb('params'),
    /** How many documents were in the caller's visible universe. */
    visibleDocCount: integer('visible_doc_count'),
    /** Ranked chunk-id lists per stage (ids only — text stays in document_chunks). */
    vectorIds: jsonb('vector_ids'),
    bm25Ids: jsonb('bm25_ids'),
    fusedIds: jsonb('fused_ids'),
    rerankedIds: jsonb('reranked_ids'),
    /** Chunk ids actually returned to the agent (post small-to-big, deduped). */
    returnedIds: jsonb('returned_ids'),
    /** 'ok' | 'bm25_degraded' | 'rerank_degraded' | 'bm25+rerank_degraded' */
    degraded: text('degraded'),
    latencyMs: integer('latency_ms'),
    ...timestamps,
  },
  (table) => ({
    userIdx: index('idx_rag_search_trace_user').on(table.userId),
    createdIdx: index('idx_rag_search_trace_created').on(table.createdAt),
  }),
);
