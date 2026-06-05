import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const MANIFEST_DIR = '.oxygenie';
export const MANIFEST_PATH = path.join(MANIFEST_DIR, 'app.json');

const SUPPORTED_TYPES = new Set(['spa', 'static', 'server']);
const DEFAULT_STATIC_PORT = 4173;
const MAX_SCAN_DEPTH = 3;

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function isSafeRelativePath(value) {
  if (typeof value !== 'string') return false;
  if (value === '') return true;
  if (value.includes('\0')) return false;
  if (path.isAbsolute(value)) return false;
  const normalized = path.posix.normalize(value.split(path.sep).join('/'));
  if (normalized === '.' || normalized === '') return true;
  return !normalized.startsWith('../') && normalized !== '..';
}

function normalizeRelativePath(value, fallback = '') {
  if (typeof value !== 'string' || !isSafeRelativePath(value)) return fallback;
  const normalized = path.posix.normalize(value.split(path.sep).join('/'));
  return normalized === '.' ? '' : normalized;
}

function readString(value, fallback = '') {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function readPort(value, fallback = DEFAULT_STATIC_PORT) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1024 || n > 65535) return fallback;
  return n;
}

async function fileExists(filePath) {
  try {
    await readFile(filePath);
    return true;
  } catch {
    return false;
  }
}

async function findPackageJson(workspacePath, dir = '', depth = 0) {
  const candidate = path.join(workspacePath, dir, 'package.json');
  if (await fileExists(candidate)) return dir;
  if (depth >= MAX_SCAN_DEPTH) return null;

  let entries;
  try {
    entries = await readdir(path.join(workspacePath, dir), { withFileTypes: true });
  } catch {
    return null;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
    const child = dir ? path.join(dir, entry.name) : entry.name;
    const found = await findPackageJson(workspacePath, child, depth + 1);
    if (found !== null) return found;
  }
  return null;
}

async function readJson(filePath) {
  const raw = await readFile(filePath, 'utf8');
  return JSON.parse(raw);
}

async function detectPackageManager(appDir) {
  if (await fileExists(path.join(appDir, 'pnpm-lock.yaml'))) {
    return {
      installCommand: 'pnpm install --frozen-lockfile',
      buildCommand: 'pnpm build',
      devCommand: 'pnpm dev',
    };
  }
  if (await fileExists(path.join(appDir, 'package-lock.json'))) {
    return {
      installCommand: 'npm ci',
      buildCommand: 'npm run build',
      devCommand: 'npm run dev',
    };
  }
  if (await fileExists(path.join(appDir, 'yarn.lock'))) {
    return {
      installCommand: 'yarn install --frozen-lockfile',
      buildCommand: 'yarn build',
      devCommand: 'yarn dev',
    };
  }
  return {
    installCommand: 'npm install',
    buildCommand: 'npm run build',
    devCommand: 'npm run dev',
  };
}

function detectFramework(pkg) {
  const deps = {
    ...(isPlainObject(pkg.dependencies) ? pkg.dependencies : {}),
    ...(isPlainObject(pkg.devDependencies) ? pkg.devDependencies : {}),
  };
  if (deps.vite || deps['@vitejs/plugin-react']) return 'vite';
  if (deps['react-scripts']) return 'cra';
  if (deps.next) return 'next';
  if (deps.react) return 'react';
  return 'static';
}

function inferType(framework) {
  return framework === 'next' ? 'server' : 'spa';
}

function inferOutputDir(framework) {
  if (framework === 'cra') return 'build';
  return 'dist';
}

