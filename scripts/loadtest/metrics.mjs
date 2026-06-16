/**
 * S5 load-test metrics helpers: server memory sampling + latency aggregation.
 *
 * Memory: samples the ws-server main process RSS plus its child workers (the
 * per-message agent subprocesses S1 bounds), so we can watch peak memory vs
 * concurrency. Uses `ps` (portable on macOS + Linux) — no extra deps.
 *
 * The point of the whole S5 exercise is to plot peak RSS / latency against
 * MAX_CONCURRENT_WORKERS so the defaults can be calibrated on a real 16G/8-core
 * host. Locally these numbers only prove the tooling works (Mac ARM != prod).
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';

const execFileAsync = promisify(execFile);

/**
 * Container-total memory from the cgroup (KB), used as a fallback when per-process
 * detection (lsof/pgrep/ps) is unavailable — e.g. running the harness inside a slim
 * app image that ships none of those tools. cgroup v2 first, then v1. Returns null
 * on a bare-metal host (no cgroup memory file).
 */
async function readCgroupMemoryKb() {
  for (const p of ['/sys/fs/cgroup/memory.current', '/sys/fs/cgroup/memory/memory.usage_in_bytes']) {
    try {
      const bytes = parseInt((await readFile(p, 'utf8')).trim(), 10);
      if (Number.isFinite(bytes) && bytes > 0) return Math.round(bytes / 1024);
    } catch {
      /* try next */
    }
  }
  return null;
}

/**
 * Find the server PID(s) that actually handle the WS traffic. We detect by
 * *who listens on the WS port* (via lsof), which is topology-agnostic: it works
 * whether the WS server is standalone (`node ws-server.mjs`) or integrated into
 * the app process (`start-production.mjs` serving both HTTP + WS). This avoids
 * matching stray `ws-server.mjs` test processes by command line.
 *
 * @param {object} [opts]
 * @param {number} [opts.port]  WS port to resolve the listener for (preferred).
 * @returns {Promise<number[]>}
 */
export async function findWsServerPids(opts = {}) {
  // Explicit override wins (e.g. WS_SERVER_PID for unusual setups).
  if (process.env.WS_SERVER_PID) {
    return process.env.WS_SERVER_PID.split(',').map((s) => parseInt(s.trim(), 10)).filter(Boolean);
  }
  const port = opts.port;
  if (port) {
    try {
      const { stdout } = await execFileAsync('lsof', [
        '-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t',
      ]);
      const pids = stdout.split('\n').map((s) => parseInt(s.trim(), 10)).filter(Boolean);
      if (pids.length) return [...new Set(pids)];
    } catch {
      /* fall through to command-line match */
    }
  }
  // Fallback: standalone ws-server.mjs by command line.
  try {
    const { stdout } = await execFileAsync('pgrep', ['-f', 'ws-server.mjs']);
    return stdout.split('\n').map((s) => parseInt(s.trim(), 10)).filter(Boolean);
  } catch {
    return []; // pgrep exits non-zero when nothing matches
  }
}

/** RSS (KB) for a set of pids via `ps`; returns total KB and per-pid map. */
async function rssForPids(pids) {
  if (!pids.length) return { totalKb: 0, perPid: {} };
  try {
    const { stdout } = await execFileAsync('ps', ['-o', 'pid=,rss=', '-p', pids.join(',')]);
    const perPid = {};
    let totalKb = 0;
    for (const line of stdout.split('\n')) {
      const m = line.trim().match(/^(\d+)\s+(\d+)$/);
      if (m) {
        const kb = parseInt(m[2], 10);
        perPid[m[1]] = kb;
        totalKb += kb;
      }
    }
    return { totalKb, perPid };
  } catch {
    return { totalKb: 0, perPid: {} };
  }
}

/** Child PIDs of a parent (one level) via `pgrep -P`. */
async function childPids(parentPid) {
  try {
    const { stdout } = await execFileAsync('pgrep', ['-P', String(parentPid)]);
    return stdout.split('\n').map((s) => parseInt(s.trim(), 10)).filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * One memory sample: ws-server main + its worker children.
 * @param {number[]} mainPids  ws-server main PIDs (from findWsServerPids()).
 */
export async function sampleMemory(mainPids) {
  const allChildren = [];
  for (const pid of mainPids) allChildren.push(...(await childPids(pid)));
  const main = await rssForPids(mainPids);
  const workers = await rssForPids(allChildren);
  const procTotal = main.totalKb + workers.totalKb;
  // Per-process detection failed (no lsof/pgrep/ps, or no listener found, e.g. inside a
  // slim container) → fall back to the container-total cgroup reading so the run still
  // produces a memory series instead of an empty header-only CSV.
  if (procTotal === 0) {
    const cgroupKb = await readCgroupMemoryKb();
    if (cgroupKb != null) {
      return { mainKb: cgroupKb, workerKb: 0, totalKb: cgroupKb, workerCount: 0, source: 'cgroup' };
    }
  }
  return {
    mainKb: main.totalKb,
    workerKb: workers.totalKb,
    totalKb: procTotal,
    workerCount: Object.keys(workers.perPid).length,
    source: 'ps',
  };
}

/** Percentile (nearest-rank) of a numeric array. */
export function percentile(arr, p) {
  if (!arr.length) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

/** Summarize an array of latencies (ms) into p50/p95/p99/max/avg. */
export function summarizeLatencies(arr) {
  if (!arr.length) return { count: 0, p50: 0, p95: 0, p99: 0, max: 0, avg: 0 };
  const sum = arr.reduce((a, b) => a + b, 0);
  return {
    count: arr.length,
    p50: percentile(arr, 50),
    p95: percentile(arr, 95),
    p99: percentile(arr, 99),
    max: Math.max(...arr),
    avg: Math.round(sum / arr.length),
  };
}
