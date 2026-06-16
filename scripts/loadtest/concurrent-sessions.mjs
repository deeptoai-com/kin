/**
 * Concurrent-session capacity harness for the 2026-06-15 background-run PRD.
 *
 * This drives the real /ws/agent protocol through Better Auth cookies and checks
 * the invariants that matter for concurrent sessions:
 * - per-user cap: 4th run should queue when PER_USER_MAX_WORKERS=3;
 * - global cap: > MAX_CONCURRENT_WORKERS users should queue rather than crash;
 * - background continue: closing a socket must not kill running workers;
 * - abort/disconnect cleanup: running_sessions should eventually return to zero.
 *
 * It intentionally does not add any test-only auth or server bypass.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { provisionUsers } from './auth-setup.mjs';
import { findWsServerPids, sampleMemory, summarizeLatencies } from './metrics.mjs';

let WebSocketImpl = null;

const CFG = {
  appUrl: process.env.APP_URL || 'http://localhost:3000',
  wsUrl: process.env.WS_URL || 'ws://localhost:3001/ws/agent',
  scenario: process.env.SCENARIO || 'all',
  prompt: process.env.PROMPT || 'Write numbers 1 to 80, one per line. No prose.',
  outDir: process.env.OUT_DIR || path.join('loadtest-results'),
  sampleMs: parseInt(process.env.SAMPLE_MS || '1000', 10),
  runTimeoutMs: parseInt(process.env.RUN_TIMEOUT_MS || '180000', 10),
  waitAfterStartMs: parseInt(process.env.WAIT_AFTER_START_MS || '1500', 10),
  settleTimeoutMs: parseInt(process.env.SETTLE_TIMEOUT_MS || '60000', 10),
  perUserSessions: parseInt(process.env.PER_USER_SESSIONS || '4', 10),
  globalSessions: parseInt(process.env.GLOBAL_SESSIONS || '10', 10),
  backgroundSessions: parseInt(process.env.BACKGROUND_SESSIONS || '2', 10),
  backgroundCloseAfterMs: parseInt(process.env.BACKGROUND_CLOSE_AFTER_MS || '1500', 10),
  abortSessions: parseInt(process.env.ABORT_SESSIONS || '4', 10),
  abortAfterMs: parseInt(process.env.ABORT_AFTER_MS || '2000', 10),
  idleWaitMs: parseInt(process.env.IDLE_WAIT_MS || '70000', 10),
  sweepLevels: parseLevels(process.env.SWEEP_LEVELS || '1,2,4,6,8,10'),
  expectedPerUserMax: parseInt(process.env.EXPECTED_PER_USER_MAX || '3', 10),
  expectedGlobalMax: parseInt(process.env.EXPECTED_GLOBAL_MAX || '8', 10),
  strict: process.env.STRICT === '1',
};

const TERMINAL_TYPES = new Set(['done', 'error', 'aborted']);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const now = () => Date.now();

function parseLevels(raw) {
  return raw
    .split(',')
    .map((part) => parseInt(part.trim(), 10))
    .filter((n) => Number.isFinite(n) && n > 0);
}

function requireLoadtestGate() {
  if (process.env.LOADTEST !== '1') {
    console.error('Refusing to run: set LOADTEST=1 (real auth + real model traffic).');
    process.exit(1);
  }
}

async function loadWebSocketImpl() {
  try {
    const mod = await import('ws');
    WebSocketImpl = mod.WebSocket;
  } catch (err) {
    throw new Error(`Cannot load dependency "ws". Run pnpm install in kin/ first. ${err.message}`);
  }
}

function maxUsersNeeded() {
  switch (CFG.scenario) {
    case 'per-user':
    case 'background':
    case 'abort':
    case 'idle':
      return 1;
    case 'global':
      return CFG.globalSessions;
    case 'sweep':
      return Math.max(1, ...CFG.sweepLevels);
    case 'all':
      return CFG.globalSessions;
    default:
      throw new Error(`Unknown SCENARIO=${CFG.scenario}`);
  }
}

function makeRun({ scenario, userIndex, sessionId, label }) {
  let resolveFinished;
  const finished = new Promise((resolve) => { resolveFinished = resolve; });
  return {
    scenario,
    userIndex,
    sessionId,
    label,
    startedAt: now(),
    firstOutputAt: 0,
    firstAssistantAt: 0,
    finishedAt: 0,
    outcome: 'running',
    framesAfterTerminal: 0,
    queuedEvents: 0,
    queuePositions: [],
    messageFrames: 0,
    frameCounts: {},
    errorCode: '',
    errorMessage: '',
    finished,
    resolveFinished,
  };
}

function routeFrame(runsBySession, msg) {
  const sessionId = msg.sessionId;
  const run = sessionId ? runsBySession.get(sessionId) : null;
  if (!run) return;

  run.frameCounts[msg.type] = (run.frameCounts[msg.type] || 0) + 1;
  if (run.finishedAt && !TERMINAL_TYPES.has(msg.type)) {
    run.framesAfterTerminal++;
  }
  if (msg.type === 'queued') {
    run.queuedEvents++;
    if (Number.isFinite(msg.position)) run.queuePositions.push(msg.position);
    return;
  }
  if (msg.type === 'message') {
    run.messageFrames++;
    if (!run.firstOutputAt) run.firstOutputAt = now();
    if (msg.event?.type === 'assistant' && !run.firstAssistantAt) {
      run.firstAssistantAt = now();
    }
    return;
  }
  if (msg.type === 'session_metadata' && !run.firstOutputAt) {
    run.firstOutputAt = now();
    return;
  }
  if (TERMINAL_TYPES.has(msg.type) && !run.finishedAt) {
    run.finishedAt = now();
    run.outcome = msg.type;
    if (msg.type === 'error') {
      run.errorCode = msg.code || '';
      run.errorMessage = msg.message || '';
    }
    run.resolveFinished(run);
  }
}

function summarizeRuns(runs) {
  const terminalRuns = runs.filter((run) => run.finishedAt);
  const durations = terminalRuns.map((run) => run.finishedAt - run.startedAt);
  const firstOutputs = runs
    .filter((run) => run.firstOutputAt)
    .map((run) => run.firstOutputAt - run.startedAt);
  const firstAssistants = runs
    .filter((run) => run.firstAssistantAt)
    .map((run) => run.firstAssistantAt - run.startedAt);
  return {
    requested: runs.length,
    terminal: terminalRuns.length,
    completed: runs.filter((run) => run.outcome === 'done').length,
    aborted: runs.filter((run) => run.outcome === 'aborted').length,
    errors: runs.filter((run) => run.outcome === 'error').length,
    still_running: runs.filter((run) => !run.finishedAt).length,
    queued_events: runs.reduce((sum, run) => sum + run.queuedEvents, 0),
    first_output_latency_ms: summarizeLatencies(firstOutputs),
    first_assistant_latency_ms: summarizeLatencies(firstAssistants),
    completion_latency_ms: summarizeLatencies(durations),
  };
}

function runToRow(run) {
  const firstOutputMs = run.firstOutputAt ? run.firstOutputAt - run.startedAt : '';
  const firstAssistantMs = run.firstAssistantAt ? run.firstAssistantAt - run.startedAt : '';
  const durationMs = run.finishedAt ? run.finishedAt - run.startedAt : '';
  return [
    run.scenario,
    run.label,
    run.userIndex,
    run.sessionId,
    run.outcome,
    run.queuedEvents,
    run.queuePositions.join('|'),
    firstOutputMs,
    firstAssistantMs,
    durationMs,
    run.messageFrames,
    run.framesAfterTerminal,
    run.errorCode,
    run.errorMessage,
  ].map(csvCell).join(',');
}

function csvCell(value) {
  const text = String(value ?? '');
  if (!/[",\n]/.test(text)) return text;
  return `"${text.replaceAll('"', '""')}"`;
}

class AgentWsClient {
  constructor({ name, userIndex, cookie, onFrame }) {
    this.name = name;
    this.userIndex = userIndex;
    this.cookie = cookie;
    this.onFrame = onFrame;
    this.ws = null;
    this.waiters = [];
    this.frameCounts = {};
    this.closed = false;
    this.closeCode = 0;
    this.closeReason = '';
  }

  async connect() {
    this.ws = new WebSocketImpl(CFG.wsUrl, { headers: { cookie: this.cookie } });
    this.ws.on('message', (data) => this.handleMessage(data));
    this.ws.on('close', (code, reason) => {
      this.closed = true;
      this.closeCode = code;
      this.closeReason = reason?.toString?.() || '';
      for (const waiter of this.waiters.splice(0)) {
        clearTimeout(waiter.timer);
        waiter.reject(new Error(`${this.name} closed while waiting for ${waiter.label}`));
      }
    });
    this.ws.on('error', (err) => {
      for (const waiter of this.waiters.splice(0)) {
        clearTimeout(waiter.timer);
        waiter.reject(err);
      }
    });
    await new Promise((resolve, reject) => {
      this.ws.once('open', resolve);
      this.ws.once('error', reject);
    });
    return this;
  }

  handleMessage(data) {
    let msg;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      return;
    }
    this.frameCounts[msg.type] = (this.frameCounts[msg.type] || 0) + 1;
    if (this.onFrame) this.onFrame(msg, this);
    for (const waiter of [...this.waiters]) {
      let matched = false;
      try {
        matched = waiter.predicate(msg);
      } catch (err) {
        this.waiters = this.waiters.filter((item) => item !== waiter);
        clearTimeout(waiter.timer);
        waiter.reject(err);
        continue;
      }
      if (matched) {
        this.waiters = this.waiters.filter((item) => item !== waiter);
        clearTimeout(waiter.timer);
        waiter.resolve(msg);
      }
    }
  }

  send(payload) {
    if (!this.ws || this.ws.readyState !== WebSocketImpl.OPEN) {
      throw new Error(`${this.name} is not open`);
    }
    this.ws.send(JSON.stringify(payload));
  }

  waitFor(predicate, timeoutMs, label) {
    return new Promise((resolve, reject) => {
      const waiter = {
        predicate,
        label,
        resolve,
        reject,
        timer: setTimeout(() => {
          this.waiters = this.waiters.filter((item) => item !== waiter);
          reject(new Error(`${this.name} timed out waiting for ${label}`));
        }, timeoutMs),
      };
      this.waiters.push(waiter);
    });
  }

  async createSession() {
    this.send({ type: 'create_session' });
    const msg = await this.waitFor(
      (frame) => frame.type === 'session_init' && typeof frame.sessionId === 'string',
      15000,
      'create_session/session_init',
    );
    return msg.sessionId;
  }

  async listRunning() {
    this.send({ type: 'list_running' });
    const msg = await this.waitFor(
      (frame) => frame.type === 'running_sessions' && Array.isArray(frame.sessionIds),
      10000,
      'running_sessions',
    );
    return msg.sessionIds;
  }

  close(reason = 'done') {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.close(1000, reason);
    }
  }
}

async function connectClient(user, index, runsBySession, prefix) {
  const client = new AgentWsClient({
    name: `${prefix}-u${index}`,
    userIndex: index,
    cookie: user.cookie,
    onFrame: (msg) => routeFrame(runsBySession, msg),
  });
  await client.connect();
  return client;
}

async function createSessions(client, count) {
  const sessions = [];
  for (let i = 0; i < count; i++) {
    sessions.push(await client.createSession());
  }
  return sessions;
}

function startRun(client, runsBySession, { scenario, sessionId, label, prompt = CFG.prompt }) {
  const run = makeRun({ scenario, userIndex: client.userIndex, sessionId, label });
  runsBySession.set(sessionId, run);
  client.send({ type: 'chat', content: prompt, sessionId });
  return run;
}

async function waitRuns(runs, timeoutMs = CFG.runTimeoutMs) {
  const timeout = sleep(timeoutMs).then(() => 'timeout');
  const all = Promise.allSettled(runs.map((run) => run.finished)).then(() => 'done');
  await Promise.race([all, timeout]);
}

async function waitRunningZero(client, timeoutMs = CFG.settleTimeoutMs) {
  const started = now();
  let last = [];
  while (now() - started < timeoutMs) {
    last = await client.listRunning();
    if (last.length === 0) return { ok: true, sessionIds: [] };
    await sleep(1000);
  }
  return { ok: false, sessionIds: last };
}

async function startMemorySampler() {
  let wsPort = null;
  try { wsPort = Number(new URL(CFG.wsUrl).port) || null; } catch { /* noop */ }
  const mainPids = await findWsServerPids({ port: wsPort });
  const samples = [];
  const peak = { totalKb: 0, workerCount: 0 };
  const startedAt = now();
  const timer = setInterval(async () => {
    if (!mainPids.length) return;
    const sample = await sampleMemory(mainPids);
    samples.push({ t: now() - startedAt, ...sample });
    peak.totalKb = Math.max(peak.totalKb, sample.totalKb);
    peak.workerCount = Math.max(peak.workerCount, sample.workerCount);
  }, CFG.sampleMs);
  return {
    mainPids,
    samples,
    peak,
    stop() { clearInterval(timer); },
  };
}

