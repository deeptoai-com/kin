/**
 * Message Attachment Server Functions
 *
 * Handles persistence of user-uploaded attachments per message.
 * Part of P13: Attachment Persistence Pipeline
 */

import { createServerFn } from '@tanstack/react-start';
import { getRequest } from '@tanstack/react-start/server';
import { z } from 'zod';
import { eq, and } from 'drizzle-orm';
import { db } from '~/db/db-config';
import { messageAttachment } from '~/db/schema/message-attachment.schema';
import { auth } from '~/server/auth.server';

/**
 * Require authenticated user
 */
const requireUser = async () => {
  const { headers } = getRequest();
  const session = await auth.api.getSession({ headers });

  if (!session?.user) {
    throw new Error('UNAUTHORIZED');
  }

  return session.user;
};

// Input validation schemas
const createAttachmentSchema = z.object({
  sessionId: z.string().uuid(),
  messageId: z.string(),
  originalName: z.string(),
  filePath: z.string(),
  mimeType: z.string().optional(),
  fileSize: z.number().optional(),
  uploaded: z.boolean().default(false),
});

const markUploadedSchema = z.object({
  attachmentId: z.string().uuid(),
  fileSize: z.number().optional(),
});

const markReferencedSchema = z.object({
  sessionId: z.string().uuid(),
  filePath: z.string(),
});

const sessionIdSchema = z.object({
  sessionId: z.string().uuid(),
});

const messageAttachmentSchema = z.object({
  sessionId: z.string().uuid(),
  messageId: z.string(),
});

const deleteAttachmentSchema = z.object({
  attachmentId: z.string().uuid(),
});

/**
 * Create an attachment record for a message
 */
export const createMessageAttachment = createServerFn({ method: 'POST' })
  .inputValidator((input) => {
    const payload = typeof input === 'string' ? JSON.parse(input) : input;
    const data =
      payload && typeof payload === 'object' && 'data' in payload
        ? (payload as { data?: unknown }).data
        : payload;
    return createAttachmentSchema.parse(data);
  })
  .handler(async ({ data }) => {
    await requireUser();

    const [attachment] = await db
      .insert(messageAttachment)
      .values({
        sessionId: data.sessionId,
        messageId: data.messageId,
        originalName: data.originalName,
        filePath: data.filePath,
        mimeType: data.mimeType,
        fileSize: data.fileSize,
        uploaded: data.uploaded,
        uploadedAt: data.uploaded ? new Date() : null,
      })
      .returning();

    return attachment;
  });

/**
 * Mark an attachment as uploaded
 */
export const markAttachmentUploaded = createServerFn({ method: 'POST' })
  .inputValidator((input) => {
    const payload = typeof input === 'string' ? JSON.parse(input) : input;
    const data =
      payload && typeof payload === 'object' && 'data' in payload
        ? (payload as { data?: unknown }).data
        : payload;
    return markUploadedSchema.parse(data);
  })
  .handler(async ({ data }) => {
    await requireUser();

    const [updated] = await db
      .update(messageAttachment)
      .set({
        uploaded: true,
        uploadedAt: new Date(),
        fileSize: data.fileSize,
      })
      .where(eq(messageAttachment.id, data.attachmentId))
      .returning();

    return updated;
  });

/**
 * Mark an attachment as referenced by the agent
 */
export const markAttachmentReferenced = createServerFn({ method: 'POST' })
  .inputValidator((input) => {
    const payload = typeof input === 'string' ? JSON.parse(input) : input;
    const data =
      payload && typeof payload === 'object' && 'data' in payload
        ? (payload as { data?: unknown }).data
        : payload;
    return markReferencedSchema.parse(data);
  })
  .handler(async ({ data }) => {
    await requireUser();

    const [updated] = await db
      .update(messageAttachment)
      .set({ referenced: true })
      .where(
        and(
          eq(messageAttachment.sessionId, data.sessionId),
          eq(messageAttachment.filePath, data.filePath)
        )
      )
      .returning();

    return updated;
  });

/**
 * Get all attachments for a session
 */
export const getSessionAttachments = createServerFn({ method: 'GET' })
  .inputValidator((input) => {
    const searchParams =
      typeof input === 'string' ? new URLSearchParams(input) : null;
    const sessionId =
      searchParams?.get('sessionId') ||
      (typeof input === 'object' && input && 'sessionId' in input
        ? (input as { sessionId?: string }).sessionId
        : null);
    return sessionIdSchema.parse({ sessionId });
  })
  .handler(async ({ data }) => {
    await requireUser();

    try {
      const attachments = await db
        .select()
        .from(messageAttachment)
        .where(eq(messageAttachment.sessionId, data.sessionId))
        .orderBy(messageAttachment.createdAt);

      return attachments;
    } catch (error) {
      console.warn('[MessageAttachment] Failed to load session attachments', error);
      return [];
    }
  });

/**
 * Get attachments for a specific message
 */
export const getMessageAttachments = createServerFn({ method: 'GET' })
  .inputValidator((input) => {
    const searchParams =
      typeof input === 'string' ? new URLSearchParams(input) : null;
    const sessionId =
      searchParams?.get('sessionId') ||
      (typeof input === 'object' && input && 'sessionId' in input
        ? (input as { sessionId?: string }).sessionId
        : null);
    const messageId =
      searchParams?.get('messageId') ||
      (typeof input === 'object' && input && 'messageId' in input
        ? (input as { messageId?: string }).messageId
        : null);
    return messageAttachmentSchema.parse({ sessionId, messageId });
  })
  .handler(async ({ data }) => {
    await requireUser();

    try {
      const attachments = await db
        .select()
        .from(messageAttachment)
        .where(
          and(
            eq(messageAttachment.sessionId, data.sessionId),
            eq(messageAttachment.messageId, data.messageId)
          )
        );

      return attachments;
    } catch (error) {
      console.warn('[MessageAttachment] Failed to load message attachments', error);
      return [];
    }
  });

/**
 * Delete an attachment record
 */
export const deleteMessageAttachment = createServerFn({ method: 'POST' })
  .inputValidator((input) => {
    const payload = typeof input === 'string' ? JSON.parse(input) : input;
    const data =
      payload && typeof payload === 'object' && 'data' in payload
        ? (payload as { data?: unknown }).data
        : payload;
    return deleteAttachmentSchema.parse(data);
  })
  .handler(async ({ data }) => {
    await requireUser();

    await db
      .delete(messageAttachment)
      .where(eq(messageAttachment.id, data.attachmentId));

    return { success: true };
  });
