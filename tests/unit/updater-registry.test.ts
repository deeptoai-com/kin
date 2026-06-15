/**
 * Unit tests for the GHCR registry query (online auto-update detection).
 * Pure: global fetch is stubbed; no network. Covers image-ref parsing and the
 * token -> manifest(index) -> child manifest -> config-blob label walk.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { parseGhcrImage, queryGhcrLatest } from '~/server/updater/registry';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('parseGhcrImage', () => {
  it('splits host, repository and tag', () => {
    expect(parseGhcrImage('ghcr.io/deeptoai-com/kin/app:latest')).toEqual({
      repository: 'deeptoai-com/kin/app',
      tag: 'latest',
    });
  });
  it('defaults the tag to latest when omitted', () => {
    expect(parseGhcrImage('ghcr.io/deeptoai-com/kin/app')).toEqual({
      repository: 'deeptoai-com/kin/app',
      tag: 'latest',
    });
  });
  it('honours an explicit tag', () => {
    expect(parseGhcrImage('ghcr.io/owner/repo/app:v1.2.3')).toEqual({
      repository: 'owner/repo/app',
      tag: 'v1.2.3',
    });
  });
  it('ignores a pinned digest', () => {
    expect(parseGhcrImage('ghcr.io/owner/repo/app@sha256:abc')).toEqual({
      repository: 'owner/repo/app',
      tag: 'latest',
    });
  });
});

function jsonResponse(body: unknown, headers: Record<string, string> = {}) {
  return {
    ok: true,
    status: 200,
    headers: { get: (k: string) => headers[k.toLowerCase()] ?? null },
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

describe('queryGhcrLatest', () => {
  it('returns digest + revision via the multi-arch index walk', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('/token')) return jsonResponse({ token: 'tok' });
      if (url.endsWith('/manifests/latest')) {
        return jsonResponse(
          { manifests: [{ digest: 'sha256:child', platform: { architecture: 'amd64', os: 'linux' } }] },
          { 'docker-content-digest': 'sha256:INDEX' },
        );
      }
      if (url.endsWith('/manifests/sha256:child')) {
        return jsonResponse({ config: { digest: 'sha256:cfg' } });
      }
      if (url.endsWith('/blobs/sha256:cfg')) {
        return jsonResponse({ config: { Labels: { 'org.opencontainers.image.revision': 'deadbeef' } } });
      }
      throw new Error(`unexpected url ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await queryGhcrLatest('ghcr.io/deeptoai-com/kin/app:latest');
    expect(result).toEqual({ digest: 'sha256:INDEX', revision: 'deadbeef' });
  });

  it('handles a single (non-index) manifest with a top-level config', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('/token')) return jsonResponse({ token: 'tok' });
      if (url.endsWith('/manifests/latest')) {
        return jsonResponse({ config: { digest: 'sha256:cfg' } }, { 'docker-content-digest': 'sha256:SINGLE' });
      }
      if (url.endsWith('/blobs/sha256:cfg')) {
        return jsonResponse({ config: { Labels: { 'org.opencontainers.image.revision': 'cafe' } } });
      }
      throw new Error(`unexpected url ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await queryGhcrLatest('ghcr.io/owner/repo/app');
    expect(result).toEqual({ digest: 'sha256:SINGLE', revision: 'cafe' });
  });

  it('degrades revision to null when the label is absent (e.g. pre-M0 images)', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('/token')) return jsonResponse({ token: 'tok' });
      if (url.endsWith('/manifests/latest')) {
        return jsonResponse({ config: { digest: 'sha256:cfg' } }, { 'docker-content-digest': 'sha256:D' });
      }
      if (url.endsWith('/blobs/sha256:cfg')) return jsonResponse({ config: { Labels: {} } });
      throw new Error(`unexpected url ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await queryGhcrLatest('ghcr.io/owner/repo/app');
    expect(result).toEqual({ digest: 'sha256:D', revision: null });
  });
});
