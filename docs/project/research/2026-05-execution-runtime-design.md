# Phase 0.5 — Execution Runtime: Design Proposal (for review)

> **Status: PROPOSAL — awaiting human approval before implementation.**
> Date: 2026-05-30 · Author: agent · Grounded by `2026-05-scalability-and-runtime.md`
> Scope decision (confirmed with human): **local + Docker backends first; serverless
> (Modal/Daytona/E2B) deferred** until a real 100→1000 concurrency bake-off is needed.

## 1. Goal & non-goals

**Goal:** introduce a typed `ExecutionRuntime` abstraction so that *how/where tool code runs*
is a pluggable backend, not hard-wired into `ws-query-worker.mjs`. Make per-session execution
possible (vs today's per-message spawn) without rewriting the agent loop or the web tier.

**In scope (this phase):**
- A TS `ExecutionRuntime` interface (start / exec / stream / abort / snapshot / stop).
- Two backends: **`LocalProcessBackend`** (today's behavior + the srt sandbox we already ship)
  and **`DockerBackend`** (one container per session, real OS isolation on any host).
- Route the existing Python tool (and later Bash) through the interface.
- Fold in **B3** (one shared path guard) and **C4** (backpressure) since they live in this code.

**Explicitly NOT in scope yet (deferred, with rationale):**
- Serverless sandbox backends (Modal/Daytona/E2B) — needs an account + budget; revisit at scale.
- Stateless-gateway / queue / worker-pool decoupling — large, and only pays off past a single box;
  the interface is designed so this can come later without touching the agent loop.
- 1000-concurrency bake-off — meaningful only once a scale backend exists.

## 2. Current state (what we're abstracting)

- `ws-server.mjs` spawns a fresh `ws-query-worker.mjs` **per message** (`spawn('node',[WORKER_PATH])`).
- The worker calls the Claude Agent SDK `query()`. Tool execution today:
  - **Python**: `src/claude/python/runner.js` → `spawn('python3', …)`, wrapped by
    `src/claude/execution/sandbox.js` (srt on Linux, env-strip always).
  - **Bash**: disallowed by default.
  - SDK-native Read/Write/Edit/Glob/Grep: gated by `path-security.js` `canUseTool`.
- This already gives strong per-*message* isolation (the architecture review rated it a strength).
  The abstraction's job is to make this **swappable** and **per-session-capable**, not to discard it.

## 3. Proposed interface

```ts
// src/claude/execution/types.ts
export interface ExecResult {
  stdout: string; stderr: string;
  exitCode: number | null; signal: NodeJS.Signals | null;
  durationMs: number; timedOut: boolean; truncated: boolean;
}

export interface ExecOptions {
  timeoutMs?: number;
  maxOutputBytes?: number;
  env?: NodeJS.ProcessEnv;     // merged over the backend's secret-stripped base
  cwdRelative?: string;        // relative to the session workspace
}

export interface ExecutionRuntime {
  /** Prepare execution for a session workspace (idempotent). */
  start(ctx: SessionContext): Promise<void>;
  /** Run a command to completion. */
  exec(command: string, opts?: ExecOptions): Promise<ExecResult>;
  /** Run a command, streaming stdout/stderr chunks. */
  stream(command: string, opts?: ExecOptions): AsyncGenerator<{ type: 'stdout'|'stderr'; chunk: Buffer }>;
  /** Cancel the in-flight command (cooperative where possible, else kill). */
  abort(): void;
  /** Optional: snapshot/restore session state for checkpointing (future). */
  snapshot?(): Promise<SnapshotRef>;
  /** Release all resources for the session. */
  stop(): Promise<void>;
}

export interface SessionContext {
  sessionId: string; userId: string;
  workspaceDir: string;        // host path to the session workspace
  claudeHome: string;
}
```

Design notes:
- **Pattern source:** hermes-agent `BaseEnvironment` (exec/cleanup/`_run`) + deer-flow
  `SandboxProvider` (acquire/release lifecycle). We take the shape, write our own TS.
- **Secret-stripping stays in the runtime** (`buildSafeEnv` from `sandbox.js`), so no backend
  can leak keys regardless of platform — same guarantee we verified on macOS/Linux.
- `snapshot?()` is optional now (enables Phase 3 checkpointing later without an interface change).

## 4. Backends (this phase)

### `LocalProcessBackend` (default; = today, behind the interface)
- `exec` = spawn the command in `workspaceDir` with secret-stripped env; on Linux wrap with srt.
- Effectively a refactor of `runner.js` + `sandbox.js` behind the interface. Lowest risk.
- Isolation: process + (Linux) srt deny-net/fs-fence. Same as today.

### `DockerBackend` (opt-in; real per-session OS isolation on any host incl. macOS)
- One container per session (image: a slim python+node sandbox), workspace bind-mounted.
- `exec` = `docker exec` into the session container; `stop` = `docker rm -f`.
- Network off by default (`--network none`); CPU/mem/pids limits; non-root.
- Selected via `EXEC_RUNTIME=docker` (default `local`). Lets us get container isolation on
  macOS dev too (where srt's Seatbelt is off), and is the stepping stone to a container pool.

## 5. How it slots in (incremental, low-risk)

1. Land `types.ts` + `LocalProcessBackend` as a pure refactor: `runPython` calls the runtime
   instead of spawning directly. **Behavior-identical** → verify with existing
   `scripts/verify-exec-sandbox.mjs` + a Python smoke run. (PR-1)
2. Add `DockerBackend` behind `EXEC_RUNTIME=docker`, off by default. Verify the same smoke +
   isolation tests pass inside a container. (PR-2)
3. **B3**: replace the 5 routes' `validateFilePath` with the shared guard module. (PR-3)
4. **C4**: backpressure in `sendMessage` (`ws.bufferedAmount`) + worker stdout `drain`. (PR-4)
5. (Later, separate decision) per-session warm pool; then tier-decoupling; then a scale backend.

Each step is a small PR with a real verification, mergeable independently. No agent-loop rewrite.

## 6. Per-session vs per-message

Today = per-message spawn (simple, isolated, but no reuse → can't scale cheaply). The interface
supports per-session (a backend instance lives across messages of a session). **This phase keeps
per-message as the default** and only makes per-session *possible*; flipping the default is a later,
measured step (it interacts with the warm pool + state decoupling).

## 7. Open questions for the human (please decide before/at implementation)

1. **Default backend in prod:** keep `local`+srt (Linux), or move prod to `docker` per-session?
   (Proposal: keep `local`+srt now; add `docker` opt-in; decide prod default after a bench.)
2. **DockerBackend base image:** reuse the 5.8GB app image, or a slim purpose-built exec image
   (~300MB python+node)? (Proposal: slim image — faster cold start, smaller blast radius.)
3. Confirm serverless (E2B/Modal/Daytona) stays deferred until a scale bake-off is funded. (Yes per earlier answer.)

## 8. Acceptance criteria (for the implementation that follows approval)

- `ExecutionRuntime` interface + `LocalProcessBackend`; `runPython` goes through it with
  **identical** behavior (smoke + isolation tests green, read from real output).
- `DockerBackend` runs the same Python task in a per-session container with network off and
  workspace-fenced FS; verified in a container.
- B3: a single path-guard module used by both the worker and the routes; one unit test covers both.
- C4: backpressure honored; a fast-stream/slow-client scenario no longer grows memory unbounded.
- No regression to the browser e2e flow (register → chat → Python tool → file).

---

### Decision requested
Approve this proposal (optionally answering §7) and I'll implement it as the small PR sequence in §5.
If you'd rather change scope (e.g., skip DockerBackend for now, or do B3/C4 first), say so and I'll adjust.
