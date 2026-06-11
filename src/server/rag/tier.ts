/**
 * RAG tier routing (final spec D5) — pure, unit-tested.
 *
 * The whole point of tiering: most uploads are small and must NOT be embedded
 * (workspace Read/Grep already serves them better and for free). Only 'rag'-tier
 * documents enter the chunk+embed pipeline.
 */

export type RagTier = 'inline' | 'grep' | 'rag';

/** inline-tier ceiling: comfortably fits a context window slice. */
export const INLINE_MAX_TOKENS = 8_000;
/** rag-tier floor (default; override via RAG_TIER_RAG_MIN_TOKENS). */
export const DEFAULT_RAG_MIN_TOKENS = 20_000;

/**
 * Cheap token estimate good enough for routing (NOT for billing): CJK chars count
 * ~1 token each; everything else ~4 chars/token.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  let cjk = 0;
  let other = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    // CJK unified + extensions, kana, hangul — the ranges that tokenize ~1:1.
    if (
      (code >= 0x4e00 && code <= 0x9fff) ||
      (code >= 0x3400 && code <= 0x4dbf) ||
      (code >= 0x3040 && code <= 0x30ff) ||
      (code >= 0xac00 && code <= 0xd7af)
    ) {
      cjk++;
    } else {
      other++;
    }
  }
  return cjk + Math.ceil(other / 4);
}

export function ragMinTokens(): number {
  const raw = Number(process.env.RAG_TIER_RAG_MIN_TOKENS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_RAG_MIN_TOKENS;
}

/**
 * Route a document by its estimated tokens (legacy R1 tiering for the CHAT-ATTACHMENT
 * line — workspace Read/Grep semantics). Superseded for KB documents by chunkStrategy
 * (ingest-UX spec D6): KB docs embed regardless of size.
 */
export function routeTier(tokenEstimate: number, ragMin: number = ragMinTokens()): RagTier {
  if (tokenEstimate >= ragMin) return 'rag';
  if (tokenEstimate > INLINE_MAX_TOKENS) return 'grep';
  return 'inline';
}

export type ChunkStrategy = 'single' | 'structured';

/**
 * Upper bound for the single-chunk strategy: a small KB doc embeds as ONE chunk (whole
 * text, no parent/child split — preserves global structure, kb_search returns it whole).
 * Must stay under Zhipu's 3072-token per-text embedding limit; matches the chunker's
 * PARENT_MAX_TOKENS so a "small" doc is exactly one that would have been a single parent.
 */
export const SINGLE_CHUNK_MAX_TOKENS = 2500;

/**
 * How to chunk a KB document (ingest-UX spec D6). NOT whether to embed — KB docs always
 * embed; this only picks single vs structured so kb_search never has a coverage gap.
 */
export function chunkStrategy(tokenEstimate: number): ChunkStrategy {
  return tokenEstimate <= SINGLE_CHUNK_MAX_TOKENS ? 'single' : 'structured';
}
