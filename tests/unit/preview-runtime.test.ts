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