async function scenarioPerUser(users) {
  const scenario = 'per-user';
  const runsBySession = new Map();
  const client = await connectClient(users[0], 0, runsBySession, scenario);
  const sessions = await createSessions(client, CFG.perUserSessions);
  const runs = sessions.map((sessionId, i) =>
    startRun(client, runsBySession, { scenario, sessionId, label: `run-${i + 1}` }));
  await sleep(CFG.waitAfterStartMs);
  const runningDuring = await client.listRunning();
  await waitRuns(runs);
  const finalZero = await waitRunningZero(client);
  client.close();
  return {
    scenario,
    expected_per_user_max: CFG.expectedPerUserMax,
    running_during_count: runningDuring.length,
    running_during_session_ids: runningDuring,
    final_running_zero: finalZero.ok,
    final_running_session_ids: finalZero.sessionIds,
    invariant_queued_when_over_cap:
      CFG.perUserSessions <= CFG.expectedPerUserMax || runs.some((run) => run.queuedEvents > 0),
    runs,
    summary: summarizeRuns(runs),
  };
}

async function scenarioGlobal(users, count = CFG.globalSessions, scenario = 'global') {
  const runsBySession = new Map();
  const clients = [];
  for (let i = 0; i < count; i++) {
    clients.push(await connectClient(users[i], i, runsBySession, scenario));
  }
  const sessions = [];
  for (const client of clients) {
    sessions.push(await client.createSession());
  }
  const runs = sessions.map((sessionId, i) =>
    startRun(clients[i], runsBySession, { scenario, sessionId, label: `u${i + 1}` }));
  await sleep(CFG.waitAfterStartMs);
  const runningDuringByUser = [];
  for (const client of clients) {
    runningDuringByUser.push(await client.listRunning());
  }
  await waitRuns(runs);
  const finalByUser = [];
  for (const client of clients) {
    finalByUser.push(await waitRunningZero(client));
    client.close();
  }
  return {
    scenario,
    expected_global_max: CFG.expectedGlobalMax,
    requested_runs: count,
    running_during_total: runningDuringByUser.reduce((sum, ids) => sum + ids.length, 0),
    running_during_by_user: runningDuringByUser,
    final_running_zero: finalByUser.every((item) => item.ok),
    final_running_by_user: finalByUser.map((item) => item.sessionIds),
    invariant_queued_when_over_global:
      count <= CFG.expectedGlobalMax || runs.some((run) => run.queuedEvents > 0),
    runs,
    summary: summarizeRuns(runs),
  };
}

