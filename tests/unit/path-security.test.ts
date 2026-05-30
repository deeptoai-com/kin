/**
 * Unit tests for the file-tool path-security guard (createPathSecurity.canUseTool).
 *
 * Encodes the cross-tenant / out-of-bounds contract for the SDK's native file
 * tools (Read/Write/Edit/Glob/Grep). Pure async function, no DB/server.
 *
 * IMPORTANT: canUseTool is ASYNC — every assertion must await it.
 *
 * Paths use a real temp dir resolved through realpath() up front, because the
 * guard realpath-resolves candidates (and on macOS /tmp -> /private/tmp), so the
 * allowed-prefix set must be built from the same resolved root or in-workspace
 * writes get falsely denied.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { mkdtempSync, mkdirSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
// @ts-expect-error - .js module without type declarations
import { createPathSecurity } from '../../src/claude/path-security.js';

let sessionsRoot: string;
let userARoot: string;
let workspaceA: string;
let guard: {
  canUseTool: (t: string, i?: Record<string, unknown>, o?: unknown) => Promise<{ behavior: string; message?: string }>;
};

beforeAll(() => {
  // realpath the temp root so the guard's realpath resolution matches our prefixes.
  sessionsRoot = realpathSync(mkdtempSync(path.join(tmpdir(), 'oxy-ps-')));
  userARoot = path.join(sessionsRoot, 'userA');
  workspaceA = path.join(userARoot, 'sessions', 's1', 'workspace');
  mkdirSync(workspaceA, { recursive: true });
  mkdirSync(path.join(sessionsRoot, 'userB', 'sessions', 's9', 'workspace'), { recursive: true });
  guard = createPathSecurity({
    workspace: workspaceA,
    userId: 'userA',
    claudeHome: userARoot,
    sessionsRoot,
  });
});

describe('path-security canUseTool (async)', () => {
  it('allows non-file tools through (gated elsewhere)', async () => {
    expect((await guard.canUseTool('Bash', { command: 'echo hi' })).behavior).toBe('allow');
  });

  it('allows a write inside the session workspace', async () => {
    expect((await guard.canUseTool('Write', { file_path: path.join(workspaceA, 'a.txt') })).behavior).toBe('allow');
  });

  it('allows a write inside the user home (CLAUDE_HOME)', async () => {
    expect((await guard.canUseTool('Write', { file_path: path.join(userARoot, 'notes.txt') })).behavior).toBe('allow');
  });

  it('allows read-only project source under /app', async () => {
    expect((await guard.canUseTool('Read', { file_path: '/app/package.json' })).behavior).toBe('allow');
  });

  it('DENIES reading a system path (/etc/passwd)', async () => {
    expect((await guard.canUseTool('Read', { file_path: '/etc/passwd' })).behavior).toBe('deny');
  });

  it("DENIES cross-user access to another user's workspace", async () => {
    const victim = path.join(sessionsRoot, 'userB', 'sessions', 's9', 'workspace', 'secret.txt');
    expect((await guard.canUseTool('Read', { file_path: victim })).behavior).toBe('deny');
  });
});
