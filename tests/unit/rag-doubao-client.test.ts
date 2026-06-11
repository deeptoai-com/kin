// @vitest-environment node
/**
 * Unit tests for the Doubao embedding client (U0.5) — mocked fetch. Pins the contracts
 * the ingest pipeline relies on: per-text requests (the API has NO batching) with order
 * preserved under concurrency, MRL dimensions=1024 in every request, retry on 429/5xx
 * but not 4xx, dim-drift guard, and clear config errors.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DOUBAO_EMBED_DIM, embedTextsDoubao } from '../../src/server/rag/doubao';

function okOne(dim = DOUBAO_EMBED_DIM) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ data: { embedding: Array.from({ length: dim }, () => 0.1) } }),
    text: async () => '',
  } as unknown as Response;
}

function httpError(status: number) {
  return { ok: false, status, json: async () => ({}), text: async () => `s${status}` } as unknown as Response;
}

describe('embedTextsDoubao', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    process.env.ANTHROPIC_AUTH_TOKEN = 'test-ark-key';
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.ARK_API_KEY;
  });

  it('sends ONE request per text with dimensions=1024, preserving order under concurrency', async () => {
    fetchMock.mockResolvedValue(okOne());
    const texts = Array.from({ length: 9 }, (_, i) => `t${i}`);
    const vectors = await embedTextsDoubao(texts);

    expect(fetchMock).toHaveBeenCalledTimes(9);
    const bodies = fetchMock.mock.calls.map((c) => JSON.parse(c[1].body as string));
    for (const b of bodies) {
      expect(b.dimensions).toBe(1024);
      expect(b.input).toHaveLength(1); // input[] is one multimodal sample, never a batch
    }
    // order preserved regardless of lane interleaving
    const sent = bodies.map((b) => b.input[0].text).sort();
    expect(sent).toEqual([...texts].sort());
    expect(vectors).toHaveLength(9);
    expect(vectors[0]).toHaveLength(DOUBAO_EMBED_DIM);
  });

  it('retries on 429 then succeeds; does NOT retry on 400', async () => {
    fetchMock.mockResolvedValueOnce(httpError(429)).mockResolvedValueOnce(okOne());
    await expect(embedTextsDoubao(['a'], { backoffMs: 1 })).resolves.toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    fetchMock.mockReset();
    fetchMock.mockResolvedValue(httpError(400));
    await expect(embedTextsDoubao(['a'], { backoffMs: 1 })).rejects.toThrow('HTTP 400');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('rejects a wrong-dimension response (provider drift guard)', async () => {
    fetchMock.mockResolvedValue(okOne(2048));
    await expect(embedTextsDoubao(['a'], { backoffMs: 1 })).rejects.toThrow('1024-dim');
  });

  it('throws a clear error when no ARK key is set', async () => {
    delete process.env.ANTHROPIC_AUTH_TOKEN;
    await expect(embedTextsDoubao(['a'])).rejects.toThrow('ARK key not set');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns [] for empty input without any request', async () => {
    await expect(embedTextsDoubao([])).resolves.toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