async function scenarioBackground(users) {
  const scenario = 'background';
  const runsBySession = new Map();
  const client = await connectClient(users[0], 0, runsBySession, scenario);
  const sessions = await createSessions(client, CFG.backgroundSessions);
  const runs = sessions.map((sessionId, i) =>
    startRun(client, runsBySession, { scenario, sessionId, label: `bg-${i + 1}` }));
  await sleep(CFG.backgroundCloseAfterMs);
  client.close('background-check');
  await sleep(500);

  const reconnect = await connectClient(users[0], 0, runsBySession, `${scenario}-reconnect`);
  const runningAfterClose = await reconnect.listRunning();
  for (const sessionId of runningAfterClose) {
    reconnect.send({ type: 'resume', sessionId });
    await reconnect.waitFor(
      (frame) => frame.type === 'session_init' && frame.sessionId === sessionId,
      15000,
      `resume ${sessionId}`,
    ).catch(() => null);
  }

  for (const run of runs) {
    if (!run.finishedAt && !runningAfterClose.includes(run.sessionId)) {
      run.outcome = 'completed_before_reconnect';
      run.finishedAt = now();
      run.resolveFinished(run);
    }
  }
  await waitRuns(runs.filter((run) => runningAfterClose.includes(run.sessionId)));
  const finalZero = await waitRunningZero(reconnect);
  reconnect.close();
  return {
    scenario,
    running_after_close_count: runningAfterClose.length,
    running_after_close_session_ids: runningAfterClose,
    invariant_background_survived_socket_close: runningAfterClose.length > 0,
    final_running_zero: finalZero.ok,
    final_running_session_ids: finalZero.sessionIds,
    runs,
    summary: summarizeRuns(runs),
  };
}

