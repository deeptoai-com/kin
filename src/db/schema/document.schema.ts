import { generateId } from '~/utils/id-generator';
import { index, integer, jsonb, pgTable, text, uuid, vector } from 'drizzle-orm/pg-core';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { files } from './file.schema';
import { project } from './project.schema';
import { timestamps } from './_shared';

/**
 * documents — parsed full text + metadata of an uploaded/created document.
 *
 * RAG R0 (final spec D2/D5, docs/project/research/2026-06-10-rag-final-implementation-spec.md):
 * - `projectId` nullable is the access primitive (null = personal, same convention as
 *   agent_session.project_id). `userId` is the uploader/owner-for-personal — visibility
 *   checks go through the access resolver (src/server/projects/access.ts), never a bare
 *   `WHERE user_id`.
 * - Ingest bookkeeping columns drive the tiered pipeline: only `ragTier='rag'` documents
 *   get chunked + embedded; small docs stay on the workspace Read/Grep path.
 */
export const documents = pgTable(
  'documents',
  {
    id: text('id')
      .$defaultFn(() => generateId('doc'))
      .primaryKey(),
    title: text('title').notNull(),
    content: text('content').notNull(),
    fileType: text('file_type'),
    filename: text('filename'),
    totalCharCount: integer('total_char_count'),
    totalLineCount: integer('total_line_count'),
    sourceType: text('source_type').notNull(),
    source: text('source'),
    fileId: text('file_id').references(() => files.id, { onDelete: 'cascade' }),
    userId: text('user_id').notNull(),
    clientId: text('client_id').default('local'),

    // ── RAG R0 ──────────────────────────────────────────────────────────────
    /** Access primitive: null = personal (owner = userId), else visible to project members. */
    projectId: uuid('project_id').references(() => project.id, { onDelete: 'set null' }),
    /** none = not routed yet / not eligible; pipeline: pending → processing → ready | failed. */
    ingestStatus: text('ingest_status').notNull().default('none'),
    /** 0–100, written by the ingest pipeline for UI progress. */
    ingestProgress: integer('ingest_progress').notNull().default(0),
    /** Heuristic token count of `content`, basis for tier routing. */
    tokenEstimate: integer('token_estimate'),
    /** inline | grep | rag — only 'rag' documents are chunked + embedded. */
    ragTier: text('rag_tier'),
    /** Document-level digest for holistic routing (R3). */
    summary: text('summary'),
    /** Section tree [{ path, pageStart, pageEnd }] for agentic drill-down (R3). */
    toc: jsonb('toc'),
    /** Embedding provenance — a model/dim change means re-embedding (final spec D1). */
    embedModel: text('embed_model'),
    embedDim: integer('embed_dim'),

    ...timestamps,
  },
  (table) => ({
    projectIdx: index('idx_documents_project').on(table.projectId),
    userIdx: index('idx_documents_user').on(table.userId),
  }),
);

/**
 * document_chunks — retrieval units of a 'rag'-tier document.
 *
 * NO access columns here (final spec D2 / keystone "零重嵌" rule): visibility resolves at
 * the documents level; chunks are document-scoped so sharing a document never re-embeds.
 * `embedding` is Zhipu embedding-3 @ 1024 dims (final spec D1; the previous 1536 column
 * was never written by any code, so the dim change is free).
 */
export const documentChunks = pgTable(
  'document_chunks',
  {
    id: text('id')
      .$defaultFn(() => generateId('chunk'))
      .primaryKey(),
    /** Logical parent (R0: was only file_id, ambiguous when documents share a file). */
    documentId: text('document_id').references(() => documents.id, { onDelete: 'cascade' }),
    fileId: text('file_id')
      .references(() => files.id, { onDelete: 'cascade' })
      .notNull(),
    chunkIndex: integer('chunk_index').notNull(),
    text: text('text').notNull(),
    embedding: vector('embedding', { dimensions: 1024 }).notNull(),

    // ── RAG R0 ──────────────────────────────────────────────────────────────
    /** e.g. "§7.2 退款条款" — citation + free-tier contextual prefix (final spec D9). */
    sectionPath: text('section_path'),
    pageStart: integer('page_start'),
    pageEnd: integer('page_end'),
    /** small-to-big: child chunks point at their section-level parent (final spec D10). */
    parentChunkId: text('parent_chunk_id').references((): AnyPgColumn => documentChunks.id, {
      onDelete: 'set null',
    }),
    /** sha256(context_prefix + text) — dedup + incremental re-embed (final spec D10). */
    contentHash: text('content_hash'),
    /** Prepended before embedding (doc title + section path); stored for re-embed audits. */
    contextPrefix: text('context_prefix'),

    ...timestamps,
  },
  (table) => ({
    documentIdx: index('idx_document_chunks_document').on(table.documentId),
    contentHashIdx: index('idx_document_chunks_content_hash').on(table.contentHash),
    // Vector ANN index — cosine, matching the kb_search query operator (final spec D7).
    embeddingHnswIdx: index('idx_document_chunks_embedding_hnsw').using(
      'hnsw',
      table.embedding.op('vector_cosine_ops'),
    ),
  }),
);
