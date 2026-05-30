# OxyGenie — Scalability & Execution-Runtime Research

> **Status:** decision-grade research snapshot · **Date:** 2026-05-30
> **Question:** can OxyGenie's current execution model serve hundreds/thousands of
> concurrent sessions, is there a more elegant design, and which mature projects can
> we adopt? Grounded by a deep-read of four reference repos (see `references/INDEX.md`).

---

## 1. The problem with the current execution model

OxyGenie today runs the real agent loop as a **fresh Node child process per chat
message** (`ws-server.mjs:771` → `ws-query-worker.mjs`) behind a **single stateful
`ws-server`** process, with **per-user `CLAUDE_HOME` + per-session workspace on local
disk** and an **in-memory `sessionMapping`** (`ws-server.mjs:214`). Consequences:

- **Per-message spawn** loads the full SDK each time (~80–200 MB, hundreds of ms).
  ~1000 concurrent messages ⇒ ~1000 Node processes ⇒ 100+ GB RAM — infeasible on one box.
- **Single ws-server** = vertical bottleneck + SPOF; no clustering.
- **Local state** (disk workspaces + in-memory map) ⇒ can't run N gateway replicas.
- No queue / backpressure / concurrency cap.

**Verdict:** fine for a single-node prototype; **not** built for hundreds/thousands of
concurrent sessions. The execution layer needs a deliberate architecture decision
**before** investing in security hardening / feature catch-up that would be rebuilt.

---

## 2. What the deep-read found (hypotheses → verdicts)

