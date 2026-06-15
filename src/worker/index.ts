import '~/lib/observability/sentry.server'

import IORedis from 'ioredis'
import { Worker, Queue, QueueEvents, JobsOptions } from 'bullmq'
import { logger } from '~/lib/logger'
import { runDailyCreditRefill } from './processors/dailyCreditRefill.ts'
import { reindexDocuments } from './processors/reindexDocuments.ts'
import { probeModels } from './processors/probeModels.ts'
import { reindexMessages } from './processors/reindexMessages.ts'
import { indexSessionMessages } from './processors/indexSessionMessages.ts'
import { ingestDocument } from '~/server/rag/ingest'
import { RAG_QUEUE, RAG_INGEST_JOB } from '~/server/rag/queue'

const connection = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
  maxRetriesPerRequest: null,
})

const queueName = process.env.BULLMQ_QUEUE ?? 'system'
// MUST match the producer default in src/server/rag/queue.ts ('oxygenie'). If these diverge and
// BULLMQ_PREFIX is unset (e.g. local dev), the app enqueues to a queue this worker never consumes
// → docs stuck 'pending'. The old 'constructa' default here was exactly that latent footgun.
const prefix = process.env.BULLMQ_PREFIX ?? 'oxygenie'
const queue = new Queue(queueName, { connection, prefix })

// Main worker
const worker = new Worker(
  queueName,
  async (job) => {
    switch (job.name) {
      case 'daily-credit-refill':
        logger.info('[worker] running daily-credit-refill')
        return runDailyCreditRefill()
      case 'reindex-all':
        logger.info('[worker] running reindex-all job')
        return reindexDocuments()
      case 'probe-models':
        logger.info('[worker] running probe-models job')
        return probeModels((job.data as { modelId?: string } | undefined)?.modelId)
      case 'reindex-messages':
        logger.info('[worker] running reindex-messages job')
        return reindexMessages()
      case 'index-session-messages':
        return indexSessionMessages(job.data as { userId?: string; sdkSessionId?: string })
      default:
        logger.warn(`[worker] Unknown job "${job.name}" - ignoring`)
    }
  },
  { connection, prefix }
)

worker.on('ready', () => logger.info('[worker] ready'))
worker.on('error', (err) => logger.error('[worker] error', { error: err }))

// RAG ingest worker — its own queue (final spec D4): an older deployed image, which
// doesn't know this queue, leaves its jobs untouched instead of swallowing them via the
// 'system' default branch above. Concurrency 1: ingest is batch-embedding heavy and the
// Zhipu client already parallelizes nothing it shouldn't.
const ragWorker = new Worker(
  RAG_QUEUE,
  async (job) => {
    if (job.name !== RAG_INGEST_JOB) {
      logger.warn(`[worker:rag] Unknown job "${job.name}" - ignoring`)
      return
    }
    const { documentId } = job.data as { documentId: string }
    logger.info('[worker:rag] ingesting document', { documentId })
    const result = await ingestDocument(documentId)
    logger.info('[worker:rag] ingest finished', { documentId, ...result })
    return result
  },
  { connection, prefix, concurrency: 1 }
)
ragWorker.on('ready', () => logger.info('[worker:rag] ready'))
ragWorker.on('error', (err) => logger.error('[worker:rag] error', { error: err }))

// Events
const events = new QueueEvents(queueName, { connection, prefix })
events.on('completed', ({ jobId }) => logger.info('[worker] completed job', { jobId }))
events.on('failed', ({ jobId, failedReason }) =>
  logger.error('[worker] job failed', { jobId, error: failedReason })
)

// Bootstrap schedules + optional reindex
;(async () => {
  const cron = process.env.DAILY_CREDIT_REFILL_CRON ?? '0 3 * * *' // 03:00 UTC daily
  const existing = await queue.getRepeatableJobs()
  const has = existing.some((j) => j.name === 'daily-credit-refill' && j.cron === cron)

  if (!has) {
    const opts: JobsOptions = { repeat: { pattern: cron }, jobId: 'daily-credit-refill' }
    await queue.add('daily-credit-refill', {}, opts)
    logger.info('[worker] scheduled daily-credit-refill', { cron })
  }

  // Model health probe (multi-model): re-check every model's connection on a cadence
  // (default every 6h) so the picker/board only offer currently-usable models.
  const probeCron = process.env.MODEL_PROBE_CRON ?? '0 */6 * * *'
  const hasProbe = existing.some((j) => j.name === 'probe-models' && j.cron === probeCron)
  if (!hasProbe) {
    await queue.add('probe-models', {}, { repeat: { pattern: probeCron }, jobId: 'probe-models' })
    logger.info('[worker] scheduled probe-models', { cron: probeCron })
  }

  // Probe once on boot (default on) so freshly-seeded models become selectable in
  // minutes instead of waiting for the first 6h tick. Set MODEL_PROBE_ON_BOOT=false
  // to disable.
  if ((process.env.MODEL_PROBE_ON_BOOT ?? 'true').toLowerCase() !== 'false') {
    await queue.add('probe-models', {}, { jobId: `probe-boot-${Date.now()}` })
    logger.info('[worker] queued probe-models on boot')
  }

  if (process.env.SEARCH_REINDEX_ON_BOOT === 'true') {
    await queue.add('reindex-all', {}, { jobId: `reindex-${Date.now()}` })
    logger.info('[worker] queued reindex-all on boot')
  }

  // Conversation search: optionally backfill the message index on boot (default off).
  if ((process.env.MESSAGE_REINDEX_ON_BOOT ?? 'false').toLowerCase() === 'true') {
    await queue.add('reindex-messages', {}, { jobId: `reindex-messages-${Date.now()}` })
    logger.info('[worker] queued reindex-messages on boot')
  }
})().catch((e) => {
  logger.error('[worker] bootstrap error', { error: e })
})
