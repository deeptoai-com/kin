# OxyGenie — Roadmap

Phased plan from foundation to surpassing Deep Agents. Each phase lists its goal
and **exit criteria**. Track live progress in [`STATUS.md`](./STATUS.md).

> Sequencing principle: *foundation (safe parallel work) → decide the execution
> runtime/scale model → close security gaps → make capabilities measurable → catch
> up to Deep Agents.* Don't build features on an unsafe / untestable / un-scalable base.

---

## 🧭 Current focus — Now / Next / Later (set 2026-06-06)

The phase plan below (0 → 4 + Skills) is largely delivered. This is the **live, ordered**
plan for what's left. Owner-set: **Now = Slimming only.**

### 🟢 NOW — Slimming & open-source CI — ✅ mostly done (2026-06-06)
**Goal:** drop the heavyweight bits so the project builds on free CI and ships lean.
- [x] **Remove Mastra entirely** — `src/mastra/**`, deps (`@mastra/*` + `ai` + `@ai-sdk/*`),
      routes (`api/chat`, `api/threads/**`, `api/workflow/**`, `agents/ai-chat`, `agents/ai-workflow`),
      the AI-SDK chat UI + `ai-elements/**`, `mastra-thread` schema, every UI surface (sidebar/menu/
      homepage), and the dual-SDK docs. *(PR #109)*
- [x] **Remove playwright + libreoffice permanently** — Dockerfile install blocks + the
      `INSTALL_BROWSER`/`INSTALL_OFFICE` ARGs + the `playwright` dep + the render-png route/UI. The
      lean image is now the only image. *(PR #110)*
- [~] **Re-enable free CI build** — **build OOM is FIXED**: `build.yml` (7 GB runner) now builds the
      slim image to completion (verified on the #110 main run — no OOM). It currently fails only at the
      GHCR **push** (`denied: write_package`) because the `oxygenie/app` package was created manually
      and has **no linked repo**. One-time fix: package → *Manage Actions access* → add `foreveryh/oxygenie`
      (Write), then re-run build.yml. After that, push-main auto-publish is green.

**Exit:** SSR build completes under the CI runner's RAM ✅; GHCR auto-publish green (pending the
one-time package→repo link); zero Mastra references ✅.

### 🔵 NEXT — Deployment completeness + capability lists
- [x] **Agent code sandbox** — fixed the registration sequencing bug (eager `ensureSandbox()`
      before the check; `state=null` → bash never registered). Verified live (srt active). *(PR #112)*
- [~] **Path A completeness** — new **`docker-compose.prod.yml`**: bundled Traefik (direct socket,
      no shim) + websecure/TLS + the `preview-auth` router (v3 `HostRegexp`) + the preview wildcard
      cert. **Two TLS options**: Let's Encrypt DNS-01 (default) + Cloudflare Origin CA (`infra/prod/dynamic/`).
      Locally verified (compose parses, labels interpolate, Traefik flags valid, services = the proven
      tunnel stack); **definitive test = a real Linux VPS** (direct-socket routing + LE wildcard issuance
      + public HTTPS). Guide: `docs/deployment/docker-compose.md`.
- **Skills / MCP curation ("lists")** — content refresh (skills-api `scrapedAt`/ETag), admin
  curation UI for the official catalog, an **MCP catalog/picker**, and fix the stale "coming soon" copy.

### 🟣 LATER — Multi-model, gates, accounting, polish
- **Multi-model** (Phase 4) — model registry + routing/failover + per-capability key split, within
  the **SDK 0.2.112 / ARK** constraint (no 0.3.x-only features). The current picker is cosmetic.
- **CI hard gates** (Phase 0 remainder) — typecheck, validate-routes (29 REST routes), test
  (Postgres service container); TS-ify `ws-server.mjs`/`ws-query-worker.mjs` + typed WS protocol.
- **Accounting** (Phase 2 wiring) — call `spendOneCredit`, persist per-run cost/tokens, enable the
  audit log, stop logging raw message content (PII).
- **Misc** — revisit `ENABLE_STRUCTURED_OUTPUTS` now Phase C is done; email-verify self-host UX;
  P16 artifact version recording (paused); deprecated-fn cleanup (`syncOldUserSkills`, `getSkillStatus`).

---

## Phase C — Real preview engine + deployment — ✅ DONE (2026-06-06)

**Goal:** users see agent-generated multi-file apps actually run, and the whole product is
deployable by a team. **Shipped + verified live on `oxygenie.cc`.**

- [x] **Real-preview v1 backend** — `PreviewRuntime` + `preview-controller` sidecar (sole
      docker-socket holder) creating per-preview sandbox containers + Traefik labels; one-time
      token → cookie forward-auth; `.oxygenie/app.json` manifest. *(PR #107)*
- [x] **Front-end seam** — `previewState` in the store + ws-adapter + `useSessionPreview`;
      「运行预览」CTA on the index.html artifact → live iframe.
- [x] **End-to-end fixes** (from a real-world test): Traefik **v3 `HostRegexp`** (the preview 404
      — was misattributed to Dokploy/Swarm), artifact-card **retarget to the most-previewable file**
      (CTA now appears), agent **no longer self-installs** (prompt: preview engine does install/build/serve).
- [x] **Shared preview dependency cache** — `/pm-cache` volume across previews + `warm-cache.sh`
      (cold ≈15 s → warm ≈4 s installs).
- [x] **Three deploy paths** — B/Dokploy (live), C/Cloudflare-Tunnel (Mac, live + verified), with
      authoritative guides (`docs/deployment/{overview,dokploy,tunnel,mac-mini}.md`).

**Exit criteria:** met — full preview + sandbox verified end-to-end over the public path; deploy
guides written. *(Path A compose-bundled preview routing carries over to NEXT.)*

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

- [x] **Todo / plan panel** (surface `TodoWrite` as structured UI). *(Wave 1, #60)*
- [~] **First-class sub-agent panel** — flat Task list done (Wave 1); **nested tree** still pending
      (needs `parent_tool_use_id` on tool-call parts).
- [x] **Human-in-the-loop tool approval** (Ask/Act + approve/reject round-trip). *(Wave 2, `feat/ask-act-hitl`, owner-tested 2026-06-04)*
- [ ] **Checkpointing / durable run resume** (resume an interrupted run, not just reload history).
- [ ] **Context management** (summarization / compaction; memory layer).
- [ ] Unify shared logic so the two runtimes can't fork (skill-sync, path guards).

**Exit criteria:** parity-or-better with `deep-agents-ui` on todo/sub-agent/HITL,
plus durable resume — while keeping our isolation + multi-tenant + web edge.

---

## Skills integration (capabilities workstream) — ✅ S1–S4 DONE (2026-06-04)

**Goal:** a curated, team-private Skills library (no public market) on a **DB-catalog** model
(DB = truth, `~/.claude/skills/` = runtime projection), with upstream discovery + governance.
Full design + decisions: [`prd/2026-06-skills-integration-prd.md`](./prd/2026-06-skills-integration-prd.md).
Owner-tested 2026-06-04.

- [x] **S1 — Catalog + display**: `skill_catalog` (+ `skill_content_cache`, `skill_schema_cache`,
      `skill_enablement`), curated-100 seed wired into `migrate`, browse/search/category + SKILL.md
      detail from skills-api (cached). *(#90/#91/#92, migration 0020)*
- [x] **S2 — Execution layer**: install→My-Skills materializes to `~/.claude/skills/<slug>/`
      (effective **next conversation** — SDK can't hot-reload a live session); default-2
      (`find-skills`+`skill-creator`) auto-installed & locked (D6); fillable-variable schema
      generated locally into the DB, cache-first by content-hash (D5). *(#93/#95)*
- [x] **D9 — retire legacy FS store**: deleted the 8 `baoyu` local assets (curated-100 already
      references baoyu upstream → no capability lost). *(#94)*
- [x] **S3 — upstream discovery**: search skills-api → add as user-scoped catalog entry; admin
      governance page `/admin/skills` (see + remove all users' added skills, D10). *(#96)*
- [x] **S4 — composer rework + cleanup**: composer reads DB schema; worker injects a lean
      skill hint (not the full SKILL.md) to save tokens; user-upload migrated into the catalog
      (`source='upload'`, multi-file materialize); legacy `SkillsPageComponent` removed. *(#97/#98/#99, migration 0021)*

**Remaining (maintenance only — none blocking):**
- [ ] **Content refresh** — re-fetch on upstream change via skills-api `scrapedAt`/ETag → recompute
      content-hash → mark schema `stale` → regenerate.
- [ ] **Schema background prewarm** — move generation into the BullMQ worker (prewarm curated set,
      regenerate on `stale`) instead of the on-demand button.
- [ ] **Admin curation** — UI to add/edit/remove **official** catalog entries (today seed-only).
- [ ] **Team/org-level sharing** — promote user-added/uploaded skills to org-shared (today
      per-owner + admin governance).
- [ ] **(optional) composer "browse all installed" picker** with inline variable form.

**Exit criteria:** met for S1–S4 (catalog browse/install/run/detail/schema/upstream-add/upload +
admin governance, build+lint green, owner-tested). Maintenance items above are tracked in STATUS Backlog.

**Config:** `SKILLS_API_URL` (default `https://skills-api.deeptoai.com`), optional `SKILLS_API_KEY`.

---

## Phase 4 — Multi-model & scale maturity

**Goal:** real provider abstraction and horizontal scale.

- [ ] Model registry / capability catalog / provider routing + failover.
- [ ] Split shared credentials per capability (remove single-key blast radius).
- [ ] Concurrency caps / backpressure / horizontal scale story for ws-server.

**Exit criteria:** swap/route models without code changes; bounded resource use under load.
