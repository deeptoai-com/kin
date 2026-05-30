/**
 * S5 load-test orchestrator.
 *
 * Spins up N virtual users that each authenticate (via auth-setup), open a real
 * /ws/agent connection, and loop: create_session -> chat -> await done ->
 * think-time -> repeat, until DURATION elapses. Meanwhile samples ws-server
 * memory + worker count. Emits a summary (latency percentiles, throughput,
 * errors, peak memory, max queue depth) and writes CSVs.
 *
 * Drives the verified frame protocol:
 *   create_session            -> session_init { sessionId }
 *   chat { content,sessionId } -> session_metadata / message (first token)
 *                                 -> done  (terminal)  | error | aborted
 *   (S1) at capacity           -> queued { position }   (then terminal later)
 *   (S3) long idle             -> idle_timeout + close 4002
 *
 * ⚠️ With real Ark, keep USERS small and PROMPT short to limit token cost.
 * ⚠️ Local numbers only prove the tooling — calibrate defaults on a real host.
 *
 * Usage:
 *   LOADTEST=1 APP_URL=http://localhost:3000 WS_URL=ws://localhost:3001/ws/agent \
 *   USERS=3 DURATION_MS=60000 THINK_MS=2000 PROMPT="say hi in 3 words" \
 *   node scripts/loadtest/load-client.mjs
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { WebSocket } from 'ws';
import { provisionUsers } from './auth-setup.mjs';
import { findWsServerPids, sampleMemory, summarizeLatencies } from './metrics.mjs';

const CFG = {
  appUrl: process.env.APP_URL || 'http://localhost:3000',
  wsUrl: process.env.WS_URL || 'ws://localhost:3001/ws/agent',
  users: parseInt(process.env.USERS || '3', 10),
  durationMs: parseInt(process.env.DURATION_MS || '60000', 10),
  thinkMs: parseInt(process.env.THINK_MS || '2000', 10),
  rampMs: parseInt(process.env.RAMP_MS || '0', 10), // spread connection starts
  prompt: process.env.PROMPT || 'say hi in 3 words',
  sampleMs: parseInt(process.env.SAMPLE_MS || '1000', 10),
  outDir: process.env.OUT_DIR || path.join('loadtest-results'),
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => Date.now();

/** Drive one virtual user over a single ws connection until the deadline. */
function runUser({ cookie, deadline, stats }) {
  return new Promise((resolve) => {
    const ws = new WebSocket(CFG.wsUrl, { headers: { cookie } });
    let sessionId = null;
    let loopStarted = false; // a `chat` also emits session_init — start loop once
    let inflight = null; // { startedAt, firstTokenAt, resolve }

    const finishInflight = (outcome) => {
      if (!inflight) return;
      const end = now();
      if (outcome === 'done') {
        stats.completionLatencies.push(end - inflight.startedAt);
        if (inflight.firstTokenAt) {
          stats.firstTokenLatencies.push(inflight.firstTokenAt - inflight.startedAt);
        }
        stats.completed++;
      } else {
        stats.errors++;
      }
      const r = inflight.resolve;
      inflight = null;
      r();
    };

    const sendChatAndWait = () =>
      new Promise((res) => {
        inflight = { startedAt: now(), firstTokenAt: null, resolve: res };
        ws.send(JSON.stringify({ type: 'chat', content: CFG.prompt, sessionId }));
      });

    ws.on('open', () => {
      ws.send(JSON.stringify({ type: 'create_session' }));
    });

    ws.on('message', async (data) => {
      let msg;
      try { msg = JSON.parse(data.toString()); } catch { return; }
      stats.frameCounts[msg.type] = (stats.frameCounts[msg.type] || 0) + 1;
      // Capture the first error payload to surface why requests fail.
      if (msg.type === 'error' && !stats.firstErrorFrame) {
        stats.firstErrorFrame = JSON.stringify(msg).slice(0, 300);
      }
      switch (msg.type) {
        case 'session_init':
          sessionId = msg.sessionId || sessionId;
          // A `chat` also emits session_init (on SDK init) — only the first one
          // (from create_session) should kick off the loop, else loops overlap.
          if (loopStarted) break;
          loopStarted = true;
          // begin the chat loop
          (async () => {
            while (now() < deadline && ws.readyState === ws.OPEN) {
              await sendChatAndWait();
              if (now() >= deadline) break;
              await sleep(CFG.thinkMs);
            }
            try { ws.close(1000, 'done'); } catch { /* noop */ }
          })();
          break;
        case 'queued':
          stats.queuedEvents++;
          stats.maxQueueDepth = Math.max(stats.maxQueueDepth, msg.position || 0);
          break;
        case 'message':
        case 'session_metadata':
          if (inflight && !inflight.firstTokenAt) inflight.firstTokenAt = now();
          break;
        case 'done':
          finishInflight('done');
          break;
        case 'error':
          finishInflight('error');
          break;
        case 'aborted':
          finishInflight('error');
          break;
        case 'idle_timeout':
          stats.idleReaped++;
          break;
        default:
          break; // pong, messages_loaded, etc.
      }
    });

    ws.on('close', () => { finishInflight('error'); resolve(); });
    ws.on('error', (err) => { stats.connErrors++; stats.lastConnError = err.message; finishInflight('error'); });
  });
}

