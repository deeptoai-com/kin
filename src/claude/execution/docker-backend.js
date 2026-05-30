/**
 * DockerBackend — runs each tool command in a fresh, locked-down container.
 *
 * One-shot `docker run --rm` per exec (matches today's per-message isolation model;
 * a per-session warm container pool is a later, separate step). The container IS the
 * sandbox, so srt is not used here. Hardening applied to every run:
 *   - `--network none`            no network (override with EXEC_DOCKER_NETWORK)
 *   - `--user <uid:gid>`          non-root (EXEC_DOCKER_USER, default 65534:65534)
 *   - `--read-only` + tmpfs /tmp  immutable rootfs; only the workspace is writable
 *   - `--memory/--cpus/--pids-limit`  resource caps
 *   - `--cap-drop ALL` + `--security-opt no-new-privileges`
 *   - host env is NOT inherited; only explicit, path-remapped overrides are passed
 *
 * The session workspace (opts.cwd) is bind-mounted at /workspace; absolute paths in
 * args/env that live under cwd are remapped to their /workspace equivalents.
 *
 * Enabled via EXEC_RUNTIME=docker. Gives container-grade isolation on any host
 * (incl. macOS, where srt's Seatbelt is off). @see ./types.js for the contract.
 */
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { createCollector } from './collector.js';

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_OUTPUT_BYTES = 512_000;
const CONTAINER_WORKDIR = '/workspace';

function cfg(name, fallback) {
  const v = process.env[name];
  return v === undefined || v === '' ? fallback : v;
}

/** Map an absolute host path under `cwd` to its /workspace-mounted container path. */
function remapPath(value, cwd) {
  if (typeof value !== 'string' || !path.isAbsolute(value)) return value;
  const rel = path.relative(cwd, value);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return value; // outside workspace
  return path.posix.join(CONTAINER_WORKDIR, rel.split(path.sep).join('/'));
}

export class DockerBackend {
  name = 'docker';

  /**
   * @param {import('./types.js').ExecCommand} cmd
   * @param {import('./types.js').ExecOptions} opts
   * @returns {Promise<import('./types.js').ExecResult>}
   */
  async exec(cmd, opts = {}) {
    const cwd = opts.cwd;
    const timeout = Number(opts.timeoutMs) || DEFAULT_TIMEOUT_MS;
    const outputLimit = Number(opts.maxOutputBytes) || DEFAULT_MAX_OUTPUT_BYTES;

    const image = cfg('EXEC_DOCKER_IMAGE', 'python:3.12-slim');
    const network = cfg('EXEC_DOCKER_NETWORK', 'none');
    const user = cfg('EXEC_DOCKER_USER', '65534:65534');
    const memory = cfg('EXEC_DOCKER_MEMORY', '512m');
    const cpus = cfg('EXEC_DOCKER_CPUS', '1');
    const pids = cfg('EXEC_DOCKER_PIDS', '256');

    const containerName = `oxy-exec-${Date.now()}-${randomBytes(4).toString('hex')}`;

    // Only explicit overrides reach the container (host env is not inherited by
    // docker). Remap any value pointing under the workspace; default HOME=/workspace.
    const envArgs = [];
    const overrides = { HOME: CONTAINER_WORKDIR, ...(opts.env || {}) };
    for (const [k, v] of Object.entries(overrides)) {
      if (v === undefined) continue;
      envArgs.push('-e', `${k}=${remapPath(String(v), cwd)}`);
    }

    const dockerArgs = [
      'run', '--rm',
      '--name', containerName,
      '--network', network,
      '--user', user,
      '--read-only',
      '--tmpfs', '/tmp',
      '--memory', memory,
      '--cpus', cpus,
      '--pids-limit', pids,
      '--cap-drop', 'ALL',
      '--security-opt', 'no-new-privileges',
      '-v', `${cwd}:${CONTAINER_WORKDIR}:rw`,
      '-w', CONTAINER_WORKDIR,
      ...envArgs,
      image,
    ];

    if (typeof cmd.command === 'string') {
      dockerArgs.push('/bin/sh', '-c', cmd.command);
    } else {
      dockerArgs.push(cmd.file, ...(cmd.args || []).map((a) => remapPath(a, cwd)));
    }

    const stdoutCollector = createCollector(outputLimit);
    const stderrCollector = createCollector(outputLimit);

    let timedOut = false;
    let killedByLimit = false;
    const startedAt = Date.now();

    // `docker kill` is the reliable way to stop the container (killing the local
    // `docker run` client process alone may leave the container running).
    const killContainer = () => {
      try {
        spawn('docker', ['kill', containerName], { stdio: 'ignore' }).on('error', () => {});
      } catch {
        /* ignore */
      }
    };

    return await new Promise((resolve) => {
      const child = spawn('docker', dockerArgs, { stdio: ['ignore', 'pipe', 'pipe'] });

      const timer = setTimeout(() => {
        timedOut = true;
        killContainer();
        child.kill('SIGKILL');
      }, timeout);

      const maybeKillForLimit = () => {
        if (stdoutCollector.truncated || stderrCollector.truncated) {
          if (!killedByLimit) {
            killedByLimit = true;
            killContainer();
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
    /* one-shot containers are --rm; nothing persistent to release */
  }
}
