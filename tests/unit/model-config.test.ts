// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { parseModelSeed } from '../../src/server/models/model-config';

const validSeed = JSON.stringify({
  default: 'ark/glm-5.1',
  connections: [
    { id: 'ark-coding', label: 'ARK', baseUrl: 'https://ark.cn-beijing.volces.com/api/coding', authStyle: 'bearer', tokenEnv: 'ARK_AUTH_TOKEN', aliasHaiku: 'doubao-seed-2.0-lite' },
    { id: 'zhipu', label: 'Zhipu', baseUrl: 'https://open.bigmodel.cn/api/anthropic', authStyle: 'bearer', tokenEnv: 'ZHIPU_AUTH_TOKEN' },
  ],
  models: [
    { id: 'ark/glm-5.1', label: 'GLM 5.1', connection: 'ark-coding', model: 'glm-5.1', tags: ['general'] },
    { id: 'zhipu/glm-5.1', label: 'GLM 5.1 (Zhipu)', connection: 'zhipu', model: 'glm-5.1' },
  ],
});

describe('parseModelSeed', () => {
  it('returns null for unset/empty', () => {
    expect(parseModelSeed(undefined)).toBeNull();
    expect(parseModelSeed('')).toBeNull();
    expect(parseModelSeed('   ')).toBeNull();
  });

  it('parses a valid seed and applies defaults', () => {
    const cfg = parseModelSeed(validSeed)!;
    expect(cfg.connections).toHaveLength(2);
    expect(cfg.models).toHaveLength(2);
    expect(cfg.default).toBe('ark/glm-5.1');
    // defaults filled
    expect(cfg.connections[0].anthropicVersion).toBe('2023-06-01');
    expect(cfg.models[1].enabled).toBe(true);
    expect(cfg.models[1].isDefault).toBe(false);
    expect(cfg.models[1].tags).toEqual([]);
  });

  it('throws on invalid JSON', () => {
    expect(() => parseModelSeed('{not json')).toThrow(/not valid JSON/);
  });

  it('rejects a model referencing an unknown connection', () => {
    const bad = JSON.stringify({
      connections: [{ id: 'a', label: 'A', baseUrl: 'https://x.example.com', tokenEnv: 'T' }],
      models: [{ id: 'a/m', label: 'M', connection: 'nope', model: 'm' }],
    });
    expect(() => parseModelSeed(bad)).toThrow(/unknown connection/);
  });

  it('rejects duplicate connection / model ids', () => {
    const dupConn = JSON.stringify({
      connections: [
        { id: 'a', label: 'A', baseUrl: 'https://x.example.com', tokenEnv: 'T' },
        { id: 'a', label: 'A2', baseUrl: 'https://y.example.com', tokenEnv: 'T2' },
      ],
      models: [],
    });
    expect(() => parseModelSeed(dupConn)).toThrow(/duplicate connection id/);
  });

  it('rejects a default that is not a known model', () => {
    const bad = JSON.stringify({
      default: 'ghost',
      connections: [{ id: 'a', label: 'A', baseUrl: 'https://x.example.com', tokenEnv: 'T' }],
      models: [{ id: 'a/m', label: 'M', connection: 'a', model: 'm' }],
    });
    expect(() => parseModelSeed(bad)).toThrow(/not a known model id/);
  });

  it('rejects an invalid baseUrl', () => {
    const bad = JSON.stringify({
      connections: [{ id: 'a', label: 'A', baseUrl: 'not-a-url', tokenEnv: 'T' }],
      models: [],
    });
    expect(() => parseModelSeed(bad)).toThrow();
  });
});
