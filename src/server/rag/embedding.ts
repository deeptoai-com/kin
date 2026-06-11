/**
 * Embedding provider facade — the ONE import for everything that embeds (ingest, search,
 * eval, smokes). Provider switches via env, column stays vector(1024) for both:
 *
 *   EMBED_PROVIDER=doubao (default) — doubao-embedding-vision @1024 via MRL dimensions
 *     (ARK key; per-text requests with a concurrency pool). Real-corpus A/B winner.
 *   EMBED_PROVIDER=zhipu            — zhipu embedding-3 @1024 (documented native value),
 *     so a fallback/switch never needs a schema change — only re-embed.
 *
 * documents.embed_model/embed_dim record provenance per doc; a provider/model change is
 * detected there and forces re-embedding on next ingest (hash-skip is bypassed).
 */
import { embedTexts as embedTextsZhipu } from './zhipu';
import { DOUBAO_EMBED_DIM, DOUBAO_EMBED_MODEL, embedTextsDoubao } from './doubao';

export type EmbedProvider = 'doubao' | 'zhipu';

export function embedProvider(): EmbedProvider {
  return process.env.EMBED_PROVIDER === 'zhipu' ? 'zhipu' : 'doubao';
}

/** Unified column dimension — both providers emit 1024 (doubao via its MRL `dimensions`
 * param, zhipu natively), matching the existing vector(1024) column + HNSW (≤2000 dims). */
export const EMBED_DIM = 1024;

export function embedModel(): string {
  return embedProvider() === 'zhipu' ? 'embedding-3' : DOUBAO_EMBED_MODEL;
}

// Compile-time guard: the doubao constant must match the unified column dim.
const _dimCheck: typeof EMBED_DIM = DOUBAO_EMBED_DIM;
void _dimCheck;

export interface EmbedOptions {
  retries?: number;
  backoffMs?: number;
  signal?: AbortSignal;
}

/** Embed texts with the configured provider. Order-preserving; throws on config errors. */
export async function embedTexts(
  texts: readonly string[],
  opts: EmbedOptions = {},
): Promise<number[][]> {
  if (embedProvider() === 'zhipu') {
    return embedTextsZhipu(texts, { ...opts, dimensions: EMBED_DIM });
  }
  return embedTextsDoubao(texts, opts);
}
