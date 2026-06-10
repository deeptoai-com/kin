/**
 * Reciprocal-rank fusion (final spec D7) — pure, unit-tested, no imports.
 * Merges the vector and BM25 recall legs: score(id) = Σ_legs 1/(k + rank + 1).
 */
export const RRF_K = 60;

export function rrfFuse(rankings: string[][], k: number = RRF_K): Map<string, number> {
  const scores = new Map<string, number>();
  for (const ranking of rankings) {
    ranking.forEach((id, rank) => {
      scores.set(id, (scores.get(id) ?? 0) + 1 / (k + rank + 1));
    });
  }
  return scores;
}
