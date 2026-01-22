/**
 * Message Attachment Hook
 *
 * React hook for managing message attachments.
 * Part of P13: Attachment Persistence Pipeline
 */

import { useCallback } from 'react';
import { useServerFn } from '@tanstack/react-start';
import {
  createMessageAttachment,
  getMessageAttachments,
  getSessionAttachments,
} from '~/server/function/message-attachment.server';
import type { MessageAttachment } from '~/db/schema/message-attachment.schema';

/**
 * Hook for message attachment operations
 */
export function useMessageAttachments() {
  const createAttachmentFn = useServerFn(createMessageAttachment);
  const getAttachmentsFn = useServerFn(getMessageAttachments);
  const getSessionAttachmentsFn = useServerFn(getSessionAttachments);

  /**
   * Persist attachments for a message after it's created
   */
  const persistAttachments = useCallback(async (
    sessionId: string,
    messageId: string,
    attachments: Array<{
      originalName: string;
      filePath: string;
      mimeType?: string;
      fileSize?: number;
    }>
  ): Promise<void> => {
    for (const attachment of attachments) {
      try {
        await createAttachmentFn({
          data: {
            sessionId,
            messageId,
            originalName: attachment.originalName,
            filePath: attachment.filePath,
            mimeType: attachment.mimeType,
            fileSize: attachment.fileSize,
            uploaded: true,
          }
        });
      } catch (error) {
        console.error('[Attachment] Failed to persist:', error);
      }
    }
  }, [createAttachmentFn]);

  /**
   * Load attachments for a specific message
   */
  const loadMessageAttachments = useCallback(async (
    sessionId: string,
    messageId: string
  ): Promise<MessageAttachment[]> => {
    try {
      const result = await getAttachmentsFn({
        data: { sessionId, messageId }
      });
      return (result as MessageAttachment[]) || [];
    } catch (error) {
      console.error('[Attachment] Failed to load message attachments:', error);
      return [];
    }
  }, [getAttachmentsFn]);

  /**
   * Load all attachments for a session (grouped by messageId)
   */
  const loadSessionAttachments = useCallback(async (
    sessionId: string
  ): Promise<Map<string, MessageAttachment[]>> => {
    try {
      const result = await getSessionAttachmentsFn({
        data: { sessionId }
      });
      const attachments = (result as MessageAttachment[]) || [];

      // Group by messageId
      const grouped = new Map<string, MessageAttachment[]>();
      for (const attachment of attachments) {
        const existing = grouped.get(attachment.messageId) || [];
        existing.push(attachment);
        grouped.set(attachment.messageId, existing);
      }

      return grouped;
    } catch (error) {
      console.error('[Attachment] Failed to load session attachments:', error);
      return new Map();
    }
  }, [getSessionAttachmentsFn]);

  return {
    persistAttachments,
    loadMessageAttachments,
    loadSessionAttachments,
  };
}

/**
 * Type for attachment metadata (before persistence)
 */
export type PendingAttachment = {
  originalName: string;
  filePath: string;
  mimeType?: string;
  fileSize?: number;
};
