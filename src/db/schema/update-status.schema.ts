/**
 * update_status — single-row table holding the result of the latest GHCR update check.
 *
 * Written by the BullMQ `update-check` repeat job (src/worker/processors/updateCheck.ts),
 * read by the admin "Web Server Update" UI to decide whether to light the "可更新" badge.
 *
 * Online auto-update (Kin M3). PRD: docs/4. PRD/2026-06-14-在线自动更新-PRD.md (FR2/FR3).
 * Always upserted against the fixed primary key `singleton` so there is exactly one row.
 */

import { pgTable, text, boolean } from 'drizzle-orm/pg-core';
import { timestamptz } from './_shared';

export const updateStatus = pgTable('update_status', {
  // Fixed PK so the table holds a single row; onConflictDoUpdate target.
  id: text('id').primaryKey().default('singleton'),
  // Image ref that was checked, e.g. ghcr.io/deeptoai-com/kin/app:latest
  image: text('image'),
  // git SHA the worker is currently running (process.env.BUILD_SHA), null pre-M0.
  currentSha: text('current_sha'),
  // git SHA of the GHCR :latest image (org.opencontainers.image.revision label), best-effort.
  latestSha: text('latest_sha'),
  // GHCR :latest manifest digest (sha256:...), used by the updater apply step.
  latestDigest: text('latest_digest'),
  // True only when current vs latest git SHA differ (and both are known).
  updateAvailable: boolean('update_available').notNull().default(false),
  // Last time the check ran (success or failure).
  checkedAt: timestamptz('checked_at'),
  // Last check error message, null on success.
  error: text('error'),
});

export type UpdateStatusRow = typeof updateStatus.$inferSelect;
export type NewUpdateStatusRow = typeof updateStatus.$inferInsert;
