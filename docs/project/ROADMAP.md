# OxyGenie — Roadmap

Phased plan from foundation to surpassing Deep Agents. Each phase lists its goal
and **exit criteria**. Track live progress in [`STATUS.md`](./STATUS.md).

> Sequencing principle: *foundation (safe parallel work) → decide the execution
> runtime/scale model → close security gaps → make capabilities measurable → catch
> up to Deep Agents.* Don't build features on an unsafe / untestable / un-scalable base.

---

## Phase 0 — Foundation (enable safe, parallel contribution)

**Goal:** anyone of any skill level can contribute safely, in parallel, with
guardrails.

- [x] Split product into its own repo (`oxygenie`), history + tags preserved.
- [x] Hygiene: untrack `.env.docker` (+ template), ignore runtime data dirs.
- [x] Secret-leak audit of full history (clean).
- [x] CI gates on `main`: build check + **gitleaks** secret scan + PR template + CODEOWNERS.
- [x] Branch protection on `main` (required checks + CODEOWNER review, no direct push).
- [ ] **Isolated, reproducible dev environment** (devcontainer / compose dev
      profile; secrets separated; one-command boot of web + ws-server + services).
- [ ] **TS-ify the agent runtime** (`ws-server.mjs`/`ws-query-worker.mjs`) with a
      typed WebSocket message protocol — prerequisite for safely adding harness features.
- [ ] Make the test suite CI-runnable (split unit vs e2e; provision Postgres/services)
      → re-enable `test` as a hard gate.
- [ ] Fix TS errors → re-enable `typecheck` as a hard gate.
- [ ] Migrate 15 REST routes → Server Functions → re-enable `validate-routes` as a hard gate.

**Exit criteria:** green, meaningful CI as a hard gate; a contributor can boot the
full stack locally in one command without touching real secrets.

---

## Phase 0.5 — Execution-runtime architecture & sandbox (decision + re-platform)

**Goal:** stand up a safe, *bounded* execution model so the product runs reliably on a
single modest VPS — explicitly targeting **one 16GB / 8-core host, ~50 concurrent
sessions** — before any multi-machine work. Grounded by
[`research/2026-05-scalability-and-runtime.md`](./research/2026-05-scalability-and-runtime.md)
and [`research/2026-05-single-host-50-concurrency.md`](./research/2026-05-single-host-50-concurrency.md).

Why now: the current model spawns a Node child **per message with no concurrency cap**,
so a burst of concurrent users can OOM the box. The sandbox primitive (srt) and the
pluggable `ExecutionRuntime` are done; what remains for the single-host target is
concurrency governance (cap + queue + resource limits), not multi-machine distribution.

- [x] **Adopt `@anthropic-ai/sandbox-runtime` (srt)** (TS, Apache-2.0) as the exec
      sandbox primitive — deny-network + workspace-fenced FS per tool-call. This *is*
      the Risk #1 fix; it uses bubblewrap (already installed) under the hood on Linux. *(PR #3/#29)*
