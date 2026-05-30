/**
 * Audit Log Schema (P2-2)
 *
 * Append-only trail of security-relevant actions (login, elevated-permission
 * runs, run aborts, …). Purely additive: writing audit rows never changes the
 * behaviour of the action being recorded.
 *
 * Design note: `userId` is deliberately NOT a foreign key. An audit trail must
 * survive user deletion for forensic value, and some actions (e.g. a failed
 * login) have no associated user. It is plain nullable text.
 */

import { index, jsonb, pgTable, text } from 'drizzle-orm/pg-core';
import { generateId } from '~/utils/id-generator';
import { createdAt } from './_shared';

export const auditLog = pgTable(
  'audit_log',
  {
    id: text('id')
      .$defaultFn(() => generateId('audit'))
      .primaryKey(),

    // Actor. Nullable; not an FK (see design note above).
    userId: text('user_id'),

    // Dotted action key, e.g. 'auth.login', 'run.abort', 'run.bypass_mode'.
    action: text('action').notNull(),

    // Optional subject of the action (session id, resource path, …).
    target: text('target'),

    // Free-form structured context.
    meta: jsonb('meta').$type<Record<string, unknown>>().default({}),

    // Source IP when known (e.g. x-forwarded-for).
    ip: text('ip'),

    createdAt: createdAt(),
  },
  (table) => ({
    userIdIdx: index('audit_log_user_id_idx').on(table.userId),
    actionIdx: index('audit_log_action_idx').on(table.action),
    createdAtIdx: index('audit_log_created_at_idx').on(table.createdAt),
  }),
);
