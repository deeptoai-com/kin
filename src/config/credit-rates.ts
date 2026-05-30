/**
 * Credit conversion rates + metering flag (P2-3).
 *
 * ⚠️ THE RATES BELOW ARE PLACEHOLDERS — they are NOT calibrated.
 *
 * Do NOT enable metering until:
 *   1. P2-1 has accumulated real usage data, and
 *   2. the owner confirms the budget mapping (¥200/month ≈ how many tokens),
 * then back-solve `tokensPerCredit` from that data.
 *
 * Rationale (docs/project/research/2026-05-billing-design.md §3):
 *  - Metering basis is TOKEN COUNT (real), not the SDK's USD estimate.
 *  - A credit is primarily a FAIR-USE quota unit, not exact cost pass-through.
 *  - The rate is config (env-overridable) so price changes don't need a release.
 *
 * Metering is OFF by default. Flip BILLING_METERING_ENABLED=true only after the
 * above gate is cleared.
 */

// Placeholder: 1 credit ≈ this many tokens. Intentionally round and uncalibrated.
const DEFAULT_TOKENS_PER_CREDIT = 10_000;

/**
 * Per-model token→credit rate. Resolution order:
 *   1. env CREDIT_TOKENS_PER_CREDIT__<model>  (e.g. CREDIT_TOKENS_PER_CREDIT__ark-code-latest=20000)
 *   2. env CREDIT_TOKENS_PER_CREDIT          (global override)
 *   3. DEFAULT_TOKENS_PER_CREDIT             (placeholder)
 * A non-positive/invalid value falls through to the next source.
 */
export function tokensPerCreditFor(model: string, env: NodeJS.ProcessEnv = process.env): number {
  const perModelKey = `CREDIT_TOKENS_PER_CREDIT__${model}`;
  const candidates = [env[perModelKey], env.CREDIT_TOKENS_PER_CREDIT];
  for (const raw of candidates) {
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return DEFAULT_TOKENS_PER_CREDIT;
}

/** Whether token→credit metering/charging is active. Default false. */
export function isMeteringEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.BILLING_METERING_ENABLED === 'true';
}

export type ModelUsageTokens = {
  inputTokens?: number;
  outputTokens?: number;
};

const tokensOf = (mu: ModelUsageTokens | undefined): number => {
  const i = Number(mu?.inputTokens);
  const o = Number(mu?.outputTokens);
  return (Number.isFinite(i) ? i : 0) + (Number.isFinite(o) ? o : 0);
};

/**
 * Credits for a single-model run: ceil(tokens / rate), minimum 1.
 */
export function creditsForTokens(
  tokens: number,
  model = 'unknown',
  env: NodeJS.ProcessEnv = process.env,
): number {
  const rate = tokensPerCreditFor(model, env);
  const t = Number.isFinite(tokens) && tokens > 0 ? tokens : 0;
  return Math.max(1, Math.ceil(t / rate));
}

/**
 * Credits for a multi-model run. Each model's tokens are divided by ITS rate,
 * the fractional results are summed, then ceil'd once (minimum 1) — this avoids
 * over-charging tiny sub-agent calls that a per-model `min 1` would inflate.
 * Falls back to a single 'unknown' bucket when modelUsage is empty.
 */
export function creditsForModelUsage(
  modelUsage: Record<string, ModelUsageTokens> | null | undefined,
  fallbackTokens = 0,
  env: NodeJS.ProcessEnv = process.env,
): number {
  const entries = Object.entries(modelUsage ?? {});
  if (entries.length === 0) {
    return creditsForTokens(fallbackTokens, 'unknown', env);
  }
  let credits = 0;
  for (const [model, mu] of entries) {
    credits += tokensOf(mu) / tokensPerCreditFor(model, env);
  }
  return Math.max(1, Math.ceil(credits));
}
