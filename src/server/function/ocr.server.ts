/**
 * OCR converter history (OCR module O2 #2) — server functions over `ocr_jobs`.
 *
 * The converter auto-saves each conversion (file already uploaded via initDocumentUpload's
 * file-only path, then saveOcrJob records the per-page text). History is per-user, separate
 * from the KB document library. "加入知识库" (addOcrJobToKb) creates a `documents` row from a
 * job — reusing its already-stored file — and schedules RAG ingest.
 */
import { createServerFn } from '@tanstack/react-start';
import { getRequest } from '@tanstack/react-start/server';
import { z } from 'zod';
import { and, desc, eq } from 'drizzle-orm';
import { db } from '~/db/db-config';
import { ocrJobs, type OcrJobPage, type OcrJobTable } from '~/db/schema/ocr-job.schema';
import { documents } from '~/db/schema/document.schema';
import { files } from '~/db/schema/file.schema';
import { auth } from '~/server/auth.server';
import { generateId } from '~/utils/id-generator';
import { scheduleRagIngest } from '~/server/rag/queue';
import { isRagEnabled } from '~/server/rag/flag';

const requireUser = async () => {
  const { headers } = getRequest();
  const session = await auth.api.getSession({ headers });
  if (!session?.user) throw new Error('UNAUTHORIZED');
  return session.user;
};

const normalize = <T>(input: unknown, schema: z.ZodType<T>): T => {
  const data = input && typeof input === 'object' && 'data' in (input as object) ? (input as { data: unknown }).data : input;
  return schema.parse(data);
};

const pageSchema = z.object({
  page: z.number().int(),
  text: z.string(),
  source: z.enum(['parse', 'ocr']),
});

const saveSchema = z.object({
  /** Existing job id → update (e.g. after per-page re-OCR); absent → insert new. */
  id: z.string().min(1).optional(),
  fileId: z.string().min(1).optional(),
  title: z.string().min(1),
  fileName: z.string().min(1),
  mimeType: z.string().optional(),
  scanned: z.boolean().optional(),
  pages: z.array(pageSchema),
});

/** Upsert a conversion in history. Returns the job id (converter holds it for 加入知识库). */
export const saveOcrJob = createServerFn({ method: 'POST' })
  .inputValidator((input) => normalize(input, saveSchema))
  .handler(async ({ data }) => {
    const user = await requireUser();
    if (data.id) {
      const res = await db
        .update(ocrJobs)
        .set({ pages: data.pages as OcrJobPage[], pageCount: data.pages.length, scanned: data.scanned ?? false })
        .where(and(eq(ocrJobs.id, data.id), eq(ocrJobs.userId, user.id)))
        .returning({ id: ocrJobs.id });
      if (res[0]) return { id: res[0].id };
      // fell through (not found/owned) → insert fresh below
    }
    const id = generateId('ocrjob');
    await db.insert(ocrJobs).values({
      id,
      userId: user.id,
      fileId: data.fileId ?? null,
      title: data.title,
      fileName: data.fileName,
      mimeType: data.mimeType ?? null,
      pageCount: data.pages.length,
      scanned: data.scanned ?? false,
      pages: data.pages as OcrJobPage[],
    });
    return { id };
  });

/** Recent conversions (metadata only — page text omitted to keep the list light). */
export const listOcrJobs = createServerFn({ method: 'GET' }).handler(async () => {
  const user = await requireUser();
  const rows = await db
    .select({
      id: ocrJobs.id,
      title: ocrJobs.title,
      fileName: ocrJobs.fileName,
      mimeType: ocrJobs.mimeType,
      pageCount: ocrJobs.pageCount,
      scanned: ocrJobs.scanned,
      createdAt: ocrJobs.createdAt,
    })
    .from(ocrJobs)
    .where(eq(ocrJobs.userId, user.id))
    .orderBy(desc(ocrJobs.createdAt))
    .limit(50);
  return rows;
});

/** Full job (per-page text + fileId) for reopening. */
export const getOcrJob = createServerFn({ method: 'GET' })
  .inputValidator((input) => normalize(input, z.object({ id: z.string().min(1) })))
  .handler(async ({ data }) => {
    const user = await requireUser();
    const [job] = await db
      .select()
      .from(ocrJobs)
      .where(and(eq(ocrJobs.id, data.id), eq(ocrJobs.userId, user.id)))
      .limit(1);
    if (!job) throw new Error('OCR job not found');
    let fileUrl: string | null = null;
    if (job.fileId) {
      const [file] = await db.select({ url: files.url }).from(files).where(eq(files.id, job.fileId)).limit(1);
      fileUrl = file?.url ?? null;
    }
    return { ...job, fileUrl };
  });

