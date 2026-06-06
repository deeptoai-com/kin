# Dokploy Deployment (OxyGenie)

> **Status: verified working** — `oxygenie.cc` deployed to Dokploy on 2026-06-05.
> This guide reflects the *actual, working* procedure plus every blocker we hit and
> its root cause. Read the **Critical invariants** box before you start — most
> deployment failures come from getting one of those wrong.

OxyGenie runs as a **Docker Compose** stack on Dokploy (Traefik in front). The app
is a heavy full-stack build (TanStack Start + Nitro + WebSocket server + Phase C
preview controller), so the single most important rule is: **do not build the image
on the Dokploy server — build it elsewhere and pull it.**

---

## ⚠️ Critical invariants (get these wrong → deploy fails)

1. **Build the image OFF-server, push to GHCR, Dokploy only PULLS.** The SSR bundle
   build peaks > 8 GB and OOMs on the Dokploy host and on standard 7 GB CI runners.
   `docker-compose.dokploy.yml` therefore uses `image:` + `pull_policy: always`
   (NOT `build:`). See [Step 3](#step-3-build-the-image-off-server--ghcr).
2. **`APP_NAME_SANITIZED` must be UNIQUE per deployment.** Volume names are
   `${APP_NAME_SANITIZED}-data` etc. and are **global** (not project-scoped). Reusing
   a value that another stack used makes Postgres reuse that stack's data volume with
   *its* credentials → migrate fails with `28P01 password authentication failed`.
3. **`DATABASE_URL` is built from `POSTGRES_*`** inside the compose (single source of
   truth). Never pass a separate `DATABASE_URL` that can drift from `POSTGRES_PASSWORD`.
4. **ARK gateway uses `ANTHROPIC_AUTH_TOKEN` (Bearer), NOT `ANTHROPIC_API_KEY`.**
   Setting `ANTHROPIC_API_KEY` makes the SDK use `x-api-key` and ARK rejects it.
5. **Previews use a SINGLE-level wildcard `*.<domain>`** (e.g. `*.oxygenie.cc`).
   Cloudflare's free Universal SSL does **not** cover 2-level `*.preview.<domain>`.
6. **TLS = Cloudflare proxied (orange) + Full (Strict) + Origin CA cert.** Do **not**
   use Let's Encrypt — HTTP-01 fails behind the orange cloud.
7. The GHCR image package must be **public** (or add a Dokploy registry credential).

---

## Prerequisites

- A Dokploy server with Traefik (Dokploy default) and the external `dokploy-network`.
- A domain on Cloudflare (this guide uses `oxygenie.cc`).
- A machine with **≥ 16 GB RAM** to build the image (e.g. a dev laptop), with Docker
  + `buildx`. (Or a CI runner large enough — standard GitHub 7 GB runners are NOT.)
- An ARK (Volcengine) API key for the `/api/coding` gateway.

---

## Step 1 — DNS (Cloudflare)

Add two **A** records pointing at the Dokploy host IP, both **Proxied** (orange):

| Name | Type | Content |
|---|---|---|
| `oxygenie.cc` | A | `<dokploy-host-ip>` |
| `*.oxygenie.cc` | A | `<dokploy-host-ip>` |

> Use a **single-level** wildcard `*.oxygenie.cc`. CF free SSL covers it; it does NOT
> cover `*.preview.oxygenie.cc`. App lives at the apex; previews are random
> `<id>.oxygenie.cc` subdomains.

## Step 2 — Cloudflare TLS (Full Strict + Origin CA)

1. SSL/TLS → Overview → set encryption mode to **Full (Strict)**.
2. SSL/TLS → Origin Server → **Create Certificate** → hostnames `oxygenie.cc` and
   `*.oxygenie.cc`, validity 15 years → save the **cert** + **private key**.
   - (Scriptable: an API token with `Zone > SSL and Certificates > Edit` can sign via
     `POST https://api.cloudflare.com/client/v4/certificates`. Origin CA *Service Keys*
     are deprecated — use a token.)
3. You'll install this cert into Dokploy in Step 5. (Do **not** use Let's Encrypt — the
   orange cloud blocks HTTP-01.)

## Step 3 — Build the image (off-server → GHCR)

Building on the Dokploy host OOMs. Build on a capable machine and push to GHCR:

```bash
# one-time: GHCR login (needs a token with write:packages)
echo "$(gh auth token)" | docker login ghcr.io -u <gh-user> --password-stdin
docker buildx create --name oxybuilder --driver docker-container --bootstrap --use

# build amd64 + push (Dokploy hosts are x86_64)
docker buildx build --builder oxybuilder --platform linux/amd64 \
  -t ghcr.io/<gh-user>/oxygenie/app:latest \
  --push .
```

> Playwright Chromium + LibreOffice were **removed from the image** (2026-06) — they were too
> heavy to run in the sandbox. The image is lean by default; no build flags needed. (Office-
> conversion and server-side-screenshot Skills degrade accordingly.)
> `VITE_WS_URL` is **not** baked: the frontend computes `wss://<current-host>/ws/agent`
> at runtime, so one image works for any domain.

## Step 4 — Make the GHCR package pullable

GHCR packages are private by default. Either:
- Make it **public**: GitHub → your packages → `oxygenie/app` → Package settings →
  Change visibility → Public. (Simplest; the image is just build output.)
- Or add a **Dokploy registry credential** (ghcr.io + user + a `read:packages` token).

## Step 5 — Dokploy: project + compose + cert + env

1. **Create a project** (e.g. `oxygenie`).
2. **Create a Docker Compose service**:
   - Source: **Git** → repo URL, branch `main` (public repos need no provider link).
   - Compose path: `./docker-compose.dokploy.yml`.
