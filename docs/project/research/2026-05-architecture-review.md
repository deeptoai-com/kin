# OxyGenie — Adversarial Architecture Review & Deep Agents Comparison

> **Status:** frozen research snapshot · **Date:** 2026-05 · **Subject:** the
> `oxygenie` codebase (formerly `constructa-starter`) vs the Deep Agents family.
>
> Method: a read-only, multi-agent review — parallel investigators per workstream,
> independent adversarial refuters per major finding, and comparison agents vs the
> Deep Agents Python/JS/UI references and the Claude Agent SDK docs. Every finding
> below survived (or was downgraded by) an adversarial refuter. Refuted/overstated
> claims were dropped. File paths are repo-relative to the product root.

---

## 1. What OxyGenie is architecturally trying to be

An **enterprise, multi-tenant, web-delivered autonomous Claude-agent platform**
on TanStack Start (SSR + Nitro), running **two independent agent runtimes**:

1. **Process-isolated Claude Agent SDK runtime** (the real interactive loop):
   `ws-server.mjs` owns `/ws/agent` (`ws-server.mjs:1195`), authenticates each
   socket by HTTP-calling Better Auth (`ws-server.mjs:567`), and spawns a fresh
   child per message (`ws-server.mjs:771`). The child `ws-query-worker.mjs` calls
   `@anthropic-ai/claude-agent-sdk@0.1.76`'s `query()` (`ws-query-worker.mjs:427`)
   in a per-session workspace with per-user `CLAUDE_HOME`, a path-security guard,
   dynamic MCP servers, and on-disk Skills.
2. **In-process Mastra runtime** (`src/mastra`) over HTTP/SSE (`src/routes/api/chat.tsx`),
   Zhipu GLM (`zhipuai/glm-5.0`).

Defining trait: **process isolation of the agent loop from the web tier.**
OxyGenie is **not** a harness in the Deep Agents sense — it delegates the loop to
the SDK's `claude_code` preset (`ws-query-worker.mjs:442,451-455`) and invests in
the multi-tenant platform shell. It is **two single-vendor runtimes** (Anthropic
for chat, Zhipu for Mastra) plus a genuinely pluggable MCP/Skills layer — not a
unified multi-model router.

---

## 2. Architecture map

### Layers

| Layer | Key paths | Role |
|---|---|---|
| Web/SSR (TanStack Start + Nitro) | `src/router.tsx`, `src/start.ts`, `src/routes/**`, `vite.config.ts` | HTTP/SSR + UI; all `/api/*`; auto-migrate on boot (`src/start.ts:10-12`) |
| Claude WS runtime (isolated) | `ws-server.mjs`, `ws-query-worker.mjs`, `start-production.mjs` | The real Claude loop: socket, auth-by-HTTP, session/workspace/skills, child lifecycle, DB-via-HTTP |
| Claude shared modules | `src/claude/path-security.js`, `src/claude/mcp/manager.js`, `src/claude/python/runner.js`, `src/claude/adapters/ws-adapter.ts`, `src/claude/skills/*` | `.js` runs in worker; `.ts` serves Nitro/browser |
| Mastra runtime | `src/mastra/*`, `src/routes/api/chat.tsx` | 2nd runtime; in-process; HTTP/SSE; GLM |
| Server fns & API | `src/server/*`, `src/routes/api/agent-sessions/*`, `src/routes/api/workspace/$sessionId.*` | `/api/agent-sessions` + `/api/auth/*` are the callbacks the WS server uses |
| Persistence | `src/db/schema/*` | `agent_session` (Claude index) + `mastra_thread` (Mastra) — separate models |
| Background jobs | `src/worker/*` | BullMQ: credit refill + Meilisearch reindex |
| Deploy | `Dockerfile`, `docker-compose*.yml`, `infra/deploy/*`, `.github/workflows/*` | Multi-stage image; Node+Python+LibreOffice+Playwright |

### Runtime flow — Claude chat (the real loop)
1. Browser mounts Assistant UI with `ClaudeAgentWSAdapter` (`src/claude/adapters/ws-adapter.ts`).
2. Persistent WS to `/ws/agent`; `run()` sends `{type:'chat',...}`.
3. Socket terminates in `ws-server.mjs` (not Nitro); auth via `/api/auth/get-session`.
4. `handleChat` (`ws-server.mjs:658`) resolves CLAUDE_HOME/workspace, `.claude` symlink, syncs Skills, fetches org permission mode, spawns the worker (`:771`).
5. Worker builds path-security `canUseTool` + MCP servers, calls `query()` (`:427`).
6. Worker streams SDK events as stdout JSON lines; `ws-server` forwards `{type:'message',event}`; on `system.init` captures SDK `session_id` and POSTs `/api/agent-sessions`.
7. Browser maps SDK blocks → Assistant UI parts (text throttled 100ms) into a Zustand store.

