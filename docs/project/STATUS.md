# OxyGenie — Status (Living Memory)

> **This is the living memory of the project. Update it whenever state changes.**
> Last updated: **2026-05-30**

## Current position (one-paragraph snapshot)

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
| **Phase 0 — Foundation** | 🔵 In progress |
| Phase 0.5 — Execution-runtime & sandbox decision | ⬜ Not started (defined) |
| Phase 1 — Security hardening | ⬜ Not started |
| Phase 2 — Observability & accounting | ⬜ Not started |
| Phase 3 — Catch up to Deep Agents | ⬜ Not started |
| Phase 4 — Multi-model & scale | ⬜ Not started |

## Done (most recent first)

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

## Known weakened gates (intentionally non-blocking until backlog done)

- `typecheck` — non-blocking (pre-existing TS errors).
- `validate-routes` — non-blocking (15 pre-existing REST-route violations).
- `test` — non-blocking (suite is e2e/integration; needs DB + live server in CI).

## Decision log

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