| # | Hypothesis | Verdict | Evidence |
|---|---|---|---|
| H1 | hermes-agent gives a pluggable runtime-backend abstraction incl. serverless sandboxes | ✅ Confirmed | `tools/environments/base.py` `BaseEnvironment` ABC; Local/Docker/SSH/Singularity/Modal/Daytona backends; per-session LRU agent cache (128, 1h TTL) in `gateway/run.py`; SQLite session store resumable; Modal/Daytona snapshot hibernate/wake. **MIT, Python.** |
| H2 | deer-flow validates a deployable backend/frontend + sandbox-mode + sizing | ✅ Confirmed | `backend/.../sandbox/sandbox_provider.py` `SandboxProvider` ABC (acquire/get/release); Local/Docker/**K8s-provisioner** backends; per-`{user}/{thread}` dirs; LangGraph checkpointer (SQLite→Postgres); SSE `StreamBridge`; sizing 8vCPU/16GB+ shared. **MIT, Python/FastAPI.** |
| H3 | ruflo is a different problem (local Claude Code augmentation), not server scaling | ✅ Confirmed | Installs into user `.claude/`, local stdio MCP + hooks (`bin/cli.js`, `plugin/hooks/hooks.json`); "federation" = peer mTLS between user machines; "swarm" = single-machine bash `&`; **no sandbox**. **MIT, TS.** Borrowable only: 3-tier model routing, HNSW memory. |
| H4 | sandbox-runtime is the low-level sandbox primitive to wrap | ✅✅ Confirmed (better than hoped) | **Anthropic `@anthropic-ai/sandbox-runtime` (srt) — TypeScript, Apache-2.0.** macOS Seatbelt + Linux bubblewrap+seccomp+namespaces + Windows WFP; deny-net + workspace-fenced FS by default; CLI `srt <cmd>` **and** library `SandboxManager.wrapWithSandbox(cmd)` → `spawn`. |

**Headline:** the sandbox primitive we need is an **Anthropic-maintained, TypeScript,
Apache-2.0 library** that drops into our Node server in ~10 lines and directly fixes the
critical Risk #1 (unsandboxed Python/Bash with full secrets + network).

---

## 3. Reference details worth keeping

### hermes-agent (Nous Research) — runtime-backend abstraction (pattern template)
- `BaseEnvironment` (`tools/environments/base.py`): `execute()`, abstract `_run_bash() → ProcessHandle`,
  `init_session()`, `cleanup()`, `_before_execute()` (file-sync hook). `ProcessHandle` duck-typed
  protocol; `_ThreadedProcessHandle` bridges blocking SDK calls to a unified poll loop.
- Backends: `local.py`, `docker.py` (hardened: `--cap-drop ALL`, `no-new-privileges`, `--pids-limit`,
  tmpfs), `ssh.py`, `singularity.py`, `modal.py` (serverless + snapshot id store), `daytona.py`
  (named sandbox stop/start = hibernate/wake).
- Session: per-session long-lived agent, LRU(128)+1h TTL (`gateway/run.py`); SQLite (`hermes_state.py`)
  resumable across restarts.
- **Borrow (pattern, re-impl in TS):** the `BaseEnvironment`/`ProcessHandle` interface; per-session
  cache+eviction; Modal/Daytona create-on-first-use + hibernate + snapshot-id persistence (both have Node SDKs).

### deer-flow (ByteDance) — deployable architecture + pluggable sandbox provider
- `SandboxProvider` ABC (`backend/.../sandbox/sandbox_provider.py`): `acquire/get/release`; `Sandbox`
  ABC (`sandbox.py`): `execute_command`, file ops. Pluggable by dotted class path in `config.yaml`
  (`resolve_class()`); Local / Docker / **Kubernetes provisioner sidecar** (sandbox pods, port 8002).
- Runtime: single asyncio FastAPI gateway; per-turn `asyncio.Task` (`runtime/runs/worker.py`); SSE
  `StreamBridge`; sub-agents via thread pools (cap 3); LangGraph checkpointer; per-`{user}/{thread}` dirs.
- Claude Code integration via ACP (`invoke_acp_agent` → `npx @zed-industries/claude-agent-acp`).
- **Borrow (pattern):** `SandboxProvider.acquire/release` lifecycle; K8s-provisioner sidecar for
  sandbox pods (a concrete Plan-B scale path); per-user/thread isolation; checkpointer for resume.

### sandbox-runtime (Anthropic `srt`) — the sandbox primitive to adopt
- TS (Node ≥18), Apache-2.0. `SandboxManager.initialize(config)` + `wrapWithSandbox(cmd)` → `spawn`.
- Config: `network.allowedDomains` (`[]` = none), `filesystem.denyRead/allowRead/allowWrite/denyWrite`.
- macOS `sandbox-exec`; Linux bwrap + seccomp BPF (vendored) + net-namespace removal + socat proxy
  (deps: `bubblewrap`, `socat`, `ripgrep` — we already install bubblewrap); Windows WFP.
- **Caveat:** `SandboxManager` is module-level singleton → true per-session isolation needs process
  separation or careful `reset()` sequencing (fits a per-session worker model well).
- Key files: `src/sandbox/sandbox-manager.ts`, `.../linux-sandbox-utils.ts`, `.../macos-sandbox-utils.ts`.

### ruflo — not our problem (recorded so we don't re-investigate)
- Local Claude Code augmentation (hooks/daemon/local MCP); peer federation, not server scaling; no sandbox.
- Borrow only: 3-tier model-routing heuristic; HNSW vector memory (`AgentDBBackend.ts`) if we add semantic recall.

---

## 4. Target architecture (proposed)

Three decoupled tiers, each scaled independently:

```
[ Browser ]
    | WS/SSE
[ Stateless Gateway ]  (Nitro + a thin WS relay; no session state held locally)
    | enqueue / route by sessionId
[ Queue (Redis/NATS/SQS) ]
    |
[ Agent Worker Pool ]  (horizontal; each worker drives the SDK loop)
    |  ExecutionRuntime (TS interface)
    +-- backend: local-process + srt        (now / dev)
    +-- backend: container (Docker)          (next)
    +-- backend: serverless sandbox          (scale: Modal / Daytona / E2B, hibernate-on-idle)
[ Shared state ]  Postgres/Redis (sessions, mappings, checkpoints) + object store (workspaces)
```

- **Sandbox primitive:** `srt` wraps every tool exec (deny-net, workspace-fenced FS).
- **Per-session sandbox** (warm pool, reused across messages) replaces per-message spawn.
- **State is shared, not local** → any worker handles any session; gateways are stateless/replicable.
- **`ExecutionRuntime` interface** (`start/exec/stream/abort/snapshot/stop`) isolates the backend
  choice so we can start local and grow to serverless/K8s without touching the agent loop.

---

## 5. Decision: Plan A vs Plan B

- **Plan A — Integrate, don't reinvent (recommended lean).** Adopt **srt** for sandboxing
  immediately (it's TS/Apache-2.0/Anthropic). For scale, wrap a **serverless sandbox provider
  (Modal or Daytona, both have Node SDKs; or E2B)** behind the `ExecutionRuntime` interface —
  offloading the hard "schedule thousands of sandboxes across hosts" problem to a managed service.
- **Plan B — Self-build the pool.** If managed sandboxes are too costly / not self-hostable enough,
  build a Docker→Kubernetes provisioner pool (deer-flow's model) behind the same interface.

**Recommendation:** adopt **srt now** (independent of A/B — it's the Risk #1 fix and the local
backend), define the **`ExecutionRuntime`** interface, and run a **bake-off spike** (Modal/Daytona
vs Docker/K8s) at 100→1000 concurrent to choose A vs B with data. The interface means the choice
is reversible and incremental.

---

## 6. Spike plan (Phase 0.5)

1. **srt integration spike** — wrap the Python/Bash tool exec with `SandboxManager.wrapWithSandbox`;
   *pass:* a tool call can't read `ANTHROPIC_API_KEY`, can't open a socket, can't read another
   user's workspace (this is the Risk #1 acceptance test).
2. **`ExecutionRuntime` interface + local backend** — define `start/exec/stream/abort/snapshot/stop`;
   port one chat path off per-message spawn to a per-session sandboxed runtime.
3. **State decoupling spike** — move `sessionMapping` + workspace pointers to Postgres/Redis +
   object store; run two gateway replicas behind a load balancer for one logical session.
4. **Scale bake-off** — implement a Modal *or* Daytona backend and a Docker backend; benchmark
   memory/latency at 100 → 1000 concurrent sessions; record the curve; **decide A vs B**.

---

## 7. Relationship to the earlier review

The earlier architecture review (`2026-05-architecture-review.md`) said "harden, don't migrate to
Deep Agents" — that still holds (Deep Agents is a harness *library*, orthogonal to execution scale).
This research adds the missing dimension: the **execution/runtime + scale layer** needs a decision
(Phase 0.5) before Phase 1/3. Several Phase 1 items (esp. Risk #1 sandboxing, and checkpointing in
Phase 3) are *subsumed* by adopting srt + the `ExecutionRuntime` abstraction.

_Provenance: deep-read by 4 constrained parallel sub-agents over the on-disk reference repos
(hermes-agent `689ef5e`, deer-flow `e8e9edc`, ruflo `48ca369`, sandbox-runtime `c738eaf`), 2026-05-30._
