/**
 * Unit tests for the file-tool path-security guard (createPathSecurity.canUseTool).
 *
 * These encode the cross-tenant / out-of-bounds contract for the SDK's native file
 * tools (Read/Write/Edit/Glob/Grep). Pure function, no DB/server — CI-runnable.
 *
 * NOTE: discovered 2026-05-30 that resolveCandidate() was an unimplemented stub
 * (returned null), making the entire deny path dead (guard allowed everything,
 * incl. /etc/passwd and other users' workspaces). These tests pin the fix.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore - .js module without type declarations
import { createPathSecurity } from '../../src/claude/path-security.js';

let sessionsRoot: string;
let userARoot: string;
let workspaceA: string;
let guard: { canUseTool: (t: string, i?: Record<string, unknown>, o?: unknown) => { behavior: string; message?: string } };

beforeAll(() => {
  // Real dirs so realpath resolution has something to anchor on.
  sessionsRoot = mkdtempSync(path.join(tmpdir(), 'oxy-ps-'));
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

describe('path-security canUseTool', () => {
  it('allows non-file tools through (gated elsewhere)', () => {
    expect(guard.canUseTool('Bash', { command: 'echo hi' }).behavior).toBe('allow');
  });

  it('allows a write inside the session workspace', () => {
    const r = guard.canUseTool('Write', { file_path: path.join(workspaceA, 'a.txt') });
    expect(r.behavior).toBe('allow');
  });

  it('allows a relative path (resolved against the workspace)', () => {
    expect(guard.canUseTool('Read', { path: 'sub/b.txt' }).behavior).toBe('allow');
  });

  it('allows a write inside the user home (CLAUDE_HOME)', () => {
    const r = guard.canUseTool('Write', { file_path: path.join(userARoot, 'notes.txt') });
    expect(r.behavior).toBe('allow');
  });

  it('DENIES reading a system path (/etc/passwd)', () => {
    expect(guard.canUseTool('Read', { file_path: '/etc/passwd' }).behavior).toBe('deny');
  });

  it("DENIES cross-user access to another user's workspace (even if the file does not exist yet)", () => {
    const victim = path.join(sessionsRoot, 'userB', 'sessions', 's9', 'workspace', 'secret.txt');
    expect(guard.canUseTool('Read', { file_path: victim }).behavior).toBe('deny');
  });

  it('DENIES a workspace-escape via ../ traversal', () => {
    const r = guard.canUseTool('Write', { file_path: path.join(workspaceA, '../../../../etc/evil') });
    expect(r.behavior).toBe('deny');
  });

  it('allows read-only project source under /app', () => {
    // /app may not exist locally; resolution must still classify it as the read-only prefix.
    expect(guard.canUseTool('Read', { file_path: '/app/package.json' }).behavior).toBe('allow');
  });
});
