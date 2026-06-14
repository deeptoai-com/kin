/**
 * OCR Job Schema (OCR module O2 #2 — converter history).
 *
 * The standalone 文字识别 converter auto-saves each conversion here so it survives refresh.
 * INTENTIONALLY separate from `documents`/knowledge bases: the converter is a utility, not
 * RAG knowledge — its history must not pollute the KB document library. "加入知识库" is a
 * separate, explicit action that creates a `documents` row from the job.
 *
 * `pages` holds the per-page extracted text (parse or OCR); the original `fileId` is kept so
 * a reopened job can re-render page images / re-OCR on demand (text-only here keeps it light).
 */
import { pgTable, text, integer, boolean, jsonb, index } from 'drizzle-orm/pg-core';
import { files } from './file.schema';
import { createdAt, updatedAt } from './_shared';

/** One page's extracted text + where it came from. */
export interface OcrJobPage {
  page: number;
  text: string;
  source: 'parse' | 'ocr';
}

/** A VLM-corrected PAGE (single page or cross-page merged): the full page content with the table
 *  re-rendered correctly as HTML (prose kept from the parser). Persisted so it survives reopen AND
 *  REPLACES the parser's flattened page on 加入知识库 — the whole point is the Agent (kb_search)
 *  reading the ACCURATE table instead of the parser's garbage. (Field stays `tables` for history.) */
export interface OcrJobTable {
  /** The page(s) this correction spans (1 = single, >1 = cross-page merged). */
  pages: number[];
  /** The corrected full-page content (HTML: prose in <p>, table in <table>). */
  content: string;
}

export const ocrJobs = pgTable(
  'ocr_jobs',
  {
    id: text('id').primaryKey().notNull(),
    userId: text('user_id').notNull(),
    // The stored original file (for reopen re-render / re-OCR). set null if the file is purged.
    fileId: text('file_id').references(() => files.id, { onDelete: 'set null' }),
    title: text('title').notNull(),
    fileName: text('file_name').notNull(),
    mimeType: text('mime_type'),
    pageCount: integer('page_count').notNull().default(0),
    scanned: boolean('scanned').notNull().default(false),
    pages: jsonb('pages').$type<OcrJobPage[]>().notNull().default([]),
    /** VLM-recognized tables (injected into the doc content on 加入知识库 → for the Agent). */
    tables: jsonb('tables').$type<OcrJobTable[]>().notNull().default([]),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => ({
    userIdx: index('idx_ocr_jobs_user').on(table.userId),
  }),
);

export type OcrJob = typeof ocrJobs.$inferSelect;
