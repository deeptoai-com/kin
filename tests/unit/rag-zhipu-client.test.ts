// @vitest-environment node
/**
 * Unit tests for the Zhipu embedding/rerank client (RAG R0, final spec D1).
 *
 * Network is mocked — these pin the request-shaping contracts the ingest pipeline
 * relies on: ≤64-per-request batching with order preserved, dim validation, retry on
 * 429/5xx but not on 4xx, and rerank result ordering.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  EMBED_DIM,
  EMBED_MAX_BATCH,
  embedTexts,
  rerankDocuments,
  splitBatches,
} from '../../src/server/rag/zhipu';

describe('splitBatches', () => {
  it('splits 130 items into 64/64/2 preserving order', () => {
    const items = Array.from({ length: 130 }, (_, i) => i);
    const batches = splitBatches(items);
    expect(batches.map((b) => b.length)).toEqual([64, 64, 2]);
    expect(batches.flat()).toEqual(items);
  });

  it('returns [] for empty input and rejects size < 1', () => {
    expect(splitBatches([])).toEqual([]);
    expect(() => splitBatches([1], 0)).toThrow();
  });
});

function okEmbeddings(count: number, dim = EMBED_DIM) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      data: Array.from({ length: count }, (_, index) => ({
        index,
        embedding: Array.from({ length: dim }, () => 0.1),
      })),
    }),
    text: async () => '',
  } as unknown as Response;
}

function httpError(status: number) {
  return {
    ok: false,
    status,
    json: async () => ({}),
    text: async () => `status ${status}`,
  } as unknown as Response;
}

describe('embedTexts', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    process.env.ZHIPU_API_KEY = 'test-key';
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends one request per 64-batch and concatenates results in order', async () => {
    const texts = Array.from({ length: EMBED_MAX_BATCH + 3 }, (_, i) => `t${i}`);
    fetchMock
      .mockResolvedValueOnce(okEmbeddings(EMBED_MAX_BATCH))
      .mockResolvedValueOnce(okEmbeddings(3));

    const vectors = await embedTexts(texts);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const firstBody = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(firstBody.model).toBe('embedding-3');
    expect(firstBody.dimensions).toBe(EMBED_DIM);
    expect(firstBody.input).toHaveLength(EMBED_MAX_BATCH);
    expect(vectors).toHaveLength(texts.length);
    expect(vectors[0]).toHaveLength(EMBED_DIM);
  });

  it('retries on 429 then succeeds', async () => {
    fetchMock.mockResolvedValueOnce(httpError(429)).mockResolvedValueOnce(okEmbeddings(1));
    const vectors = await embedTexts(['hello'], { backoffMs: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(vectors).toHaveLength(1);
  });

  it('does NOT retry on 400 (non-retryable client error)', async () => {
    fetchMock.mockResolvedValue(httpError(400));
    await expect(embedTexts(['hello'], { backoffMs: 1 })).rejects.toThrow('HTTP 400');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('rejects a wrong-dimension response (provider drift guard)', async () => {
    fetchMock.mockResolvedValueOnce(okEmbeddings(1, 2048));
    await expect(embedTexts(['hello'])).rejects.toThrow('1024-dim');
  });

  it('throws a clear error when ZHIPU_API_KEY is missing', async () => {
    delete process.env.ZHIPU_API_KEY;
    await expect(embedTexts(['hello'])).rejects.toThrow('ZHIPU_API_KEY');
  });
});

describe('rerankDocuments', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    process.env.ZHIPU_API_KEY = 'test-key';
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns results sorted by relevance, highest first', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        results: [
          { index: 2, relevance_score: 0.4 },
          { index: 0, relevance_score: 0.9 },
        ],
      }),
      text: async () => '',
    } as unknown as Response);

    const results = await rerankDocuments('q', ['a', 'b', 'c'], { topN: 2 });
    expect(results.map((r) => r.index)).toEqual([0, 2]);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.model).toBe('rerank');
    expect(body.top_n).toBe(2);
  });

  it('short-circuits on empty documents without a network call', async () => {
    const results = await rerankDocuments('q', []);
    expect(results).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