async function main() {
  if (process.env.LOADTEST !== '1') {
    console.error('Refusing to run: set LOADTEST=1 (provisions throwaway users + drives load).');
    process.exit(1);
  }
  console.log('[loadtest] config:', JSON.stringify(CFG, null, 0));

  // 1) Provision users via real Better Auth sign-up.
  console.log(`[loadtest] provisioning ${CFG.users} users against ${CFG.appUrl} ...`);
  const users = await provisionUsers({ count: CFG.users, appUrl: CFG.appUrl });
  console.log(`[loadtest] provisioned ${users.length} users.`);

  // 2) Start memory sampler — detect the WS server by who listens on the WS port
  // (works for standalone ws-server.mjs and integrated start-production.mjs).
  let wsPort = null;
  try { wsPort = Number(new URL(CFG.wsUrl).port) || null; } catch { /* noop */ }
  const mainPids = await findWsServerPids({ port: wsPort });
  console.log(`[loadtest] WS server PIDs (port ${wsPort}): ${mainPids.join(',') || '(none found — memory sampling off)'}`);
  const memSamples = [];
  let peakTotalKb = 0;
  let peakWorkers = 0;
  const startedAt = now();
  const sampler = setInterval(async () => {
    if (!mainPids.length) return;
    const m = await sampleMemory(mainPids);
    memSamples.push({ t: now() - startedAt, ...m });
    peakTotalKb = Math.max(peakTotalKb, m.totalKb);
    peakWorkers = Math.max(peakWorkers, m.workerCount);
  }, CFG.sampleMs);

  // 3) Run virtual users (optionally ramped).
  const deadline = now() + CFG.durationMs;
  const stats = {
    completed: 0, errors: 0, connErrors: 0, queuedEvents: 0, maxQueueDepth: 0,
    idleReaped: 0, lastConnError: '', frameCounts: {}, firstErrorFrame: '',
    completionLatencies: [], firstTokenLatencies: [],
  };
  const runners = [];
  for (let i = 0; i < users.length; i++) {
    runners.push(runUser({ cookie: users[i].cookie, deadline, stats }));
    if (CFG.rampMs > 0 && i < users.length - 1) await sleep(CFG.rampMs);
  }
  await Promise.all(runners);
  clearInterval(sampler);

  // 4) Summarize.
  const wallMs = now() - startedAt;
  const comp = summarizeLatencies(stats.completionLatencies);
  const ftt = summarizeLatencies(stats.firstTokenLatencies);
  const throughput = (stats.completed / (wallMs / 1000)).toFixed(2);

  const summary = {
    config: CFG,
    wall_seconds: +(wallMs / 1000).toFixed(1),
    requests_completed: stats.completed,
    requests_failed: stats.errors,
    conn_errors: stats.connErrors,
    last_conn_error: stats.lastConnError,
    throughput_req_per_s: +throughput,
    queued_events: stats.queuedEvents,
    max_queue_depth: stats.maxQueueDepth,
    idle_reaped: stats.idleReaped,
    frame_counts: stats.frameCounts,
    first_error_frame: stats.firstErrorFrame,
    completion_latency_ms: comp,
    first_token_latency_ms: ftt,
    peak_total_rss_mb: +(peakTotalKb / 1024).toFixed(1),
    peak_worker_count: peakWorkers,
    mem_samples: memSamples.length,
  };

  console.log('\n[loadtest] ===== SUMMARY =====');
  console.log(JSON.stringify(summary, null, 2));

  // 5) Write CSVs.
  await mkdir(CFG.outDir, { recursive: true });
  const stamp = `${startedAt}`;
  await writeFile(
    path.join(CFG.outDir, `summary-${stamp}.json`),
    JSON.stringify(summary, null, 2),
  );
  const memCsv = ['t_ms,main_kb,worker_kb,total_kb,worker_count']
    .concat(memSamples.map((s) => `${s.t},${s.mainKb},${s.workerKb},${s.totalKb},${s.workerCount}`))
    .join('\n');
  await writeFile(path.join(CFG.outDir, `memory-${stamp}.csv`), memCsv);
  console.log(`[loadtest] wrote results to ${CFG.outDir}/ (summary-${stamp}.json, memory-${stamp}.csv)`);

  process.exit(0);
}

main().catch((err) => {
  console.error('[loadtest] fatal:', err.stack || err.message);
  process.exit(1);
});