async function abortUntilZero(client, candidateSessionIds) {
  const started = now();
  let last = [];
  while (now() - started < CFG.settleTimeoutMs) {
    last = await client.listRunning();
    const targets = new Set([...candidateSessionIds, ...last]);
    for (const sessionId of targets) {
      client.send({ type: 'abort', sessionId });
    }
    await sleep(1000);
    last = await client.listRunning();
    if (last.length === 0) return { ok: true, sessionIds: [] };
  }
  return { ok: false, sessionIds: last };
}

async function scenarioAbort(users) {
  const scenario = 'abort';
  const runsBySession = new Map();
  const client = await connectClient(users[0], 0, runsBySession, scenario);
  const sessions = await createSessions(client, CFG.abortSessions);
  const runs = sessions.map((sessionId, i) =>
    startRun(client, runsBySession, { scenario, sessionId, label: `abort-${i + 1}` }));
  await sleep(CFG.abortAfterMs);
  const runningBeforeAbort = await client.listRunning();
  const zero = await abortUntilZero(client, sessions);
  await waitRuns(runs, 15000);
  client.close();
  return {
    scenario,
    running_before_abort_count: runningBeforeAbort.length,
    running_before_abort_session_ids: runningBeforeAbort,
    final_running_zero: zero.ok,
    final_running_session_ids: zero.sessionIds,
    invariant_permits_released_after_abort: zero.ok,
    runs,
    summary: summarizeRuns(runs),
  };
}

