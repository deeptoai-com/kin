/**
 * Zhipu (BigModel) embedding + rerank HTTP client — RAG R0.
 *
 * Final spec D1/D6 (docs/project/research/2026-06-10-rag-final-implementation-spec.md):
 * a PLAIN fetch client, deliberately not an Agent SDK — the chat runtime stays single-SDK.
 * Lives server-side only (app + worker); the per-session SDK worker never sees the key
 * (kb_search calls back into the app instead).
 *
 * Live-probed limits (T0 memo, 2026-06-10): embedding-3 accepts ≤64 texts per request,
 * ≤3072 tokens per text; we standardize on 1024 dims (documented value; HNSW index and
 * document_chunks.embedding are built for it).
 */

const DEFAULT_BASE_URL = 'https://open.bigmodel.cn/api/paas/v4';

export const EMBED_MODEL = 'embedding-3';
export const EMBED_DIM = 1024;
/** Hard API limit per request (T0 probe). */
export const EMBED_MAX_BATCH = 64;
/** Hard API limit per text; the chunker targets ≤1024 tokens, well under this. */
export const EMBED_MAX_TOKENS_PER_TEXT = 3072;
export const RERANK_MODEL = 'rerank';

function baseUrl(): string {
  return (process.env.EMBEDDING_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, '');
}

function apiKey(): string {
  const key = process.env.ZHIPU_API_KEY;
  if (!key) {
    throw new Error(
      'ZHIPU_API_KEY is not set — required for RAG embedding/rerank. ' +
        'Locally: add it to oxygenie/.env.local (zhipu section); deploy: compose env.',
    );
  }
  return key;
}

/** Split `items` into request-sized batches, preserving order. Pure — unit-tested. */
export function splitBatches<T>(items: readonly T[], size: number = EMBED_MAX_BATCH): T[][] {
  if (size < 1) throw new Error(`splitBatches: size must be >= 1 (got ${size})`);
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size) as T[]);
  }
  return out;
}

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

interface PostOptions {
  /** Total attempts = 1 + retries. */
  retries?: number;
  /** Base backoff in ms (doubles per retry). Injectable for tests. */
  backoffMs?: number;
  signal?: AbortSignal;
}

async function postJson<T>(path: string, body: unknown, opts: PostOptions = {}): Promise<T> {
  const { retries = 3, backoffMs = 1000, signal } = opts;
  // Resolve config OUTSIDE the retry loop — a missing key is a setup error, not a
  // transient failure, and must surface immediately instead of burning backoff time.
  const key = apiKey();
  const url = `${baseUrl()}${path}`;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) {
      await new Promise((r) => setTimeout(r, backoffMs * 2 ** (attempt - 1)));
    }
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal,
      });
      if (response.ok) {
        return (await response.json()) as T;
      }
      const text = await response.text().catch(() => '');
      const error = new Error(`Zhipu ${path} HTTP ${response.status}: ${text.slice(0, 300)}`);
      if (!RETRYABLE_STATUS.has(response.status)) throw error;
      lastError = error;
    } catch (err) {
      // AbortError and non-retryable HTTP errors propagate; network errors retry.
      if (err instanceof Error && err.name === 'AbortError') throw err;
      if (err instanceof Error && err.message.startsWith('Zhipu ') && !isRetryableMessage(err.message)) {
        throw err;
      }
      lastError = err instanceof Error ? err : new Error(String(err));
    }
  }
  throw lastError ?? new Error(`Zhipu ${path}: exhausted retries`);
}

function isRetryableMessage(message: string): boolean {
  const m = message.match(/HTTP (\d{3})/);
  return m ? RETRYABLE_STATUS.has(Number(m[1])) : true;
}

interface EmbeddingsResponse {
  data: Array<{ index: number; embedding: number[] }>;
  usage?: { total_tokens?: number };
}

/**
 * Embed texts with embedding-3 @ EMBED_DIM. Batches sequentially (rate-limit friendly —
 * T0 probe: one 64-batch ≈ 5s, ample for ingest), preserves input order, validates dims.
 */
export async function embedTexts(
  texts: readonly string[],
  opts: PostOptions & { dimensions?: number } = {},
): Promise<number[][]> {
  const { dimensions = EMBED_DIM, ...post } = opts;
  if (texts.length === 0) return [];
  const out: number[][] = [];
  for (const batch of splitBatches(texts)) {
    const res = await postJson<EmbeddingsResponse>(
      '/embeddings',
      { model: EMBED_MODEL, input: batch, dimensions },
      post,
    );
    // The API returns per-item `index` relative to the request — sort to be safe.
    const ordered = [...(res.data ?? [])].sort((a, b) => a.index - b.index);
    if (ordered.length !== batch.length) {
      throw new Error(`Zhipu /embeddings: expected ${batch.length} vectors, got ${ordered.length}`);
    }
    for (const item of ordered) {
      if (item.embedding.length !== dimensions) {
        throw new Error(
          `Zhipu /embeddings: expected ${dimensions}-dim vector, got ${item.embedding.length}`,
        );
      }
      out.push(item.embedding);
    }
  }
  return out;
}

interface RerankResponse {
  results: Array<{ index: number; relevance_score: number; document?: string }>;
}

export interface RerankResult {
  /** Index into the input `documents` array. */
  index: number;
  relevanceScore: number;
}

/**
 * Rerank `documents` against `query` (final spec D7 — the precision stage after RRF).
 * Returns results sorted by relevance, highest first.
 */
export async function rerankDocuments(
  query: string,
  documents: readonly string[],
  opts: PostOptions & { topN?: number } = {},
): Promise<RerankResult[]> {
  const { topN, ...post } = opts;
  if (documents.length === 0) return [];
  const res = await postJson<RerankResponse>(
    '/rerank',
    {
      model: RERANK_MODEL,
      query,
      documents,
      ...(topN ? { top_n: topN } : {}),
      return_documents: false,
    },
    post,
  );
  return (res.results ?? [])
    .map((r) => ({ index: r.index, relevanceScore: r.relevance_score }))
    .sort((a, b) => b.relevanceScore - a.relevanceScore);
}
