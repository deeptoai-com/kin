/**
 * Online auto-update — admin-gated server functions (Kin M3).
 *
 * The same-origin bridge between the admin "Web Server Update" UI and the privileged updater
 * sidecar. Every function is double-gated (FR9): requireSystemAdmin() here (systemRole==='admin')
 * AND a Bearer UPDATER_TOKEN on the wire to the updater (which also checks it).
 *
 * Follows the preview runtime client shape (src/preview/runtime.js) — POST JSON, tolerant
 * parse — but ADDS the Authorization header the preview path omits. Only createServerFn
 * instances are exported (no plain server-only values) so nothing drags postgres into the
 * client bundle.
 *
 * PRD FR3/FR4/FR5/FR6/FR7/FR9. Spec §4.4.
 */

import { createServerFn } from '@tanstack/react-start';
import { requireSystemAdmin } from '~/server/admin.server';

const UPDATER_URL = (process.env.UPDATER_URL || 'http://updater:5066').replace(/\/+$/, '');
const UPDATER_TOKEN = process.env.UPDATER_TOKEN || '';

/** Concrete, fully-serializable shape of the updater sidecar's responses (all fields optional). */
interface UpdaterResponse {
  ok?: boolean;
  // /v1/update/check
  service?: string;
  runningImageId?: string | null;
  targetImage?: string;
  // /v1/update/verify
  services?: Array<{
    service: string | null;
    state: string | null;
    health: string | null;
    status: string | null;
  }>;
  allRunning?: boolean;
  // /v1/update/apply (+ apply/status)
  started?: boolean;
  phase?: string;
  inProgress?: boolean;
  startedAt?: number | null;
  rolledBack?: boolean;
  updated?: boolean;
  // error path
  error?: string;
}

/** POST to the updater sidecar with the shared Bearer token; tolerant JSON parse. */
async function updaterPost(path: string, payload: Record<string, unknown> = {}): Promise<UpdaterResponse> {
  const res = await fetch(`${UPDATER_URL}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${UPDATER_TOKEN}`,
    },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  let body: UpdaterResponse | null = null;
  try {
    body = text ? (JSON.parse(text) as UpdaterResponse) : null;
  } catch {
    body = { error: text };
  }
  if (!res.ok) {
    const msg = body?.error || `Updater returned ${res.status}`;
    throw new Error(msg);
  }
  return body ?? {};
}

/**
 * Read the latest detection result written by the worker `update-check` job — drives the
 * "可更新" badge + current/latest version chips (FR3). Admin-only.
 */
export const getUpdateStatus = createServerFn({ method: 'GET' }).handler(async () => {
  await requireSystemAdmin();
  const { db } = await import('~/db/db-config');
  const { updateStatus } = await import('~/db/schema/update-status.schema');
  const rows = await db.select().from(updateStatus).limit(1);
  const row = rows[0] ?? null;
  return {
    currentSha: row?.currentSha ?? process.env.BUILD_SHA ?? 'dev',
    latestSha: row?.latestSha ?? null,
    latestDigest: row?.latestDigest ?? null,
    updateAvailable: row?.updateAvailable ?? false,
    checkedAt: row?.checkedAt ?? null,
    image: row?.image ?? null,
    error: row?.error ?? null,
  };
});

/** On-demand: ask the updater what image is currently running vs target (FR3). Admin-only. */
export const checkUpdate = createServerFn({ method: 'POST' }).handler(async () => {
  await requireSystemAdmin();
  return updaterPost('/v1/update/check');
});

/** Service health snapshot for the "Ready to Update" dialog (FR4). Admin-only. */
export const verifyServices = createServerFn({ method: 'POST' }).handler(async () => {
  await requireSystemAdmin();
  return updaterPost('/v1/update/verify');
});

/** Trigger the ordered in-place upgrade (FR5/FR6). Returns 202-started; UI then polls health. */
export const applyUpdate = createServerFn({ method: 'POST' }).handler(async () => {
  await requireSystemAdmin();
  // Pass the detected target git SHA so the updater health gate can positively confirm it.
  const { db } = await import('~/db/db-config');
  const { updateStatus } = await import('~/db/schema/update-status.schema');
  const rows = await db.select().from(updateStatus).limit(1);
  const targetVersion = rows[0]?.latestSha ?? undefined;
  return updaterPost('/v1/update/apply', targetVersion ? { targetVersion } : {});
});

/** Best-effort upgrade progress (phase) while the app is still reachable (FR7). Admin-only. */
export const getApplyStatus = createServerFn({ method: 'GET' }).handler(async () => {
  await requireSystemAdmin();
  return updaterPost('/v1/update/apply/status');
});
