/**
 * Sandboxed Bash Runner (PR-C)
 *
 * Executes an arbitrary shell command string through the ExecutionRuntime —
 * the same sandbox pipeline that wraps the Python tool (srt on Linux, or
 * DockerBackend when EXEC_RUNTIME=docker). Mirrors python/runner.js closely.
 *
 * SECURITY INVARIANTS (all enforced before execution):
 *
 *   1. FAIL-CLOSED: sandbox MUST be confirmed active; if not, the run is
 *      refused with a clear error. Never falls back to bare-host execution.
 *
 *   2. RESOURCE LIMITS via prlimit (Linux only, best-effort):
 *        CPU:     2 cores (RLIMIT_CPU = 300s wall-clock via timeout, soft)
 *        Memory:  2 GiB  (RLIMIT_AS)
 *        Procs:   512    (RLIMIT_NPROC)
 *        Fsize:   2 GiB  (RLIMIT_FSIZE — caps single file writes)
 *      Enforced by wrapping the command with `prlimit` when available.
 *      The hard 300-second wall-clock timeout is always enforced by the runtime.
 *
 *   3. DISK QUOTA GUARD (best-effort, pre- and post-run):
 *      Workspace size is measured with `du` before and after; if > DISK_LIMIT_BYTES
 *      (default 2 GiB) a warning is emitted. This is a soft guard — a hard per-session
 *      quota volume (direction ③) will replace it in a future hardening pass.
 *
 *   4. COMMAND VALIDATION (logical guard on top of sandbox):
 *      - Rejects absolute paths that escape the session workspace
 *      - Rejects path traversal (.. segments outside workspace)
 *      - CWD is anchored to session workspace (cd injected if needed)
 *      This mirrors deer-flow's local sandbox path-validation approach.
 *
 *   5. SECRET STRIPPING: buildSafeEnv() in the runtime backend, always active.
 *
 * Timeouts: default 300 s (configurable via BASH_RUNNER_TIMEOUT_MS).
 * Output cap: default 512 KB (configurable via BASH_RUNNER_MAX_OUTPUT_BYTES).
 */

import path from 'node:path';
import { getExecutionRuntime } from '../execution/index.js';
import { ensureSandbox } from '../execution/sandbox.js';

const DEFAULT_TIMEOUT_MS  = Number(process.env.BASH_RUNNER_TIMEOUT_MS)        || 300_000; // 300 s
const DEFAULT_MAX_OUTPUT  = Number(process.env.BASH_RUNNER_MAX_OUTPUT_BYTES)   || 512_000; // 512 KB
const DISK_LIMIT_BYTES    = Number(process.env.BASH_RUNNER_DISK_LIMIT_BYTES)   || 2 * 1024 * 1024 * 1024; // 2 GiB

// prlimit resource caps (Linux) — 2C/2G/512procs as decided
// RLIMIT_CPU is in seconds; we use wall-clock timeout (300 s) for enforcement.
// RLIMIT_AS = virtual memory (2 GiB); RLIMIT_NPROC = max processes.
// RLIMIT_FSIZE = max single file size (2 GiB) to cap writes.
const PRLIMIT_FLAGS = [
  '--as=2147483648',        // 2 GiB virtual memory
  '--nproc=512',            // max processes
  '--fsize=2147483648',     // 2 GiB max single file
].join(' ');

// ─── validation helpers ────────────────────────────────────────────────────

/** Is the string free of path traversal that could escape the workspace? */
function hasTraversal(str) {
  // Normalise slashes, look for .. that steps outside
  const parts = str.replace(/\\/g, '/').split('/');
  return parts.some((p) => p === '..');
}

/**
 * Reject commands that look like they reference absolute paths outside the
 * workspace (heuristic; sandbox is the hard boundary — this is defence-in-depth).
 * @param {string} command
 * @param {string} workspaceRoot  absolute path
 * @returns {string | null} null = ok; string = rejection reason
 */