- [x] **Define an `ExecutionRuntime` interface** (exec / stop / sandboxStatus; start/stream/
      abort/snapshot reserved) — pattern from hermes-agent `BaseEnvironment` + deer-flow
      `SandboxProvider`. First backend `LocalProcessBackend` (local-process + srt), behind
      `getExecutionRuntime()` (EXEC_RUNTIME selector). Behavior-identical refactor. *(PR #39, PR-1)*
- [x] **Second backend `DockerBackend`** — per-exec locked-down container (network none,
      non-root, read-only rootfs + workspace mount, cpu/mem/pids caps, host env not
      inherited). Container-grade isolation on any host incl. macOS. `EXEC_RUNTIME=docker`. *(PR #41, PR-2)*
**Single-host target work (S1–S5) — directly hits "50 on one 16G/8-core box":**
- [x] **S1 — Bounded worker concurrency + queue** (`MAX_CONCURRENT_WORKERS`, default 8):
      FIFO Semaphore caps simultaneously-active workers, queues the rest, sends a `queued` frame.
      Direct OOM fix (≤8 parallel × ~250MB ≈ 2GB vs 50 × 250MB ≈ 12.5GB). Verified: boots clean,
      env override honored, semaphore unit tests + `test:unit` 20/20. *(PR #48)*
- [x] **S2 — Per-worker resource caps**: `WORKER_MAX_OLD_SPACE_MB` → node `--max-old-space-size`;
      Docker backend reuses `EXEC_DOCKER_MEMORY`. *(PR #51)*
- [x] **S3 — Idle WS connection reaper**: `WS_IDLE_TIMEOUT_MS` + `shouldReapIdle()` (skips active
      workers; pong ≠ activity). *(PR #52)*
- [x] **S5 — Capacity load-test harness** (`scripts/loadtest/`, Phase A local). Calibrate defaults
      on a real 16G/8-core box + write results to README. *(PR #53)*

**Deferred to a future multi-machine goal (design stored, not executed for single-host 50):**
- [~] **Move execution off per-message spawn** → per-session warm pool. Not needed for single-host 50.
- [~] **Decouple tiers**: stateless gateway · shared state (Postgres/Redis) · object-store
      workspaces · queue-driven worker pool. Design in `research/2026-05-tier-decoupling-design.md`.
- [~] **Pick the scale backend** (Modal/Daytona/E2B vs self-managed pool) — multi-machine only.
- [~] **Concurrency spike 100 → 1000** — future multi-machine target.
- [x] **(folded from Phase 1) Unify path guards**: the 5 routes' duplicated
      `validateFilePath` → one shared `validateRelativePath` module (+ hardening, unit tests). (B3) *(PR #42)*
- [x] **(folded from Phase 1) Backpressure**: worker awaits stdout `drain`; ws-server pauses
      `worker.stdout` on high `ws.bufferedAmount` — a fast stream + slow client can't OOM. (C4) *(PR #43)*

**Exit criteria (revised):** `ExecutionRuntime` + srt sandbox live (✅); **bounded worker
concurrency + queue + per-worker resource caps**, with a capacity bench showing a single
16GB/8-core host sustains ~50 concurrent sessions without OOM. (Multi-machine tier
decoupling + the 1000-session benchmark are a *separate future goal*, design stored in
`research/2026-05-tier-decoupling-design.md`.)

---

## Phase 1 — Security hardening (gate before real/multi-tenant use) — ✅ CORE DONE

**Goal:** close the high-severity risks from the architecture review so the
product is safe to run with real data / real tenants.
**Status (2026-05-30):** core risks fixed + merged; app browser-verified end-to-end.
Remaining hardening items (B3 path-guard unify, C4 backpressure) are folded into
Phase 0.5 because the execution-runtime rewrite touches the same code.

- [x] **Sandbox the exec tools** (Python/Bash) — `srt` (deny-net, workspace-fenced FS)
      + secret env-strip; Linux-only OS sandbox, env-strip always on (PR #3, #29). *(Risk #1)*
- [x] Keep `canUseTool` active even in `bypassPermissions` mode (PR #15). *(Risk #2)*
- [x] Owner predicates fix **cross-tenant file/attachment access** (PR #4, 8 handlers). *(Risks #3,#4)*
- [x] `maxTurns` + wall-clock watchdog (PR #5). *(Risk #5; `maxBudgetUsd` deferred to Phase 2 cost work)*
- [x] Worker-crash terminal frame + removed dead `ws.abortController` (PR #22/#23/#24). *(Risk #10 / C2-C3)*
- [x] Unit test + CI hard-gate for the path-security guard (PR #26/#27).
- [ ] Fix deploy so the WS server actually boots; reconcile ports. *(Risk #8 — needs deploy access; HUMAN-REVIEW)*
- [ ] Multi-user cross-tenant **integration** test (needs DB+auth harness). *(folded into test work)*
- [→] B3 unify the two path-traversal guards · C4 backpressure → **moved to Phase 0.5** (same code).

**Exit criteria:** every "high"/"critical" review risk has a fix + a regression test.
**Met for Risks #1/#2/#3/#4/#5/#10** (code + unit/smoke + browser e2e). #8 and full
multi-user integration tests remain (tracked above / HUMAN-REVIEW).

---

## Phase 2 — Observability & accounting (make "production" measurable)

**Goal:** you can tell whether the system is healthy and what it costs.

- [ ] Actually meter usage (`spendOneCredit` is currently never called).
- [ ] Persist token/cost/turns per run server-side (from the SDK `result` event).
- [ ] Audit log table for security-relevant actions.
- [ ] Stop logging raw message content unconditionally (PII).

**Exit criteria:** per-run cost + usage visible and billable; an audit trail exists.

---

## Phase 3 — Catch up to (and pass) Deep Agents (capabilities)

**Goal:** match Deep Agents' harness strengths, on top of our platform advantages.

- [ ] **Todo / plan panel** (surface `TodoWrite` as structured UI).
- [ ] **First-class sub-agent panel** (nested input/output, not regex-detected).
- [ ] **Human-in-the-loop tool approval** (approve / reject / edit round-trip).
- [ ] **Checkpointing / durable run resume** (resume an interrupted run, not just reload history).
- [ ] **Context management** (summarization / compaction; memory layer).
- [ ] Unify shared logic so the two runtimes can't fork (skill-sync, path guards).

**Exit criteria:** parity-or-better with `deep-agents-ui` on todo/sub-agent/HITL,
plus durable resume — while keeping our isolation + multi-tenant + web edge.

---

## Phase 4 — Multi-model & scale maturity

**Goal:** real provider abstraction and horizontal scale.

- [ ] Model registry / capability catalog / provider routing + failover.
- [ ] Split shared credentials per capability (remove single-key blast radius).
- [ ] Concurrency caps / backpressure / horizontal scale story for ws-server.

**Exit criteria:** swap/route models without code changes; bounded resource use under load.
