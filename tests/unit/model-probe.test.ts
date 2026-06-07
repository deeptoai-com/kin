// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { classifyProbeStatus, probeModelMeta, type ProbeInput } from '../../src/server/models/probe';

const meta: ProbeInput = {
  baseUrl: 'https://ark.cn-beijing.volces.com/api/coding',
  authStyle: 'bearer',
  tokenEnv: 'ARK_AUTH_TOKEN',
  model: 'glm-5.1',
};
const env = { ARK_AUTH_TOKEN: 'tok' } as unknown as NodeJS.ProcessEnv;

function fetchReturning(status: number): typeof fetch {
  return (async () => new Response(null, { status })) as unknown as typeof fetch;
}

describe('classifyProbeStatus', () => {
  it('maps status codes to verdicts', () => {
    expect(classifyProbeStatus(200, 5)).toMatchObject({ health: 'healthy', probeError: null });
    expect(classifyProbeStatus(429, 5)).toMatchObject({ health: 'healthy', probeError: null }); // throttled but usable
    expect(classifyProbeStatus(401, 5)).toMatchObject({ health: 'unhealthy', probeError: 'auth' });
    expect(classifyProbeStatus(403, 5)).toMatchObject({ health: 'unhealthy', probeError: 'auth' });
    expect(classifyProbeStatus(404, 5)).toMatchObject({ health: 'unhealthy', probeError: 'model' });
    expect(classifyProbeStatus(400, 5)).toMatchObject({ health: 'unhealthy', probeError: 'model' });
    expect(classifyProbeStatus(500, 5)).toMatchObject({ health: 'unhealthy', probeError: 'http_5xx' });
    expect(classifyProbeStatus(418, 5)).toMatchObject({ health: 'unhealthy', probeError: 'http_418' });
  });
});

describe('probeModelMeta', () => {
  it('healthy on 200', async () => {
    const r = await probeModelMeta(meta, { env, fetchImpl: fetchReturning(200) });
    expect(r.health).toBe('healthy');
    expect(r.probeError).toBeNull();
  });

  it('auth-unhealthy when the token env is missing (no fetch attempted)', async () => {
    let called = false;
    const spyFetch = (async () => {
      called = true;
      return new Response(null, { status: 200 });
    }) as unknown as typeof fetch;
    const r = await probeModelMeta(meta, { env: {} as NodeJS.ProcessEnv, fetchImpl: spyFetch });
    expect(r).toMatchObject({ health: 'unhealthy', probeError: 'auth' });
    expect(called).toBe(false);
  });

  it('classifies a 401 from the gateway as auth', async () => {
    const r = await probeModelMeta(meta, { env, fetchImpl: fetchReturning(401) });
    expect(r).toMatchObject({ health: 'unhealthy', probeError: 'auth' });
  });

  it('network error → network', async () => {
    const boom = (async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof fetch;
    const r = await probeModelMeta(meta, { env, fetchImpl: boom });
    expect(r.probeError).toBe('network');
  });

  it('abort → timeout', async () => {
    const aborting = (async () => {
      const e = new Error('aborted');
      e.name = 'AbortError';
      throw e;
    }) as unknown as typeof fetch;
    const r = await probeModelMeta(meta, { env, fetchImpl: aborting });
    expect(r.probeError).toBe('timeout');
  });

  it('sends bearer auth + the messages body to {baseUrl}/v1/messages', async () => {
    let seenUrl = '';
    let seenInit: RequestInit | undefined;
    const capture = (async (url: string, init: RequestInit) => {
      seenUrl = url;
      seenInit = init;
      return new Response(null, { status: 200 });
    }) as unknown as typeof fetch;
    await probeModelMeta(meta, { env, fetchImpl: capture });
    expect(seenUrl).toBe('https://ark.cn-beijing.volces.com/api/coding/v1/messages');
    const headers = seenInit?.headers as Record<string, string>;
    expect(headers.authorization).toBe('Bearer tok');
    expect(headers['anthropic-version']).toBe('2023-06-01');
    expect(JSON.parse(seenInit?.body as string)).toMatchObject({ model: 'glm-5.1', max_tokens: 1 });
  });

  it('x-api-key auth uses the x-api-key header', async () => {
    let headers: Record<string, string> = {};
    const capture = (async (_url: string, init: RequestInit) => {
      headers = init.headers as Record<string, string>;
      return new Response(null, { status: 200 });
    }) as unknown as typeof fetch;
    await probeModelMeta(
      { ...meta, authStyle: 'x-api-key', tokenEnv: 'NATIVE_KEY' },
      { env: { NATIVE_KEY: 'k' } as unknown as NodeJS.ProcessEnv, fetchImpl: capture },
    );
    expect(headers['x-api-key']).toBe('k');
    expect(headers.authorization).toBeUndefined();
  });
});
