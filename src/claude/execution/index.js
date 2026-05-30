/**
 * Execution runtime factory.
 *
 * Returns a process-wide singleton ExecutionRuntime chosen by `EXEC_RUNTIME`:
 *   - 'local'  (default) → LocalProcessBackend (today's behavior; Phase 0.5 PR-1)
 *   - 'docker'           → per-session container backend (added in PR-2)
 *
 * Unknown / not-yet-implemented values fall back to 'local' with a warning, so a
 * misconfiguration degrades safely instead of breaking the agent loop.
 *
 * @see ./types.js, ./local-process-backend.js
 */
import { LocalProcessBackend } from './local-process-backend.js';
import { DockerBackend } from './docker-backend.js';

let singleton = null;
let resolvedName = null;

/** @returns {import('./types.js').ExecutionRuntime} */
export function getExecutionRuntime() {
  if (singleton) return singleton;

  const requested = (process.env.EXEC_RUNTIME || 'local').toLowerCase();
  switch (requested) {
    case 'local':
      singleton = new LocalProcessBackend();
      break;
    case 'docker':
      singleton = new DockerBackend();
      break;
    default:
      console.warn(`[execution] EXEC_RUNTIME='${requested}' not available; falling back to 'local'.`);
      singleton = new LocalProcessBackend();
      break;
  }
  resolvedName = singleton.name;
  return singleton;
}

/** The active backend's name, or null before first use. Useful for diagnostics. */
export function activeRuntimeName() {
  return resolvedName;
}

/** Test-only: drop the cached singleton so the next get re-reads EXEC_RUNTIME. */
export function __resetExecutionRuntimeForTests() {
  singleton = null;
  resolvedName = null;
}