/** Persist a VLM-recognized table (single page or cross-page). Upsert by page-set so re-reading
 *  a table replaces it. These get injected into the doc content on 加入知识库 — for the Agent. */
export const saveOcrTableResult = createServerFn({ method: 'POST' })
  .inputValidator((input) => normalize(input, z.object({
    id: z.string().min(1),
    pages: z.array(z.number().int()).min(1),
    content: z.string().min(1),
  })))
  .handler(async ({ data }) => {
    const user = await requireUser();
    const [job] = await db
      .select({ tables: ocrJobs.tables })
      .from(ocrJobs)
      .where(and(eq(ocrJobs.id, data.id), eq(ocrJobs.userId, user.id)))
      .limit(1);
    if (!job) throw new Error('OCR job not found');
    const key = (ps: number[]) => [...ps].sort((a, b) => a - b).join(',');
    const next = (job.tables as OcrJobTable[]).filter((t) => key(t.pages) !== key(data.pages));
    next.push({ pages: [...data.pages].sort((a, b) => a - b), content: data.content });
    await db.update(ocrJobs).set({ tables: next }).where(and(eq(ocrJobs.id, data.id), eq(ocrJobs.userId, user.id)));
    return { ok: true as const, count: next.length };
  });

export const deleteOcrJob = createServerFn({ method: 'POST' })
  .inputValidator((input) => normalize(input, z.object({ id: z.string().min(1) })))
  .handler(async ({ data }) => {
    const user = await requireUser();
    await db.delete(ocrJobs).where(and(eq(ocrJobs.id, data.id), eq(ocrJobs.userId, user.id)));
    return { ok: true as const };
  });

/** 加入知识库: create a documents row from the job (reusing its stored file) + schedule ingest. */
export const addOcrJobToKb = createServerFn({ method: 'POST' })
  .inputValidator((input) => normalize(input, z.object({ id: z.string().min(1) })))
  .handler(async ({ data }) => {
    const user = await requireUser();
    if (!isRagEnabled()) throw new Error('RAG 未启用（RAG_ENABLED）');
    const [job] = await db
      .select()
      .from(ocrJobs)
      .where(and(eq(ocrJobs.id, data.id), eq(ocrJobs.userId, user.id)))
      .limit(1);
    if (!job) throw new Error('OCR job not found');
    if (!job.fileId) throw new Error('该转换记录没有可用的原始文件');

    // Document content, page by page, with corrected pages REPLACING the parser's flattened text.
    // A VLM correction holds the whole page (prose + the table fixed to HTML); on a corrected page
    // we use the AI version INSTEAD of the parser text — so kb_search reads the accurate table, not
    // the garbage. Cross-page tables (>1 page) are emitted once at their first page.
    const corrections = job.tables as OcrJobTable[];
    const anchorContent = new Map<number, string>(); // first page of a corrected set -> AI content
    const covered = new Set<number>(); // every page a correction spans
    for (const t of corrections) {
      const sorted = [...t.pages].sort((a, b) => a - b);
      anchorContent.set(sorted[0], t.content);
      for (const p of sorted) covered.add(p);
    }
    const byPage = [...(job.pages as OcrJobPage[])].sort((a, b) => a.page - b.page);
    const parts: string[] = [];
    for (const p of byPage) {
      if (anchorContent.has(p.page)) parts.push(anchorContent.get(p.page)!); // corrected → replaces parser
      else if (covered.has(p.page)) continue; // non-anchor page of a cross-page table (already emitted)
      else if (p.text) parts.push(p.text); // uncorrected parser page
    }
    const content = parts.join('\n\n');
    const [file] = await db.select().from(files).where(eq(files.id, job.fileId)).limit(1);
    const [doc] = await db
      .insert(documents)
      .values({
        title: job.title,
        content,
        fileType: job.mimeType ?? 'application/octet-stream',
        filename: job.fileName,
        totalCharCount: content.length,
        totalLineCount: content.split(/\r?\n/).length,
        sourceType: 'knowledge-base',
        source: file?.key ?? job.fileName,
        fileId: job.fileId,
        userId: user.id,
        parseStatus: 'ready',
        ingestStatus: 'pending',
      })
      .returning({ id: documents.id });
    const mode = await scheduleRagIngest(doc.id);
    return { documentId: doc.id, mode };
  });
