# Multi-model selection — research & implementation plan (2026-06)

**Status:** research / owner-set next focus (2026-06-07). Implementation pending.
**Goal:** let the user pick which model an agent run uses, instead of the single
deployment-wide `ANTHROPIC_MODEL`. Stay inside the **SDK 0.2.112 / ARK** constraint
(no 0.3.x-only features); fit the **self-hosted, single-org, curated-capabilities**
product shape (a team-curated model list, not a public marketplace).

---

## 1. Current state (code audit, 2026-06-07)

| Aspect | Today |
|---|---|
| Where the model comes from | `process.env.ANTHROPIC_MODEL`, read **once at server startup** (`ws-server.mjs` config ~L107; mirrored in `ws-query-worker.mjs` ~L24). |
| How it reaches the SDK | Worker passes it explicitly: `query({ options: { model: config.model, … } })` (`ws-query-worker.mjs` ~L693). |
| Auth / endpoint | Worker child inherits `process.env` wholesale; `ws-server` sets `ANTHROPIC_BASE_URL`/`ANTHROPIC_API_URL` and (for ARK) inherits `ANTHROPIC_AUTH_TOKEN` (Bearer). One gateway, one key. |
| Per-request / per-session model | **None.** No `model` field on the inbound `chat` message; no `model` column on `agent_session`. |
| UI | The "GLM 5.0" text in `chat-composer.tsx` (~L468) is a **hardcoded, non-interactive badge**. Nothing is sent to the backend. |
| Usage tracking | `recordUsage()` already captures `modelUsage` from the SDK `result` event (post-run) → `/api/usage`. Telemetry only, not selection. |
| **Proven plumbing pattern to mirror** | `skillSlug` and `permissionTier` already flow **frontend store → ws-adapter `chat` message → ws-server `handleChat` → worker request**. A `model` field follows the exact same path. |

**Net:** model selection has **zero** effect today. The hard parts (a registry,
the picker, per-request routing) are greenfield, but the plumbing template and a
fresh-child-process-per-request architecture make it tractable.

---

## 2. The constraint that shapes everything: we drive the **Claude Agent SDK**, not a raw chat client

LibreChat/Lobe build per-provider HTTP clients (OpenAI/Anthropic/Google factories).
**We can't** — our "client" is the Agent SDK, which spawns a CLI subprocess that
talks **only the Anthropic-compatible protocol** and reads its target from env:

- `ANTHROPIC_BASE_URL` (+ `ANTHROPIC_API_URL`) — the gateway
- `ANTHROPIC_AUTH_TOKEN` (Bearer, ARK) **or** `ANTHROPIC_API_KEY` (x-api-key, native)
- `ANTHROPIC_MODEL` (+ the `model` option on `query()`)
- alias models: `ANTHROPIC_DEFAULT_SONNET_MODEL` / `…_OPUS_MODEL` / `…_HAIKU_MODEL`,
  `CLAUDE_CODE_SUBAGENT_MODEL` (used by the SDK for sub-agents + the cheap background tier)

**Consequence — two tiers of "multi-model":**

- **A. Same-gateway, many models (EASY, the MVP).** ARK `/api/coding` already serves
  several models behind **one base URL + one key** (today: `glm-5.1` main,
  `doubao-seed-2.0-lite` haiku; `doubao-seed-2.0-code` validated on `/api/coding/v3`).
  Switching model = pass a different `model` string. **No key/baseURL change.**
- **B. Cross-gateway / cross-provider (LATER).** e.g. ARK **+** Zhipu native
  (`open.bigmodel.cn/api/anthropic`) **+** native Anthropic. Each has its own
  base URL + token + model namespace. Requires **per-request env routing** (below).
  Still no 0.3.x needed — because the worker is a fresh child process, `ws-server`
  can set that child's `ANTHROPIC_BASE_URL` / `ANTHROPIC_AUTH_TOKEN` / `ANTHROPIC_MODEL`
  per request based on the chosen model's provider.

> **Hard limit to call out:** the SDK speaks Anthropic-protocol only. **OpenAI-only**
> providers cannot be used directly — they'd need an Anthropic-compatible gateway/shim
> in front. So "multi-model" here = "multi-model across Anthropic-compatible gateways."
> (Our `/api/coding/v3` OpenAI path is for the changedoc CLI, **not** the agent SDK.)

---

## 3. The key enabler: per-request worker env override

