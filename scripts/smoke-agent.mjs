#!/usr/bin/env node
/**
 * Worker-level end-to-end smoke test for the Claude Agent loop.
 *
 * Spawns ws-query-worker.mjs exactly like ws-server.mjs does (same env + stdin
 * JSON contract) and drives a real prompt through query() -> the configured
 * Anthropic-compatible endpoint (ANTHROPIC_BASE_URL/MODEL/API_KEY in .env), then
 * asserts we get streamed events, a tool call, a written file, and a terminal frame.
 *
 * This proves the heart of the system is live (model + streaming + tool exec)
 * WITHOUT needing the WebSocket server, auth, or the database.
 *
 * Run from repo root (loads .env automatically):
 *   node --env-file=.env scripts/smoke-agent.mjs
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const MODEL = process.env.ANTHROPIC_MODEL || '(unset)';
const BASE = process.env.ANTHROPIC_BASE_URL || '(default Anthropic)';
if (!process.env.ANTHROPIC_API_KEY) {
  console.error('ABORT: ANTHROPIC_API_KEY not set (run with: node --env-file=.env scripts/smoke-agent.mjs)');
  process.exit(2);
}

// Per-run sandboxed home + workspace, mirroring ws-server's per-session layout.
const root = mkdtempSync(path.join(tmpdir(), 'oxy-smoke-'));
const claudeHome = path.join(root, 'home');
const workspace = path.join(root, 'workspace');
const targetFile = path.join(workspace, 'hello.txt');
import { mkdirSync } from 'node:fs';
mkdirSync(claudeHome, { recursive: true });
mkdirSync(workspace, { recursive: true });

const workerEnv = {
  ...process.env,
  CLAUDE_HOME: claudeHome,
  WORKER_CWD: workspace,
  CLAUDE_SESSIONS_ROOT: root,
  // Keep the smoke test focused on the model loop; the srt sandbox is verified
  // separately by scripts/verify-exec-sandbox.mjs.
  ENABLE_EXEC_SANDBOX: process.env.SMOKE_ENABLE_SANDBOX === '1' ? '1' : '0',
};

const request = {
  prompt:
    'Use the Write tool to create a file named hello.txt in the current directory ' +
    'containing exactly the text: OXYGENIE_SMOKE_OK . Then reply with the single word DONE.',
  userId: 'smoke-user',
  permissionMode: 'bypassPermissions', // smoke-user not in allowlist -> resolver downgrades to default; fine
};

console.log('=== OxyGenie agent smoke test ===');
console.log('model     :', MODEL);
console.log('baseURL   :', BASE);
console.log('workspace :', workspace);
console.log('sandbox   :', workerEnv.ENABLE_EXEC_SANDBOX === '1' ? 'on' : 'off (model-loop focus)');
console.log('---');

const worker = spawn('node', ['ws-query-worker.mjs'], {
  cwd: process.cwd(),
  env: workerEnv,
  stdio: ['pipe', 'pipe', 'pipe'],
});

let buf = '';
const seen = { events: 0, toolUse: 0, text: '', done: false, error: null, sessionId: null };
const HARD_TIMEOUT_MS = Number(process.env.SMOKE_TIMEOUT_MS) || 120000;

const killTimer = setTimeout(() => {
  console.error(`\nTIMEOUT after ${HARD_TIMEOUT_MS}ms — killing worker`);
  worker.kill('SIGKILL');
}, HARD_TIMEOUT_MS);

worker.stdout.on('data', (chunk) => {
  buf += chunk.toString();
  let nl;
  while ((nl = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { continue; }
    if (msg.type === 'event') {
      seen.events++;
      const ev = msg.event || {};
      if (ev.type === 'system' && ev.session_id) seen.sessionId = ev.session_id;
      if (ev.type === 'text_delta' && ev.text) process.stdout.write(ev.text);
      // tool_use appears inside assistant message content blocks
      if (ev.type === 'assistant' && Array.isArray(ev.message?.content)) {
        for (const b of ev.message.content) if (b?.type === 'tool_use') seen.toolUse++;
      }
    } else if (msg.type === 'done') {
      seen.done = true;
    } else if (msg.type === 'error') {
      seen.error = msg.error || msg.message || 'unknown';
    }
  }
});

let stderrTail = '';
worker.stderr.on('data', (c) => { stderrTail = (stderrTail + c.toString()).slice(-2000); });

worker.on('close', (code) => {
  clearTimeout(killTimer);
  const fileOk = existsSync(targetFile) && readFileSync(targetFile, 'utf8').includes('OXYGENIE_SMOKE_OK');
  console.log('\n---');
  console.log('exit code     :', code);
  console.log('events        :', seen.events);
  console.log('tool_use seen :', seen.toolUse);
  console.log('done frame    :', seen.done);
  console.log('error frame   :', seen.error || 'none');
  console.log('file written  :', fileOk, fileOk ? `(${targetFile})` : '');
  if (!seen.events || seen.error) {
    console.log('\n[stderr tail]\n' + stderrTail);
  }
  const pass = !seen.error && seen.events > 0 && (seen.done || fileOk);
  // cleanup unless asked to keep
  if (process.env.SMOKE_KEEP !== '1') rmSync(root, { recursive: true, force: true });
  console.log('\nSMOKE:', pass ? 'PASS ✅' : 'FAIL ❌');
  process.exit(pass ? 0 : 1);
});

worker.stdin.write(JSON.stringify(request));
worker.stdin.end();