### Verified correction
`vite.config.ts:42-43` claims a Nitro plugin `server/plugins/websocket.mjs` handles
the WS server — **that file doesn't exist**; the WS server boots only via
`start-production.mjs`/`start.sh`. Dead documentation.

---

## 3. Deep Agents (Python) comparison
*Ref: `references/useful_frameworks/deepagents`*

| Capability | OxyGenie | Deep Agents (Py) | Assessment |
|---|---|---|---|
| Owns the agent loop | Delegated to SDK `query()` + `claude_code` preset | `create_deep_agent` builds a LangGraph middleware stack (`graph.py:217`) | divergent-goals |
| Planning/todo | None of its own; renders count only | `TodoListMiddleware` in every stack | reference-better |
| Sub-agents | SDK Task tool only; forwards `parent_tool_use_id` | `SubAgentMiddleware`, per-subagent overrides | reference-better |
| Virtual filesystem | Real on-disk per-session workspace, path-fenced | Pluggable backends (State/FS/Sandbox/Store) | divergent-goals |
| State/durability | Stateless per msg; SDK `resume` + DB map | LangGraph checkpointer, `DeltaChannel` reducer | divergent-goals |
| Human-in-the-loop | Hard allow/deny only, no round-trip | `HumanInTheLoopMiddleware` (approve/edit/reject) | reference-better |
| FS access control | Per-user prefix + realpath + cross-user denial | `FilesystemPermission` rules | **oxygenie-better** |
| Sandbox/exec isolation | OS process-per-msg + Docker | optional `SandboxBackendProtocol` | **oxygenie-better** |
| Context mgmt | none of its own (relies on preset) | summarization + prompt caching + memory | reference-better |
| Multi-tenant identity | first-class (auth/org/roles) | out of scope | **oxygenie-better** |

**Takeaway:** OxyGenie invests in the *platform*; Deep Agents *is* the harness.
Not substitutes. We win on isolation/multi-tenancy/FS-fencing; they win on
planning/sub-agents/HITL/checkpointing/context — because those are harness features
we chose not to own.

---

## 4. Deep Agents JS comparison
*Ref: `references/useful_frameworks/deepagentsjs`*

| Capability | OxyGenie | Deep Agents JS | Assessment |
|---|---|---|---|
| Construction API | direct `query()` options object | `createDeepAgent()` factory → compiled graph (`agent.ts:140-502`) | divergent-goals |
| Compile-time typing | none — untyped `.mjs`, JSON over stdin | heavy generic inference (`types.ts:104-227`) | reference-better |
| Structured responses | opt-in `outputFormat`, env+regex gated | typed `responseFormat` strategies | reference-better |
| Subagent streaming | `parent_tool_use_id` rollup only | typed `run.subagents` (`stream.ts:49-112`) | reference-better |
| HITL / interrupts | `canUseTool` deny only | `interruptOn` + checkpoint pause | divergent-goals |
| Checkpointing | none; SDK `resume` | `checkpointer`/`store` → full graph state | divergent-goals |
| Run cancellation | **OS process kill** (reliable) | in-process `config.signal` only | **oxygenie-better** |
| Multi-tenant/web | built-in | out of scope | **oxygenie-better** |
| Process isolation | child per message | in-process graph | **oxygenie-better** |

**Takeaway:** starkest gap is **type safety**; biggest offset is our
**process-isolated cancellation**.

---

## 5. Deep Agents UI comparison
*Ref: `references/useful_frameworks/deep-agents-ui`*

| Capability | OxyGenie | Deep Agents UI | Assessment |
|---|---|---|---|
| Streaming render | custom generator, 100ms throttle, reasoning split | `useStream` reduces server stream | **oxygenie-better** |
| Tool-call viz | rich per-turn timeline + per-type drawers | generic expandable boxes | **oxygenie-better** |
| Sub-agent (Task) viz | none dedicated (regex "backgrounded") | first-class `SubAgentIndicator` | reference-better |
| Todo / plan panel | **none** | dedicated todo panel from `stream.values.todos` | **oxygenie-missing** |
| File/artifacts | real disk tree + artifact previews | editable in-state `Record<string,string>` | divergent-goals |
| HITL approval | **none** (programmatic deny only) | full approve/reject/edit + Debug step-through | reference-better |
| Reconnect/error | app-level backoff + re-resume + beforeunload | delegated to SDK | **oxygenie-better** |
| Run queueing | promise-gate + epoch cancel + switch modal | single `isLoading` gate | divergent-goals |