The single most important design point. `handleChat` spawns the worker with
`workerEnv = { ...process.env }` and then overrides specific keys. Today it overrides
`ANTHROPIC_MODEL` from a startup constant. We change it to override
`ANTHROPIC_MODEL` (always) and — for mode B — `ANTHROPIC_BASE_URL` / `ANTHROPIC_API_URL`
/ `ANTHROPIC_AUTH_TOKEN` (or `ANTHROPIC_API_KEY`) **from the selected model's registry
entry**. This gives full provider routing with the pinned SDK and no protocol work.

---

## 4. Proposed architecture

### 4.1 Model registry (the curated list)
A small, curated set the team configures — **not** a fetched marketplace (matches the
product's "curated capabilities" principle, like Skills).

Per-entry fields (borrowed from LibreChat's spec + Lobe's provider card, trimmed):

```
id            // stable key sent over the wire, e.g. "glm-5.1", "doubao-seed-2.0-code"
label         // display name, e.g. "GLM 5.1", "Doubao Code 2.0"
model         // the string the gateway expects (often == id)
provider      // "ark" | "zhipu" | "anthropic" | "<custom>"
default?      // the one selected when none chosen
enabled?      // hide without deleting
tags?         // ["coding","fast","cheap","vision"] for UI hints
// provider routing (mode B only; omit for same-gateway mode A):
baseUrlEnv?   // name of the env var holding the gateway base URL
tokenEnv?     // name of the env var holding the Bearer token (ARK) ...
apiKeyEnv?    // ... or x-api-key (native Anthropic)
// optional alias remap when this model implies different sub-agent/background models:
aliases?      // { sonnet, opus, haiku, subagent }
```

**Where it lives — phased:**
- **MVP:** a server-side config (env-derived or a checked-in `model-registry` TS/JSON
  of curated entries, all `provider: "ark"`). No DB migration. Secrets stay as env var
  *names* in the registry; values stay outside the repo.
- **v2:** a DB table + admin UI, mirroring the **Skills catalog** model (DB = truth,
  curated seed via `migrate`, admin add/remove). Reuse that proven pattern.

### 4.2 Selection plumbing (mirror `skillSlug` / `permissionTier` exactly)
1. `src/lib/chat-session-store.ts`: add `selectedModelId` + setter (default = registry default).
2. `src/claude/adapters/ws-adapter.ts`: add `model?: string` to the `chat` `InboundMessage`;
   include `model: store.selectedModelId` in the `send({ type:'chat', … })`.
3. `ws-server.mjs` `handleChat`: accept `model`, **validate against the registry**
   (reject/clamp unknown → default), thread into the worker spawn.
4. `ws-query-worker.mjs`: already passes `config.model` to `query()` — just ensure the
   resolved model flows in (via request payload or env, matching the skillSlug path).

### 4.3 Worker env routing (mode B)
In `handleChat`, after resolving the registry entry: build `workerEnv` overriding
`ANTHROPIC_MODEL` and (if the entry carries provider routing) `ANTHROPIC_BASE_URL` /
`ANTHROPIC_API_URL` / the token var, reading values from the named env vars. For mode A
(all-ARK) this collapses to just `ANTHROPIC_MODEL`.

### 4.4 Sub-agent / alias models
The SDK uses `ANTHROPIC_DEFAULT_*` + `CLAUDE_CODE_SUBAGENT_MODEL` internally.
- **MVP:** leave the alias env as deployed (the gateway default). Switching the *main*
  model only changes the top-level `query({model})`.
- **v2:** let a registry entry's `aliases` remap these per-request (needed if the chosen
  model lives on a *different* provider than the deployed aliases).

### 4.5 Session persistence
Add a `model` column to `agent_session` so resume reuses the last model and the picker
reflects it. Optional for MVP (store-only is fine first); do it with the v2 DB work.
LibreChat stores model **per message** — worth adopting later for cost attribution
(we already have `modelUsage` telemetry to pair with it).

### 4.6 UI picker
Replace the cosmetic badge in `chat-composer.tsx` with a real dropdown:
- options from the registry (a `GET` server fn, or a small static import for MVP);
- writes `selectedModelId` to the store; disabled while a run is active;
- mirror the existing **permission-tier selector** UX in the composer.

### 4.7 Credentials / keys
Per-provider tokens are env vars **outside the repo** (e.g. `~/oxygenie-deploy/secrets.env`);
the registry references their *names*, `ws-server` reads values at spawn. This is the
"per-capability key split" the roadmap calls for — no single-key blast radius once
mode B lands.

