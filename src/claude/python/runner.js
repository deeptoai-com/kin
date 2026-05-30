/**
 * Python Runner
 *
 * Executes Python code using a temp file and returns stdout/stderr.
 * Avoids shell execution to reduce attack surface.
 */

import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { getExecutionRuntime } from '../execution/index.js';

const DEFAULT_TIMEOUT_MS = Number(process.env.PYTHON_RUNNER_TIMEOUT_MS) || 10_000;
const DEFAULT_MAX_OUTPUT_BYTES = Number(process.env.PYTHON_RUNNER_MAX_OUTPUT_BYTES) || 512_000;
const DEFAULT_MAX_CODE_BYTES = Number(process.env.PYTHON_RUNNER_MAX_CODE_BYTES) || 200_000;
const MAX_TRACKED_FILES = 2000;
const IGNORED_DIRS = new Set(['__python__', '.claude', '.git', 'node_modules', '.output', 'dist', 'build']);

async function listWorkspaceFiles(rootDir) {
  const files = new Map();
  const stack = [{ dir: rootDir, relative: '' }];
  let truncated = false;

  while (stack.length > 0) {
    const { dir, relative } = stack.pop();
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (entry.name.startsWith('.')) {
        if (entry.isDirectory() && entry.name !== '.claude') {
          continue;
        }
      }

      const nextRelative = relative ? `${relative}/${entry.name}` : entry.name;
      const nextFull = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        if (IGNORED_DIRS.has(entry.name)) continue;
        stack.push({ dir: nextFull, relative: nextRelative });
        continue;
      }

      if (!entry.isFile()) continue;

      try {
        const stats = await fs.stat(nextFull);
        files.set(nextRelative, {
          size: stats.size,
          mtimeMs: stats.mtimeMs,
        });
      } catch {
        continue;
      }

      if (files.size > MAX_TRACKED_FILES) {
        truncated = true;
        return { files, truncated };
      }
    }
  }

  return { files, truncated };
}

function diffWorkspaceFiles(beforeSnapshot, afterSnapshot) {
  const created = [];
  const updated = [];

  for (const [filePath, meta] of afterSnapshot.entries()) {
    const previous = beforeSnapshot.get(filePath);
    if (!previous) {
      created.push(filePath);
      continue;
    }
    if (previous.mtimeMs !== meta.mtimeMs || previous.size !== meta.size) {
      updated.push(filePath);
    }
  }

  return { created, updated };
}

async function collectWorkspaceChanges(rootDir, beforeSnapshot) {
  if (!beforeSnapshot) {
    return { filesCreated: [], filesUpdated: [], trackingSkipped: true };
  }

  if (beforeSnapshot.truncated) {
    return { filesCreated: [], filesUpdated: [], trackingSkipped: true };
  }

  let afterSnapshot;
  try {
    afterSnapshot = await listWorkspaceFiles(rootDir);
  } catch {
    return { filesCreated: [], filesUpdated: [], trackingSkipped: true };
  }

  if (afterSnapshot.truncated) {
    return { filesCreated: [], filesUpdated: [], trackingSkipped: true };
  }

  const diff = diffWorkspaceFiles(beforeSnapshot.files, afterSnapshot.files);
  return {
    filesCreated: diff.created,
    filesUpdated: diff.updated,
    trackingSkipped: false,
  };
}

function ensureAbsoluteDir(value) {
  return path.resolve(String(value || process.cwd()));
}

export async function runPython({ code, cwd, timeoutMs, maxOutputBytes, maxCodeBytes } = {}) {
  const resolvedCwd = ensureAbsoluteDir(cwd);
  const outputLimit = Number(maxOutputBytes) || DEFAULT_MAX_OUTPUT_BYTES;
  const codeLimit = Number(maxCodeBytes) || DEFAULT_MAX_CODE_BYTES;

  if (typeof code !== 'string' || !code.trim()) {
    throw new Error('Python code is required.');
  }

  const codeBytes = Buffer.byteLength(code, 'utf-8');
  if (codeBytes > codeLimit) {
    throw new Error(`Python code exceeds size limit (${codeBytes} > ${codeLimit}).`);
  }

  const workDir = path.join(resolvedCwd, '__python__');
  await fs.mkdir(workDir, { recursive: true });

  let beforeSnapshot = null;
  try {
    beforeSnapshot = await listWorkspaceFiles(resolvedCwd);
  } catch {
    beforeSnapshot = null;
  }

  const filename = `run_${Date.now()}_${randomBytes(4).toString('hex')}.py`;
  const filePath = path.join(workDir, filename);

  await fs.writeFile(filePath, code, 'utf-8');

  const timeout = Number(timeoutMs) || DEFAULT_TIMEOUT_MS;

  // Execution backend (Phase 0.5): how/where the process runs is pluggable.
  // The backend strips secrets from the child env (buildSafeEnv) and applies the
  // OS sandbox (srt: deny-net + fs fenced to cwd) where available. Structured
  // {file,args} runs without a shell when the sandbox is inactive. See
  // src/claude/execution/.
  const runtime = getExecutionRuntime();
  const result = await runtime.exec(
    { file: 'python3', args: ['-u', filePath] },
    {
      cwd: resolvedCwd,
      timeoutMs: timeout,
      maxOutputBytes: outputLimit,
      env: {
        HOME: resolvedCwd,
        PYTHONUNBUFFERED: '1',
        PYTHONDONTWRITEBYTECODE: '1',
        MPLBACKEND: process.env.MPLBACKEND || 'Agg',
      },
    },
  );

  const fileTracking = await collectWorkspaceChanges(resolvedCwd, beforeSnapshot);
  await fs.unlink(filePath).catch(() => {});

  return {
    stdout: result.stdout,
    stderr: result.stderr,
    exitCode: result.exitCode,
    signal: result.signal,
    durationMs: result.durationMs,
    timedOut: result.timedOut,
    truncated: result.truncated,
    killedByLimit: result.killedByLimit,
    ...fileTracking,
  };
}
