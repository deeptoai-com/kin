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

**Goal:** decide and stand up the execution model the rest of the product depends on,
**before** pouring effort into a single-node design that can't scale. Grounded by
[`research/2026-05-scalability-and-runtime.md`](./research/2026-05-scalability-and-runtime.md).

Why now: the current model — a per-**message** Node child spawn behind a single
stateful `ws-server`, with local-disk + in-memory session state — cannot reach
hundreds/thousands of concurrent sessions, and it gates sandboxing (Risk #1),
checkpointing, and cost. Deep-read of hermes-agent, deer-flow, ruflo, and Anthropic's
`sandbox-runtime` validated a clear path.

- [ ] **Adopt `@anthropic-ai/sandbox-runtime` (srt)** (TS, Apache-2.0) as the exec
      sandbox primitive — deny-network + workspace-fenced FS per tool-call. This *is*
      the Risk #1 fix; it uses bubblewrap (already installed) under the hood on Linux.
- [ ] **Define a TS `ExecutionRuntime` interface** (start / exec / stream / abort /
      snapshot / stop) — pattern from hermes-agent `BaseEnvironment` + deer-flow
      `SandboxProvider`. First backend: local-process + srt.
- [ ] **Move execution off per-message spawn** → per-session sandbox (warm pool,
      reused across messages) behind that interface.
- [ ] **Decouple tiers**: stateless web/WS gateway · shared session state
      (Postgres/Redis) · object-store workspaces · queue-driven worker pool.
- [ ] **Pick the scale backend** (spike): serverless sandboxes (Modal/Daytona/E2B,
      hibernate-on-idle, Node SDKs) vs self-managed container pool (Docker → K8s
      provisioner, à la deer-flow). Decide **Plan A (integrate)** vs **B (self-build)**.
- [ ] **Concurrency spike**: memory/latency curve at 100 → 1000 concurrent sessions.
- [ ] **(folded from Phase 1) Unify path guards**: the worker's `path-security.js`
      `canUseTool` vs the route-level `validateFilePath` (5 routes) — share one module. (B3)
- [ ] **(folded from Phase 1) Backpressure**: honor `ws.bufferedAmount` in `sendMessage`
      and await stdout `drain` in the worker, so a fast stream + slow client can't OOM. (C4)

**Exit criteria:** a TS `ExecutionRuntime` abstraction with srt sandboxing live; a
documented A-vs-B decision + a 1000-concurrent-session benchmark; execution no longer
pinned to a single box.

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
