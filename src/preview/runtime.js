import crypto from 'node:crypto';
import { Semaphore } from '../server/concurrency/semaphore.js';
import { loadOrDetectManifest } from './manifest.js';

const DEFAULT_PREVIEW_CONTROLLER_URL = 'http://localhost:5055';
const DEFAULT_PREVIEW_BASE_DOMAIN = '127-0-0-1.sslip.io';
const DEFAULT_PREVIEW_PROTOCOL = 'http';
const DEFAULT_MAX_ACTIVE_PREVIEWS = 4;
const DEFAULT_IDLE_TIMEOUT_MS = 5 * 60 * 1000;

function cfgNumber(name, fallback) {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
}

function stablePreviewId(userId, sessionId, rootDir = '') {
  const digest = crypto
    .createHash('sha256')
    .update(`${userId}:${sessionId}:${rootDir}`)
    .digest('hex')
    .slice(0, 18);
  return `p-${digest}`;
}

function normalizeHostSegment(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

export function makePreviewHost(previewId) {
  const domain = process.env.PREVIEW_BASE_DOMAIN || DEFAULT_PREVIEW_BASE_DOMAIN;
  const template = process.env.PREVIEW_HOST_TEMPLATE;
  if (template) {
    return template.replaceAll('{previewId}', normalizeHostSegment(previewId));
  }
  return `${normalizeHostSegment(previewId)}.${domain}`;
}

async function readJsonResponse(response) {
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { error: text };
  }
  if (!response.ok) {
    throw new Error(body?.error || body?.message || `Preview controller returned ${response.status}`);
  }
  return body;
}

export class DockerPreviewProvider {
  constructor(options = {}) {
    this.controllerUrl = (options.controllerUrl || process.env.PREVIEW_CONTROLLER_URL || DEFAULT_PREVIEW_CONTROLLER_URL).replace(/\/+$/, '');
  }

