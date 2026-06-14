/**
 * RAG ingest scheduling (final spec D4).
 *
 * DELIBERATELY a separate BullMQ queue named 'rag' — the deployed worker container may
 * run an older image whose Worker subscribes only to the 'system' queue; jobs on a queue
 * nobody subscribes to simply wait, whereas jobs on 'system' would be consumed by the old
 * worker's default branch and silently completed ("Unknown job - ignoring").
 *
 * Local dev (scripts/local-* run NO worker): RAG_INGEST_INLINE=true executes the pipeline
 * in-process, fire-and-forget. Inline is also the automatic fallback when REDIS_URL is
 * unset.
 */
import { ingestDocument } from './ingest';

export const RAG_QUEUE = 'rag';
export const RAG_INGEST_JOB = 'rag-ingest';

let queuePromise: Promise<import('bullmq').Queue> | null = null;

async function getQueue() {
  if (!queuePromise) {
    queuePromise = (async () => {
      const [{ Queue }, { default: IORedis }] = await Promise.all([
        import('bullmq'),
        import('ioredis'),
      ]);
      const connection = new IORedis(process.env.REDIS_URL!, { maxRetriesPerRequest: null });
      // Default MUST match the worker's queue prefix (docker-compose worker uses
      // BULLMQ_PREFIX:-oxygenie). If they diverge, the app enqueues to a queue the worker never
      // consumes → docs stuck 'pending'. The old 'constructa' default caused exactly that.
      const prefix = process.env.BULLMQ_PREFIX ?? 'oxygenie';
      return new Queue(RAG_QUEUE, { connection, prefix });
    })();
  }
  return queuePromise;
}

function inlineMode(): boolean {
  if (process.env.RAG_INGEST_INLINE === 'true') return true;
  return !process.env.REDIS_URL;
}

/**
 * Schedule (or inline-run) ingest for a document. Never throws — ingest failure surfaces
 * via documents.ingest_status, not by breaking the upload request that triggered it.
 */
export async function scheduleRagIngest(documentId: string): Promise<'queued' | 'inline' | 'error'> {
  try {
    if (inlineMode()) {
      void ingestDocument(documentId).catch((err) =>
        console.error('[rag-queue] inline ingest failed:', documentId, err),
      );
      return 'inline';
    }
    const queue = await getQueue();
    // jobId dedups re-triggers of the same document while one is still queued.
    await queue.add(RAG_INGEST_JOB, { documentId }, { jobId: `${RAG_INGEST_JOB}-${documentId}` });
    return 'queued';
  } catch (err) {
    console.error('[rag-queue] schedule failed:', documentId, err);
    return 'error';
  }
}