3. **Certificates → Add Certificate**: paste the Origin CA cert + private key from Step 2.
4. **Environment** — paste the variables (see [Step 6](#step-6-environment-variables)).
5. Make sure `dokploy-network` exists (Dokploy default).

> The whole of Step 5 is also doable via the `dokploy` CLI
> (`project create`, `compose create`, `compose update --sourceType git --customGitUrl …
> --customGitBranch main --composePath ./docker-compose.dokploy.yml --env …`,
> `certificates create`, `compose deploy`).

## Step 6 — Environment variables

```bash
# --- identity / domain ---
APP_NAME=oxygenie
APP_NAME_SANITIZED=oxygenie-cc      # ⚠️ MUST be unique across all stacks on this host
APP_HOSTNAME=oxygenie.cc            # drives BETTER_AUTH_URL, WS, previews, checkout, Traefik Host

# --- secrets (generate strong values; openssl rand) ---
POSTGRES_USER=oxygenie
POSTGRES_PASSWORD=<rand>
POSTGRES_DB=oxygenie
MINIO_ROOT_USER=oxygenie
MINIO_ROOT_PASSWORD=<rand>
MINIO_BUCKET=oxygenie-files
MEILI_MASTER_KEY=<rand>
BETTER_AUTH_SECRET=<rand 32+>

# --- ARK (Volcengine) — Bearer auth, NOT api-key ---
ANTHROPIC_AUTH_TOKEN=ark-...
ANTHROPIC_BASE_URL=https://ark.cn-beijing.volces.com/api/coding
ANTHROPIC_MODEL=glm-5.1
ANTHROPIC_DEFAULT_SONNET_MODEL=glm-5.1
ANTHROPIC_DEFAULT_OPUS_MODEL=glm-5.1
CLAUDE_CODE_SUBAGENT_MODEL=glm-5.1
ANTHROPIC_DEFAULT_HAIKU_MODEL=doubao-seed-2.0-lite

# --- image ---
APP_TAG=latest                     # (APP_IMAGE defaults to ghcr.io/<user>/oxygenie/app)
```

Do **not** set `DATABASE_URL` (the compose builds it from `POSTGRES_*`) and do **not**
set `ANTHROPIC_API_KEY`. `ZHIPU_API_KEY` is optional (leave empty in ARK-only deploys).

## Step 7 — Deploy + verify

Trigger the deploy. Expected: clone → pull image → create fresh volumes/network →
db/minio/meili/redis healthy → migrate (retries until `db` resolves) → app up.

```bash
curl -sS -o /dev/null -w "%{http_code}\n" https://oxygenie.cc/health      # 200
curl -sS -o /dev/null -w "%{http_code}\n" https://oxygenie.cc/            # 200
curl -sS -o /dev/null -w "%{http_code}\n" https://oxygenie.cc/ws/agent    # 426 (WS upgrade)
```

`/ws/agent` returning **426 Upgrade Required** confirms the WebSocket server is up and
Traefik routes `/ws` correctly — that's the agent-chat lifeline.

---

## Troubleshooting — blockers we hit & root causes

| Symptom | Root cause | Fix |
|---|---|---|
| Deploy "Cancelled" after ~5 min; build log dies at `vite:reporter` (SSR) | SSR bundle build peaks > available RAM → OOM-killed (Dokploy host) / 6 h hang (7 GB GitHub runner) | **Build off-server** (≥16 GB) → GHCR; Dokploy pulls. Don't `build:` in the compose. |
| migrate `exit 1`; deploy log only says "didn't complete successfully" | `up -d` swallows container stdout | Read the **migrate container** log (Dokploy → Logs → `*-migrate`), not the deployment log |
| `pull access denied` / image won't pull | GHCR package private | Make package public, or add a Dokploy registry credential |
| `volume "<x>-data" already exists but was created for project …` then `28P01` | Global volume names collided with a previous stack → Postgres reused its data volume + creds | Set a **unique** `APP_NAME_SANITIZED` |
| migrate `28P01 password authentication failed for user "oxygenie"` | A standalone `DATABASE_URL` drifted from `POSTGRES_PASSWORD` | Build `DATABASE_URL` from `POSTGRES_*` in the compose (done) |
| migrate `getaddrinfo EAI_AGAIN db` | The `db` network alias isn't resolvable the instant migrate starts (DNS propagation lag), even with `depends_on: service_healthy` | migrate entrypoint **retries** `db:migrate` until `db` resolves (done) |
| Browser cert error on `<id>.preview.<domain>` | CF free SSL doesn't cover 2-level wildcards | Use single-level `*.<domain>` for previews |
| ARK 401 / auth failures | Used `ANTHROPIC_API_KEY` (x-api-key) | Use `ANTHROPIC_AUTH_TOKEN` (Bearer); leave `ANTHROPIC_API_KEY` empty |

**General debugging tip:** the deployment log shows orchestration only. For a failing
one-shot container (migrate, provision-minio), read **that container's** logs to see the
real error. To diagnose fast without redeploy churn, reproduce the exact compose locally:
`docker compose -f docker-compose.dokploy.yml -p test up migrate` (source the env into the
shell; pull amd64 base images; the app image is amd64-only so emulate on arm64).

---

## Known follow-ups

- **Make CI builds viable** (so contributors don't need a 16 GB local build): slim the
  SSR bundle so it fits a standard 7 GB runner — remove the Mastra SDK and the
  Playwright/LibreOffice tooling (decided; tracked). Then `.github/workflows/build.yml`
  builds + pushes GHCR on push to `main` automatically.
- **Phase C routed-preview E2E** on the live host (create a multi-file app → Run preview
  → reach `<id>.oxygenie.cc`) — pending.
- `version:` key in the compose is obsolete (harmless warning) — can be removed.
