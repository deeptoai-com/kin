import { createServerFn } from '@tanstack/react-start';
import { getRequest } from '@tanstack/react-start/server';
import { randomUUID } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { z } from 'zod';

import { fileEnv } from '~/conf/file';
import { db } from '~/db/db-config';
import { files } from '~/db/schema/file.schema';
import { documents } from '~/db/schema/document.schema';
import { kbDocuments } from '~/db/schema/kb-document.schema';
import { auth } from '~/server/auth.server';
import { S3StaticFileImpl } from '~/server/s3/s3';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { estimateTokens } from '~/server/rag/tier';
import { scheduleRagIngest } from '~/server/rag/queue';
import { isRagEnabled } from '~/server/rag/flag';
import { canAccessDocument } from '~/server/projects/access';

const fileService = new S3StaticFileImpl();

const requireUser = async () => {
  const { headers } = getRequest();
  const session = await auth.api.getSession({ headers });

  if (!session?.user) {
    throw new Error('UNAUTHORIZED');
  }

  return session.user;
};

const sanitizeFileName = (name?: string | null) => {
  const fallback = `file-${Date.now()}`;
  const safeInput = name && name.length > 0 ? name : fallback;

  return safeInput
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]/g, '_');
};

const buildObjectKey = (userId: string, originalName: string) => {
  const prefix = fileEnv.S3_PREFIX ? fileEnv.S3_PREFIX.replace(/\/*$/, '') + '/' : '';
  const safeName = sanitizeFileName(originalName);
  return `${prefix}${userId}/${Date.now()}-${randomUUID()}-${safeName}`;
};

const initUploadSchema = z.object({
  originalName: z.string().min(1),
  mimeType: z.string().optional(),
  size: z.number().int().nonnegative().optional(),
  title: z.string().optional(),
  content: z.string().optional(),
  addToKnowledgeBase: z.boolean().optional(),
  // KB redesign (prd §4.2): the knowledge bases this upload joins (multi-select). Writing
  // kb_documents here is what makes "勾了知识库" actually land the file in those KBs.
  knowledgeBaseIds: z.array(z.string()).optional(),
});

const completeUploadSchema = z
  .object({
    id: z.string().min(1).optional(),
    key: z.string().min(1).optional(),
  })
  .refine((v) => Boolean(v.id) || Boolean(v.key), 'Either id or key is required');

const directUploadSchema = z.object({
  id: z.string().min(1).optional(),
  key: z.string().min(1).optional(),
  originalName: z.string().optional(),
  size: z.number().int().nonnegative().optional(),
  content: z.string().min(1),
  mimeType: z.string().optional(),
});

const deleteDocumentsSchema = z
  .object({
    ids: z.array(z.string().min(1)).optional(),
    items: z
      .array(
        z
          .object({
            id: z.string().min(1).optional(),
            key: z.string().min(1).optional(),
          })
          .refine((value) => Boolean(value.id) || Boolean(value.key), 'id or key is required'),
      )
      .optional(),
  })
  .refine(
    (value) => (value.ids && value.ids.length > 0) || (value.items && value.items.length > 0),
    'ids or items are required',
  );

const coerceStringArray = (input: unknown) => {
  if (Array.isArray(input)) {
    return input
      .map((value) => (typeof value === 'string' ? value : String(value ?? '')).trim())
      .filter((value) => value.length > 0);
  }

  if (input && typeof input === 'object' && '$values' in (input as Record<string, unknown>)) {
    const values = (input as { $values?: unknown }).$values;
    if (Array.isArray(values)) {
      return coerceStringArray(values);
    }
  }

  if (input && typeof input === 'object') {
    const values = Object.values(input as Record<string, unknown>);
    if (values.length > 0) {
      return coerceStringArray(values);
    }
  }

  if (typeof input === 'string') {
    try {
      const parsed = JSON.parse(input);
      return coerceStringArray(parsed);
    } catch (error) {
      console.warn('[deleteDocuments] failed to parse stringified ids payload', error);
    }
  }

  return [] as string[];
};

const coerceItemArray = (input: unknown): { id?: string; key?: string }[] => {
  if (Array.isArray(input)) {
    return input
      .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
      .map((item) => {
        const id = typeof item.id === 'string' ? item.id.trim() : undefined;
        const key = typeof item.key === 'string' ? item.key.trim() : undefined;

        return {
          ...(id ? { id } : {}),
          ...(key ? { key } : {}),
        };
      })
      .filter((item) => item.id || item.key);
  }

  if (input && typeof input === 'object' && '$values' in (input as Record<string, unknown>)) {
    const values = (input as { $values?: unknown }).$values;
    if (Array.isArray(values)) {
      return coerceItemArray(values);
    }
  }

  if (input && typeof input === 'object') {
    const values = Object.values(input as Record<string, unknown>);
    if (values.length > 0) {
      return coerceItemArray(values);
    }
  }

  if (typeof input === 'string') {
    try {
      const parsed = JSON.parse(input);
      return coerceItemArray(parsed);
    } catch (error) {
      console.warn('[deleteDocuments] failed to parse stringified items payload', error);
    }
  }

  return [];
};

export type InitDocumentUploadInput = z.infer<typeof initUploadSchema>;
export type CompleteDocumentUploadInput = z.infer<typeof completeUploadSchema>;
export type DirectDocumentUploadInput = z.infer<typeof directUploadSchema>;
export type DeleteDocumentsInput = z.infer<typeof deleteDocumentsSchema>;

const normalizeInput = <TSchema extends z.ZodTypeAny>(
  input: unknown,
  schema: TSchema,
  preprocess?: (payload: unknown) => unknown,
): z.infer<TSchema> => {
  console.log('[normalizeInput] raw input', input);
  const rawCandidate =
    input instanceof FormData
      ? Object.fromEntries(input.entries())
      : typeof input === 'string'
        ? JSON.parse(input)
        : input ?? {};
  const candidate = Array.isArray(rawCandidate)
    ? rawCandidate[0] ?? {}
    : rawCandidate;

  let payload =
    candidate && typeof candidate === 'object'
      ? { ...(candidate as Record<string, unknown>) }
      : candidate;

  if (payload && typeof payload === 'object' && 'data' in (payload as Record<string, unknown>)) {
    payload = (payload as Record<string, unknown>).data ?? {};
  }

  if (payload && typeof payload === 'object') {
    const record = payload as Record<string, unknown>;
    if ('size' in record) {
      const sizeValue = record.size;
      record.size = typeof sizeValue === 'string' ? Number(sizeValue) : sizeValue;
    }
    if ('addToKnowledgeBase' in record) {
      const kbValue = record.addToKnowledgeBase;
      record.addToKnowledgeBase = kbValue === 'true' || kbValue === true;
    }
  }

  const processed = preprocess ? preprocess(payload) : payload;

  console.log('[normalizeInput] processed payload', processed);

  return schema.parse(processed);
};

export const listDocuments = createServerFn({ method: 'GET' }).handler(async () => {
  const user = await requireUser();

  const fileRows = await db
    .select({
      file: files,
      sourceType: documents.sourceType,
      // U2: parse/embed state for the documents UI (status chips, engine re-pick, progress)
      documentId: documents.id,
      parseMethod: documents.parseMethod,
      parseStatus: documents.parseStatus,
      ingestStatus: documents.ingestStatus,
      ingestProgress: documents.ingestProgress,
    })
    .from(files)
    .leftJoin(documents, eq(files.id, documents.fileId))
    .where(eq(files.clientId, user.id))
    .orderBy(desc(files.createdAt));

  return Promise.all(
    fileRows.map(async (row) => ({
      ...row.file,
      sourceType: row.sourceType,
      documentId: row.documentId,
      parseMethod: row.parseMethod,
      parseStatus: row.parseStatus,
      ingestStatus: row.ingestStatus,
      ingestProgress: row.ingestProgress,
      downloadUrl: await fileService.getFullFileUrl(row.file.key),
    })),
  );
});

/**
 * U2 (ingest-UX spec §3): probe an uploaded PDF's text layer via the parser sidecar and
 * return the recommended engine ("系统推荐+可改") — { method: simple|structured|ocr, reason }.
 */
export const probeDocumentFile = createServerFn({ method: 'POST' })
  .inputValidator((input: unknown) => {
    const data = (input && typeof input === 'object' && 'data' in (input as Record<string, unknown>))
      ? (input as { data: unknown }).data
      : input;
    return z.object({ fileId: z.string().min(1) }).parse(data);
  })
  .handler(async ({ data }) => {
    const user = await requireUser();
    if (!isRagEnabled()) return { ok: false as const, error: 'RAG 未启用（RAG_ENABLED）' };
    const [file] = await db
      .select()
      .from(files)
      .where(and(eq(files.id, data.fileId), eq(files.clientId, user.id)))
      .limit(1);
    if (!file) throw new Error('File not found');
    if (!file.name.toLowerCase().endsWith('.pdf')) {
      return { ok: true as const, recommend: { method: 'simple' as const, reason: '非 PDF 文档走既有解析链' } };
    }
    const { probePdfViaSidecar } = await import('~/server/rag/parser-client');
    const url = await fileService.getFullFileUrl(file.key);
    const blob = await fetch(url);
    if (!blob.ok) throw new Error(`file fetch HTTP ${blob.status}`);
    const probe = await probePdfViaSidecar(Buffer.from(await blob.arrayBuffer()));
    if (!probe.ok || !probe.recommend) {
      return { ok: false as const, error: probe.error ?? 'probe failed' };
    }
    return { ok: true as const, pages: probe.pages, chars: probe.chars, recommend: probe.recommend };
  });

/**
 * U2: (re)parse a document with a user-chosen engine, then re-embed. Parse and embed are
 * separate state machines — this resets both and reruns the pipeline (parse pre-stage
 * honors parse_method; spec DR-2/DR-7).
 */
export const requestDocumentParse = createServerFn({ method: 'POST' })
  .inputValidator((input: unknown) => {
    const data = (input && typeof input === 'object' && 'data' in (input as Record<string, unknown>))
      ? (input as { data: unknown }).data
      : input;
    return z.object({
      documentId: z.string().min(1),
      method: z.enum(['simple', 'structured', 'ocr']),
    }).parse(data);
  })
  .handler(async ({ data }) => {
    const user = await requireUser();
    if (!isRagEnabled()) throw new Error('RAG 未启用（RAG_ENABLED）');
    const [doc] = await db
      .select({ id: documents.id, userId: documents.userId, projectId: documents.projectId })
      .from(documents)
      .where(eq(documents.id, data.documentId))
      .limit(1);
    if (!doc) throw new Error('Document not found');
    if (!(await canAccessDocument(user.id, doc))) throw new Error('FORBIDDEN');
    // OCR wired (O1-c): parseMethod='ocr' → ingest parse stage renders pages + runs the VLM
    // OCR provider (src/server/ocr/provider) instead of the text-layer parser.
    await db
      .update(documents)
      .set({
        parseMethod: data.method,
        parseStatus: 'pending',
        content: '', // force the parse pre-stage to run with the new engine
        ingestStatus: 'pending',
        ingestProgress: 0,
        updatedAt: new Date(),
      })
      .where(eq(documents.id, doc.id));
    const mode = await scheduleRagIngest(doc.id);
    return { scheduled: true as const, mode };
  });

export const initDocumentUpload = createServerFn({ method: 'POST' })
  .inputValidator((input) => normalizeInput(input, initUploadSchema))
  .handler(async ({ data: input }) => {
    const user = await requireUser();

    const originalName = input.originalName?.trim() || `file-${Date.now()}`;
    const key = buildObjectKey(user.id, originalName);
    const mimeType = input.mimeType ?? 'application/octet-stream';
    const size = input.size ?? 0;

    const kbIds = input.knowledgeBaseIds ?? [];
    const addToKb = kbIds.length > 0 || !!input.addToKnowledgeBase;
    const shouldCreateDocument = addToKb || Boolean(input.content?.trim().length);

    // RAG ingest-UX spec (D5/D6): a KB/document-library document goes FULLY into the
    // vector store — size never decides whether to embed (only how to chunk, decided
    // later in ingest). Parse vs embed are two state machines: content present now →
    // parse_status 'ready' + embed scheduled; content absent (large PDF awaiting the
    // U1 parse sidecar) → parse_status 'pending', embed deferred until parse fills content.
    const content = input.content ?? '';
    const hasContent = Boolean(content.trim().length);
    const tokenEstimate = content ? estimateTokens(content) : 0;
    // RAG flag off → the documents row is still created (the knowledge base predates
    // RAG), but nothing is embedded: ingest_status stays 'none', no ingest scheduled.
    const ragEnabled = isRagEnabled();

    const { fileRecord, ragDocumentId } = await db.transaction(async (tx) => {
      const [createdFile] = await tx
        .insert(files)
        .values({
          key,
          clientId: user.id,
          fileType: mimeType,
          name: originalName,
          size,
          url: '',
          mimeType: input.mimeType ?? null,
        })
        .returning();

      if (!createdFile) {
        throw new Error('Failed to create file record');
      }

      // Link the new file into the chosen knowledge bases (multi-membership; prd §4.2).
      if (kbIds.length > 0) {
        await tx
          .insert(kbDocuments)
          .values(kbIds.map((kbId) => ({ kbId, fileId: createdFile.id })))
          .onConflictDoNothing();
      }

      let createdRagDocId: string | null = null;
      if (shouldCreateDocument) {
        const [createdDoc] = await tx
          .insert(documents)
          .values({
            title: input.title?.trim() || originalName,
            content,
            fileType: mimeType,
            filename: originalName,
            totalCharCount: input.content?.length ?? null,
            totalLineCount: input.content ? input.content.split(/\r?\n/).length : null,
            sourceType: addToKb ? 'knowledge-base' : 'upload',
            source: key,
            fileId: createdFile.id,
            userId: user.id,
            clientId: user.id,
            tokenEstimate: tokenEstimate || null,
            // parse_status: text already present → 'ready'; else awaits the parse stage (U1)
            parseStatus: hasContent ? 'ready' : 'pending',
            // embed every document with text (full-coverage); ragTier (single|structured)
            // is recorded by the ingest pipeline once it chunks.
            ingestStatus: ragEnabled && hasContent ? 'pending' : 'none',
          })
          .returning({ id: documents.id });
        if (ragEnabled && hasContent) createdRagDocId = createdDoc?.id ?? null;
      }

      return { fileRecord: createdFile, ragDocumentId: createdRagDocId };
    });

    // After the tx so a queue/inline failure can never roll back the upload itself.
    if (ragDocumentId) {
      await scheduleRagIngest(ragDocumentId);
    }

    const uploadUrl = fileService.isPresignedEnabled()
      ? await fileService.createUploadPreSignedUrl(key)
      : null;

    return { id: fileRecord.id, key, uploadUrl };
  });

/**
 * Manually (re)ingest a document into the RAG pipeline — used by the documents UI and
 * for backfilling docs created before this shipped. Full-coverage (spec D5): any document
 * with text is embedded; the ingest pipeline picks single vs structured chunking by size.
 * No content (large PDF awaiting parse) → nothing to embed yet.
 */
export const reingestDocument = createServerFn({ method: 'POST' })
  .inputValidator((input: unknown) => {
    const data = (input && typeof input === 'object' && 'data' in (input as Record<string, unknown>))
      ? (input as { data: unknown }).data
      : input;
    return z.object({ documentId: z.string().min(1) }).parse(data);
  })
  .handler(async ({ data }) => {
    const user = await requireUser();
    if (!isRagEnabled()) throw new Error('RAG 未启用（RAG_ENABLED）');
    const [doc] = await db
      .select({ id: documents.id, userId: documents.userId, projectId: documents.projectId, content: documents.content })
      .from(documents)
      .where(eq(documents.id, data.documentId))
      .limit(1);
    if (!doc) throw new Error('Document not found');
    if (!(await canAccessDocument(user.id, doc))) throw new Error('FORBIDDEN');

    const tokenEstimate = estimateTokens(doc.content ?? '');
    const hasContent = Boolean(doc.content?.trim().length);
    await db
      .update(documents)
      .set({ tokenEstimate, ingestStatus: hasContent ? 'pending' : 'none' })
      .where(eq(documents.id, doc.id));

    if (!hasContent) {
      return { scheduled: false as const, reason: 'no-content', tokenEstimate };
    }
    const mode = await scheduleRagIngest(doc.id);
    return { scheduled: true as const, tokenEstimate, mode };
  });

export const completeDocumentUpload = createServerFn({ method: 'POST' })
  .inputValidator((input) => normalizeInput(input, completeUploadSchema))
  .handler(async ({ data: payload }) => {
    const data = (payload && typeof payload === 'object' && 'data' in (payload as Record<string, unknown>))
      ? ((payload as Record<string, unknown>).data as CompleteDocumentUploadInput)
      : (payload as CompleteDocumentUploadInput);

    const { id, key } = data;

    const user = await requireUser();

    let file = null;

    if (key) {
      const byKey = await db
        .select()
        .from(files)
        .where(and(eq(files.key, key), eq(files.clientId, user.id)))
        .limit(1);
      file = byKey[0] ?? null;
    }

    if (!file && id) {
      const byId = await db
        .select()
        .from(files)
        .where(eq(files.id, id))
        .limit(1);
      const candidate = byId[0];
      if (candidate && candidate.clientId === user.id) {
        file = candidate;
      }
    }

    if (!file || (file.clientId && file.clientId !== user.id)) {
      throw new Error('File not found');
    }

    const url = await fileService.getFullFileUrl(file.key);
    const now = new Date();

    await db
      .update(files)
      .set({
        url,
        updatedAt: now,
        accessedAt: now,
      })
      .where(eq(files.key, file.key));

    return { id: file.id, url };
  });

export const directDocumentUpload = createServerFn({ method: 'POST' })
  .inputValidator((input) => normalizeInput(input, directUploadSchema))
  .handler(async ({ data: payload }) => {
    const data = (payload && typeof payload === 'object' && 'data' in (payload as Record<string, unknown>))
      ? ((payload as Record<string, unknown>).data as DirectDocumentUploadInput)
      : (payload as DirectDocumentUploadInput);

    const { id, key: inputKey, originalName, size, content, mimeType } = data;

    const user = await requireUser();
    const inferredName = originalName?.trim() || `file-${Date.now()}`;
    const inferredMime = mimeType ?? 'application/octet-stream';
    const inferredSize = size ?? 0;

    if (!content) {
      throw new Error('Missing upload content');
    }

    const byId = id
      ? await db
          .select()
          .from(files)
          .where(and(eq(files.id, id), eq(files.clientId, user.id)))
          .limit(1)
      : [];

    let fileRecord = byId[0] ?? null;

    if (!fileRecord && inputKey) {
      const byKey = await db
        .select()
        .from(files)
        .where(and(eq(files.key, inputKey), eq(files.clientId, user.id)))
        .limit(1);
      fileRecord = byKey[0] ?? null;
    }

    let resolvedKey = fileRecord?.key ?? inputKey ?? buildObjectKey(user.id, inferredName);

    if (!fileRecord) {
      const [created] = await db
        .insert(files)
        .values({
          ...(id ? { id } : {}),
          key: resolvedKey,
          clientId: user.id,
          fileType: inferredMime,
          name: inferredName,
          size: inferredSize,
          url: '',
          mimeType: mimeType ?? null,
        })
        .returning();

      if (!created) {
        throw new Error('Failed to create file record for upload');
      }

      fileRecord = created;
      resolvedKey = created.key;
    }

    if (fileRecord.clientId && fileRecord.clientId !== user.id) {
      throw new Error('File not found');
    }

    const buffer = Buffer.from(content, 'base64');
    await fileService.uploadContent(resolvedKey, buffer);

    const url = await fileService.getFullFileUrl(resolvedKey);
    const now = new Date();

    await db
      .update(files)
      .set({
        url,
        fileType: mimeType ?? fileRecord.fileType,
        mimeType: mimeType ?? fileRecord.mimeType,
        name: inferredName,
        size: inferredSize,
        updatedAt: now,
        accessedAt: now,
      })
      .where(eq(files.id, fileRecord.id));

    return { id: fileRecord.id, url };
  });

const preprocessDeletePayload = (payload: unknown) => {
  if (!payload || typeof payload !== 'object') return payload;

  const record = { ...(payload as Record<string, unknown>) };

  if ('items' in record) {
    const coercedItems = coerceItemArray(record.items);
    console.log('[preprocessDeletePayload] coerced items len', coercedItems.length);
    if (coercedItems.length > 0) {
      record.items = coercedItems;
    } else {
      delete record.items;
    }
  }

  if ('ids' in record) {
    const coercedIds = coerceStringArray(record.ids);
    console.log('[preprocessDeletePayload] coerced ids len', coercedIds.length);
    if (coercedIds.length > 0) {
      record.ids = coercedIds;
    } else {
      delete record.ids;
    }
  }

  return record;
};

export const deleteDocuments = createServerFn({ method: 'POST' })
  .handler(async ({ data: payload }) => {
    const user = await requireUser();

    const { ids, items } = normalizeInput(payload, deleteDocumentsSchema, preprocessDeletePayload);

    console.log('[deleteDocuments] parsed ids', ids, 'parsed items length', items?.length);

    const normalizedItems = coerceItemArray(items);
    const normalizedIds = coerceStringArray(ids);

    console.log('[deleteDocuments] normalized items len', normalizedItems.length, 'normalized ids len', normalizedIds.length);

    const idSet = new Set(
      normalizedItems
        .map((item) => item.id?.trim())
        .filter((value): value is string => Boolean(value)),
    );
    const keySet = new Set(
      normalizedItems
        .map((item) => item.key?.trim())
        .filter((value): value is string => Boolean(value)),
    );

    normalizedIds.forEach((id) => {
      if (id) {
        idSet.add(id);
      }
    });

    if (idSet.size === 0 && keySet.size === 0) {
      return { deleted: 0 };
    }

    const conditions: Array<ReturnType<typeof inArray> | ReturnType<typeof eq>> = [
      eq(files.clientId, user.id),
    ];
    if (idSet.size > 0) {
      conditions.push(inArray(files.id, Array.from(idSet)));
    }
    if (keySet.size > 0) {
      conditions.push(inArray(files.key, Array.from(keySet)));
    }

    const existing = await db
      .select({ id: files.id, key: files.key })
      .from(files)
      .where(conditions.length === 1 ? conditions[0] : and(...conditions));

    if (existing.length === 0) {
      return { deleted: 0 };
    }

    await db.delete(files).where(inArray(files.id, existing.map((file) => file.id)));

    const keys = Array.from(
      new Set(existing.map((file) => file.key).filter((key): key is string => Boolean(key))),
    );

    if (keys.length > 0) {
      await Promise.allSettled(keys.map((key) => fileService.deleteFile(key)));
    }

    return { deleted: existing.length };
  });
