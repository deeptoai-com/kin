/**
 * GHCR (GitHub Container Registry) anonymous manifest/label query — online auto-update (Kin M3).
 *
 * Public GHCR packages are anonymously pullable, so detection needs NO PAT. We:
 *   1. fetch an anonymous bearer token for `repository:<repo>:pull`,
 *   2. read the tag's manifest digest (Docker-Content-Digest),
 *   3. (best-effort) resolve the image's git revision label
 *      `org.opencontainers.image.revision` so we can compare against the running BUILD_SHA.
 *
 * No external deps — uses global fetch (Node >=18; project pins node:24). Network/HTTP errors
 * propagate to the caller (the worker job records them into update_status.error).
 *
 * Spec: docs/5. 研发实施/.../2026-06-14-kin-在线自动更新-设计与实施规格.md §4.1(c).
 * NOTE: until M0 publishes images to ghcr.io/deeptoai-com/kin/app this returns nothing useful;
 * the parsing/HTTP logic is unit-tested with a mocked fetch (tests/unit/updater-registry.test.ts).
 */

const GHCR_HOST = 'https://ghcr.io';

// Accept both OCI and Docker media types, index (multi-arch) and single manifests.
const MANIFEST_ACCEPT = [
  'application/vnd.oci.image.index.v1+json',
  'application/vnd.docker.distribution.manifest.list.v2+json',
  'application/vnd.oci.image.manifest.v1+json',
  'application/vnd.docker.distribution.manifest.v2+json',
].join(', ');

export interface GhcrLatest {
  /** Docker-Content-Digest of the requested tag (the index/manifest digest). */
  digest: string | null;
  /** org.opencontainers.image.revision label (git sha) of the latest image, best-effort. */
  revision: string | null;
}

/**
 * Parse an image ref like `ghcr.io/owner/repo/app:latest` (host + tag both optional)
 * into `{ repository, tag }`. A pinned `@sha256:...` digest is ignored for tag queries.
 */
export function parseGhcrImage(image: string, fallbackTag = 'latest'): { repository: string; tag: string } {
  let ref = image.trim();
  if (ref.startsWith('ghcr.io/')) ref = ref.slice('ghcr.io/'.length);

  // Drop a pinned digest (`repo@sha256:...`) — we query by tag.
  const at = ref.indexOf('@');
  if (at !== -1) ref = ref.slice(0, at);

  // Split a trailing `:tag` (a colon whose remainder has no `/`, so we don't mistake a
  // port in a host that slipped through).
  let tag = fallbackTag;
  const colon = ref.lastIndexOf(':');
  if (colon !== -1 && !ref.slice(colon + 1).includes('/')) {
    tag = ref.slice(colon + 1) || fallbackTag;
    ref = ref.slice(0, colon);
  }
  return { repository: ref, tag };
}

async function anonymousToken(repository: string): Promise<string> {
  const url = `${GHCR_HOST}/token?service=ghcr.io&scope=repository:${repository}:pull`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GHCR token request failed: ${res.status}`);
  const body = (await res.json()) as { token?: string };
  if (!body.token) throw new Error('GHCR token response missing token');
  return body.token;
}

/**
 * Fetch the latest digest + git revision label for a GHCR image tag.
 * `revision` is best-effort: any failure to resolve the config blob label yields null
 * rather than throwing, so a missing label (e.g. pre-M0 images) degrades gracefully.
 */
export async function queryGhcrLatest(image: string): Promise<GhcrLatest> {
  const { repository, tag } = parseGhcrImage(image);
  const token = await anonymousToken(repository);
  const headers = { Authorization: `Bearer ${token}`, Accept: MANIFEST_ACCEPT };

  const manRes = await fetch(`${GHCR_HOST}/v2/${repository}/manifests/${encodeURIComponent(tag)}`, { headers });
  if (!manRes.ok) throw new Error(`GHCR manifest request failed: ${manRes.status}`);
  const digest = manRes.headers.get('docker-content-digest');
  const manifest = (await manRes.json()) as ManifestLike;

  let revision: string | null = null;
  try {
    revision = await readRevisionLabel(repository, manifest, headers);
  } catch {
    revision = null;
  }
  return { digest, revision };
}

interface ManifestLike {
  manifests?: Array<{ digest?: string; platform?: { architecture?: string; os?: string } }>;
  config?: { digest?: string };
}

/**
 * Resolve `org.opencontainers.image.revision` from an image's config blob.
 * For a multi-arch index, pick the linux/amd64 child (falling back to the first child),
 * fetch its manifest, then its config blob, and read the label.
 */
async function readRevisionLabel(
  repository: string,
  manifest: ManifestLike,
  headers: Record<string, string>,
): Promise<string | null> {
  let imageManifest = manifest;

  const children = manifest?.manifests;
  if (Array.isArray(children) && children.length > 0) {
    const chosen =
      children.find((m) => m?.platform?.architecture === 'amd64' && m?.platform?.os === 'linux') ?? children[0];
    if (!chosen?.digest) return null;
    const childRes = await fetch(`${GHCR_HOST}/v2/${repository}/manifests/${chosen.digest}`, { headers });
    if (!childRes.ok) return null;
    imageManifest = (await childRes.json()) as ManifestLike;
  }

  const configDigest = imageManifest?.config?.digest;
  if (!configDigest) return null;
  const cfgRes = await fetch(`${GHCR_HOST}/v2/${repository}/blobs/${configDigest}`, { headers });
  if (!cfgRes.ok) return null;
  const config = (await cfgRes.json()) as {
    config?: { Labels?: Record<string, string> };
    container_config?: { Labels?: Record<string, string> };
  };
  const labels = config?.config?.Labels ?? config?.container_config?.Labels ?? null;
  const rev = labels?.['org.opencontainers.image.revision'];
  return typeof rev === 'string' && rev.length > 0 ? rev : null;
}
