/**
 * BullMQ processor: detect whether a newer server image is published, and persist the
 * verdict to update_status (PRD FR2). Runs on the 6h `update-check` repeat job.
 *
 * Detection is read-only and unprivileged: it does NOT touch the Docker socket. It compares
 * the git SHA the worker is running (process.env.BUILD_SHA — baked into the shared app image)
 * against the git revision label of the GHCR :latest image. The admin UI reads the row to
 * decide whether to light the "可更新" badge; applying an update is a separate, gated action.
 *
 * Spec §4.3. Mirrors probeModels.ts (db client import + onConflictDoUpdate upsert).
 */

import { db } from '~/db/client';
import { updateStatus } from '~/db/schema/update-status.schema';
import { queryGhcrLatest } from '~/server/updater/registry';
import { logger } from '~/lib/logger';

const SINGLETON = 'singleton';

/**
 * Resolve the image to poll. Prefer an explicit GHCR ref (APP_IMAGE) + APP_TAG; otherwise
 * fall back to the final Kin GHCR coordinates. The local production tag (`oxygenie:local`,
 * pre-D1) is not a GHCR ref, so we only poll when APP_IMAGE actually points at a registry.
 */
function resolveImage(): string {
  const explicit = process.env.UPDATE_CHECK_IMAGE?.trim();
  if (explicit) return explicit;
  const appImage = process.env.APP_IMAGE?.trim();
  const appTag = process.env.APP_TAG?.trim() || 'latest';
  if (appImage && appImage.includes('ghcr.io')) return `${appImage}:${appTag}`;
  return 'ghcr.io/deeptoai-com/kin/app:latest';
}

/** Query GHCR, compute updateAvailable, upsert the single update_status row. */
export async function runUpdateCheck(): Promise<{ updateAvailable: boolean }> {
  const image = resolveImage();
  const currentSha = process.env.BUILD_SHA ?? null;
  const now = new Date();

  try {
    const { digest, revision } = await queryGhcrLatest(image);
    // Only claim an update when we can compare two known git SHAs and they differ.
    // Unknown (pre-M0 images without the revision label) is treated as "no update" so we
    // never nag the admin on a signal we can't trust.
    const updateAvailable = Boolean(currentSha && revision && currentSha !== revision);

    await db
      .insert(updateStatus)
      .values({
        id: SINGLETON,
        image,
        currentSha,
        latestSha: revision,
        latestDigest: digest,
        updateAvailable,
        checkedAt: now,
        error: null,
      })
      .onConflictDoUpdate({
        target: updateStatus.id,
        set: {
          image,
          currentSha,
          latestSha: revision,
          latestDigest: digest,
          updateAvailable,
          checkedAt: now,
          error: null,
        },
      });

    logger.info('[update-check] done', { image, currentSha, latestSha: revision, updateAvailable });
    return { updateAvailable };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    // Record the error but keep the last-known latest* values; do not flip updateAvailable.
    await db
      .insert(updateStatus)
      .values({ id: SINGLETON, image, currentSha, updateAvailable: false, checkedAt: now, error })
      .onConflictDoUpdate({
        target: updateStatus.id,
        set: { image, currentSha, checkedAt: now, error },
      });

    logger.error('[update-check] failed', { image, error });
    return { updateAvailable: false };
  }
}