async function scenarioIdle(users) {
  const scenario = 'idle';
  const runsBySession = new Map();
  const client = await connectClient(users[0], 0, runsBySession, scenario);
  const sessionId = await client.createSession();
  const idleFrame = await client.waitFor(
    (frame) => frame.type === 'idle_timeout',
    CFG.idleWaitMs,
    'idle_timeout',
  ).catch(() => null);
  await sleep(500);
  client.close();
  return {
    scenario,
    session_id: sessionId,
    idle_wait_ms: CFG.idleWaitMs,
    idle_timeout_seen: !!idleFrame,
    close_code: client.closeCode,
    close_reason: client.closeReason,
    invariant_idle_reaped: !!idleFrame || client.closeCode === 4002,
    runs: [],
    summary: summarizeRuns([]),
  };
}

async function scenarioSweep(users) {
  const scenario = 'sweep';
  const levels = [];
  for (const level of CFG.sweepLevels) {
    console.log(`[concurrent-loadtest] sweep level ${level}`);
    const result = await scenarioGlobal(users, level, `sweep-${level}`);
    levels.push(result);
    await sleep(2000);
  }
  return {
    scenario,
    levels: levels.map((item) => ({
      level: item.requested_runs,
      queued_events: item.summary.queued_events,
      completed: item.summary.completed,
      errors: item.summary.errors,
      first_assistant_latency_ms: item.summary.first_assistant_latency_ms,
      completion_latency_ms: item.summary.completion_latency_ms,
      final_running_zero: item.final_running_zero,
    })),
    runs: levels.flatMap((item) => item.runs),
    summary: summarizeRuns(levels.flatMap((item) => item.runs)),
  };
}

function stripRuns(result) {
  const clone = { ...result };
  delete clone.runs;
  if (clone.levels) clone.levels = clone.levels;
  return clone;
}