---

## 5. Phased scope

> **Scope update (owner steer 2026-06-07):** v1 is **not** limited to a single gateway. Any
> Anthropic-protocol model that is *currently usable* (reachable + authed + model-accepted), incl.
> **across connections/accounts**, must be switchable; a **health probe gates the menu**. The
> authoritative spec is **`prd/2026-06-multi-model-switching-prd.md`** — it folds the old "mode B"
> (per-request cross-provider env routing) into v1. The table below is kept for the original effort
> reasoning; defer to the PRD where they differ.

| Phase | Scope | Effort |
|---|---|---|
| **MVP (tomorrow)** | Same-gateway (ARK) model switch: registry config (curated ARK models) + `model` plumbing (store→adapter→ws-server→worker, validated) + real composer picker + `query({model})`. **No** baseURL/token switching, **no** DB. | S–M |
| **v2** | Session/message persistence (`model` column), DB-backed registry + admin curation UI (mirror Skills), alias remap. | M |
| **Phase 4 stretch** | Cross-provider routing (mode B per-request env), provider failover/fallback, per-capability key split, model capability gating (e.g. only vision models for image tasks). | M–L |

---

## 6. Concrete change list (MVP)

- `src/config/model-registry.ts` (**new**) — curated entries + `getModels()` / `resolveModel(id)` + default.
- `src/lib/chat-session-store.ts` — `selectedModelId` state + setter.
- `src/claude/adapters/ws-adapter.ts` — `model?` on `chat` `InboundMessage`; send it.
- `ws-server.mjs` — `handleChat` accepts + validates `model`; set `workerEnv.ANTHROPIC_MODEL` from it (replacing the startup constant).
- `ws-query-worker.mjs` — ensure resolved model reaches `query({ options:{ model } })` (largely already there).
- `src/components/claude-chat/chat-composer.tsx` — swap the static badge for a registry-driven `<select>`; wire to the store.
- (optional) a `listModels` server fn if the registry should be server-owned.

---

## 7. Risks & open questions

1. **Does ARK `/api/coding` (Anthropic proto) serve every model we want behind one key?**
   Confirmed for `glm-5.1` + `doubao-seed-2.0-lite` (deployed) and `doubao-seed-2.0-code`
   (validated on `/api/coding/v3`). **Verify each MVP model on `/api/coding` (the SDK path)**
   before listing it — the OpenAI `/v3` validation doesn't prove the Anthropic path.
2. **Alias/sub-agent coupling.** If a chosen model's provider differs from the deployed
   `ANTHROPIC_DEFAULT_*`, sub-agents/background calls may still hit the old provider until
   v2 alias remap. Keep MVP same-gateway to avoid this.
3. **Resume + model change mid-session.** Decide whether changing model mid-conversation
   is allowed (likely yes; record per-message later). The SDK resume carries its own session;
   a different model on resume is generally fine over the same gateway.
4. **No OpenAI-only providers** without an Anthropic-compatible shim (§2). Set expectations.
5. **Structured outputs flag.** `ENABLE_STRUCTURED_OUTPUTS` stays off; ensure model switch
   doesn't re-trigger the Stop-hook path.

---

## 8. Prior art (consulted; borrow, don't copy)

- **LibreChat** (`packages/data-provider/src/models.ts`, `librechat.example.yaml`):
  two-tier spec→preset; YAML/env custom endpoints with `${ENV}` injection; **per-message
  model+endpoint logging**; endpoint-type sniffing. *Borrow:* env-named credentials in a
  declarative registry, per-message model tracking.
- **Lobe Chat** (`packages/model-bank/.../modelProvider.ts`, `src/store/aiInfra`,
  `openaiCompatibleFactory`): provider cards; runtime `resolveRuntimeProvider` routing custom
  → compat runtime; Zustand per-session selection. *Borrow:* clean registry + a request-time
  "resolve provider → routing config" helper; store-held selection.
- **Skip:** their 50–70 provider enums and per-provider HTTP client factories — we have one
  SDK and (for now) one Anthropic-compatible gateway. Our "factory" is just choosing the
  worker child's env.

**Verdict for OxyGenie:** a tiny curated registry + the proven per-request plumbing +
per-request worker-env routing gives full multi-model (and later multi-provider) on the
pinned SDK with no protocol work. Ship mode A (same-gateway) first; the env-routing seam
makes mode B a later, additive change.
