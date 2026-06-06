# OxyGenie — Vision & Architectural Identity

> **North star:** turn OxyGenie into an excellent open-source project that
> **surpasses Deep Agents** — by combining Deep Agents' *harness* strengths with
> OxyGenie's *platform* strengths, on a security-first, production-grade base.

## 1. What OxyGenie is

OxyGenie is a **self-hosted, team-scale, autonomous Claude-agent workspace** —
a deployable Claude-Desktop-class platform that a team runs on its own
infrastructure. It is built on **TanStack Start** (SSR + Nitro) and runs on a single
**process-isolated Claude Agent SDK runtime**:

> ### ⭐ Intended use & audience — settled 2026-06 (the north star; check every design against this to avoid drift)
>
> OxyGenie is built for **private deployment by small-to-midsize teams**.
> Typical scenarios: **company-internal** and **team-internal** use, run for a
> **trusted small circle** of colleagues — this is the usage we actively
> encourage. It is **self-hosted, single-organization, multi-user** (multiple
> *trusted* users inside one org), **NOT** a public-internet, multi-tenant SaaS
> serving anonymous/untrusted users at scale.
>
> **Design implications (do not drift from these):**
> 1. **Threat model = semi-trusted colleagues, not anonymous attackers.** Security
>    is defense-in-depth for *mistakes* + shared-host/secret hygiene + intra-org
>    user isolation — **not** anti-anonymous-attack lockdown. Server-touching power
>    features (stdio MCP, connecting to internal/LAN tools, code execution) are
>    **legitimate core uses**, guarded by sandboxing + warnings, never forbidden.
> 2. **Capabilities are curated for the team, not a public marketplace.** Skills/MCP
>    are a relatively fixed, curated set for the org's own work — no ratings /
>    payments / public market (an upstream API may *source* candidates; the team
>    curates).
> 3. **Must run on the team's chosen models/gateway.** Default deployment uses the
>    **ARK (Volcano) multi-model gateway**; the Claude Agent SDK is pinned to the
>    ARK-compatible ceiling (**0.2.112**). Don't design features that require a
>    native-Anthropic-only SDK (0.3.x) without an explicit gateway/migration
>    decision.
> 4. **Deployability over hyperscale.** Optimize for "a team boots this with Docker
>    and it just works," not elastic public-SaaS scale.
>

A standalone WebSocket server (`ws-server.mjs`) authenticates each socket against the
web app, then **spawns a fresh child process per message** (`ws-query-worker.mjs`) that
calls `@anthropic-ai/claude-agent-sdk`'s `query()` inside a per-session sandbox workspace
with a per-user `CLAUDE_HOME`, a path-security guard, dynamic MCP servers, and on-disk Skills.

> A second, in-process **Mastra** runtime (HTTP/SSE; file-analysis / workflows) existed
> earlier; it was **removed in 2026-06** (along with playwright/libreoffice) to simplify to
> one SDK and restore free CI builds. Don't reintroduce a second agent SDK.

Around these sits a conventional SaaS stack: Better Auth + organizations,
Drizzle/Postgres, Polar billing, a BullMQ worker, S3/MinIO, Meilisearch.

**Key truth:** OxyGenie is *not* an agent harness in the Deep Agents sense — it
**delegates the agent loop to the Claude Agent SDK's `claude_code` preset** and
invests its own engineering in the **self-hosted multi-user platform shell**
(transport, per-user isolation, permissions, web UI, deployability).

## 2. What we are trying to be (the production harness)

A production-grade autonomous-agent product with:
multi-model support · **self-hosted private deployability** · **single-org
multi-user isolation** · observability · autonomous execution · a real web UI ·
and **strong security/sandboxing (defense-in-depth for a trusted team)**.

## 3. Where we already win (keep these)

Validated by the architecture review (see `research/`):

- **Process isolation of the agent loop** — fault + tenant isolation, clean
  OS-level cancellation. Stronger than Deep Agents' in-process model.
- **Cross-user filesystem fencing + realpath anti-symlink** (`src/claude/path-security.js`).
- **A sophisticated web tier** — streaming with throttling, WebSocket
  reconnect/backoff + re-resume, run-queue with epoch cancellation, rich
  artifact/file previews. Ahead of `deep-agents-ui`.
- **Config-driven, provider-pluggable MCP layer** (`src/claude/mcp/manager.js`).

## 4. Where Deep Agents wins (what we must catch up on)

Because Deep Agents *is* the harness, it ships first-class:
**planning/todo**, **sub-agents** (typed, per-subagent overrides),
**human-in-the-loop tool approval**, **checkpointing / durable resume**, and
**context management** (summarization, prompt caching, memory). OxyGenie
currently delegates or lacks these. Closing this gap — *on top of* our platform
advantages — is the path to surpassing Deep Agents.

## 5. Strategic decision (settled)

**Harden the current design and borrow patterns — do NOT migrate to or integrate
Deep Agents.** Deep Agents is a single-process LangGraph library with divergent
goals; a wholesale migration would discard our platform investment and SDK
alignment. We re-implement the missing harness capabilities against our own
WebSocket protocol and the Claude Agent SDK.

## 6. Principles — do / don't

**Do**
- Security-first **as defense-in-depth for a semi-trusted team — not anti-anonymous
  lockdown**: sandbox tool execution + least-privilege env to contain *mistakes* and
  protect the shared host/secrets. Server-touching power features (stdio MCP,
  internal-tool access, code exec) are **legitimate** — guard them (sandbox + warn),
  don't forbid them.
- Keep the process-isolation substrate; preserve tenant isolation everywhere.
- Use **TanStack Server Functions** for server logic (typed RPC).
- Minimal necessary change; extend/adapt over rewrite (this repo started from a starter).
- Evidence-based decisions: cite files; record decisions in `STATUS.md`.
- Make capabilities testable + observable before declaring them "done."

**Don't**
- Commit secrets / `.env` / credentials (a secret scanner enforces this).
- Add new REST API routes under `src/routes/api/*` (use Server Functions).
- Weaken or bypass cross-tenant isolation for convenience.
- Migrate wholesale to Deep Agents, or over-engineer ahead of need.
- Reintroduce a second agent SDK / runtime (Mastra was removed 2026-06) — extend the
  single Claude Agent SDK path instead.

## 7. Pointers

- Phased plan → [`ROADMAP.md`](./ROADMAP.md)
- Current state + ToDo (living) → [`STATUS.md`](./STATUS.md)
- The research that grounds all of this → [`research/2026-05-architecture-review.md`](./research/2026-05-architecture-review.md)