function collectFailures(results) {
  const failures = [];
  for (const result of results) {
    if ('final_running_zero' in result && !result.final_running_zero) {
      failures.push(`${result.scenario}: running sessions did not return to zero`);
    }
    if ('invariant_queued_when_over_cap' in result && !result.invariant_queued_when_over_cap) {
      failures.push(`${result.scenario}: no queued frame observed over per-user cap`);
    }
    if ('invariant_queued_when_over_global' in result && !result.invariant_queued_when_over_global) {
      failures.push(`${result.scenario}: no queued frame observed over global cap`);
    }
    if ('invariant_background_survived_socket_close' in result && !result.invariant_background_survived_socket_close) {
      failures.push(`${result.scenario}: no running session observed after socket close`);
    }
    if ('invariant_permits_released_after_abort' in result && !result.invariant_permits_released_after_abort) {
      failures.push(`${result.scenario}: permits/running list did not clear after abort`);
    }
    if ('invariant_idle_reaped' in result && !result.invariant_idle_reaped) {
      failures.push(`${result.scenario}: idle_timeout was not observed`);
    }
  }
  return failures;
}

async function main() {
  requireLoadtestGate();
  await loadWebSocketImpl();
  console.log('[concurrent-loadtest] config:', JSON.stringify(CFG));

  const neededUsers = maxUsersNeeded();
  console.log(`[concurrent-loadtest] provisioning ${neededUsers} user(s) ...`);
  const users = await provisionUsers({ count: neededUsers, appUrl: CFG.appUrl });

  const memory = await startMemorySampler();
  console.log(
    `[concurrent-loadtest] WS server PIDs: ${memory.mainPids.join(',') || '(none found; memory sampling off)'}`,
  );

  const startedAt = now();
  const scenarioResults = [];
  try {
    if (CFG.scenario === 'per-user' || CFG.scenario === 'all') {
      scenarioResults.push(await scenarioPerUser(users));
    }
    if (CFG.scenario === 'global' || CFG.scenario === 'all') {
      scenarioResults.push(await scenarioGlobal(users));
    }
    if (CFG.scenario === 'background' || CFG.scenario === 'all') {
      scenarioResults.push(await scenarioBackground(users));
    }
    if (CFG.scenario === 'abort' || CFG.scenario === 'all') {
      scenarioResults.push(await scenarioAbort(users));
    }
    if (CFG.scenario === 'idle') {
      scenarioResults.push(await scenarioIdle(users));
    }
    if (CFG.scenario === 'sweep') {
      scenarioResults.push(await scenarioSweep(users));
    }
  } finally {
    memory.stop();
  }

  const allRuns = scenarioResults.flatMap((result) => result.runs ?? []);
  const failures = collectFailures(scenarioResults);
  const summary = {
    config: CFG,
    wall_seconds: +((now() - startedAt) / 1000).toFixed(1),
    ws_server_pids: memory.mainPids,
    peak_total_rss_mb: +(memory.peak.totalKb / 1024).toFixed(1),
    peak_worker_count: memory.peak.workerCount,
    mem_samples: memory.samples.length,
    scenarios: scenarioResults.map(stripRuns),
    aggregate: summarizeRuns(allRuns),
    failures,
  };

  console.log('\n[concurrent-loadtest] ===== SUMMARY =====');
  console.log(JSON.stringify(summary, null, 2));

  await mkdir(CFG.outDir, { recursive: true });
  const stamp = `${startedAt}`;
  await writeFile(
    path.join(CFG.outDir, `concurrent-summary-${stamp}.json`),
    JSON.stringify(summary, null, 2),
  );
  const runCsv = [
    'scenario,label,user_index,session_id,outcome,queued_events,queue_positions,first_output_ms,first_assistant_ms,duration_ms,message_frames,frames_after_terminal,error_code,error_message',
    ...allRuns.map(runToRow),
  ].join('\n');
  await writeFile(path.join(CFG.outDir, `concurrent-runs-${stamp}.csv`), runCsv);
  const memCsv = ['t_ms,main_kb,worker_kb,total_kb,worker_count']
    .concat(memory.samples.map((s) => `${s.t},${s.mainKb},${s.workerKb},${s.totalKb},${s.workerCount}`))
    .join('\n');
  await writeFile(path.join(CFG.outDir, `concurrent-memory-${stamp}.csv`), memCsv);
  console.log(`[concurrent-loadtest] wrote results to ${CFG.outDir}/ with stamp ${stamp}`);

  if (CFG.strict && failures.length > 0) {
    console.error('[concurrent-loadtest] strict failures:', failures.join('; '));
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('[concurrent-loadtest] fatal:', err.stack || err.message);
  process.exit(1);
});