function parseScriptCommand(command) {
  const parts = String(command || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return null;
  const [bin, a, b] = parts;
  if (bin === 'npm' && a === 'run' && b) return b;
  if ((bin === 'pnpm' || bin === 'yarn') && a) return a;
  if (bin === 'bun' && a === 'run' && b) return b;
  if (bin === 'bun' && a) return a;
  return null;
}

function isAllowedInstallCommand(command) {
  const normalized = String(command || '').trim();
  return [
    'npm install',
    'npm ci',
    'pnpm install',
    'pnpm install --frozen-lockfile',
    'yarn install',
    'yarn install --frozen-lockfile',
    'bun install',
  ].includes(normalized);
}

function assertAllowedBuildCommand(command, pkg, field) {
  const scriptName = parseScriptCommand(command);
  const scripts = isPlainObject(pkg.scripts) ? pkg.scripts : {};
  if (!scriptName || typeof scripts[scriptName] !== 'string') {
    throw new Error(`${field} must call an existing package.json script`);
  }
}

export async function normalizeManifest(workspacePath, manifest) {
  if (!isPlainObject(manifest)) {
    throw new Error('Preview manifest must be an object');
  }

  const rootDir = normalizeRelativePath(manifest.rootDir ?? '', '');
  const appDir = path.join(workspacePath, rootDir);
  const pkg = await readJson(path.join(appDir, 'package.json'));
  const scripts = isPlainObject(pkg.scripts) ? pkg.scripts : {};
  const framework = readString(manifest.framework, detectFramework(pkg));
  const type = SUPPORTED_TYPES.has(String(manifest.type)) ? String(manifest.type) : inferType(framework);
  const defaults = await detectPackageManager(appDir);

  const installCommand = readString(manifest.installCommand, defaults.installCommand);
  if (!isAllowedInstallCommand(installCommand)) {
    throw new Error('installCommand must be a supported package-manager install command');
  }

  const buildCommand = readString(manifest.buildCommand, defaults.buildCommand);
  assertAllowedBuildCommand(buildCommand, pkg, 'buildCommand');

  const defaultDevCommand = typeof scripts.dev === 'string' ? defaults.devCommand : '';
  const devCommand = readString(manifest.devCommand, defaultDevCommand);
  if (devCommand) assertAllowedBuildCommand(devCommand, pkg, 'devCommand');

  const outputDir = normalizeRelativePath(manifest.outputDir ?? inferOutputDir(framework), inferOutputDir(framework));
  if (!outputDir) throw new Error('outputDir must be a workspace-relative path');

  const entryFiles = Array.isArray(manifest.entryFiles)
    ? manifest.entryFiles.filter(isSafeRelativePath).map((v) => path.posix.normalize(v.split(path.sep).join('/')))
    : ['package.json'];

  return {
    rootDir,
    title: readString(manifest.title ?? manifest.name, readString(pkg.name, 'App Preview')),
    name: readString(manifest.name, readString(manifest.title ?? pkg.name, 'App Preview')),
    type,
    framework,
    installCommand,
    buildCommand,
    devCommand,
    outputDir,
    port: readPort(manifest.port, DEFAULT_STATIC_PORT),
    entryFiles,
  };
}

async function detectManifest(workspacePath) {
  const rootDir = await findPackageJson(workspacePath);
  if (rootDir === null) {
    throw new Error('No package.json found in the session workspace');
  }

  const appDir = path.join(workspacePath, rootDir);
  const pkg = await readJson(path.join(appDir, 'package.json'));
  const framework = detectFramework(pkg);
  const defaults = await detectPackageManager(appDir);
  const scripts = isPlainObject(pkg.scripts) ? pkg.scripts : {};

  return normalizeManifest(workspacePath, {
    rootDir,
    title: readString(pkg.name, 'App Preview'),
    type: inferType(framework),
    framework,
    installCommand: defaults.installCommand,
    buildCommand: defaults.buildCommand,
    devCommand: typeof scripts.dev === 'string' ? defaults.devCommand : '',
    outputDir: inferOutputDir(framework),
    port: DEFAULT_STATIC_PORT,
    entryFiles: ['package.json'],
  });
}

export async function loadOrDetectManifest(workspacePath) {
  const manifestFile = path.join(workspacePath, MANIFEST_PATH);
  let manifest;
  let source = 'detected';

  try {
    manifest = await normalizeManifest(workspacePath, await readJson(manifestFile));
    source = 'file';
  } catch (error) {
    if (error && error.code !== 'ENOENT') {
      console.error('[Preview] Ignoring invalid .oxygenie/app.json:', error.message);
    }
    manifest = await detectManifest(workspacePath);
    await mkdir(path.dirname(manifestFile), { recursive: true });
    await writeFile(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  }

  return { manifest, source };
}
