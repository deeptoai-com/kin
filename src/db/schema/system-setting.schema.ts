/**
 * System settings (key-value) — runtime-editable org-wide capability/permission posture.
 *
 * DB = runtime source of truth for the permission posture an admin sets in
 * `/admin/permissions` (shell audience, default interaction mode, permission mode,
 * egress scope). Resolution precedence is **DB → env → built-in default**: an unset
 * key falls back to the legacy env var (for existing deployments) and finally to the
 * secure-but-open local default ("开放·留网闸"). Admin edits write rows here and take
 * precedence immediately — ws-server injects the resolved values into each worker it
 * spawns, so there is no container restart.
 *
 * Generic KV (not typed columns) so adding a setting needs no migration; the typed
 * accessor + validation live in `src/server/config/system-settings.server.ts`. Values
 * are small JSON scalars/arrays (enum string | string[]) — **never secrets** (those
 * stay in `.env`, like model tokens).
 */

import { pgTable, text, jsonb } from 'drizzle-orm/pg-core';
import { createdAt, updatedAt } from './_shared';

export const systemSetting = pgTable('system_setting', {
  // Dotted key, e.g. 'shell.audience', 'egress.scope'.
  key: text('key').primaryKey(),
  // Small JSON value (enum string | string[] | boolean). Never a secret.
  value: jsonb('value').$type<unknown>().notNull(),
  // Actor of the last write (user id), for the "changed by" line + audit cross-ref.
  updatedBy: text('updated_by'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export type SystemSetting = typeof systemSetting.$inferSelect;
export type NewSystemSetting = typeof systemSetting.$inferInsert;
