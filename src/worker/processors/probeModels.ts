/**
 * BullMQ processor: probe model health and persist to model_health (PR3).
 *
 * Runs on the 6h `probe-models` repeat job (and on-demand for a single model from
 * the admin "re-probe" action). Resolves token-free metadata from the registry,
 * probes via the Anthropic Messages API, and upserts the verdict.
 */

import { db } from '~/db/client';
import { modelDefinition, modelHealth } from '~/db/schema/model.schema';
import { resolveModelMeta } from '~/server/models/registry';
import { probeModelMeta } from '~/server/models/probe';
import { logger } from '~/lib/logger';

/** Probe a single model and upsert its health row. */
export async function probeAndStore(modelId: string): Promise<void> {
  const meta = await resolveModelMeta(modelId);
  if (!meta) {
    logger.warn('[probe] unknown model id, skipping', { modelId });
    return;
  }
  const result = await probeModelMeta(meta);
  const now = new Date();
  await db
    .insert(modelHealth)
    .values({
      modelId,
      health: result.health,
      lastProbeAt: now,
      probeError: result.probeError,
      latencyMs: result.latencyMs,
    })
    .onConflictDoUpdate({
      target: modelHealth.modelId,
      set: { health: result.health, lastProbeAt: now, probeError: result.probeError, latencyMs: result.latencyMs },
    });
  logger.info('[probe] result', { modelId, health: result.health, error: result.probeError, latencyMs: result.latencyMs });
}

/** Probe all models (periodic) or one model (on-demand). Never throws per-model. */
export async function probeModels(modelId?: string): Promise<{ probed: number }> {
  if (modelId) {
    await probeAndStore(modelId).catch((e) => logger.error('[probe] failed', { modelId, error: e }));
    return { probed: 1 };
  }
  const defs = await db.select({ id: modelDefinition.id }).from(modelDefinition);
  for (const d of defs) {
    await probeAndStore(d.id).catch((e) => logger.error('[probe] failed', { modelId: d.id, error: e }));
  }
  logger.info('[probe] swept all models', { count: defs.length });
  return { probed: defs.length };
}
