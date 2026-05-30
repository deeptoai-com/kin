/**
 * Unit tests for P2-3 credit-rate math + the metering flag.
 *
 * Rates are uncalibrated placeholders; these tests pin the *formula*, not any
 * particular price. The default placeholder rate is 10_000 tokens/credit.
 */
import { describe, it, expect } from 'vitest';
import {
  creditsForTokens,
  creditsForModelUsage,
  tokensPerCreditFor,
  isMeteringEnabled,
} from '~/config/credit-rates';

describe('isMeteringEnabled', () => {
  it('is OFF by default and only true for the exact "true" string', () => {
    expect(isMeteringEnabled({})).toBe(false);
    expect(isMeteringEnabled({ BILLING_METERING_ENABLED: 'false' })).toBe(false);
    expect(isMeteringEnabled({ BILLING_METERING_ENABLED: '1' })).toBe(false);
    expect(isMeteringEnabled({ BILLING_METERING_ENABLED: 'true' })).toBe(true);
  });
});

describe('tokensPerCreditFor', () => {
  it('uses the placeholder default when no env override', () => {
    expect(tokensPerCreditFor('ark-code-latest', {})).toBe(10_000);
  });
  it('prefers a per-model override over the global override', () => {
    const env = {
      CREDIT_TOKENS_PER_CREDIT: '5000',
      'CREDIT_TOKENS_PER_CREDIT__ark-code-latest': '20000',
    } as NodeJS.ProcessEnv;
    expect(tokensPerCreditFor('ark-code-latest', env)).toBe(20_000);
    expect(tokensPerCreditFor('other-model', env)).toBe(5000);
  });
  it('ignores invalid/non-positive values and falls through', () => {
    expect(tokensPerCreditFor('m', { CREDIT_TOKENS_PER_CREDIT: '0' })).toBe(10_000);
    expect(tokensPerCreditFor('m', { CREDIT_TOKENS_PER_CREDIT: 'abc' })).toBe(10_000);
  });
});

describe('creditsForTokens', () => {
  it('is ceil(tokens / rate) with a floor of 1', () => {
    expect(creditsForTokens(0, 'm', {})).toBe(1); // min 1
    expect(creditsForTokens(1, 'm', {})).toBe(1);
    expect(creditsForTokens(10_000, 'm', {})).toBe(1);
    expect(creditsForTokens(10_001, 'm', {})).toBe(2);
    expect(creditsForTokens(25_000, 'm', {})).toBe(3);
  });
});

describe('creditsForModelUsage', () => {
  it('sums per-model fractional credits then ceils once (min 1)', () => {
    // real Ark run: 14071 + 1480 = 15551 tokens at 10k rate -> ceil(1.5551) = 2
    const credits = creditsForModelUsage(
      {
        'claude-haiku-4-5-20251001': { inputTokens: 1378, outputTokens: 102 },
        'ark-code-latest': { inputTokens: 14067, outputTokens: 4 },
      },
      0,
      {},
    );
    expect(credits).toBe(2);
  });

  it('honours per-model rates when summing', () => {
    const env = {
      'CREDIT_TOKENS_PER_CREDIT__cheap': '100000',
      'CREDIT_TOKENS_PER_CREDIT__pricey': '1000',
    } as NodeJS.ProcessEnv;
    // cheap: 50000/100000 = 0.5 ; pricey: 2000/1000 = 2 ; sum 2.5 -> ceil 3
    const credits = creditsForModelUsage(
      {
        cheap: { inputTokens: 50000, outputTokens: 0 },
        pricey: { inputTokens: 2000, outputTokens: 0 },
      },
      0,
      env,
    );
    expect(credits).toBe(3);
  });

  it('falls back to top-level tokens when modelUsage is empty', () => {
    expect(creditsForModelUsage({}, 25_000, {})).toBe(3);
    expect(creditsForModelUsage(null, 0, {})).toBe(1);
  });
});