**Three concrete UI gaps to borrow:** (1) todo/plan panel, (2) first-class
sub-agent panel, (3) HITL approve/reject/edit.

---

## 6. Claude Agent SDK alignment
*Verified vs installed `@anthropic-ai/claude-agent-sdk@0.1.76` + docs.*

| Surface | OxyGenie usage | Aligned? |
|---|---|---|
| Package/version, `query()` entry, options shape | correct for 0.1.76 | ✅ |
| `canUseTool`/`PermissionResult` | conforms; realpath + cross-user denial exceed baseline | ✅ strong |
| `permissionMode` union | hardcodes `delegate` (not in docs), omits `auto` | ⚠️ divergent |
| MCP servers (sdk/stdio/sse/http) | uniform per-user resolution + `${VAR}` templating | ✅ strong |
| `settingSources:['project']` + Skills | via `.claude` symlink | ✅ (symlink-dependent) |
| system prompt / tools preset | correct `{type:'preset',...}` | ✅ |
| Subagents (`agents` option) | **never used**; `Agent` absent from `allowedTools` | ❌ unused |
| Hooks | **never configured** | ❌ unused |
| `maxTurns`/`maxBudgetUsd` | supported, **not used** | ❌ |
| AbortSignal / `interrupt()` | supported, **not used** (`ws.abortController` is dead code) | ❌ |
| In-repo CLAUDE.md SDK docs | stale/wrong signatures | ❌ doc drift |

**Net:** call-shape alignment is high; safety options + subagents/hooks go unused.

---

## 7. Capabilities that are MISSING

1. Turn / wall-clock / token-cost bound on the loop (`ws-query-worker.mjs:429-465`; no watchdog).
2. Usage metering that runs — `spendOneCredit` (`src/server/credits.ts:46`) has **zero callers**.
3. Server-side token/cost accounting — the SDK `result` event is forwarded but **not persisted** (`ws-server.mjs:806-867`).
4. Audit log — no audit table exists.
5. Real OS sandbox — `bubblewrap` installed (`Dockerfile:62`) but **never invoked**.
6. HITL approval, todo panel, sub-agent panel (vs `deep-agents-ui`).
7. Unified model registry / provider failover.
8. Conversation checkpointing (`resumeSessionAt` exists in SDK, unused).
9. Subagents & hooks (`agents`/`hooks` never passed).

---

## 8. Capabilities that EXIST but are FRAGILE

1. `bypassPermissions` removes the path-security guard entirely (`ws-query-worker.mjs:435-436`).
2. Cancellation is process-kill only; `ws.abortController` is dead code (`ws-server.mjs:1058-1060,1230`).
3. Concurrent same-connection message silently kills the in-flight worker (`ws-server.mjs:661-665`).
4. Silent socket death parks the client generator forever — no timeout (`ws-adapter.ts:823-826`).
5. Forked skill-sync — two *live* divergent paths (inline JS in `ws-server.mjs` vs TS `manager.ts`).
6. Two divergent path-traversal guards over the same files (`ws-query-worker.mjs:189` vs `$sessionId.file.$filePath.ts:14-37`).
7. No backpressure on worker stdout / WS send.
8. No global concurrency cap (one worker per connection).
9. Single shared `ZHIPU_API_KEY` (chat + image + 4 MCP servers).
10. Unconditional message-content logging (`ws-server.mjs:952,1158`) → PII in logs.
11. `requireUser()` fails open to `dev-user-123` when `NODE_ENV!=='production'` (`require-user.ts:20-34`).
12. Structured output gated by a filename regex + env flag (`ws-query-worker.mjs:131-142,214-221`).

---

## 9. Where our design may be BETTER / more appropriate

1. Process-isolated agent loop (fault + tenant isolation; clean kill-on-abort).
2. Cross-user FS denial + realpath anti-symlink (`path-security.js:147-163,289-296`).
3. Config-driven, provider-pluggable MCP layer (`manager.js`).
4. Sophisticated web tier (streaming throttle, reconnect/re-resume, run-queue, artifacts).
5. OS-process cancellation (reliably reclaims compute).

---

## 10. Top 10 risks (post-refutation, ranked)

