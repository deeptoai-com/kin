/**
 * Unit tests for the sandboxed bash runner — pure logic (no child processes).
 * We test: command validation, fail-closed sandbox check, and result shaping.
 * The underlying ExecutionRuntime and srt are NOT exercised here (integration tests
 * cover those via scripts/verify-exec-sandbox.mjs).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── mock the runtime and sandbox so tests are pure ──────────────────────────
vi.mock('../../src/claude/execution/index.js', () => ({
  getExecutionRuntime: () => ({
    exec: vi.fn().mockResolvedValue({
      stdout: 'hello\n',
      stderr: '',
      exitCode: 0,
      signal: null,
      durationMs: 42,
      timedOut: false,
      truncated: false,
      killedByLimit: false,
    }),
  }),
}));

// Default: sandbox is ACTIVE
const mockEnsureSandbox = vi.fn().mockResolvedValue(true);
vi.mock('../../src/claude/execution/sandbox.js', () => ({
  ensureSandbox: (...args: unknown[]) => mockEnsureSandbox(...args),
  buildSafeEnv: (o: Record<string, string>) => o,
}));

const { runBash } = await import('../../src/claude/bash/runner.js');

describe('runBash — input validation', () => {
  it('rejects empty command', async () => {
    await expect(runBash({ command: '' })).rejects.toThrow('required');
    await expect(runBash({ command: '   ' })).rejects.toThrow('required');
    // @ts-expect-error intentional
    await expect(runBash({})).rejects.toThrow('required');
  });

  it('rejects path traversal (..)', async () => {
    await expect(runBash({ command: 'cat ../../etc/passwd', cwd: '/workspace/u1' }))
      .rejects.toThrow('traversal');
  });

  it('rejects absolute path outside workspace and non-system dirs', async () => {
    await expect(runBash({ command: 'cat /home/other/secret', cwd: '/workspace/u1' }))
      .rejects.toThrow('outside');
  });

  it('allows absolute path to workspace', async () => {
    const result = await runBash({ command: 'ls /workspace/u1', cwd: '/workspace/u1' });
    expect(result.exitCode).toBe(0);
  });

  it('allows absolute system paths (/usr, /bin, /tmp, ...)', async () => {
    const result = await runBash({ command: 'ls /usr/bin/node', cwd: '/workspace/u1' });
    expect(result.exitCode).toBe(0);
  });
});

describe('runBash — fail-closed sandbox check', () => {
  beforeEach(() => {
    mockEnsureSandbox.mockResolvedValue(false); // sandbox NOT active
  });
  afterEach(() => {
    mockEnsureSandbox.mockResolvedValue(true);
  });

  it('refuses to run when sandbox is inactive', async () => {
    await expect(runBash({ command: 'echo hi', cwd: '/workspace/u1' }))
      .rejects.toThrow('Sandbox is not active');
  });

  it('error message references the design doc', async () => {
    try {
      await runBash({ command: 'echo hi', cwd: '/workspace/u1' });
    } catch (e) {
      expect((e as Error).message).toContain('permission-bash-sandbox-design');
    }
  });
});

describe('runBash — happy path result shape', () => {
  it('returns stdout, exitCode, sandboxActive=true', async () => {
    const result = await runBash({ command: 'echo hello', cwd: '/workspace/u1' });
    expect(result.stdout).toBe('hello\n');
    expect(result.exitCode).toBe(0);
    expect(result.sandboxActive).toBe(true);
    expect(result.timedOut).toBe(false);
  });
});
