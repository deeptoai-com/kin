# OxyGenie — Status (Living Memory)

> **This is the living memory of the project. Update it whenever state changes.**
> Last updated: **2026-06-06**

## Current position (one-paragraph snapshot)

**2026-06-06 — Phase C real-preview is DONE and the product is deployed + verified live; roadmap
reset (Now = Slimming).** Real-preview v1 (PR #107) + the front-end seam shipped, then a real-world
test drove three end-to-end fixes — Traefik **v3 `HostRegexp`** (the "preview 404"; never a
Dokploy/Swarm issue), artifact-card **retarget to the most-previewable file** (the 运行预览 CTA now
appears), and the agent **no longer self-installs** (the preview engine does install/build/serve) —
plus a **shared preview dependency cache** (`/pm-cache` + `infra/preview/warm-cache.sh`, cold ≈15 s →
warm ≈4 s). Three deploy paths with authoritative guides (`docs/deployment/{overview,dokploy,tunnel,
mac-mini}.md`): **B/Dokploy** (live) and **C/Cloudflare-Tunnel on a Mac** (live + full preview +
sandbox verified end-to-end over the public path); **A/Compose** partial (preview routing not yet
bundled). All merged to `main` (`78f46af`). **Roadmap reset to Now/Next/Later in `ROADMAP.md` —
owner-set Now = Slimming only** (remove Mastra + playwright + libreoffice → restore free CI build);
Next = Path A preview routing + agent code-sandbox fix + Skills/MCP curation; Later = multi-model + CI
hard gates + accounting.

**2026-06-04 — Skills integration (S1–S4) is DONE, merged, and owner-tested.** The Skills
subsystem moved from a filesystem skills-store to a **DB catalog** model
(`docs/project/prd/2026-06-skills-integration-prd.md`): `skill_catalog` (+ `skill_content_cache`,
`skill_schema_cache`, `skill_enablement`) seeded from the platform's curated-100, content fetched
from the upstream **skills-api** (`SKILLS_API_URL`, default `https://skills-api.deeptoai.com`) and
cached, fillable-variable **schema generated locally** into the DB (cache-first, content-hashed).
**S1** catalog + browse/detail (#90/#92), seed wired into `migrate` (#91). **S2** install→My-Skills
(materialize to `~/.claude/skills/<slug>/`, **effective next conversation** — this SDK can't
hot-reload a running session), default-2 (`find-skills` + `skill-creator`) auto-installed & locked
(#93), + fillable-schema generation (#95). **D9**: legacy 8 `baoyu` FS assets **deleted** (#94).
**S3** upstream search/add → user-scoped catalog + an **admin governance page `/admin/skills`** (#96).
**S4** composer repointed to the catalog model (form←DB schema, lean skill-context to save tokens),
**user-upload migrated into the catalog** (`source='upload'`, multi-file materialize), legacy
`SkillsPageComponent` removed (#97/#98/#99). Remaining = maintenance only (content refresh,
schema prewarm worker, admin curation, org-level sharing) — see Backlog. Capability Center Skills
tab is now a single catalog surface (browse/search/install/My-Skills/detail/schema/upstream-add/
upload); `/admin/skills` is the governance guardrail.

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

- **R4 — Bash tier-gating gap** ([Issue #69](https://github.com/foreveryh/oxygenie/issues/69))
  — **RESOLVED BY REDESIGN (not by patch)**. The wantsBash patch (PR #108) was **closed**: the
  Ask/Act redesign (2026-06-cowork) **removes the read-only `explore` tier entirely** (web+sandbox,
  no use for Plan), so there is no read-only tier left to leak bash/python. Security = sandbox + (Ask
  mode) HITL approval; Ask and Act are capability-equal. Net: #69's vulnerable tier is deleted. Close
  #69 once the Ask/Act model lands (see `research/2026-06-ask-act-hitl-design.md`). Testing during R4
  also found `explore` could still exec via the **python** tool (ungated) — also moot once explore is gone.

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
| **Phase 3 — Catch up to Deep Agents (capabilities + UI/UX)** | 🟡 In progress — Wave 0 + Wave 1 merged (#60); **Wave 2 (Ask/Act + HITL tool approval) merged + owner-tested** (2026-06-04, `feat/ask-act-hitl`); + Cowork single-source chat S1/S2 merged. Remaining: nested sub-agent tree, responsive workbench drawer |
| **Phase C — Real preview engine + deployment** | ✅ Done (PR #107 + end-to-end fixes + dep cache + 3 deploy paths; live on `oxygenie.cc`, merged `78f46af`, 2026-06-06) |
| **Slimming (NOW)** — remove Mastra + playwright + libreoffice → free CI build | ✅ Mastra (#109) + playwright/libreoffice (#110) removed & merged; **CI build OOM fixed** (build.yml builds slim image on 7G runner). Only the GHCR push needs a one-time package→repo link to auto-publish. *(2026-06-06)* |
| Phase 4 — Multi-model & scale | ⬜ Not started (Later) |

## Done (most recent first)

- ✅ **Slimming: Mastra + playwright + libreoffice removed → CI build OOM fixed** (PRs #109/#110,
  2026-06-06). #109 removed Mastra entirely (backend, the `ai-chat`/`ai-workflow` + `api/*` routes,
  the AI-SDK chat UI + `ai-elements/**`, the sidebar/menu/homepage surfaces, `@mastra/*`+`ai`+`@ai-sdk/*`
  deps, schema, docs). #110 removed playwright + libreoffice (Dockerfile blocks + ARGs + `playwright`
  dep + the render-png route/UI) so the lean image is the only image. **Result: `build.yml` on the 7G
  GitHub runner now builds the slim image to completion (no OOM)** — verified on the #110 main run; it
  fails only at the GHCR push (`denied: write_package`) because the `oxygenie/app` package has no linked
  repo (created manually). One-time fix: package → Manage Actions access → add `foreveryh/oxygenie`
  (Write). Mac redeployed on the slim image (UI no longer shows the Mastra surfaces). Image 4.23→4.02 GB.
  Kept `ZHIPU_API_KEY` (Claude GLM-image tool + Zhipu MCP). *(2026-06-06)*

- ✅ **Phase C real-preview deployed + verified live** (merge `78f46af`, 2026-06-06): real-preview v1
  (PR #107) + front-end seam, then 3 real-world-test fixes — Traefik **v3 `HostRegexp`** (the preview
  404, *not* Swarm), artifact-card **retarget → most-previewable file** (CTA shows), agent
  **no-self-install** (preview engine installs/builds/serves) — + **shared preview dep cache**
  (`/pm-cache` + `infra/preview/warm-cache.sh`, cold ≈15 s → warm ≈4 s). Verified end-to-end over the
  public path (CF → tunnel → Traefik → app, and `<id>.oxygenie.cc` preview). Invariant recorded:
  CLAUDE.md #11 (v3 HostRegexp). *(2026-06-06)*
- ✅ **Deployment: 3 paths + guides** (2026-06-06): **C/Cloudflare-Tunnel** (`docker-compose.tunnel.yml`
  + `infra/tunnel/*`; Mac/OrbStack, no public IP — bundled Traefik + `dockerproxy` API-version shim +
  cloudflared) **live + full-feature verified**; **B/Dokploy** live; **A/Compose** partial (preview
  routing not bundled — NEXT). Authoritative guides `docs/deployment/{overview,dokploy,tunnel,mac-mini}.md`
  (incl. the from-scratch Mac mini 8GB/16GB recipe — the build-RAM decision). *(2026-06-06)*

- ✅ **Skills integration S1–S4** (PRs #90–#99, owner-tested 2026-06-04): DB catalog replaces the
  FS skills-store. **S1** `skill_catalog`+caches, curated-100 seed, seed-on-`migrate`, browse +
  SKILL.md detail (from skills-api, cached) — #90/#91/#92. **S2** install→My-Skills (DB→FS
  materialize, effective next conversation), default-2 locked, fillable schema gen (DB,
  content-hashed) — #93/#95. **D9** delete legacy 8 baoyu FS assets — #94. **S3** upstream
  search/add (user-scoped) + admin `/admin/skills` governance — #96. **S4** composer→catalog
  (DB schema + lean skill-context token fix), upload→catalog (`source='upload'`), removed legacy
  `SkillsPageComponent` — #97/#98/#99. Verified: each PR `build`+`lint` green on CI; content/schema
  paths checked end-to-end against live skills-api + ARK + DB. Migrations 0020 (4 tables) + 0021
  (`skill_source` add `'upload'`). New env: `SKILLS_API_URL` (+ optional `SKILLS_API_KEY`). *(2026-06-04)*

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
| **Skills: content refresh (scrapedAt/ETag)** | M | Detect upstream changes via skills-api `scrapedAt`/ETag → re-fetch `skill_content_cache` + recompute content_hash → mark schema `stale` → regenerate. Today content is fetched once on first view/install and cached indefinitely. PRD S4 维护. |
| **Skills: schema background prewarm (worker)** | M | Move fillable-schema generation off the on-demand "Generate" button into the BullMQ worker — prewarm the curated set + regenerate on `stale`. Today generation is lazy/manual (one ARK call per skill, cached globally by content_hash). PRD D5/S4. |
| **Skills: admin curation of the catalog** | M | Admin UI to add/edit/remove **official** `skill_catalog` entries (editorial fields, default flags, sort) — currently the curated set is seed-only (`db:seed`); only user-added (`scope='user'`) skills are admin-manageable via `/admin/skills`. |
| **Skills: team/org-level sharing** | L | Promote a user-added/uploaded skill (`scope='user'`) to org-shared (visible to the whole team), vs today's per-owner visibility + admin governance. PRD non-goal for this round; needs an `org` scope + unique-index rework. |
| **Skills: composer "browse all installed" picker + inline form (optional)** | S–M | A dedicated composer picker listing **all** installed My-Skills → select → inline fillable variable form → compose. Today covered by context-badges (session-active skills + 「使用」 + examples) + A2Composer form (DB schema); this would be a convenience enhancement. PRD S4b-2 (partial). |
| ✅ ~~NOW · Remove Mastra entirely~~ | L | **Done — PR #109.** Backend + all UI surfaces + deps + schema + docs. |
| ✅ ~~NOW · Remove playwright + libreoffice~~ | M | **Done — PR #110.** Dockerfile blocks + ARGs + `playwright` dep + render-png route/UI. Lean image is the only image now. |
| **🟢 NOW · Re-enable free CI build (last step)** | XS | **Build OOM fixed** (build.yml builds the slim image on the 7G runner). Remaining: one-time GHCR **package→repo link** (`oxygenie/app` → Manage Actions access → add `foreveryh/oxygenie` Write) → push-main auto-publish goes green. |
| **🔵 NEXT · Path A: bundle Traefik + preview-auth** | M | `docker-compose.yml` has no bundled proxy/preview routing → the "recommended baseline" path can't run previews. Add Traefik + the `preview-auth` router (Traefik **v3** `HostRegexp`). |
| **🔵 NEXT · Agent code sandbox: fix srt registration sequencing** | M | `ws-query-worker.mjs` reads `sandboxStatus().state` **before** `ensureSandbox()` runs → `state=null` → bash tool never registers. Call `ensureSandbox()` first + ensure bubblewrap in the image → chat-side bash/Python works. |
| **🔵 NEXT · MCP catalog/picker + fix stale "coming soon" copy** | M | No curated MCP picker yet; `skills.content.ts` "enabling … coming soon" copy is outdated (Skills shipped). Pairs with the Skills curation rows above. |
| **🟣 LATER · Multi-model: registry + routing/failover** | L | Phase 4. Picker is cosmetic today (hardcoded GLM/ARK). Within the **SDK 0.2.112 / ARK** constraint; per-capability key split. |
| **🟣 LATER · Revisit `ENABLE_STRUCTURED_OUTPUTS` (off)** | M | Coupled to the artifact/structured-output strategy; Phase C now done → resolve the StructuredOutput-leak root cause instead of keeping the flag forced-off. |
| **🟣 LATER · Wire accounting (Phase 2)** | M | `spendOneCredit` never called; persist per-run cost/tokens; enable audit log; stop logging raw message content (PII). |
| **🟣 LATER · Email-verify self-host UX + P16 version recording + deprecated-fn cleanup** | S | The "verify your email" banner on a self-host is friction; P16 artifact version recording paused (`ENABLE_VERSION_RECORDING=false`); `syncOldUserSkills`/`getSkillStatus` are `@deprecated`. |

## Known weakened gates (intentionally non-blocking until backlog done)

- `typecheck` — non-blocking (pre-existing TS errors).
- `validate-routes` — non-blocking (15 pre-existing REST-route violations).
- `test` — non-blocking (suite is e2e/integration; needs DB + live server in CI).

## Decision log

- **2026-06-06** — **Phase C 真预览全链路打通 + Mac/Tunnel 部署上线 + 路线图重置**。
  ① **真预览 E2E 修复**(实测驱动):Traefik **v3 `HostRegexp`** 修预览 404 —— v2 命名组
  `HostRegexp(`{name:regexp}`)` 在 v3 **静默不匹配**,`<id>.域名/__oxy/preview/auth` 直接 404;**此前
  误判为 Dokploy-Swarm,实为通用 bug**,已修 `docker-compose.{tunnel,dokploy}.yml` 并记 **CLAUDE.md 不变量 #11**。
  artifact 卡**改指向最可预览文件**(流式时 package.json 先到建卡、index.html 后到不再另建卡 → 运行预览 CTA 出现);
  agent **不再自装依赖**(系统提示:沙箱按设计禁网,装/构建/serve 交预览引擎)。
  ② **预览依赖共享缓存**(`/pm-cache` 卷 + `infra/preview/warm-cache.sh`,冷 ≈15s → 暖 ≈4s)。
  ③ **Mac + Cloudflare Tunnel 部署(Path C)**:`docker-compose.tunnel.yml` + `infra/tunnel/*`,无公网入站;
  OrbStack docker-API 版本问题用 nginx `dockerproxy` 改写 `/vX.Y/`→`/v1.44/`;live + 全功能(预览+沙箱)
  公网端到端验证;沉淀 `docs/deployment/{overview,tunnel,mac-mini}.md`(含从零 Mac mini 8GB/16GB 指南——
  **核心是构建内存:16G 本机构建、8G 需异机构建后导入**)。全部并入 `main`(`78f46af`)。
  **注**:推送**绕过了 main 分支保护**(owner admin 权限)、CI 必需检查未运行——代码为线上实测验证,正式 CI 门未跑;
  外部贡献仍应走 PR。
  ④ **路线图重置(Now/Next/Later,见 `ROADMAP.md`):owner 定 Now = 仅瘦身**(移除 Mastra + playwright +
  libreoffice → 恢复 7G runner 免费 CI 构建 + push-main 自动发 GHCR)。Next = Path A 预览路由补全 + agent
  代码沙箱注册时序修复(`state=null`)+ Skills/MCP 策展(含 MCP 目录/选择器);Later = 多模型(registry/路由/
  failover,守 SDK 0.2.112/ARK 约束)+ CI 硬门禁(typecheck/validate-routes/test)+ 计费接通(Phase 2)。

- **2026-06-05** — **✅ `oxygenie.cc` 在 Dokploy 上线成功**（/health 200、/ 200、/ws/agent 426、TLS via CF）。
  闯过 **8 个部署卡点**,根因 + 修法已沉淀到 **`docs/deployment/dokploy.md`**(7 步指南 + 卡点根因表):
  ① 构建 OOM/挂死 → **镜像 off-server 构建推 GHCR、Dokploy 只拉**(compose 用 `image:`+`pull_policy:always`,非 `build:`);
  ② playwright/libreoffice 拖慢/吃内存 → `INSTALL_BROWSER=false INSTALL_OFFICE=false`(并决定**永久移除**这两个重型工具);
  ③ GHCR 包私有 → 设 public;④ 卷名全局冲突(撞 deeptoai 遗留卷)→ `APP_NAME_SANITIZED` 必须唯一;
  ⑤ `DATABASE_URL` 与 `POSTGRES_PASSWORD` 失配(28P01)→ compose 内从 `POSTGRES_*` 拼 DATABASE_URL(单一来源);
  ⑥ migrate `getaddrinfo EAI_AGAIN db`(DNS 时序)→ migrate entrypoint 重试直到 db 可解析;
  ⑦ CF 免费 SSL 不覆盖两层泛域名 → 预览用单层 `*.oxygenie.cc`;⑧ ARK 用 `ANTHROPIC_AUTH_TOKEN` 非 `API_KEY`。
  关键认知:**本地用同一 compose+镜像+env 全栈跑通(migrate+app+WS 200)→ 失败全在 Dokploy 环境/状态**,
  逐一隔离修复。**遗留**:CI 7G runner 构建仍 OOM(待砍 Mastra/playwright/office 瘦身后恢复免费 CI 构建);
  Phase C 路由预览的浏览器 E2E 待做。
- **2026-06-05** — **生产部署拍板：`oxygenie.cc` on Dokploy（待执行→已上线）+ preview-controller 硬化**。
  完整决策/差异/runbook → `research/2026-06-oxygenie-cc-dokploy-deployment.md`。要点：
  ① **域名**：app=apex `oxygenie.cc`，预览=**单层 `*.oxygenie.cc`**（CF 免费 SSL 不覆盖两层
  `*.preview.`，故弃用 2 层）。② **TLS**：CF 橙云 + **Full(Strict) + Origin CA 证书**，**不用
  Let's Encrypt**（橙云下 HTTP-01 会失败）；Origin CA 用带 `Zone>SSL&Certs>Edit` 的 API Token
  签（Service Key 已弃用）。③ **ARK 鉴权**：用 **`ANTHROPIC_AUTH_TOKEN`（Bearer），不设
  `ANTHROPIC_API_KEY`**；base=`https://ark.cn-beijing.volces.com/api/coding`；**无需改鉴权代码**
  （worker 继承 `process.env`，SDK CLI 直接读环境）。④ **模型**：主/sonnet/opus/subagent=`glm-5.1`，
  haiku=`doubao-seed-2.0-lite`；多模型切换延后。⑤ **镜像**：GHCR（既定），从 `codex/phasec-real-preview`
  以 `--platform linux/amd64` + VITE build-args 重建。⑥ **dokploy compose 需改 6 处**（Host
  deeptoai.com→oxygenie.cc、去 letsencrypt、预览单层、ARK auth-token、ZHIPU 改可选、VITE build-args）。
  **preview-controller 硬化**（`d19621c`，本地真预览引擎已验证）：serve 改 detached `exec node`（修首跑竞态）、
  服务器自写容器内 pid（修 restart/reap）、`CapAdd:['CHOWN']`（修 CapDrop ALL 下非-root 装依赖 EACCES）。
- **2026-06-04** — **Ask/Act + HITL（Phase 3 Wave 2）实现 + owner 实测通过 + 合并 `main`**（merge
  `feat/ask-act-hitl`）。2 档(🖐 Ask 逐动作审批 / ⏩ Act 自主,默认),砍掉 explore/auto/Plan。实现:先
  **spike 验证** SDK `canUseTool` 能 async-await(0.2.112),再**对照官方文档**(canUseTool=官方 HITL 机制;
  Ask=`default`、Act=`acceptEdits`;options.toolUseID/title/signal;reject=interrupt:false)。chunk1=模型
  3→2;chunk2=worker stdin 行协议 + HITL canUseTool(只读放行/动作类发 approval_request 并 await)+ ws-server
  中继/回写 + 前端 pendingApprovals + ApprovalPrompt 卡。实测:选择器两档、Ask 逐动作批准/拒绝生效、Act 不打断。
  **R4(#69)由"删 explore"解决,PR #108 已关。** 设计/校验见 `research/2026-06-ask-act-hitl-design.md`(§8 文档校验)。

- **2026-06-04** — **权限模型拍板:对标 Cowork 的 Ask/Act 两档,砍掉 Plan/explore/auto**。理由:纯
  web、不在客户本地、全沙盒 → 只读 Plan 无用;符合既定哲学(安全=沙盒,档位=交互偏好)。**Ask**=每个动作
  类工具前暂停等批准(HITL);**Act**=自主(默认)。两档能力相同,只差打不打断。**含义**:① R4(#69)由"删
  explore"解决,**PR #108(wantsBash 补丁)已关闭作废**;② Phase C 的 python 越权洞随 explore 消失而作废;
  ③ **Ask = HITL = 要真建**(canUseTool 暂停 → UI 批准/拒绝 → 回写 worker stdin 的往返协议),正是规划中的
  Phase 3 Wave 2。设计子文档:`research/2026-06-ask-act-hitl-design.md`(含 stdin 行协议改造、canUseTool
  组合闸、approval 协议、**实现前先 spike 验证 SDK canUseTool 能 async await**)。**Next: 评审设计 → spike → 实现。**
- **2026-06-04** — **Phase C v1 代码就绪（PR #107），E2E + 一处回退挂到「全栈那轮」**。架构师交付真预览**后端**（`src/preview/*`：PreviewRuntime + controller sidecar + 一次性 token→cookie + manifest；`ws-server.mjs` 加 start/stop_preview + preview_state；docker-compose）；评审通过（范围/契约/安全六坑/5-5 单测/SDK 0.2.112）。架构师把收尾**交回评审执行**：已补 **P1 前端接缝**（`chat-session-store.previewState` + ws-adapter 收发 + `useSessionPreview` selector + `artifact-html` 「运行预览」CTA→ready 换 live iframe）、**P3**（preview 测试 `@vitest-environment node`；secret-from-env 架构师已做）。全部在分支 `codex/phasec-real-preview` / worktree `oxygenie-phasec` / **PR #107**（build+lint 绿、5/5 单测）。**未做 = P2 端到端**（需全栈 docker-compose：preview-controller+Traefik+浏览器交互验收 §3.1 1–5），owner 选延后。**已知回退（仅本地、非紧急、owner 同意延后）**：在 phasec 构建上「历史会话加载不出聊天记录」（main 正常）；已排除 历史合并逻辑/后端发送/intlayer，疑为 P1 给 `artifact-html` 加 `~/claude/adapters` import 边改变 Vite chunk 切分导致客户端初始化问题——**精确定位需浏览器 console，连同 P2 全栈那轮一并 pin+fix**（届时把 artifact-html 与 adapter/store 解耦）。
- **2026-06-04** — **Phase C（真预览）交给架构师 + 完整实施指南落档**。chat/Workbench 单源重做 S1+S2 已合并 `main`、S3 延后备案，**真预览（多文件 App 跑起来）= Phase C，归架构师**。交付 `research/2026-06-phasec-implementation-guide-for-architect.md`（① 如何实施含 **UI 接缝契约**：`.oxygenie/app.json` + `preview_state` 事件 + `chat-session-store` slot + `useSessionPreview` selector + 卡片「运行预览」露出，后端/前端归属切分；② 预期=SPA static 硬验收；③ 验证清单+回归；④ 求助/协作规矩）。另：成果物多文件 App 预览加了「这是多文件 App…」提示横幅（`artifact-html.tsx`，合并 `main`）。
- **2026-06-04** — **Cowork S2 实现（turn 卡渲染收尾）+ S3 决定（暂不修，挂 artifact 线）**。S2：
  `turn-builder.ts` 折叠头改 Cowork 式 **「Worked Xs · N steps · 改 K 文件」**（耗时=工具 `elapsedSeconds`
  之和、步数=工具/搜索组渲染行、改动文件=Write/Edit/MultiEdit/NotebookEdit 去重计数；纯思考轮 stepCount=0
  回退实时 previewText），并**去重连续重复的 thinking/intermediate** 行；运行中仍显示实时 preview + 步数 Tag。
  历史/实时同组件（S1 P4 合并后天然成立）。**S3（结构化输出泄漏）决定不在本 PR 修**：owner 选「维持 env-off
  + 不加投机文本过滤」——泄漏当前不触发（`ENABLE_STRUCTURED_OUTPUTS` **强制默认 false**，已写进 `.env.example`/
  `CLAUDE.md`/worker 注释），根因与 artifact/结构化输出策略耦合，**备案到 `research/2026-06-real-preview-architect-brief.md` §9**，随 Phase C/artifact 线统一定。分支 `feat/cowork-s2-turn-card`。
- **2026-06-04** — **Cowork 单源重做 S1 实现 + owner 实测通过 + 合并 `main`**（merge `feat/cowork-s1-single-source`）。
  落地：`useLocalRuntime`→`useExternalStoreRuntime`，`chat-session-store.messages` 成唯一有序真相源，
  ws-adapter `runChat()` 把每个 chunk 写进 store（带单调 `seq`），左侧流 + 右侧 Workbench 同读一份
  → **Progress/Files/Context 跑时实时、无需刷新**。实测迭代修掉 5 个问题：① converter 只在 assistant
  角色带 `status`（否则发消息即报 "status is only supported for assistant messages"）；② 取消成果物
  **自动弹面板**（仅点击开，避免盖住 Workbench）；③ 文本兜底卡与 Write 卡**去重**（升级临时卡而非新建）；
  ④ **历史按轮合并**——`loadHistoricalMessages` 把一轮的多条 SDK 消息（每段文字/工具一条 + tool_result 走
  user 消息）合并成**一条** store 消息，历史与实时渲染一致（每轮一张 turn 卡 + 一张交付物卡，告别「6 张
  步骤已完成 + 3 张重复卡」）；⑤ `.js/.ts` 误判为 React 丢进 Sandpack 执行 → 原生 DOM 脚本崩
  "Something went wrong"，改为**非组件代码只读展示**；并删掉重复的全局 `ThreadArtifactCallout`（与 turn
  内联卡重复）。**真预览（多文件 App 跑起来）仍是 Phase C 沙盒，不在 S1**。**Next: S2**（turn 卡头摘要
  「Worked Xs · N steps」+ thinking 去重）、S3（结构化输出泄漏处理）。规格见
  `research/2026-06-cowork-chat-workbench-redesign-spec.md`。
- **2026-06-04** — **聊天+Workbench「Cowork-faithful 单源重做」定方向（owner 选 A）**。测试暴露根因：
  Workbench 四个 tab 读 zustand `chat-session-store.messages`（只在刷新/resume 由 `loadHistoricalMessages` 填），
  而实时消息在独立的 assistant-ui `useLocalRuntime` 里，且 `WorkbenchPanel` 渲染在 `AssistantRuntimeProvider`
  之外 → **结构上拿不到实时数据，刷新才有**（这正是最早「Progress 滞后」的真因）。正解 = **单一实时真相源**
  （推荐 `useExternalStoreRuntime`，store 持有单一有序消息列表，左侧流 + 右侧 Workbench 都读它），一把修好
  Workbench 实时 + 消息顺序 + 历史/实时渲染统一 + Cowork 式渐进折叠。已交付实施规格
  `research/2026-06-cowork-chat-workbench-redesign-spec.md`，将在**专门对话**按规格实现（owner 不要尾段仓促一把梭）。
  期间已落地的小修：Phase B（Files/Context selector，#102，刷新后正确）、A3（每轮一张成果物卡，#103）。
  另：泄漏的 "StructuredOutput" 内部消息是 SDK `outputFormat` 强制机制（`ENABLE_STRUCTURED_OUTPUTS=true`），建议先关。
- **2026-06-04** — **「真预览」架构拍板（架构师评审）**：让用户看到 agent 生成的多文件 App 真正运行。
  方向 = **per-session 持久沙盒 + 按需预览进程 + idle 回收**（不每会话常驻 dev server）。
  新增 `PreviewRuntime`/`SessionSandboxManager`（不硬改 one-shot `DockerBackend`）+ `preview-controller`
  sidecar 独占 docker socket；**双档**（默认 build→内置静态服务器 serve=硬验收，HMR dev=best-effort）；
  **Traefik + Docker provider + forward-auth**（本地 `*.127-0-0-1.sslip.io`、生产 `*.preview.<domain>`+
  wildcard cert，子路径仅兜底，v1 不做 on-demand TLS）；鉴权用**一次性 bootstrap JWT → opaque
  httpOnly host-only preview cookie**；app manifest = `.oxygenie/app.json`（v1 启发式生成，命令仅限
  package.json scripts）；**Provider 抽象先留、只实现 Docker**；**v1 硬验收 = 纯前端 SPA
  install→build→static→iframe**，Next/Express/带 API = best-effort。诊断+对比+计划见
  `research/2026-06-real-preview-architect-brief.md` + `…-v1-implementation-plan.md` +
  `…-workbench-artifact-ordering-fix-plan.md`。**归属**：沙盒新对话执行。也顺带记录三个 UI 缺陷
  （Workbench 只 Progress/滞后、每文件一张「打开成果物」、消息错乱）的根因与 Phase A/B 修正（UI 轨道）。
- **2026-06-04** — **Skills integration S1–S4 shipped + owner-tested** (PRs #90–#99). Model:
  **DB catalog = source of truth**, FS = runtime projection (materialize enabled skills to
  `~/.claude/skills/`). Key owner decisions recorded in the Skills PRD:
  **D6** default skills = only `find-skills` + `skill-creator` (admin, locked);
  **D7** install effective **next conversation** (this SDK can't hot-reload a running/resumed
  session — kept the "需重新发起对话" contract, replaced full SKILL.md injection with a lean hint +
  SDK progressive disclosure);
  **D8** seed wired into `migrate` (idempotent, best-effort);
  **D9** deleted legacy 8 `baoyu` FS assets (curated-100 already references baoyu upstream — no loss);
  **D10** upstream/upload skills are user-scoped (per-owner visible) + admin-visible/removable via
  `/admin/skills` (governance guardrail). Remaining work is maintenance-only (see Backlog).
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