| # | Risk | Severity | Evidence |
|---|---|---|---|
| 1 | **Python MCP tool = arbitrary code exec OUTSIDE the path guard, with full secrets env + unrestricted network** | **critical** | `path-security.js:4,270-272`; `python/runner.js:196-205`; `ws-query-worker.mjs:226-271,324-331`; `ws-server.mjs:734-744` |
| 2 | `bypassPermissions` disables `canUseTool` entirely | high | `ws-query-worker.mjs:435-436`; `path-security.js:289-305` |
| 3 | Cross-tenant file download (no owner predicate) | high | `$sessionId.documents.ts:124-131,170-205` |
| 4 | Cross-tenant attachment access | high | `message-attachment.server.ts:99-151` |
| 5 | No turn/timeout/cost cap on the loop | high | `ws-query-worker.mjs:429-465` |
| 6 | No OS sandbox; bubblewrap installed but unused | high | `ws-server.mjs:771`; `Dockerfile:62,138` |
| 7 | Usage credits never deducted (`spendOneCredit` unused) | high | `credits.ts:46-72` |
| 8 | Deploy bypasses the WS server; port mismatch | high | `infra/deploy/compose.yml:14-16`; `start-production.mjs`; `Dockerfile:99,151` |
| 9 | `dokku config:set` interleaves comment lines (env risk) | high | `.github/workflows/deploy.yml:123-160` |
| 10 | Silent socket death + unsignaled worker crash → hung UI | high | `ws-adapter.ts:823-827`; `ws-server.mjs:884-910` |

**Refuted/downgraded (excluded):** `realSdkSessionId` drift (SDK keeps id on non-fork
resume); `sessionMapping` lost on restart (persisted in Postgres); `messageHandler`
corruption (overstated); hardcoded Mastra model (trivial → low).

---

## 11. Top 10 highest-leverage fixes (effort S/M/L)

| # | Fix | Effort | Addresses |
|---|---|---|---|
| 1 | Route non-file tools (python/Bash) through `canUseTool`; strip secrets from worker/python env | M | Risk 1 |
| 2 | Run exec tools under `bubblewrap --unshare-net` + workspace-only binds | M | Risks 1,6 |
| 3 | Add owner predicates to `documents.ts` / `message-attachment.server.ts` | S | Risks 3,4 |
| 4 | Wire `maxTurns`/`maxBudgetUsd` + server watchdog | S+S | Risk 5 |
| 5 | Call `spendOneCredit` + persist usage/cost from the `result` event | M | Missing #2/#3 |
| 6 | Fix deploy to boot `start-production.mjs`; reconcile ports | M | Risk 8 |
| 7 | Rewrite `dokku config:set` (drop interleaved comments) | S | Risk 9 |
| 8 | Client heartbeat/idle timeout + terminal frame on worker crash | M | Risk 10 |
| 9 | Keep `canUseTool` in `bypassPermissions` (narrowed) | M | Risk 2 |
| 10 | Collapse skill-sync to one shared module; guard message-content logging | M+S | Fragile 5,10 |

---

## 12. Recommendation

**Harden the current design — security first — and borrow three UI patterns
(todo panel, sub-agent panel, HITL). Do NOT migrate to or integrate Deep Agents.**
The comparison shows Deep Agents is a single-process library with divergent goals;
OxyGenie's process isolation, multi-tenancy, web tier, and SDK alignment are the
assets. Surviving risks are security/resource-bounding gaps, not architectural
dead-ends — most are small wires into features the codebase already ships
(`bubblewrap`, `canUseTool`, `maxTurns`, `spendOneCredit`). The single most urgent
item is **Risk #1** (unsandboxed Python exec with full secrets) — exploitable today.

---

## 13. Minimal spike plan (each with pass/fail)

1. **Contain the Python/exec tool** — bubblewrap `--unshare-net` + workspace bind + secret-stripped env. *Pass:* a Python tool call can't read `ANTHROPIC_API_KEY`, can't open a socket, can't read another user's workspace.
2. **Cross-tenant proof** — owner predicates; test user B requesting user A's `fileId`/attachment is denied.
3. **Budget + watchdog** — `maxTurns`/`maxBudgetUsd` + timeout; a looping prompt terminates and an abandoned worker is killed with a terminal frame.
4. **Usage accounting** — completed turn writes a usage ledger row + server-side cost; balance decrements.
5. **Deploy boots both servers** — fresh deploy serves web + a working `/ws/agent`.
6. **UI liveness** — killing the worker/socket surfaces an error and unblocks the composer within N seconds.
7. **Borrow todo + sub-agent + HITL panels** — a plan renders as a todo panel, a Task shows a nested sub-agent card, a gated tool prompts before proceeding.

---

### Provenance note
Finding IDs are not globally unique across workstreams; each verdict was attributed
by evidence content. Matrices/§1–§6 are taken from the comparison/investigator
agents; §7–§13 are synthesized across all ten workstreams. Re-run as a new dated
file under `research/` if the review is repeated.
