/**
 * Integration-ish test for the updater sidecar's AUTH GATE + routing.
 * Spawns the real controller (Node stdlib, no deps) as a child process and exercises it
 * over HTTP. The auth check runs BEFORE any docker call, so these assertions need no docker:
 *   - GET /health        -> 200 (open liveness)
 *   - POST without token  -> 401
 *   - POST with wrong tok -> 401
 *   - POST /apply w/ token -> 202 (gate opens; the actual upgrade runs detached and is N/A here)
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';

const PORT = 5267;
const TOKEN = 'test-updater-token';
const BASE = `http://127.0.0.1:${PORT}`;
let child: ChildProcess;

beforeAll(async () => {
  child = spawn('node', ['src/updater/controller.mjs'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      UPDATER_PORT: String(PORT),
      UPDATER_TOKEN: TOKEN,
      // point compose at a non-existent file so any (unexpected) docker call fails fast
      UPDATER_COMPOSE_FILE: '/nonexistent/docker-compose.yml',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  // wait for the "Listening on" banner (printed to stderr)
  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('updater did not start in time')), 10000);
    child.stderr?.on('data', (b: Buffer) => {
      if (b.toString().includes('Listening on')) {
        clearTimeout(t);
        resolve();
      }
    });
    child.on('error', reject);
  });
});

afterAll(() => {
  child?.kill('SIGKILL');
});

describe('updater controller auth gate', () => {
  it('serves open liveness on GET /health', async () => {
    const res = await fetch(`${BASE}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('rejects an unauthenticated mutating request with 401', async () => {
    const res = await fetch(`${BASE}/v1/update/apply`, { method: 'POST' });
    expect(res.status).toBe(401);
  });

  it('rejects a wrong Bearer token with 401', async () => {
    const res = await fetch(`${BASE}/v1/update/apply`, {
      method: 'POST',
      headers: { Authorization: 'Bearer wrong-token' },
    });
    expect(res.status).toBe(401);
  });

  it('lets the correct Bearer token through the gate (202 started)', async () => {
    const res = await fetch(`${BASE}/v1/update/apply`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    expect(res.status).toBe(202);
    expect(await res.json()).toMatchObject({ started: true });
  });
});
