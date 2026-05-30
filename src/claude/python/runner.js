/**
 * Python Runner
 *
 * Executes Python code using a temp file and returns stdout/stderr.
 * Avoids shell execution to reduce attack surface.
 */

import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { buildSafeEnv, ensureSandbox, wrapCommand, cleanupAfterCommand, shQuote } from '../execution/sandbox.js';

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

function createCollector(limitBytes) {
  let total = 0;
  let truncated = false;
  let content = '';

  const append = (chunk) => {
    if (truncated) return;
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    const remaining = limitBytes - total;
    if (remaining <= 0) {
      truncated = true;
      return;
    }

    if (buffer.length > remaining) {
      content += buffer.subarray(0, remaining).toString('utf-8');
      total += remaining;
      truncated = true;
      return;
    }

    content += buffer.toString('utf-8');
    total += buffer.length;
  };

  return {
    append,
    get content() {
      return content;
    },
    get truncated() {
      return truncated;
    },
  };
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

  const stdoutCollector = createCollector(outputLimit);
  const stderrCollector = createCollector(outputLimit);

  let timedOut = false;
  let killedByLimit = false;

  const startedAt = Date.now();
  const timeout = Number(timeoutMs) || DEFAULT_TIMEOUT_MS;

  // Risk #1 mitigation: always strip secrets from the child env; where the OS
  // sandbox is available, also wrap execution with srt (deny-net + fs fenced to cwd).
  const safeEnv = buildSafeEnv({
    HOME: resolvedCwd,
    PYTHONUNBUFFERED: '1',
    PYTHONDONTWRITEBYTECODE: '1',
    MPLBACKEND: process.env.MPLBACKEND || 'Agg',
  });
  const sandboxActive = await ensureSandbox(resolvedCwd);
  let spawnFile = 'python3';
  let spawnArgs = ['-u', filePath];
  if (sandboxActive) {
    const wrapped = await wrapCommand(`python3 -u ${shQuote(filePath)}`);
    spawnFile = '/bin/sh';
    spawnArgs = ['-c', wrapped];
  }

  return await new Promise((resolve) => {
    const child = spawn(spawnFile, spawnArgs, {
      cwd: resolvedCwd,
      env: safeEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeout);

    const maybeKillForLimit = () => {
      if (stdoutCollector.truncated || stderrCollector.truncated) {
        if (!killedByLimit) {
          killedByLimit = true;
          child.kill('SIGKILL');
        }
      }
    };

    child.stdout?.on('data', (chunk) => {
      stdoutCollector.append(chunk);
      maybeKillForLimit();
    });

    child.stderr?.on('data', (chunk) => {
      stderrCollector.append(chunk);
      maybeKillForLimit();
    });

    child.on('error', async (error) => {
      clearTimeout(timer);
      cleanupAfterCommand();
      const fileTracking = await collectWorkspaceChanges(resolvedCwd, beforeSnapshot);
      await fs.unlink(filePath).catch(() => {});
      resolve({
        stdout: stdoutCollector.content,
        stderr: `${stderrCollector.content}${stderrCollector.content ? '\n' : ''}${error.message}`,
        exitCode: 127,
        signal: null,
        durationMs: Date.now() - startedAt,
        timedOut: false,
        truncated: stdoutCollector.truncated || stderrCollector.truncated,
        killedByLimit,
        ...fileTracking,
      });
    });

    child.on('close', async (code, signal) => {
      clearTimeout(timer);
      cleanupAfterCommand();
      const fileTracking = await collectWorkspaceChanges(resolvedCwd, beforeSnapshot);
      await fs.unlink(filePath).catch(() => {});
      resolve({
        stdout: stdoutCollector.content,
        stderr: stderrCollector.content,
        exitCode: code,
        signal,
        durationMs: Date.now() - startedAt,
        timedOut,
        truncated: stdoutCollector.truncated || stderrCollector.truncated,
        killedByLimit,
        ...fileTracking,
      });
    });
  });
}
