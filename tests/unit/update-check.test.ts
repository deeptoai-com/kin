/**
 * Unit tests for the update-check worker processor LOGIC (no real DB, no network).
 * Mocks the db client + the GHCR registry query, and asserts updateAvailable is computed
 * from git-SHA comparison and persisted via the singleton upsert.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── capture the drizzle upsert chain: db.insert(table).values(v).onConflictDoUpdate({set}) ──
// vi.hoisted so these exist before the hoisted vi.mock factories run.
const { insert, captured, queryGhcrLatest } = vi.hoisted(() => {
  const captured: { values?: Record<string, unknown>; set?: Record<string, unknown> } = {};
  const onConflictDoUpdate = vi.fn((arg: { set: Record<string, unknown> }) => {
    captured.set = arg.set;
    return Promise.resolve();
  });
  const values = vi.fn((v: Record<string, unknown>) => {
    captured.values = v;
    return { onConflictDoUpdate };
  });
  const insert = vi.fn(() => ({ values }));
  const queryGhcrLatest = vi.fn();
  return { insert, captured, queryGhcrLatest };
});

vi.mock('~/db/client', () => ({ db: { insert } }));
vi.mock('~/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('~/server/updater/registry', () => ({ queryGhcrLatest }));

import { runUpdateCheck } from '~/worker/processors/updateCheck';

beforeEach(() => {
  vi.clearAllMocks();
  delete captured.values;
  delete captured.set;
  process.env.BUILD_SHA = 'currentsha';
  process.env.UPDATE_CHECK_IMAGE = 'ghcr.io/deeptoai-com/kin/app:latest';
});

describe('runUpdateCheck', () => {
  it('flags updateAvailable when the latest git SHA differs', async () => {
    queryGhcrLatest.mockResolvedValue({ digest: 'sha256:X', revision: 'newersha' });
    const res = await runUpdateCheck();
    expect(res.updateAvailable).toBe(true);
    expect(captured.values).toMatchObject({
      id: 'singleton',
      currentSha: 'currentsha',
      latestSha: 'newersha',
      latestDigest: 'sha256:X',
      updateAvailable: true,
      error: null,
    });
  });

  it('does NOT flag an update when running the same SHA', async () => {
    queryGhcrLatest.mockResolvedValue({ digest: 'sha256:X', revision: 'currentsha' });
    const res = await runUpdateCheck();
    expect(res.updateAvailable).toBe(false);
    expect(captured.values).toMatchObject({ updateAvailable: false });
  });

  it('is conservative (no update) when the revision label is unknown', async () => {
    queryGhcrLatest.mockResolvedValue({ digest: 'sha256:X', revision: null });
    const res = await runUpdateCheck();
    expect(res.updateAvailable).toBe(false);
  });

  it('records the error and does not flag an update when the query throws', async () => {
    queryGhcrLatest.mockRejectedValue(new Error('GHCR token request failed: 503'));
    const res = await runUpdateCheck();
    expect(res.updateAvailable).toBe(false);
    expect(captured.set).toMatchObject({ error: 'GHCR token request failed: 503' });
    // must not clobber latest* on error (only id/image/currentSha/checkedAt/error in the set)
    expect(captured.set).not.toHaveProperty('updateAvailable');
  });
});
