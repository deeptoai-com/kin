/**
 * Knowledge Base Schema
 *
 * A knowledge base is a named collection of documents that can be reused across sessions.
 * Users can create multiple KBs to organize documents by topic, project, or purpose.
 */

import { pgTable, text, timestamp, uuid, index } from 'drizzle-orm/pg-core';
import { createdAt, updatedAt } from './_shared';
import { project } from './project.schema';

export const knowledgeBases = pgTable('knowledge_bases', {
  // Primary key
  id: uuid('id').primaryKey().defaultRandom(),

  // Owner of this KB (uploader/attribution; for personal KBs also the access owner)
  userId: text('user_id').notNull(),

  // RAG R0 (final spec D2): access primitive — null = personal (owner = userId),
  // else visible to all members of the project. Resolved via accessibleKbIds()
  // in src/server/projects/access.ts; never a bare `WHERE user_id`.
  projectId: uuid('project_id').references(() => project.id, { onDelete: 'set null' }),

  // KB metadata
  name: text('name').notNull(),
  description: text('description'),

  // Standard timestamps
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => ({
  // Index for finding all KBs owned by a user
  userIdx: index('idx_knowledge_bases_user').on(table.userId),
  // Index for listing a project's KBs
  projectIdx: index('idx_knowledge_bases_project').on(table.projectId),
}));

// Type exports for use in application code
export type KnowledgeBase = typeof knowledgeBases.$inferSelect;
export type NewKnowledgeBase = typeof knowledgeBases.$inferInsert;