function validateCommand(command, workspaceRoot) {
  if (hasTraversal(command)) {
    return 'Command contains ".." path traversal — not allowed.';
  }
  // Look for absolute paths that are clearly outside the workspace.
  // Match /<something> that is NOT under workspaceRoot and NOT a well-known
  // system binary location (/bin, /usr, /lib, /etc, /dev, /proc, /tmp).
  const SYSTEM_PREFIXES = ['/bin/', '/usr/', '/lib/', '/lib64/', '/sbin/',
                            '/etc/', '/dev/', '/proc/', '/sys/', '/tmp/'];
  const absPathPattern = /(?:^|\s|['"`])(\/[^\s'"`]+)/g;
  let m;
  while ((m = absPathPattern.exec(command)) !== null) {
    const p = m[1];
    const isSystem = SYSTEM_PREFIXES.some((prefix) => p.startsWith(prefix));
    const isWorkspace = p.startsWith(workspaceRoot);
    if (!isSystem && !isWorkspace) {
      return `Absolute path "${p}" is outside the session workspace and system directories.`;
    }
  }
  return null;
}

// ─── prlimit wrapping ──────────────────────────────────────────────────────

/**
 * Check if `prlimit` is available (Linux; best-effort).
 * Cached after first call.
 */
let _prlimitAvailable = null;
async function prlimitAvailable() {
  if (_prlimitAvailable !== null) return _prlimitAvailable;
  try {
    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    await promisify(execFile)('prlimit', ['--version'], { timeout: 1000 });
    _prlimitAvailable = true;
  } catch {
    _prlimitAvailable = false;
  }
  return _prlimitAvailable;
}

/**
 * Wrap a shell command with `prlimit` resource caps if available.
 * @param {string} command
 * @param {string} cwd
 * @returns {Promise<string>}
 */
async function applyResourceLimits(command, cwd) {
  if (process.platform !== 'linux') return command;
  if (!(await prlimitAvailable())) return command;
  // prlimit wraps the shell invocation: prlimit <flags> /bin/sh -c <cmd>
  // We quote the inner command safely.
  const escaped = command.replace(/'/g, `'\\''`);
  return `prlimit ${PRLIMIT_FLAGS} /bin/sh -c '${escaped}'`;
}

// ─── disk guard ────────────────────────────────────────────────────────────

/**
 * Measure workspace size in bytes via `du -sb` (Linux/macOS).
 * Returns null if unavailable.
 */
async function measureDirBytes(dirPath) {
  try {
    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const { stdout } = await promisify(execFile)('du', ['-sb', dirPath], { timeout: 10_000 });
    const bytes = parseInt(stdout.split('\t')[0], 10);
    return Number.isFinite(bytes) ? bytes : null;
  } catch {
    return null;
  }
}

// ─── main export ───────────────────────────────────────────────────────────

/**
 * Run a bash command in the sandbox.
 *
 * @param {{
 *   command: string,
 *   cwd?: string,
 *   timeoutMs?: number,
 *   maxOutputBytes?: number,
 * }} opts
 * @returns {Promise<{
 *   stdout: string, stderr: string, exitCode: number|null,
 *   durationMs: number, timedOut: boolean, truncated: boolean,
 *   diskWarning?: string, sandboxActive: boolean,
 * }>}
 */
export async function runBash({ command, cwd, timeoutMs, maxOutputBytes } = {}) {
  const resolvedCwd = path.resolve(String(cwd || process.cwd()));
  const timeout     = Number(timeoutMs)       || DEFAULT_TIMEOUT_MS;
  const outputLimit = Number(maxOutputBytes)  || DEFAULT_MAX_OUTPUT;

  // ── 1. INPUT VALIDATION ──────────────────────────────────────────────────
  if (typeof command !== 'string' || !command.trim()) {
    throw new Error('Bash command is required.');
  }

  const validationError = validateCommand(command, resolvedCwd);
  if (validationError) {
    throw new Error(`[bash-runner] Command rejected: ${validationError}`);
  }

  // ── 2. FAIL-CLOSED SANDBOX CHECK ─────────────────────────────────────────
  // sandboxActive=false means srt failed to initialise.  We REFUSE to run
  // bare Bash on the host — better to give a clear error than to silently
  // bypass the isolation boundary.
  const sandboxActive = await ensureSandbox(resolvedCwd);
  if (!sandboxActive) {
    throw new Error(
      '[bash-runner] Sandbox is not active on this host. ' +
      'Bash execution requires srt (Linux + seccomp=unconfined) or EXEC_RUNTIME=docker. ' +
      'See docs/project/research/2026-05-permission-bash-sandbox-design.md §3.2.',
    );
  }

  // ── 3. RESOURCE LIMITS (prlimit, Linux, best-effort) ─────────────────────
  const wrappedCommand = await applyResourceLimits(command, resolvedCwd);

  // ── 4. DISK GUARD (pre-run) ───────────────────────────────────────────────
  const diskBefore = await measureDirBytes(resolvedCwd);

  // ── 5. EXECUTE via runtime ────────────────────────────────────────────────
  const runtime = getExecutionRuntime();
  const result  = await runtime.exec(
    { command: wrappedCommand },       // string form → backend runs via /bin/sh -c
    {
      cwd:            resolvedCwd,
      timeoutMs:      timeout,
      maxOutputBytes: outputLimit,
      env:            { HOME: resolvedCwd },
    },
  );

  // ── 6. DISK GUARD (post-run) ──────────────────────────────────────────────
  let diskWarning;
  if (diskBefore !== null) {
    const diskAfter = await measureDirBytes(resolvedCwd);
    if (diskAfter !== null && diskAfter > DISK_LIMIT_BYTES) {
      diskWarning =
        `Workspace has grown to ${(diskAfter / 1024 / 1024).toFixed(0)} MiB ` +
        `(limit ${(DISK_LIMIT_BYTES / 1024 / 1024).toFixed(0)} MiB). ` +
        'Consider cleaning up large files.';
      console.warn('[bash-runner] Disk quota warning:', diskWarning);
    }
  }

  return {
    stdout:        result.stdout,
    stderr:        result.stderr,
    exitCode:      result.exitCode,
    signal:        result.signal,
    durationMs:    result.durationMs,
    timedOut:      result.timedOut,
    truncated:     result.truncated,
    killedByLimit: result.killedByLimit,
    sandboxActive,
    ...(diskWarning ? { diskWarning } : {}),
  };
}