  async request(path, body) {
    const response = await fetch(`${this.controllerUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return readJsonResponse(response);
  }

  async ensureSessionSandbox(input) {
    return this.request('/v1/sandbox/ensure', input);
  }

  async installDeps(input) {
    return this.request('/v1/deps/install', input);
  }

  async startPreview(input) {
    return this.request('/v1/preview/start', input);
  }

  async stopPreview(input) {
    return this.request('/v1/preview/stop', input);
  }

  async statusPreview(input) {
    return this.request('/v1/preview/status', input);
  }
}

export class PreviewRuntime {
  constructor({ provider, auth } = {}) {
    this.provider = provider || new DockerPreviewProvider();
    this.auth = auth;
    this.maxActive = cfgNumber('MAX_ACTIVE_PREVIEWS', DEFAULT_MAX_ACTIVE_PREVIEWS);
    this.idleTimeoutMs = cfgNumber('PREVIEW_IDLE_TIMEOUT_MS', DEFAULT_IDLE_TIMEOUT_MS);
    this.protocol = process.env.PREVIEW_PROTOCOL || DEFAULT_PREVIEW_PROTOCOL;
    this.semaphore = new Semaphore(this.maxActive);
    this.active = new Map();
    this.inFlight = new Map();
  }

  getPreviewUrl(previewId, token) {
    const state = this.active.get(previewId);
    const host = state?.host || makePreviewHost(previewId);
    return `${this.protocol}://${host}/__oxy/preview/auth?t=${encodeURIComponent(token)}`;
  }

  getState(previewId) {
    return this.active.get(previewId) || null;
  }

  touchPreview(previewId) {
    const state = this.active.get(previewId);
    if (!state) return null;
    state.lastAccessAt = Date.now();
    return state;
  }

  async stopPreview(previewId, reason = 'stopped') {
    const state = this.active.get(previewId);
    if (!state) return null;
    await this.provider.stopPreview({ previewId });
    this.active.delete(previewId);
    this.semaphore.release();
    return {
      sessionId: state.sessionId,
      previewId,
      mode: state.mode,
      status: 'stopped',
      error: reason === 'stopped' ? undefined : reason,
      manifest: state.manifest,
    };
  }

  async reapIdlePreviews(sendState) {
    const now = Date.now();
    const stopped = [];
    for (const [previewId, state] of this.active.entries()) {
      if (state.status !== 'ready') continue;
      if (now - state.lastAccessAt <= this.idleTimeoutMs) continue;
      try {
        const next = await this.stopPreview(previewId, 'idle timeout');
        if (next) {
          stopped.push(next);
          sendState?.(next);
        }
      } catch (error) {
        console.error('[Preview] Idle reap failed:', previewId, error);
      }
    }
    return stopped;
  }

  async startStaticPreview({ userId, sessionId, workspacePath, sendState }) {
    if (!userId || !sessionId || !workspacePath) {
      throw new Error('Missing preview start context');
    }
    if (this.inFlight.has(sessionId)) {
      return this.inFlight.get(sessionId);
    }

    const task = this.#startStaticPreview({ userId, sessionId, workspacePath, sendState })
      .finally(() => this.inFlight.delete(sessionId));
    this.inFlight.set(sessionId, task);
    return task;
  }

  async #startStaticPreview({ userId, sessionId, workspacePath, sendState }) {
    const status = (state) => {
      sendState?.(state);
      return state;
    };

    let manifest;
    let previewId;
    let host;
    let acquired = false;

    try {
      status({
        sessionId,
        previewId: stablePreviewId(userId, sessionId),
        mode: 'static',
        status: 'detecting',
      });

      const detected = await loadOrDetectManifest(workspacePath);
      manifest = detected.manifest;
      previewId = stablePreviewId(userId, sessionId, manifest.rootDir);
      host = makePreviewHost(previewId);

      if (manifest.type === 'server') {
        return status({
          sessionId,
          previewId,
          mode: 'static',
          status: 'error',
          error: 'Static preview v1 supports frontend SPA/static apps only. Use live preview in a later version for server apps.',
          manifest,
        });
      }

      if (this.active.has(previewId)) {
        const existing = this.active.get(previewId);
        existing.lastAccessAt = Date.now();
        if (existing.status !== 'ready') {
          return status({
            sessionId,
            previewId,
            mode: 'static',
            status: existing.status,
            manifest,
          });
        }
        // Cached as 'ready' — but the sandbox container may have been removed since
        // (redeploy, idle-reap, crash) while this in-memory entry lingered. Returning
        // the stale URL would 404. Verify liveness with the controller first; if the
        // container is gone, clean up and fall through to a fresh (re)build.
        let alive = false;
        try {
          const st = await this.provider.statusPreview({ previewId });
          alive = !!st?.running;
        } catch {
          alive = false;
        }
        if (alive) {
          const token = this.auth?.issueBootstrapToken({
            previewId,
            sessionId,
            userId,
            host,
          });
          return status({
            sessionId,
            previewId,
            mode: 'static',
            status: 'ready',
            url: token ? this.getPreviewUrl(previewId, token) : existing.url,
            manifest,
          });
        }
        await this.stopPreview(previewId).catch(() => {});
      }

      if (this.semaphore.activeCount >= this.semaphore.max) {
        return status({
          sessionId,
          previewId,
          mode: 'static',
          status: 'error',
          error: `Preview capacity reached (${this.semaphore.max} active previews). Try again after another preview goes idle.`,
          manifest,
        });
      }
      await this.semaphore.acquire();
      acquired = true;

      const baseState = {
        sessionId,
        previewId,
        mode: 'static',
        host,
        manifest,
        workspacePath,
        lastAccessAt: Date.now(),
        status: 'installing',
      };
      this.active.set(previewId, baseState);
      status({ sessionId, previewId, mode: 'static', status: 'installing', manifest });

      await this.provider.ensureSessionSandbox({
        previewId,
        sessionId,
        userId,
        host,
        workspacePath,
        manifest,
      });
      await this.provider.installDeps({
        previewId,
        workspacePath,
        manifest,
      });

      baseState.status = 'building';
      status({ sessionId, previewId, mode: 'static', status: 'building', manifest });
      await this.provider.startPreview({
        previewId,
        workspacePath,
        manifest,
        mode: 'static',
      });

      const token = this.auth?.issueBootstrapToken({
        previewId,
        sessionId,
        userId,
        host,
      });
      const url = token ? this.getPreviewUrl(previewId, token) : `${this.protocol}://${host}/`;
      baseState.status = 'ready';
      baseState.url = url;
      baseState.lastAccessAt = Date.now();

      return status({
        sessionId,
        previewId,
        mode: 'static',
        status: 'ready',
        url,
        manifest,
      });
    } catch (error) {
      if (previewId) {
        this.active.delete(previewId);
        try {
          await this.provider.stopPreview({ previewId });
        } catch (stopError) {
          console.error('[Preview] Failed to clean up failed preview:', stopError?.message || stopError);
        }
      }
      if (acquired) this.semaphore.release();
      return status({
        sessionId,
        previewId: previewId || stablePreviewId(userId, sessionId),
        mode: 'static',
        status: 'error',
        error: error instanceof Error ? error.message : String(error),
        ...(manifest && { manifest }),
      });
    }
  }
}
