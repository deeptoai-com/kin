/**
 * Project Schema (Projects P1 — team collaboration)
 *
 * A Project is the unit of organization AND sharing (PRD 2026-06-projects-collaboration,
 * Model A: container = permission). "personal vs team" is not a type — it's just the
 * member count: a Project with 1 member is private; N members is shared. Every user
 * gets one auto-created default ("个人/Personal") Project for daily ad-hoc work.
 *
 * Access is resolved through a SINGLE resolver (src/server/projects/access.ts) — never
 * scatter `WHERE user_id`. Membership in `project_member` grants access to ALL of a
 * Project's sessions + (later) documents/KB. Sharing = adding a member (instant).
 */

import { pgTable, text, boolean, uuid, index, uniqueIndex, primaryKey, pgEnum } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { user } from './auth.schema';
import { createdAt, updatedAt } from './_shared';

export const projectRoleEnum = pgEnum('project_role', ['owner', 'member']);

export const project = pgTable('project', {
  id: uuid('id').primaryKey().defaultRandom(),

  // Owner (can rename / delete / manage members). Always also a row in project_member.
  ownerUserId: text('owner_user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),

  // Outer org boundary (better-auth organization). Reserved for P1+ org↔project work;
  // single-org self-hosted instances leave it null. Not FK-enforced yet.
  orgId: text('org_id'),

  name: text('name').notNull(),
  description: text('description'),
  // Project-level custom instructions. Stored + editable today; APPLYING them to a
  // project's chats (system prompt) is a follow-up — not yet wired. Don't assume applied.
  instructions: text('instructions'),

  // The auto-created default "个人/Personal" Project. At most one per owner.
  isDefault: boolean('is_default').default(false).notNull(),

  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => ({
  ownerIdx: index('idx_project_owner').on(table.ownerUserId),
  // Enforce a single default Project per owner (guards the ensureDefault race).
  oneDefaultPerOwner: uniqueIndex('idx_project_one_default_per_owner')
    .on(table.ownerUserId)
    .where(sql`${table.isDefault} = true`),
}));

export const projectMember = pgTable('project_member', {
  projectId: uuid('project_id')
    .notNull()
    .references(() => project.id, { onDelete: 'cascade' }),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  role: projectRoleEnum('role').notNull().default('member'),
  createdAt: createdAt(),
}, (table) => ({
  pk: primaryKey({ columns: [table.projectId, table.userId] }),
  // "which Projects can this user see" — the resolver's hot path.
  userIdx: index('idx_project_member_user').on(table.userId),
}));

// Type exports for use in application code
export type Project = typeof project.$inferSelect;
export type NewProject = typeof project.$inferInsert;
export type ProjectMember = typeof projectMember.$inferSelect;
export type NewProjectMember = typeof projectMember.$inferInsert;
export type ProjectRole = (typeof projectRoleEnum.enumValues)[number];
