# Deploy OxyGenie on a Mac mini (from scratch)

A complete, start-to-finish guide to self-hosting the **full** OxyGenie stack — chat,
the Phase C **live preview**, and the **code sandbox** — on a single Apple-Silicon Mac
(a Mac mini is ideal), exposed on your own domain through a **Cloudflare Tunnel**. No public
IP, no open ports, no separate server.

This is the **Path C / tunnel** deployment ([tunnel.md](tunnel.md)) written as a linear
recipe for a brand-new machine, with the one thing that actually trips people up — **RAM vs.
the image build** — settled up front.

---

## 0. Read this first: 8 GB vs 16 GB (the build is the catch)

OxyGenie's web image bundles a server-side-rendered (SSR) app whose **build peaks above
8 GB of RAM**. Everything else (running the stack) is light. So the only hard requirement is
about **building the image**, not running it:

| Mac mini | Build the image on the mini? | What to do |
|---|---|---|
| **16 GB (recommended)** | ✅ Yes — native build works | Follow every step here as written. |
| **8 GB** | ❌ No — the build OOMs | Build the image on **another** Apple-Silicon Mac (16 GB+), transfer it, and run it on the mini (see [Step 4 · 8 GB path](#step-4--build-the-image)). The mini runs the stack fine; it just can't *build* it. |

> **Why not just pull a prebuilt image?** The published image (`ghcr.io/foreveryh/oxygenie/app`)
> is `linux/amd64` (for x86 servers). A Mac mini is `arm64`; running amd64 under emulation is
> slow. For a Mac you want a **native arm64** image, which means building it on *an* arm64 Mac
> (the mini if 16 GB, or another Mac if 8 GB).

**Runtime footprint** (so you know it fits): macOS itself ~3–4 GB; the idle stack (Postgres,
Redis, MinIO, Meilisearch, app, worker, preview-controller, Traefik, cloudflared) ~2–3 GB; an
active preview build adds ~1 GB (each preview sandbox is capped at 768 MB). 16 GB is
comfortable with room for several previews; 8 GB works for light single-user use.

---

## Prerequisites

- An **Apple-Silicon Mac mini**, macOS up to date.
- A **domain you control, managed by Cloudflare** (DNS hosted on Cloudflare). The examples use
  `oxygenie.cc` — substitute your own everywhere.
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
git clone https://github.com/foreveryh/oxygenie.git
cd oxygenie
```

Confirm Docker is up: `docker version` should print both Client and Server.

---

## Step 2 · Create your secrets (outside the repo)

**Never put secrets in the repo or in `.env`.** Keep them in a file in your home dir:

```bash
mkdir -p ~/oxygenie-deploy && chmod 700 ~/oxygenie-deploy
cat > ~/oxygenie-deploy/secrets.env <<'EOF'
# --- identity / domain ---
APP_HOSTNAME=oxygenie.cc
APP_NAME=oxygenie
APP_NAME_SANITIZED=oxygenie-mini        # must be UNIQUE across stacks on this host (volume names)

# --- datastore + auth secrets (generated below) ---
POSTGRES_USER=oxygenie
POSTGRES_PASSWORD=__FILL__
POSTGRES_DB=oxygenie
MINIO_ROOT_USER=oxygenie
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
chmod 600 ~/oxygenie-deploy/secrets.env

# fill the four generated secrets in place:
for k in POSTGRES_PASSWORD MINIO_ROOT_PASSWORD MEILI_MASTER_KEY BETTER_AUTH_SECRET; do
  v=$(openssl rand -hex 32)
  sed -i '' "s|^$k=__FILL__|$k=$v|" ~/oxygenie-deploy/secrets.env
done
```

Then edit `~/oxygenie-deploy/secrets.env` and set your real `ANTHROPIC_AUTH_TOKEN` (and
`APP_HOSTNAME` if not `oxygenie.cc`). Keep `APP_NAME_SANITIZED` unique — volume names derive
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
cd ~/oxygenie/infra/tunnel        # adjust if you cloned elsewhere
cp config.yml.example config.yml
TOKEN='eyJ...'                    # paste your tunnel token
TID=$(echo "$TOKEN" | base64 -d \
  | python3 -c 'import sys,json;d=json.load(sys.stdin);open("credentials.json","w").write(json.dumps({"AccountTag":d["a"],"TunnelID":d["t"],"TunnelSecret":d["s"]}));print(d["t"])')
sed -i '' "s/REPLACE_WITH_TUNNEL_ID/$TID/" config.yml
echo "Tunnel ID: $TID"            # you need this for DNS next
```
If your domain isn't `oxygenie.cc`, also edit the two `hostname:` lines in `config.yml`.
(`config.yml` and `credentials.json` are **gitignored** — per-deploy / secret.)

### 3c. DNS — two **proxied** CNAMEs
In Cloudflare DNS for your zone, add (replace `<TID>`):

| Type | Name | Target | Proxy |
|---|---|---|---|
| CNAME | `oxygenie.cc` (`@`) | `<TID>.cfargotunnel.com` | **Proxied** (orange) |
| CNAME | `*` | `<TID>.cfargotunnel.com` | **Proxied** (orange) |

The apex serves the app; `*` serves every `<id>.oxygenie.cc` preview. Cloudflare's free
Universal SSL covers the apex + one wildcard level (so previews are single-level by design).

---

## Step 4 · Build the image

### 16 GB Mac mini — build natively (on the mini)
```bash
cd ~/oxygenie
docker build -t oxygenie:local .
```
The result is a ~4 GB native arm64 image tagged `oxygenie:local`. (Playwright + LibreOffice
were removed from the image in 2026-06, so it's lean by default — no build flags needed.)

### 8 GB Mac mini — build elsewhere, then load
On **another Apple-Silicon Mac with 16 GB+** (same `docker build` as above), then:
```bash
# on the build Mac:
docker save oxygenie:local | gzip > oxygenie-local.tar.gz       # ~1.5–2 GB
scp oxygenie-local.tar.gz you@mac-mini.local:~/                 # or AirDrop / USB

# on the 8 GB mini:
gunzip -c ~/oxygenie-local.tar.gz | docker load                # registers oxygenie:local
```
(Alternatively push to a private registry from the build Mac and `docker pull` on the mini.)

---

## Step 5 · Bring up the stack

```bash
cd ~/oxygenie
set -a; . ~/oxygenie-deploy/secrets.env; set +a
export APP_IMAGE=oxygenie APP_TAG=local
docker compose -f docker-compose.tunnel.yml -p oxygenie up -d
```

This starts everything: Postgres, Redis, MinIO, Meilisearch, the migrator (runs once), the
app, the worker, the preview-controller, the bundled Traefik (+ the macOS `dockerproxy` shim),
and `cloudflared`. All services use `restart: unless-stopped`, so they come back after a
reboot once the Docker engine is running.

---

## Step 6 · Verify (before trusting the browser)

`fetch()` from Node ignores a manual `Host` header, so test routing with `wget --header`:

```bash
set -a; . ~/oxygenie-deploy/secrets.env; set +a

# everything up + datastores healthy
docker compose -f docker-compose.tunnel.yml -p oxygenie ps

# cloudflared connected to the edge (expect ~4 "Registered tunnel connection")
docker logs ${APP_NAME_SANITIZED}-cloudflared 2>&1 | grep "Registered tunnel connection"

# app routes through the bundled Traefik
TIP=$(docker inspect ${APP_NAME_SANITIZED}-traefik -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}')
docker exec ${APP_NAME_SANITIZED}-dockerproxy sh -c \
  "wget -qS -O /dev/null --header='Host: $APP_HOSTNAME' http://$TIP/health 2>&1 | grep HTTP/"   # → 200

# code sandbox viable (user+net namespace must succeed)
docker exec oxygenie-app sh -c 'unshare -Urn echo userns-ok'   # → userns-ok
```

Then open **`https://oxygenie.cc`** in a browser (DNS from Step 3 must be live). You should
get the app over HTTPS (Cloudflare terminates TLS at the edge).

---

## Step 7 · Pre-warm the preview dependency cache (recommended)

Previews install their deps in a sandbox; a **shared cache** (mounted into every preview)
makes installs reuse downloads (cold ≈ 15 s → warm ≈ 4 s for a React+Vite app). Seed the
common frameworks once so even the first preview is fast:

```bash
cd ~/oxygenie
bash infra/preview/warm-cache.sh
# extend later: PREVIEW_WARM_DEPS="svelte @sveltejs/vite-plugin-svelte" bash infra/preview/warm-cache.sh
```

---

## Step 8 · First sign-in

Open `https://oxygenie.cc`, create your account. OxyGenie is a **single-org, multi-user**
workspace for a trusted team — the first user is you; invite teammates as needed. You may see
a "verify your email" banner; email verification is optional for core use on a self-host.

Try it end to end: ask for a small multi-file web app → click **运行预览 / Run preview** → it
builds in a sandbox and loads at `https://<id>.oxygenie.cc`. Run a snippet of Python to
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
```bash
cd ~/oxygenie && git pull
docker build -t oxygenie:local .   # (8 GB: rebuild off-box + load)
set -a; . ~/oxygenie-deploy/secrets.env; set +a; export APP_IMAGE=oxygenie APP_TAG=local
docker compose -f docker-compose.tunnel.yml -p oxygenie up -d   # recreates only what changed
```

### Back up your data (do this regularly)
User workspaces, the database, and object storage live in named volumes. The important ones:
`${APP_NAME_SANITIZED}-data` (Postgres), `${APP_NAME_SANITIZED}-claude-sessions` (user
workspaces), `${APP_NAME_SANITIZED}-minio-data`, `${APP_NAME_SANITIZED}-meili-data`.
```bash
set -a; . ~/oxygenie-deploy/secrets.env; set +a
mkdir -p ~/oxygenie-backups
for v in data claude-sessions minio-data meili-data; do
  docker run --rm -v ${APP_NAME_SANITIZED}-$v:/d -v ~/oxygenie-backups:/b busybox \
    tar czf /b/$v.tgz -C /d .
done
```
(`oxy-preview-pm-cache` and `redis-data` are caches — no need to back up.)

### Logs / stop / start
```bash
docker compose -f docker-compose.tunnel.yml -p oxygenie logs -f app          # tail app logs
docker compose -f docker-compose.tunnel.yml -p oxygenie stop                 # stop (keeps data)
docker compose -f docker-compose.tunnel.yml -p oxygenie up -d                # start again
```

---

## Troubleshooting

The deep table (Traefik on OrbStack, the `dockerproxy` shim, preview 404s, etc.) lives in
**[tunnel.md → Troubleshooting](tunnel.md#troubleshooting-issues-actually-hit-bringing-this-up-on-macosorbstack)**.
The most common first-deploy snags:

| Symptom | Fix |
|---|---|
| Build killed / "out of memory" on an 8 GB mini | Build off-box (Step 4 · 8 GB path) — the build needs >8 GB. |
| Site unreachable, but `docker ps` is healthy | The mini slept or lost network. See "Keep the mini awake". |
| `https://oxygenie.cc` shows Cloudflare error 1033/530 | Tunnel not connected — check `cloudflared` logs (Step 6) and that DNS CNAMEs point to `<TID>.cfargotunnel.com`, **proxied**. |
| Preview opens but 404s | Ensure you're on this branch's code (Traefik v3 `HostRegexp` fix). |
| Chat says auth/model error | ARK key/model: `ANTHROPIC_AUTH_TOKEN` set, `ANTHROPIC_API_KEY` **unset**. |

---

## What you get vs. the other paths

| | This guide (Mac mini + tunnel) | [Docker Compose VPS](docker-compose.md) | [Dokploy](dokploy.md) |
|---|---|---|---|
| Public IP / open ports | **None needed** (outbound tunnel) | Needed | Needed |
| TLS | Cloudflare edge (automatic) | Let's Encrypt / your certs | Dokploy / CF Origin CA |
| Always-on | Only while the mini is on | 24/7 | 24/7 |
| Best for | A team's own box / full-feature self-host | A real server | Managed PaaS w/ UI |

All paths run the **same app and images**; they differ only in who runs the edge (proxy / TLS
/ DNS).
