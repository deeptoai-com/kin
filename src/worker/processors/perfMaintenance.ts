/**
 * Perf maintenance processor (P2): hourly rollup + retention pruning.
 * Scheduled hourly by the worker bootstrap (PERF_MAINTENANCE_CRON).
 */

import { logger } from '~/lib/logger'
import { rollupHourly, pruneRetention } from '~/server/perf/rollup'

export async function runPerfMaintenance() {
  const rollup = await rollupHourly()
  const pruned = await pruneRetention()
  logger.info('[worker] perf-maintenance done', { buckets: rollup.buckets, pruned })
  return { ...rollup, pruned }
}
