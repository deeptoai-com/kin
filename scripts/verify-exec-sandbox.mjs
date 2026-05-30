#!/usr/bin/env node
/**
 * Verify the exec sandbox (srt) isolates untrusted Python via the REAL runPython() path.
 *
 * Must run on Linux with `seccomp=unconfined` + deps (bubblewrap, socat, ripgrep, python3),
 * after dependencies are installed. Example (from repo root):
 *
 *   docker run --rm --security-opt seccomp=unconfined -v "$PWD":/app -w /app node:24-bookworm-slim \
 *     sh -lc 'apt-get update -qq && apt-get install -y -qq bubblewrap socat ripgrep python3 \
 *       && corepack enable && pnpm install --frozen-lockfile \
 *       && node scripts/verify-exec-sandbox.mjs'
 *
 * Expected: secret-env=PASS, network=PASS, fs-escape=PASS, ws-write=PASS, "ALL PASS".
 * (On macOS it uses Apple Seatbelt and also passes; with ENABLE_EXEC_SANDBOX=0 only env-strip applies.)
 */
import { runPython } from '../src/claude/python/runner.js';
import { sandboxStatus } from '../src/claude/execution/sandbox.js';
import { mkdirSync, writeFileSync } from 'node:fs';

process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'sk-secret-DO-NOT-LEAK-123';

const WORK = '/tmp/oxy-sbx-verify/ws';
const VICTIM = '/srv/oxy-victim-secret.txt'; // outside the sandbox allowRead set
mkdirSync(WORK, { recursive: true });
try { mkdirSync('/srv', { recursive: true }); writeFileSync(VICTIM, 'TOPSECRET_OUTSIDE'); } catch { /* may need root */ }

const cases = [
  ['secret-env', 'import os;print(os.environ.get("ANTHROPIC_API_KEY","NONE"))'],
  ['network', 'import socket;socket.create_connection(("1.1.1.1",443),5);print("NET_OK")'],
  ['fs-escape', `print(open(${JSON.stringify(VICTIM)}).read())`],
  ['ws-write', 'open("out.txt","w").write("hi");print(open("out.txt").read())'],
];

let allPass = true;
for (const [name, code] of cases) {
  const r = await runPython({ code, cwd: WORK, timeoutMs: 15000 });
  const out = (r.stdout || '').trim();
  let verdict;
  if (name === 'secret-env') verdict = out === 'NONE' ? 'PASS' : 'FAIL';
  else if (name === 'ws-write') verdict = out === 'hi' && r.exitCode === 0 ? 'PASS' : 'FAIL';
  else verdict = r.exitCode !== 0 && !out.includes('NET_OK') && !out.includes('TOPSECRET') ? 'PASS' : 'FAIL';
  if (verdict === 'FAIL') allPass = false;
  console.log(`${name.padEnd(11)} exit=${r.exitCode} out=${JSON.stringify(out)} => ${verdict}`);
}
console.log('sandboxStatus:', JSON.stringify(sandboxStatus()));
console.log(allPass ? '\nALL PASS ✅' : '\nSOME FAILED ❌ (expected if ENABLE_EXEC_SANDBOX=0 or not on Linux/seccomp=unconfined)');
process.exit(allPass ? 0 : 1);
