# Deploy Kin on a Mac mini (from scratch)

A complete, start-to-finish guide to self-hosting the **full** Kin stack — chat,
the Phase C **live preview**, and the **code sandbox** — on a single Apple-Silicon Mac
(a Mac mini is ideal), exposed on your own domain through a **Cloudflare Tunnel**. No public
IP, no open ports, no separate server.

This is the **Path B / tunnel** deployment ([tunnel.md](tunnel.md)) written as a linear
recipe for a brand-new machine.

---

## 0. Read this first: just pull the prebuilt image

Kin publishes **prebuilt multi-arch (amd64 + arm64) images** to GHCR
(`ghcr.io/deeptoai-com/kin/{app,parser,updater}`). On an Apple-Silicon Mac, `docker compose
pull` fetches the **native arm64** variant — **no local build, no OOM risk, no 8-vs-16 GB
build dance.** This guide pulls by default; building locally is optional (see [Step 4](#step-4--get-the-image)).

**RAM is now only about *running* the stack**, which is light:

| Mac mini | Run Kin? |
|---|---|
| **8 GB** | ✅ Light single-user use (idle stack + a preview fits). |
| **16 GB (recommended)** | ✅ Comfortable, room for several concurrent previews. |

> A local build (only if you want to run your own image instead of the published one) still
> peaks above 8 GB of RAM — so build on a 16 GB+ Mac. But you no longer need to: pulling the
> multi-arch image is the default.

**Runtime footprint** (so you know it fits): macOS itself ~3–4 GB; the idle stack (Postgres,
Redis, MinIO, Meilisearch, app, worker, preview-controller, Traefik, cloudflared, the `parser`
and `updater` sidecars) ~2–3 GB; an active preview build adds ~1 GB (each preview sandbox is
capped at 768 MB). 16 GB is comfortable with room for several previews; 8 GB works for light
single-user use.

---

## Prerequisites

- An **Apple-Silicon Mac mini**, macOS up to date.
- A **domain you control, managed by Cloudflare** (DNS hosted on Cloudflare). The examples use
  `kin.example.com` — substitute your own everywhere.
- A free **Cloudflare account**.
- An **LLM gateway key** — the default is ARK (Volcengine): an `ANTHROPIC_AUTH_TOKEN`
  (Bearer) + base URL. (Any Anthropic-compatible gateway works; see the env notes.)
- ~30 minutes, and ~10 GB free disk.

---

## Step 1 · Install the runtime + get the code

```bash
# 1a. OrbStack — the recommended Docker engine on macOS (lighter + faster than Docker Desktop).
#     Download from https://orbstack.dev and install, OR via Homebrew:
brew install orbstack            # then launch OrbStack once so the docker engine is running
# (Docker Desktop also works; the bundled `dockerproxy` shim handles either — see tunnel.md.)

# 1b. git (Xcode CLT) if you don't have it
xcode-select --install 2>/dev/null || true

# 1c. clone
git clone https://github.com/deeptoai-com/kin.git
cd kin
```

Confirm Docker is up: `docker version` should print both Client and Server.

---

## Step 2 · Create your secrets (outside the repo)

**Never put secrets in the repo or in `.env`.** Keep them in a file in your home dir:

```bash
mkdir -p ~/kin-deploy && chmod 700 ~/kin-deploy
cat > ~/kin-deploy/secrets.env <<'EOF'
# --- identity / domain ---
APP_HOSTNAME=kin.example.com
APP_NAME=kin
APP_NAME_SANITIZED=kin-mini        # must be UNIQUE across stacks on this host (volume names)

# --- datastore + auth secrets (generated below) ---
POSTGRES_USER=kin
POSTGRES_PASSWORD=__FILL__
POSTGRES_DB=kin
MINIO_ROOT_USER=kin
MINIO_ROOT_PASSWORD=__FILL__
MEILI_MASTER_KEY=__FILL__
BETTER_AUTH_SECRET=__FILL__

# --- LLM gateway (ARK / Volcengine) — Bearer auth; do NOT set ANTHROPIC_API_KEY ---
ANTHROPIC_AUTH_TOKEN=ark-your-key-here
ANTHROPIC_BASE_URL=https://ark.cn-beijing.volces.com/api/coding
ANTHROPIC_MODEL=glm-5.1
ANTHROPIC_DEFAULT_SONNET_MODEL=glm-5.1
ANTHROPIC_DEFAULT_OPUS_MODEL=glm-5.1
ANTHROPIC_DEFAULT_HAIKU_MODEL=doubao-seed-2.0-lite
CLAUDE_CODE_SUBAGENT_MODEL=glm-5.1
EOF
chmod 600 ~/kin-deploy/secrets.env

# fill the four generated secrets in place:
for k in POSTGRES_PASSWORD MINIO_ROOT_PASSWORD MEILI_MASTER_KEY BETTER_AUTH_SECRET; do
  v=$(openssl rand -hex 32)
  sed -i '' "s|^$k=__FILL__|$k=$v|" ~/kin-deploy/secrets.env
done
```

Then edit `~/kin-deploy/secrets.env` and set your real `ANTHROPIC_AUTH_TOKEN` (and
`APP_HOSTNAME` if not `kin.example.com`). Keep `APP_NAME_SANITIZED` unique — volume names derive
from it, and a collision would reuse another stack's data.

> ARK uses **`ANTHROPIC_AUTH_TOKEN`** (Bearer). Setting `ANTHROPIC_API_KEY` makes the SDK
> switch to `x-api-key` and ARK rejects it — so leave it unset.

---

## Step 3 · Cloudflare Tunnel + DNS

### 3a. Create the tunnel and copy its token
Cloudflare dashboard → **Zero Trust → Networks → Tunnels → Create a tunnel** → *Cloudflared* →
name it → copy the **token** (`eyJ...`). **Do not** add Public Hostnames in the dashboard —
ingress is defined in `config.yml` below so the wildcard works.

### 3b. Generate credentials + tunnel config
```bash
cd ~/kin/infra/tunnel        # adjust if you cloned elsewhere
cp config.yml.example config.yml
TOKEN='eyJ...'                    # paste your tunnel token
TID=$(echo "$TOKEN" | base64 -d \
  | python3 -c 'import sys,json;d=json.load(sys.stdin);open("credentials.json","w").write(json.dumps({"AccountTag":d["a"],"TunnelID":d["t"],"TunnelSecret":d["s"]}));print(d["t"])')
sed -i '' "s/REPLACE_WITH_TUNNEL_ID/$TID/" config.yml
echo "Tunnel ID: $TID"            # you need this for DNS next
```
If your domain isn't `kin.example.com`, also edit the two `hostname:` lines in `config.yml`.
(`config.yml` and `credentials.json` are **gitignored** — per-deploy / secret.)

### 3c. DNS — two **proxied** CNAMEs
In Cloudflare DNS for your zone, add (replace `<TID>`):

| Type | Name | Target | Proxy |
|---|---|---|---|
| CNAME | `kin.example.com` (`@`) | `<TID>.cfargotunnel.com` | **Proxied** (orange) |
| CNAME | `*` | `<TID>.cfargotunnel.com` | **Proxied** (orange) |

The apex serves the app; `*` serves every `<id>.kin.example.com` preview. Cloudflare's free
Universal SSL covers the apex + one wildcard level (so previews are single-level by design).

---

## Step 4 · Get the image

**Default — pull the prebuilt multi-arch image (recommended).** Nothing to do here:
`docker-compose.tunnel.yml` defaults to `ghcr.io/deeptoai-com/kin/app` and Step 5 pulls the
native **arm64** variant automatically. Skip to Step 5.

**Optional — build locally** (only if you want to run your own image instead of the published
one). The build peaks above 8 GB of RAM, so do it on a 16 GB+ Mac:
```bash
cd ~/kin
docker build -t kin:local .                                # ~4 GB native arm64
```
Then in Step 5 set `APP_IMAGE=kin APP_TAG=local APP_PULL_POLICY=never` and overlay
`-f docker-compose.build.yml`. On an 8 GB mini you can build on **another** 16 GB+ Mac and
transfer the image (`docker save kin:local | gzip > kin-local.tar.gz` → copy → `gunzip -c
kin-local.tar.gz | docker load`), but pulling the multi-arch image avoids all of this.

---

## Step 5 · Bring up the stack

```bash
cd ~/kin
set -a; . ~/kin-deploy/secrets.env; set +a
docker compose -f docker-compose.tunnel.yml -p kin up -d    # pulls ghcr.io/deeptoai-com/kin/* (arm64)
```

> Running your own local build instead? Add the overlay + image env:
> `APP_IMAGE=kin APP_TAG=local APP_PULL_POLICY=never docker compose -f docker-compose.tunnel.yml -f docker-compose.build.yml -p kin up -d`.

This starts everything: Postgres, Redis, MinIO, Meilisearch, the migrator (runs once), the
app, the worker, the preview-controller, the bundled Traefik (+ the macOS `dockerproxy` shim),
and `cloudflared`. All services use `restart: unless-stopped`, so they come back after a
reboot once the Docker engine is running.

---

## Step 6 · Verify (before trusting the browser)

`fetch()` from Node ignores a manual `Host` header, so test routing with `wget --header`:

```bash
set -a; . ~/kin-deploy/secrets.env; set +a

# everything up + datastores healthy
docker compose -f docker-compose.tunnel.yml -p kin ps

# cloudflared connected to the edge (expect ~4 "Registered tunnel connection")
docker logs ${APP_NAME_SANITIZED}-cloudflared 2>&1 | grep "Registered tunnel connection"

# app routes through the bundled Traefik
TIP=$(docker inspect ${APP_NAME_SANITIZED}-traefik -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}')
docker exec ${APP_NAME_SANITIZED}-dockerproxy sh -c \
  "wget -qS -O /dev/null --header='Host: $APP_HOSTNAME' http://$TIP/health 2>&1 | grep HTTP/"   # → 200

# code sandbox viable (user+net namespace must succeed)
docker exec kin-app sh -c 'unshare -Urn echo userns-ok'   # → userns-ok
```

Then open **`https://kin.example.com`** in a browser (DNS from Step 3 must be live). You should
get the app over HTTPS (Cloudflare terminates TLS at the edge).

---

## Step 7 · Pre-warm the preview dependency cache (recommended)

Previews install their deps in a sandbox; a **shared cache** (mounted into every preview)
makes installs reuse downloads (cold ≈ 15 s → warm ≈ 4 s for a React+Vite app). Seed the
common frameworks once so even the first preview is fast:

```bash
cd ~/kin
bash infra/preview/warm-cache.sh
# extend later: PREVIEW_WARM_DEPS="svelte @sveltejs/vite-plugin-svelte" bash infra/preview/warm-cache.sh
```

---

## Step 8 · First sign-in

Open `https://kin.example.com`, create your account. Kin is a **single-org, multi-user**
workspace for a trusted team — the first user is you; invite teammates as needed. You may see
a "verify your email" banner; email verification is optional for core use on a self-host.

Try it end to end: ask for a small multi-file web app → click **运行预览 / Run preview** → it
builds in a sandbox and loads at `https://<id>.kin.example.com`. Run a snippet of Python to
exercise the code sandbox.

---

## Operations

### Keep the mini awake (it's your server now)
A sleeping Mac drops the tunnel. For a headless mini:
```bash
sudo pmset -a sleep 0 disksleep 0 displaysleep 0 womp 1   # never sleep; wake on network
```
(Or System Settings → Energy: "Prevent automatic sleeping", "Start up automatically after a
power failure".)

### Start on boot without a login
- OrbStack → Settings → **Start at login**.
- For a truly headless box, enable macOS **automatic login** (System Settings → Users & Groups)
  so OrbStack starts after a reboot; `restart: unless-stopped` then brings the stack back.

### Update to a new version
**Easiest: in-app online auto-update.** When a newer image is published, an **admin** sees an
**update** entry in the sidebar; one click runs pull → migrate → recreate → health-gate (auto-
rollback on failure), executed by the `updater` sidecar.

Or update manually by pulling the new image:
```bash
cd ~/kin && git pull
set -a; . ~/kin-deploy/secrets.env; set +a
docker compose -f docker-compose.tunnel.yml -p kin pull      # fetch the latest GHCR image
docker compose -f docker-compose.tunnel.yml -p kin up -d     # recreates only what changed
```
(Running your own local build? `docker build -t kin:local .` first, with the
`APP_IMAGE=kin APP_TAG=local APP_PULL_POLICY=never` + `-f docker-compose.build.yml` overlay.)

### Back up your data (do this regularly)
User workspaces, the database, and object storage live in named volumes. The important ones:
`${APP_NAME_SANITIZED}-data` (Postgres), `${APP_NAME_SANITIZED}-claude-sessions` (user
workspaces), `${APP_NAME_SANITIZED}-minio-data`, `${APP_NAME_SANITIZED}-meili-data`.
```bash
set -a; . ~/kin-deploy/secrets.env; set +a
mkdir -p ~/kin-backups
for v in data claude-sessions minio-data meili-data; do
  docker run --rm -v ${APP_NAME_SANITIZED}-$v:/d -v ~/kin-backups:/b busybox \
    tar czf /b/$v.tgz -C /d .
done
```
(`oxy-preview-pm-cache` and `redis-data` are caches — no need to back up.)

### Logs / stop / start
```bash
docker compose -f docker-compose.tunnel.yml -p kin logs -f app          # tail app logs
docker compose -f docker-compose.tunnel.yml -p kin stop                 # stop (keeps data)
docker compose -f docker-compose.tunnel.yml -p kin up -d                # start again
```

---

## Troubleshooting

The deep table (Traefik on OrbStack, the `dockerproxy` shim, preview 404s, etc.) lives in
**[tunnel.md → Troubleshooting](tunnel.md#troubleshooting-issues-actually-hit-bringing-this-up-on-macosorbstack)**.
The most common first-deploy snags:

| Symptom | Fix |
|---|---|
| Build killed / "out of memory" on an 8 GB mini | You don't need to build — pull the prebuilt multi-arch image (Step 4 default). A local build needs >8 GB; do it on a 16 GB+ Mac. |
| Site unreachable, but `docker ps` is healthy | The mini slept or lost network. See "Keep the mini awake". |
| `https://kin.example.com` shows Cloudflare error 1033/530 | Tunnel not connected — check `cloudflared` logs (Step 6) and that DNS CNAMEs point to `<TID>.cfargotunnel.com`, **proxied**. |
| Preview opens but 404s | Ensure you're on this branch's code (Traefik v3 `HostRegexp` fix). |
| Chat says auth/model error | ARK key/model: `ANTHROPIC_AUTH_TOKEN` set, `ANTHROPIC_API_KEY` **unset**. |

---

## What you get vs. the other paths

| | This guide (Mac mini + tunnel) | [VPS / Docker Compose](docker-compose.md) |
|---|---|---|
| Public IP / open ports | **None needed** (outbound tunnel) | Needed |
| TLS | Cloudflare edge (automatic) | Let's Encrypt / your certs |
| Install | `docker compose up` (this guide) | one-command [`install-vps.sh`](../../scripts/install-vps.sh) |
| Always-on | Only while the mini is on | 24/7 |
| Best for | A team's own box / full-feature self-host | A real server |

Both paths run the **same app and images**; they differ only in who runs the edge (proxy / TLS
/ DNS).
