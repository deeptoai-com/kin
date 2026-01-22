/**
 * Message Attachment Schema
 *
 * Links user-uploaded attachments to specific chat messages.
 * Provides persistence for attachment metadata and enables:
 * - Reconstruction of attachment state on session resume
 * - Tracking of files mentioned/used per message
 * - File lifecycle management
 *
 * Part of P13: Attachment Persistence Pipeline
 */

import { pgTable, text, timestamp, uuid, index, integer, boolean } from 'drizzle-orm/pg-core';
import { agentSession } from './agent-session.schema';
import { createdAt, updatedAt } from './_shared';

export const messageAttachment = pgTable('message_attachment', {
  // Primary key
  id: uuid('id').primaryKey().defaultRandom(),

  // Session reference - cascade delete when session is deleted
  sessionId: uuid('session_id')
    .notNull()
    .references(() => agentSession.id, { onDelete: 'cascade' }),

  // Message UUID from the chat (corresponds to SDK message uuid)
  messageId: text('message_id').notNull(),

  // Original file name as uploaded by user
  originalName: text('original_name').notNull(),

  // File path in workspace (relative to workspace root)
  // e.g., "uploads/report.pdf" or "image.png"
  filePath: text('file_path').notNull(),

  // MIME type of the file
  mimeType: text('mime_type'),

  // File size in bytes
  fileSize: integer('file_size'),

  // Whether the file was successfully uploaded
  uploaded: boolean('uploaded').notNull().default(false),

  // When the file was uploaded
  uploadedAt: timestamp('uploaded_at', { withTimezone: true }),

  // Whether the file has been referenced by the agent (read/analyzed)
  referenced: boolean('referenced').notNull().default(false),

  // Standard timestamps
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => ({
  // Index for finding all attachments in a session
  sessionIdx: index('idx_message_attachment_session').on(table.sessionId),

  // Index for finding all attachments for a message
  messageIdx: index('idx_message_attachment_message').on(table.messageId),

  // Compound index for session + message lookup
  sessionMessageIdx: index('idx_message_attachment_session_message').on(table.sessionId, table.messageId),
}));

// Type exports for use in application code
export type MessageAttachment = typeof messageAttachment.$inferSelect;
export type NewMessageAttachment = typeof messageAttachment.$inferInsert;
