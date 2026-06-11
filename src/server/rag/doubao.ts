/**
 * Doubao (ARK) embedding client — doubao-embedding-vision via /embeddings/multimodal.
 *
 * Chosen as the DEFAULT embedding provider by real-corpus A/B (2026-06-11, minimax
 * prospectus, 12 cases/117 chunks; scripts/rag-embed-ab.ts):
 *   zhipu-1024 R@1 42% MRR 0.546 | doubao-2048 58%/0.684 | doubao-1024 67%/0.744 ← winner
 *
 * API quirk (probed live): `input[]` is ONE multimodal sample (text+image combined),
 * NOT a batch — every text needs its own request. We run a small concurrency pool
 * instead. Auth reuses the ARK key (ANTHROPIC_AUTH_TOKEN), same as the chat gateway.
 * Bonus capability for later (U3/R3): image+text combined embeddings.
 */

const DEFAULT_BASE_URL = 'https://ark.cn-beijing.volces.com/api/v3';

export const DOUBAO_EMBED_MODEL = process.env.ARK_EMBED_MODEL || 'doubao-embedding-vision-250615';
/**
 * 1024 via the (probed) MRL `dimensions` param — the A/B WINNER even over the model's
 * native 2048 (minimax corpus: R@1 67%/MRR 0.744 vs 58%/0.684), and it reuses the
 * existing vector(1024) column + HNSW untouched. NB: pgvector HNSW caps at 2000 dims,
 * so the native 2048 couldn't be indexed anyway (halfvec would be the escape hatch).
 */
export const DOUBAO_EMBED_DIM = 1024;
const CONCURRENCY = Number(process.env.ARK_EMBED_CONCURRENCY) || 4;

function baseUrl(): string {
  return (process.env.ARK_EMBED_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, '');
}

function apiKey(): string {
  const key = process.env.ARK_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN;
  if (!key) {
    throw new Error(
      'ARK key not set (ARK_API_KEY or ANTHROPIC_AUTH_TOKEN) — required for doubao embeddings.',
    );
  }
  return key;
}

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

interface EmbedOptions {
  retries?: number;
  backoffMs?: number;
  signal?: AbortSignal;
}

async function embedOne(text: string, key: string, opts: EmbedOptions): Promise<number[]> {
  const { retries = 3, backoffMs = 1000, signal } = opts;
  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, backoffMs * 2 ** (attempt - 1)));
    try {
      const res = await fetch(`${baseUrl()}/embeddings/multimodal`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: DOUBAO_EMBED_MODEL, input: [{ type: 'text', text }], dimensions: DOUBAO_EMBED_DIM }),
        signal,
      });
      if (res.ok) {
        const embedding = (await res.json())?.data?.embedding as number[] | undefined;
        if (!embedding || embedding.length !== DOUBAO_EMBED_DIM) {
          throw new Error(
            `doubao embeddings: expected ${DOUBAO_EMBED_DIM}-dim vector, got ${embedding?.length ?? 'none'}`,
          );
        }
        return embedding;
      }
      const body = await res.text().catch(() => '');
      const error = new Error(`doubao embeddings HTTP ${res.status}: ${body.slice(0, 200)}`);
      if (!RETRYABLE_STATUS.has(res.status)) throw error;
      lastError = error;
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') throw err;
      if (err instanceof Error && /expected \d+-dim|HTTP \d{3}/.test(err.message) && !isRetryable(err.message)) {
        throw err;
      }
      lastError = err instanceof Error ? err : new Error(String(err));
    }
  }
  throw lastError ?? new Error('doubao embeddings: exhausted retries');
}

function isRetryable(message: string): boolean {
  const m = message.match(/HTTP (\d{3})/);
  return m ? RETRYABLE_STATUS.has(Number(m[1])) : true;
}

/** Embed texts via a fixed-size concurrency pool, preserving input order. */
export async function embedTextsDoubao(
  texts: readonly string[],
  opts: EmbedOptions = {},
): Promise<number[][]> {
  if (texts.length === 0) return [];
  const key = apiKey(); // config errors surface before any lane starts
  const out: number[][] = new Array(texts.length);
  let next = 0;
  async function lane() {
    while (next < texts.length) {
      const i = next++;
      out[i] = await embedOne(texts[i], key, opts);
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, texts.length) }, lane));
  return out;
}
