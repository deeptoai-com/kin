/**
 * Knowledge Base Server Functions
 *
 * Handles CRUD operations for knowledge bases and their documents.
 */

import { createServerFn } from '@tanstack/react-start';
import { getRequest } from '@tanstack/react-start/server';
import { z } from 'zod';
import { db } from '~/db/db-config';
import { knowledgeBases, kbDocuments, files } from '~/db/schema';
import { auth } from '~/server/auth.server';
import { eq, and, desc, sql, count } from 'drizzle-orm';

const requireUser = async () => {
  const { headers } = getRequest();
  const session = await auth.api.getSession({ headers });

  if (!session?.user) {
    throw new Error('UNAUTHORIZED');
  }

  return session.user;
};

// List all knowledge bases for current user
export const listKnowledgeBases = createServerFn({ method: 'GET' }).handler(async () => {
  const user = await requireUser();

  // Get all KBs
  const kbs = await db
    .select()
    .from(knowledgeBases)
    .where(eq(knowledgeBases.userId, user.id))
    .orderBy(desc(knowledgeBases.createdAt));

  // Get document counts for each KB
  const kbsWithCounts = await Promise.all(
    kbs.map(async (kb) => {
      const [result] = await db
        .select({ count: count() })
        .from(kbDocuments)
        .where(eq(kbDocuments.kbId, kb.id));

      return {
        ...kb,
        documentCount: result?.count || 0,
      };
    })
  );

  return kbsWithCounts;
});

// Create a new knowledge base
const createKbSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().optional(),
});

export const createKnowledgeBase = createServerFn({ method: 'POST' })
  .inputValidator((input: any) => createKbSchema.parse(input.data || input))
  .handler(async ({ data }) => {
    const user = await requireUser();

    const [kb] = await db
      .insert(knowledgeBases)
      .values({
        userId: user.id,
        name: data.name,
        description: data.description || null,
      })
      .returning();

    return {
      ...kb,
      documentCount: 0,
    };
  });

// Update knowledge base metadata
const updateKbSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(100),
  description: z.string().optional(),
});

export const updateKnowledgeBase = createServerFn({ method: 'POST' })
  .inputValidator((input: any) => updateKbSchema.parse(input.data || input))
  .handler(async ({ data }) => {
    const user = await requireUser();

    // Verify ownership
    const [existing] = await db
      .select()
      .from(knowledgeBases)
      .where(and(
        eq(knowledgeBases.id, data.id),
        eq(knowledgeBases.userId, user.id)
      ));

    if (!existing) {
      throw new Error('Knowledge base not found');
    }

    const [updated] = await db
      .update(knowledgeBases)
      .set({
        name: data.name,
        description: data.description || null,
        updatedAt: new Date(),
      })
      .where(and(eq(knowledgeBases.id, data.id), eq(knowledgeBases.userId, user.id)))
      .returning();

    return updated;
  });

// Delete knowledge base
const deleteKbSchema = z.object({
  id: z.string().uuid(),
});

export const deleteKnowledgeBase = createServerFn({ method: 'POST' })
  .inputValidator((input: any) => deleteKbSchema.parse(input.data || input))
  .handler(async ({ data }) => {
    const user = await requireUser();

    // Verify ownership
    const [existing] = await db
      .select()
      .from(knowledgeBases)
      .where(and(
        eq(knowledgeBases.id, data.id),
        eq(knowledgeBases.userId, user.id)
      ));

    if (!existing) {
      throw new Error('Knowledge base not found');
    }

    await db
      .delete(knowledgeBases)
      .where(and(eq(knowledgeBases.id, data.id), eq(knowledgeBases.userId, user.id)));

    return { success: true };
  });

// Get documents in a knowledge base
const getKbDocumentsSchema = z.object({
  kbId: z.string().uuid(),
});

export const getKbDocuments = createServerFn({ method: 'GET' })
  .inputValidator((input: any) => getKbDocumentsSchema.parse(input.data || input))
  .handler(async ({ data }) => {
    const user = await requireUser();

    // Verify ownership
    const [kb] = await db
      .select()
      .from(knowledgeBases)
      .where(and(
        eq(knowledgeBases.id, data.kbId),
        eq(knowledgeBases.userId, user.id)
      ));

    if (!kb) {
      throw new Error('Knowledge base not found');
    }

    // Get all documents in this KB
    const docs = await db
      .select({
        kbDoc: kbDocuments,
        file: files,
      })
      .from(kbDocuments)
      .innerJoin(files, eq(kbDocuments.fileId, files.id))
      .where(eq(kbDocuments.kbId, data.kbId))
      .orderBy(desc(kbDocuments.createdAt));

    return docs.map((row) => ({
      id: row.kbDoc.id,
      fileId: row.file.id,
      name: row.file.name,
      size: row.file.size,
      mimeType: row.file.mimeType,
      fileType: row.file.fileType,
      createdAt: row.kbDoc.createdAt,
    }));
  });

// Add documents to knowledge base
const addKbDocumentsSchema = z.object({
  kbId: z.string().uuid(),
  fileIds: z.array(z.string()),
});

export const addKbDocuments = createServerFn({ method: 'POST' })
  .inputValidator((input: any) => addKbDocumentsSchema.parse(input.data || input))
  .handler(async ({ data }) => {
    const user = await requireUser();

    // Verify ownership
    const [kb] = await db
      .select()
      .from(knowledgeBases)
      .where(and(
        eq(knowledgeBases.id, data.kbId),
        eq(knowledgeBases.userId, user.id)
      ));

    if (!kb) {
      throw new Error('Knowledge base not found');
    }

    // Add documents (ignore duplicates)
    const added = [];
    const errors = [];

    for (const fileId of data.fileIds) {
      try {
        // Check if file belongs to user
        const [file] = await db
          .select()
          .from(files)
          .where(and(
            eq(files.id, fileId),
            eq(files.clientId, user.id)
          ));

        if (!file) {
          errors.push({ fileId, error: 'File not found' });
          continue;
        }

        // Check if already in KB
        const [existing] = await db
          .select()
          .from(kbDocuments)
          .where(and(
            eq(kbDocuments.kbId, data.kbId),
            eq(kbDocuments.fileId, fileId)
          ));

        if (existing) {
          errors.push({ fileId, error: 'Already in knowledge base' });
          continue;
        }

        // Add to KB
        const [kbDoc] = await db
          .insert(kbDocuments)
          .values({
            kbId: data.kbId,
            fileId,
          })
          .returning();

        added.push(kbDoc);
      } catch (error) {
        errors.push({
          fileId,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }

    return {
      added: added.length,
      errors: errors.length > 0 ? errors : undefined,
    };
  });

// Remove document from knowledge base
const removeKbDocumentSchema = z.object({
  kbId: z.string().uuid(),
  documentId: z.string().uuid(),
});

export const removeKbDocument = createServerFn({ method: 'POST' })
  .inputValidator((input: any) => removeKbDocumentSchema.parse(input.data || input))
  .handler(async ({ data }) => {
    const user = await requireUser();

    // Verify KB ownership
    const [kb] = await db
      .select()
      .from(knowledgeBases)
      .where(and(
        eq(knowledgeBases.id, data.kbId),
        eq(knowledgeBases.userId, user.id)
      ));

    if (!kb) {
      throw new Error('Knowledge base not found');
    }

    // Remove document
    await db
      .delete(kbDocuments)
      .where(and(
        eq(kbDocuments.id, data.documentId),
        eq(kbDocuments.kbId, data.kbId)
      ));

    return { success: true };
  });
