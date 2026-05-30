/**
 * LocalProcessBackend — runs tool commands as a local child process.
 *
 * This is today's execution behavior, moved behind the ExecutionRuntime interface
 * (Phase 0.5, PR-1) with NO behavior change:
 *   - secrets are stripped from the child env (buildSafeEnv); always, every platform
 *   - on Linux (or ENABLE_EXEC_SANDBOX=1) the command is wrapped with srt
 *     (deny-network + workspace-fenced FS); on macOS/Windows it runs directly
 *   - structured {file,args} runs WITHOUT a shell when the sandbox is inactive
 *   - per-stream output cap (kill on overflow) + hard wall-clock timeout (SIGKILL)
 *
 * @see ./types.js for the ExecutionRuntime / ExecResult contracts.
 */
import { spawn } from 'node:child_process';
import {
  buildSafeEnv,
  ensureSandbox,
  wrapCommand,
  cleanupAfterCommand,
  shQuote,
} from './sandbox.js';

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_OUTPUT_BYTES = 512_000;

/** Bounded output collector: stops appending (and flags truncation) past `limitBytes`. */
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

export class LocalProcessBackend {
  name = 'local';

  /**
   * @param {import('./types.js').ExecCommand} cmd
   * @param {import('./types.js').ExecOptions} opts
   * @returns {Promise<import('./types.js').ExecResult>}
   */
  async exec(cmd, opts = {}) {
    const cwd = opts.cwd;
    const timeout = Number(opts.timeoutMs) || DEFAULT_TIMEOUT_MS;
    const outputLimit = Number(opts.maxOutputBytes) || DEFAULT_MAX_OUTPUT_BYTES;

    // Secret-stripping lives in the runtime: overrides are merged over the
    // allowlisted base, so callers can never widen the child's env to leak keys.
    const safeEnv = buildSafeEnv(opts.env || {});

    // Decide sandbox vs direct, exactly as the python runner did.
    const sandboxActive = await ensureSandbox(cwd);
    let spawnFile;
    let spawnArgs;
    if (sandboxActive) {
      const raw =
        typeof cmd.command === 'string'
          ? cmd.command
          : [cmd.file, ...(cmd.args || [])].map(shQuote).join(' ');
      const wrapped = await wrapCommand(raw);
      spawnFile = '/bin/sh';
      spawnArgs = ['-c', wrapped];
    } else if (typeof cmd.command === 'string') {
      // Raw command requested but no OS sandbox: run via shell (caller opted in).
      spawnFile = '/bin/sh';
      spawnArgs = ['-c', cmd.command];
    } else {
      // Structured form, sandbox off → spawn directly, NO shell (smaller surface).
      spawnFile = cmd.file;
      spawnArgs = cmd.args || [];
    }

    const stdoutCollector = createCollector(outputLimit);
    const stderrCollector = createCollector(outputLimit);

    let timedOut = false;
    let killedByLimit = false;
    const startedAt = Date.now();

    return await new Promise((resolve) => {
      const child = spawn(spawnFile, spawnArgs, {
        cwd,
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

      child.on('error', (error) => {
        clearTimeout(timer);
        cleanupAfterCommand();
        resolve({
          stdout: stdoutCollector.content,
          stderr: `${stderrCollector.content}${stderrCollector.content ? '\n' : ''}${error.message}`,
          exitCode: 127,
          signal: null,
          durationMs: Date.now() - startedAt,
          timedOut: false,
          truncated: stdoutCollector.truncated || stderrCollector.truncated,
          killedByLimit,
        });
      });

      child.on('close', (code, signal) => {
        clearTimeout(timer);
        cleanupAfterCommand();
        resolve({
          stdout: stdoutCollector.content,
          stderr: stderrCollector.content,
          exitCode: code,
          signal,
          durationMs: Date.now() - startedAt,
          timedOut,
          truncated: stdoutCollector.truncated || stderrCollector.truncated,
          killedByLimit,
        });
      });
    });
  }

  async stop() {
    /* no per-session resources to release for local processes */
  }
}
