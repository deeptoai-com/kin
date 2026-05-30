# OxyGenie — Vision & Architectural Identity

> **North star:** turn OxyGenie into an excellent open-source project that
> **surpasses Deep Agents** — by combining Deep Agents' *harness* strengths with
> OxyGenie's *platform* strengths, on a security-first, production-grade base.

## 1. What OxyGenie is

OxyGenie is a **web-based, multi-tenant, autonomous Claude-agent platform** —
think "Claude Desktop as a deployable SaaS." It is built on **TanStack Start**
(SSR + Nitro) and deliberately runs **two agent runtimes side by side**:

1. **Process-isolated Claude Agent SDK runtime** (the real interactive loop).
   A standalone WebSocket server (`ws-server.mjs`) authenticates each socket
   against the web app, then **spawns a fresh child process per message**
   (`ws-query-worker.mjs`) that calls `@anthropic-ai/claude-agent-sdk`'s
   `query()` inside a per-session sandbox workspace with a per-user
   `CLAUDE_HOME`, a path-security guard, dynamic MCP servers, and on-disk Skills.
2. **In-process Mastra runtime** (`src/mastra`) over HTTP/SSE for
   file-analysis / workflow tasks, currently on Zhipu GLM.

Around these sits a conventional SaaS stack: Better Auth + organizations,
Drizzle/Postgres, Polar billing, a BullMQ worker, S3/MinIO, Meilisearch.

**Key truth:** OxyGenie is *not* an agent harness in the Deep Agents sense — it
**delegates the agent loop to the Claude Agent SDK's `claude_code` preset** and
invests its own engineering in the **multi-tenant platform shell** (transport,
isolation, permissions, web UI, deployability).

## 2. What we are trying to be (the production harness)

A production-grade autonomous-agent product with:
multi-model support · multi-tenancy · deployability · observability ·
autonomous execution · a real web UI · and **strong security/sandboxing**.

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
- Security-first: treat tool execution as untrusted; sandbox it; least-privilege env.
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
- Let the two runtimes (Claude SDK vs Mastra) silently fork shared logic.

## 7. Pointers

- Phased plan → [`ROADMAP.md`](./ROADMAP.md)
- Current state + ToDo (living) → [`STATUS.md`](./STATUS.md)
- The research that grounds all of this → [`research/2026-05-architecture-review.md`](./research/2026-05-architecture-review.md)
