# OxyGenie — Status (Living Memory)

> **This is the living memory of the project. Update it whenever state changes.**
> Last updated: **2026-05-31**

## Current position (one-paragraph snapshot)

**2026-05-31 — Phases 0/1/0.5/2 are DONE; Phase 3 (capabilities + UI/UX overhaul) is IN PROGRESS —
Wave 0 + Wave 1 merged (#60).** Phase 0.5 delivered the execution-runtime abstraction + single-host concurrency
governance (target: one 16G/8-core VPS ~50 concurrent sessions): `ExecutionRuntime`+`LocalProcessBackend`
(#39), `DockerBackend` (#41), unified path guard B3 (#42), WS backpressure C4 (#43/#45), bounded
worker concurrency S1 (#48), per-worker heap cap S2 (#51), idle-connection reaper S3 (#52), load-test
harness S5 (#53). Phase 2 delivered observability+accounting: per-run `usage_record` (#55), `audit_log`
(#56), token metering + quota mechanism **OFF by default** (#57, rate stays config-driven, calibrate
from real usage data later — see `research/2026-05-billing-design.md`). **Phase 3 Wave 0 + Wave 1 are
merged (#60)**: design tokens redone to Direction A "暖雾奶油" (warm-cream + terracotta, 换皮不换骨 —
only `app.css` token values, shadcn/Radix kept), a three-column `WorkbenchPanel` skeleton (Progress /
Sub-agents / Files / Context, placeholder 3D-icon slots), and the front-end line ① Progress = live
TodoWrite checklist + ② Sub-agents = flat Task list (pure store selectors in
`src/lib/hooks/use-session-workbench.ts`, no adapter change, unit-tested 11/11). **Next: Wave 2**
(Ask/Act mode + ③ HITL tool approval — backend-heavy, needs a small design sub-doc per PHASE3-PLAN §5
before implementing). Follow-ups: nested sub-agent tree (needs `parent_tool_use_id` on tool-call parts),
responsive workbench drawer below `lg`, Inter/Source-Serif font files, owner-supplied 3D icons.
Historical note below (kept for context).

## 🔴 Release blockers (must fix before multi-user / public release)

> Acceptable to defer during single-user / local dev; **must be closed before opening to multiple
> tenants or the public internet.**

- **R4 — Bash tier-gating gap** ([Issue #69](https://github.com/foreveryh/oxygenie/issues/69),
  labels: `security` `release-blocker`). `wantsBash` is not threaded front-end → ws-server → worker,
  so the permission tiers (Explore/Auto/Act) don't fully gate Bash; a tier could reach Bash it
  shouldn't, or the gate is bypassed. Fix = thread `wantsBash` so the worker's `resolveDisallowedTools`
  gates by tier + wantsBash; verify on real runs across all three tiers. ~2-line core fix, but it's a
  **security boundary** — do not ship multi-user with it open.

### Historical snapshot (2026-05-30, first browser-verified run)

**🎉 2026-05-30: the app now runs and was VERIFIED IN A BROWSER end-to-end.** Hybrid local mode
(Docker deps db/redis/minio/meili + `node start-production.mjs` on :3000, WS :3001 — see WORKLOG
run recipe). A human registered, opened a chat, and ran a Python tool task ("compute 2**10 →
result.txt"): the full path works — ByteDance Ark (`ark-code-latest`) streaming → multi-step tool
loop → real Python execution → file written (`1024`). Three real bugs were found *by* this browser
testing and fixed: Invalid origin (BETTER_AUTH_URL/VITE_BASE_URL 5050→3000), WebSocket couldn't
connect (VITE_WS_URL → :3001), and the Python tool was killed by srt's macOS Seatbelt (PR #29:
OS sandbox now Linux-only, secret env-strip always on).

Research is done — the adversarial architecture review + Deep Agents comparison
([`research/2026-05-architecture-review.md`](./research/2026-05-architecture-review.md))
**and** a scalability / execution-runtime study
([`research/2026-05-scalability-and-runtime.md`](./research/2026-05-scalability-and-runtime.md)).
**Phase 0 (Foundation) is largely done** (repo split, CI gates + branch protection, project
memory, Docker dev stack, live ByteDance Ark model + passing e2e smoke). We are now **mid
Phase 1 (security hardening)** — Risks #1/#2/#3/#4/#5/#10 + D4 shipped as merged PRs. The
runtime study added **Phase 0.5** (execution-runtime + sandbox re-platform) which still needs a
human design checkpoint + sandbox-backend budget before it starts (see HUMAN-REVIEW.md).
Caveat: several Phase-1 fixes are code-verified (node --check / unit / smoke) but their full
WS+auth+DB integration behavior is **NEEDS-VERIFY** pending the running stack.
**Autonomous sprint in progress** (see `SPRINT-2026-06.md`): first security fixes have landed on
main — Risk #1 (srt exec sandbox), Risks #3/#4 (cross-tenant scoping), Risk #5 (turn/wall-clock
bounds). **Live model is now wired & verified end-to-end** via ByteDance Ark (`ark-code-latest`,
Anthropic-compatible) — `scripts/smoke-agent.mjs` drives a real agent run (query → stream → tool →
file → done). The earlier GLM-plan blocker is resolved.

## Phase tracker

| Phase | State |
|---|---|
| Research (architecture review, Deep Agents comparison, scalability/runtime) | ✅ Done |
| **Phase 0 — Foundation** | ✅ Largely done (repo/CI/dev-stack/live-model) |
| **Phase 1 — Security hardening** | ✅ Core done (Risks #1/#2/#3/#4/#5/#10) |
| **Phase 0.5 — Execution-runtime + single-host concurrency** | ✅ Done (ExecutionRuntime #39, DockerBackend #41, B3 #42, C4 #43/#45, S1 #48, S2 #51, S3 #52, S5 #53) — single 16G/8-core ~50 concurrent target |
| **Phase 2 — Observability & accounting** | ✅ Done (usage_record #55, audit_log #56, metering+quota OFF-by-default #57) |
| **Phase 3 — Catch up to Deep Agents (capabilities + UI/UX)** | 🟡 In progress — Wave 0 (tokens A "暖雾奶油" + 3-col workbench skeleton) + Wave 1 (① Todo, ② Sub-agents) merged (#60); next: Wave 2 (Ask/Act + ③ HITL) |
| Phase 4 — Multi-model & scale | ⬜ Not started |

## Done (most recent first)

- ✅ **Phase 3 Wave 0 + Wave 1** (PR #60): redo design tokens → Direction A "暖雾奶油" (warm-cream +
  terracotta primary, radius 1.25rem, soft warm shadows; only `app.css`, shadcn/Radix kept) + new
  three-column `WorkbenchPanel` skeleton (Progress/Sub-agents/Files/Context, placeholder 3D-icon slots,
  hidden below `lg`) + ① Progress live TodoWrite checklist + ② Sub-agents flat Task list (pure store
  selectors, no adapter change). Verified: `pnpm build` ✓, `test:unit` 11/11, real app light/dark/mobile +
  panels rendered (injected data via a temporary, reverted store-exposure). Direction preview:
  `docs/project/wave0-design/preview.html`. *(2026-05-31)*

- ✅ **Phase 0.5 PR-4 — WebSocket backpressure (C4)** (PR #43): worker `send()` awaits stdout
  `drain`; ws-server pauses `worker.stdout` above 8MB `ws.bufferedAmount`, resumes below 1MB.
  Verified: smoke PASS (no streaming regression) + standalone primitive test BACKPRESSURE_WORKS. *(2026-05-30)*
- ✅ **Phase 0.5 PR-3 — unify route path guard (B3)** (PR #42): 5 duplicated `validateFilePath`
  → one shared `src/server/security/validate-relative-path.ts` (+ hardening: reject `\`, `C:/`, `./`).
  Verified: test:unit 13/13; regression 7 allow / 16 deny. *(2026-05-30)*
- ✅ **Phase 0.5 PR-2 — `DockerBackend`** (PR #41): per-exec locked-down container (network none,
  non-root, read-only rootfs + workspace mount, cpu/mem/pids caps, host env not inherited), via
  `EXEC_RUNTIME=docker`. Verified in real containers: host key→NONE, network→BLOCKED, ws-write +
  file-tracking, nonzero/timeout/truncation all correct. *(2026-05-30)*
- ✅ **Phase 0.5 PR-1 — `ExecutionRuntime` interface + `LocalProcessBackend`** (PR #39):
  pluggable execution backend; `runPython` delegates to `runtime.exec()`. Behavior-identical
  refactor (baseline vs after `verify-exec-sandbox` matched; edge cases compute/nonzero/timeout/
  truncation/file-tracking + 11-field return shape all verified; `test:unit` 6/6). `EXEC_RUNTIME`
  selector (default `local`; `docker` warns+falls back until PR-2). *(2026-05-30)*
- ✅ **Live model wired + end-to-end smoke test** (PR #8): switched to ByteDance Ark
  (`ark-code-latest`, Anthropic-compatible endpoint); `scripts/smoke-agent.mjs` proves the full
  agent loop — real query → streamed events → tool_use → workspace file written → done. *(2026-05-30)*
- ✅ **Risk #5 — agent run bounds** (PR #5): `AGENT_MAX_TURNS` → `maxTurns`, `AGENT_WALLCLOCK_TIMEOUT_MS`
  → worker watchdog; opt-in (0 = unbounded). Watchdog timing verified in isolation. *(2026-05-30)*
- ✅ **Risks #3/#4 — cross-tenant access** (PR #4): owner predicates on 8 handlers (files.clientId /
  agentSession.userId / kb.userId / attachment→session chain), found via subagent sweep. *(2026-05-30)*
- ✅ **Risk #1 — exec sandbox** (PR #3): srt wraps Python tool exec (deny-net + workspace-fenced FS) +
  secret env-strip; verified end-to-end in an OrbStack container (seccomp=unconfined). *(2026-05-30)*
- ✅ **Scalability / runtime research** (deep-read of hermes-agent, deer-flow, ruflo,
  Anthropic `srt`) → target architecture + Plan A/B + **Phase 0.5** added to ROADMAP.
  Key find: adopt `@anthropic-ai/sandbox-runtime` (TS, Apache-2.0) for exec isolation.
  See `research/2026-05-scalability-and-runtime.md`. *(2026-05-30)*
- ✅ **References filled + indexed**: shallow-cloned 5 new agent repos, updated key ones,
  created tracked `references/INDEX.md` (query-first memory) + this repo's `WORKLOG.md`. *(2026-05-30)*
- ✅ **main branch protection** on `oxygenie` (required checks: `Quality Checks (22.12)`
  + `gitleaks`; 1 review + CODEOWNER required; no direct/force push). *(2026-05-29)*
- ✅ Repo made **public** (it's an open-source product; history was already public via
  the old `constructa-starter` mirror, and verified secret-free). *(2026-05-29)*
- ✅ **CI gates merged to main** (PR #1): `pnpm build` check, **gitleaks** secret scan
  (full-history config + placeholder allowlist), PR template, CODEOWNERS. *(2026-05-29)*
- ✅ **Secret-leak audit** of full git history (incl. dangling objects): **clean** —
  no real keys; only placeholders in example/doc files; `data/` never committed. *(2026-05-29)*
- ✅ **Hygiene**: untracked `.env.docker` → `.env.docker.example`; ignored `/data/`,
  `/user-data/`. *(2026-05-29)*
- ✅ **Repo split**: product extracted to `github.com/foreveryh/oxygenie` (private→public),
  full 383-commit history + 4 tags; `origin`=oxygenie, `upstream`=constructa-starter. *(2026-05-29)*
- ✅ **Research**: adversarial architecture review + Deep Agents (py/js/ui) comparison
  + Claude Agent SDK alignment. See `research/2026-05-architecture-review.md`.

## In progress

- 🔵 Building out **project memory** (this `docs/project/` set). *(2026-05-29)*

## Next up (Phase 0 remainder, roughly ordered)

1. ⬜ **Isolated, reproducible dev environment** (devcontainer / compose dev profile;
   secrets separated; one-command boot of web + ws-server + Postgres/Redis/MinIO/Meili).
   *(Also the starting point for Phase 1 Risk #1.)*
2. ⬜ **TS-ify the agent runtime** + typed WS protocol (prerequisite for harness features).
3. ⬜ Make tests CI-runnable (unit/e2e split + service containers) → re-enable `test` gate.
4. ⬜ Fix TS errors → re-enable `typecheck` gate.
5. ⬜ Migrate 15 REST routes → Server Functions → re-enable `validate-routes` gate.

## Backlog (with difficulty tags)

| Item | Difficulty | Notes |
|---|---|---|
| Migrate 15 REST routes → Server Functions | M | Overlaps cross-tenant security fixes (Risks #3/#4) |
| Make tests CI-runnable (unit/e2e split + services) | M | Then make `test` a hard gate |
| Fix TS errors | S–M | Good starter task; then make `typecheck` a hard gate |
| Sandbox Python/Bash exec — adopt `srt` + env allowlist | M | **Critical** (Risk #1); via Phase 0.5 `ExecutionRuntime` + Anthropic `srt` |
| `changedoc` (ai-pr-docs) needs `OPENAI_API_KEY` secret | S (chore) | Deferred by decision; or disable the AI workflows |
| Archive old public repo `constructa-starter` | S (chore) | Avoid two-public-repo confusion |
| Bump gitleaks/checkout actions off Node 20 | S (chore) | Deprecation forced ~2026-06-16 |
| **Workspace (项目) as a first-class concept** | L | Decouple Workspace from Conversation; let new-chat pick "existing workspace vs new"; conversations belong to a workspace (stable absolute path). Today每对话=独立 workspace（`getSessionWorkspace`, 1:1）。L2 in `research/2026-06-conversation-persistence-resume-comparison.md`; subsumes the persistence 治本. Owner-deferred 2026-06 (do 治标 first). |
| **Conversation history in our own DB (治本)** | M–L | Make Postgres the source of truth for messages (reload by session id, cwd-independent — LangGraph principle); SDK transcript becomes resume input + absolute cwd + spawn-validation/fallback (CraftAgent practice). Aligns with PRD "DB=truth, FS=projection". Pairs with the Workspace item. |

## Known weakened gates (intentionally non-blocking until backlog done)

- `typecheck` — non-blocking (pre-existing TS errors).
- `validate-routes` — non-blocking (15 pre-existing REST-route violations).
- `test` — non-blocking (suite is e2e/integration; needs DB + live server in CI).

## Decision log

- **2026-06-02** — Conversation-resume bug ("navigate away → back → empty history"):
  fixed 治标 (#86) = absolute session paths (`resolveSessionsRoot()` → `path.resolve`,
  normalize `CLAUDE_SESSIONS_ROOT`) + auto-resume on route remount. Root cause was a
  relative-path/cwd mismatch (worker cwd=workspace vs ws-server cwd=repo root);
  local-dev-only (prod uses absolute `/data/users`). **治本** (own DB message store)
  and **Workspace as a first-class concept** are Owner-deferred to backlog (do 治标
  first). See `research/2026-06-conversation-persistence-resume-comparison.md`.
- **2026-06-02** — SDK pinned to **0.2.112** (ARK-compatible ceiling); 0.2.113+ switch to a
  native binary incompatible with the ARK `/api/coding` gateway. See skills arch doc §九.
- **2026-06-02** — Product positioning settled: **self-hosted private deployment for SMB
  teams (company/team-internal, semi-trusted users), NOT a public multi-tenant SaaS.**
  Drives the threat model (defense-in-depth for mistakes, not anti-anonymous lockdown).
  See VISION §1 + CLAUDE.md top.
- **2026-05-30** — Execution layer: insert **Phase 0.5** (runtime + sandbox) before Phase 1.
  Adopt **`@anthropic-ai/sandbox-runtime` (srt)** as the exec sandbox primitive; define a TS
  **`ExecutionRuntime`** abstraction (pattern from hermes-agent `BaseEnvironment` + deer-flow
  `SandboxProvider`); then bake-off serverless (Modal/Daytona/E2B) vs self-hosted container pool
  at 100→1000 concurrency. Rationale: per-message-spawn + single ws-server can't scale; srt is
  TS/Apache-2.0 and fixes Risk #1. (See `research/2026-05-scalability-and-runtime.md`.)
- **2026-05-30** — Reference mgmt: shallow-clone repos, keep tracked `references/INDEX.md`,
  query-first / record-on-deep-contact. ruflo judged out-of-scope (local CC augmentation, not server scaling).
- **2026-05-29** — Strategy: **harden + borrow from Deep Agents; do not migrate/integrate.**
  Rationale: Deep Agents is a single-process library with divergent goals; our
  platform/isolation/SDK investment is the asset. (See VISION §5.)
- **2026-05-29** — Repo topology: separate code repo (`oxygenie`) from the docs/PM
  repo; **no submodule** (friction for many contributors); keep old remote as `upstream`.
- **2026-05-29** — Make `oxygenie` **public** to unlock free branch protection and
  because it is intended to be open-source; verified safe (history already public + secret-free).
- **2026-05-29** — Phase-0 CI: keep `lint`/`build`/`gitleaks` as hard gates now;
  `typecheck`/`validate-routes`/`test` non-blocking until their backlog items land.

## How to use this file

- Update the **snapshot**, **Done/In progress/Next**, and **Decision log** as part of
  finishing any meaningful task.
- When a phase's exit criteria are met, flip its row in the Phase tracker and in `ROADMAP.md`.
- Keep difficulty tags on backlog items so work can be parcelled out by skill level.
