// @vitest-environment node
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { PreviewRuntime } from '../../src/preview/runtime.js';

async function tempWorkspace() {
  return mkdtemp(path.join(os.tmpdir(), 'oxy-preview-runtime-'));
}

describe('PreviewRuntime', () => {
  it('rejects server apps for static preview v1 before touching Docker', async () => {
    const workspace = await tempWorkspace();
    await writeFile(
      path.join(workspace, 'package.json'),
      JSON.stringify({
        name: 'next-app',
        scripts: { build: 'next build', dev: 'next dev' },
        dependencies: { next: '^15.0.0', react: '^19.0.0' },
      }),
    );

    const provider = {
      ensureSessionSandbox: async () => {
        throw new Error('should not touch Docker');
      },
      installDeps: async () => {
        throw new Error('should not touch Docker');
      },
      startPreview: async () => {
        throw new Error('should not touch Docker');
      },
      stopPreview: async () => undefined,
    };
    const runtime = new PreviewRuntime({ provider });

    const state = await runtime.startStaticPreview({
      userId: 'user-1',
      sessionId: 'session-1',
      workspacePath: workspace,
      sendState: undefined,
    });

    expect(state.status).toBe('error');
    expect(state.error).toMatch(/frontend SPA\/static apps only/);
  });
});

describe('PreviewRuntime sharing (Option A public-link toggle)', () => {
  function readyRuntime() {
    const stopped: string[] = [];
    const provider = {
      ensureSessionSandbox: async () => undefined,
      installDeps: async () => undefined,
      startPreview: async () => undefined,
      stopPreview: async ({ previewId }: { previewId: string }) => {
        stopped.push(previewId);
        return undefined;
      },
    };
    const runtime = new PreviewRuntime({ provider });
    runtime.active.set('p-1', {
      sessionId: 's-1',
      previewId: 'p-1',
      mode: 'static',
      host: 'p-1.example.com',
      status: 'ready',
      url: 'http://p-1.example.com/__oxy/preview/auth?t=tok',
      lastAccessAt: Date.now(),
    });
    return { runtime, stopped };
  }

  it('sharePreview flips a ready preview to public and returns a bare share URL', () => {
    const { runtime } = readyRuntime();
    const state = runtime.sharePreview('p-1');
    expect(state).not.toBeNull();
    expect(state?.public).toBe(true);
    expect(state?.shareUrl).toBe('http://p-1.example.com/');
    expect(runtime.getState('p-1')?.public).toBe(true);
  });

  it('sharePreview returns null for unknown or not-ready previews', () => {
    const { runtime } = readyRuntime();
    expect(runtime.sharePreview('nope')).toBeNull();
    runtime.active.get('p-1')!.status = 'building';
    expect(runtime.sharePreview('p-1')).toBeNull();
  });

  it('isPublicHost / getStateByHost resolve by host (case-insensitive)', () => {
    const { runtime } = readyRuntime();
    expect(runtime.isPublicHost('p-1.example.com')).toBe(false);
    runtime.sharePreview('p-1');
    expect(runtime.isPublicHost('P-1.EXAMPLE.COM')).toBe(true);
    expect(runtime.getStateByHost('p-1.example.com')?.previewId).toBe('p-1');
    expect(runtime.isPublicHost('other.example.com')).toBe(false);
  });

  it('reapIdlePreviews keeps shared (public) previews pinned alive', async () => {
    const { runtime, stopped } = readyRuntime();
    // Force the preview well past the idle window.
    runtime.active.get('p-1')!.lastAccessAt = Date.now() - runtime.idleTimeoutMs - 60_000;

    // Not shared yet → reaped.
    const reapedBefore = await runtime.reapIdlePreviews();
    expect(reapedBefore.map((s) => s.previewId)).toContain('p-1');
    expect(stopped).toContain('p-1');

    // Re-add as a shared/public preview → must survive the reaper.
    runtime.active.set('p-1', {
      sessionId: 's-1',
      previewId: 'p-1',
      mode: 'static',
      host: 'p-1.example.com',
      status: 'ready',
      lastAccessAt: Date.now() - runtime.idleTimeoutMs - 60_000,
      public: true,
    });
    const reapedAfter = await runtime.reapIdlePreviews();
    expect(reapedAfter.map((s) => s.previewId)).not.toContain('p-1');
    expect(runtime.getState('p-1')).not.toBeNull();
  });
});
