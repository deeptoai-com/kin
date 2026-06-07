// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { buildWorkerEnv, serializeCustomHeaders } from '../../src/server/models/build-worker-env.js';

const baseMeta = {
  baseUrl: 'https://ark.cn-beijing.volces.com/api/coding',
  authStyle: 'bearer',
  tokenEnv: 'ARK_AUTH_TOKEN',
  model: 'glm-5.1',
};

describe('buildWorkerEnv', () => {
  it('routes base URL + bearer auth + model, and clears API_KEY', () => {
    const env = buildWorkerEnv(baseMeta, { ARK_AUTH_TOKEN: 'tok', ANTHROPIC_API_KEY: 'stale', PATH: '/usr/bin' });
    expect(env.ANTHROPIC_BASE_URL).toBe(baseMeta.baseUrl);
    expect(env.ANTHROPIC_API_URL).toBe(baseMeta.baseUrl);
    expect(env.ANTHROPIC_AUTH_TOKEN).toBe('tok');
    expect(env.ANTHROPIC_API_KEY).toBeUndefined(); // the stale one is cleared
    expect(env.ANTHROPIC_MODEL).toBe('glm-5.1');
    expect(env.PATH).toBe('/usr/bin'); // unrelated env preserved
  });

  it('x-api-key style sets API_KEY and clears AUTH_TOKEN', () => {
    const env = buildWorkerEnv(
      { ...baseMeta, authStyle: 'x-api-key', tokenEnv: 'ANTHROPIC_API_KEY' },
      { ANTHROPIC_API_KEY: 'k', ANTHROPIC_AUTH_TOKEN: 'stale' },
    );
    expect(env.ANTHROPIC_API_KEY).toBe('k');
    expect(env.ANTHROPIC_AUTH_TOKEN).toBeUndefined();
  });

  it('aliases fall back to the selected model (no cross-account sub-agents)', () => {
    const env = buildWorkerEnv(baseMeta, { ARK_AUTH_TOKEN: 'tok' });
    expect(env.ANTHROPIC_DEFAULT_OPUS_MODEL).toBe('glm-5.1');
    expect(env.ANTHROPIC_DEFAULT_SONNET_MODEL).toBe('glm-5.1');
    expect(env.ANTHROPIC_DEFAULT_HAIKU_MODEL).toBe('glm-5.1');
    expect(env.CLAUDE_CODE_SUBAGENT_MODEL).toBe('glm-5.1');
  });

  it('explicit aliases override the fallback', () => {
    const env = buildWorkerEnv(
      { ...baseMeta, aliasHaiku: 'doubao-seed-2.0-lite', aliasSubagent: 'glm-4.5' },
      { ARK_AUTH_TOKEN: 'tok' },
    );
    expect(env.ANTHROPIC_DEFAULT_HAIKU_MODEL).toBe('doubao-seed-2.0-lite');
    expect(env.CLAUDE_CODE_SUBAGENT_MODEL).toBe('glm-4.5');
    expect(env.ANTHROPIC_DEFAULT_OPUS_MODEL).toBe('glm-5.1'); // unspecified → fallback
  });

  it('serializes custom headers into ANTHROPIC_CUSTOM_HEADERS', () => {
    const env = buildWorkerEnv(
      { ...baseMeta, customHeaders: { 'x-route': 'a', 'x-tenant': 'b' } },
      { ARK_AUTH_TOKEN: 'tok' },
    );
    expect(env.ANTHROPIC_CUSTOM_HEADERS).toBe('x-route: a\nx-tenant: b');
  });

  it('throws when the token env var is missing/empty', () => {
    expect(() => buildWorkerEnv(baseMeta, {})).toThrow(/token env "ARK_AUTH_TOKEN" is not set/);
    expect(() => buildWorkerEnv(baseMeta, { ARK_AUTH_TOKEN: '   ' })).toThrow(/not set/);
  });

  it('throws on incomplete metadata', () => {
    expect(() => buildWorkerEnv({ baseUrl: 'x' }, { X: 'y' })).toThrow(/incomplete model metadata/);
  });

  it('serializeCustomHeaders joins Name: Value by newline', () => {
    expect(serializeCustomHeaders({ a: '1', b: '2' })).toBe('a: 1\nb: 2');
  });
});
