# Path C — Cloudflare Tunnel (workstation / home server / behind NAT)

Run the **full** OxyGenie stack — including the Phase C **preview engine** and the **code
sandbox** — on a single machine that has **no public inbound** (a dev Mac, a home server,
any box behind NAT/CGNAT), and expose it on your domain through a **Cloudflare Tunnel**.

- **No public IP, no port-forwarding, no open ports.** `cloudflared` makes an *outbound*
  connection to Cloudflare; traffic comes back down that tunnel.
- **TLS is terminated at the Cloudflare edge** — the tunnel→Traefik hop is plain HTTP, so
  there are no certs to manage on the host.
- This path gives you the elevated container privileges (`seccomp=unconfined`,
  `apparmor=unconfined`, `cap_add: NET_ADMIN`) that preview + sandbox need and that a hardened
  managed PaaS may not allow — so it's the fastest way to a **full-feature** trial.

```
Cloudflare edge (TLS, *.oxygenie.cc)
  └─ cloudflared  (outbound QUIC tunnel; no inbound ports)
        └─ Traefik (:80, Host routing, reads container labels)
              ├─ oxygenie.cc        → app (5000) ;  /ws → ws-server (3001)
              └─ <id>.oxygenie.cc   → preview sandbox container (4173), forward-auth gated
```

**Compose file:** [`docker-compose.tunnel.yml`](../../docker-compose.tunnel.yml) ·
**configs:** [`infra/tunnel/`](../../infra/tunnel/)

> This is **Path A + a tunnel**: the same bundled Traefik, plus a `cloudflared` container and
> (on macOS only) a small `dockerproxy` shim. On a normal cloud VPS with a public IP, prefer
> [Path A](docker-compose.md) (Let's Encrypt / your own certs) — you don't need the tunnel.

---

## Critical invariants (get any wrong → it won't serve)

1. **DNS is two **proxied** CNAMEs to the tunnel** — the apex `oxygenie.cc` **and** the
   single-level wildcard `*.oxygenie.cc`, both → `<TUNNEL_ID>.cfargotunnel.com` (orange cloud
   ON). Cloudflare's free Universal SSL covers the apex + one wildcard level; it does **not**
   cover two levels (`*.preview.oxygenie.cc`), so previews use **single-level** `<id>.oxygenie.cc`.
2. **Ingress lives in `infra/tunnel/config.yml`, not the dashboard.** Do **not** add Public
   Hostnames in the Zero-Trust UI — define `oxygenie.cc` + `*.oxygenie.cc` → `http://traefik:80`
   in `config.yml` so the wildcard works. (Dashboard-managed ingress can't express a wildcard.)
3. **`credentials.json` is a secret** (it holds the tunnel secret). It's gitignored — never commit it.
4. **Image is built natively on the host** (`oxygenie:local`) — `APP_IMAGE=oxygenie`,
   `APP_TAG=local`, and every app service uses `pull_policy: never` (don't try to pull a local tag).
5. **ARK auth** uses `ANTHROPIC_AUTH_TOKEN` (Bearer) — do **not** set `ANTHROPIC_API_KEY`
   (setting it makes the SDK switch to `x-api-key` and ARK rejects it). Same as every other path.
6. **The `dockerproxy` shim is required on OrbStack/Docker Desktop AND on Docker 28/29+.**
   Traefik's docker provider pins API `v1.24`; a daemon whose minimum is `1.40` rejects it →
   `"client version 1.24 is too old"`. This hits **macOS (OrbStack/Docker Desktop)** *and*
   **modern Docker on any OS** (Docker 28/29 raised the minimum to 1.40 — verified on Docker 29
   / Ubuntu). `dockerproxy` (nginx) rewrites `/vX.Y/...` → `/v1.44/...`. Only **old Linux Docker
   (≤27)** can skip it and point Traefik at the socket directly (see the bottom).

---

## Steps

### 1. Create the tunnel + copy its token
Cloudflare dashboard → **Zero Trust → Networks → Tunnels → Create a tunnel** → *Cloudflared* →
name it → copy the **token** (`eyJ...`). Do **not** add Public Hostnames here.

### 2. Generate credentials + set the tunnel id
From `infra/tunnel/` (both `config.yml` and `credentials.json` are gitignored — per-deploy):
```bash
cp config.yml.example config.yml
TOKEN='eyJ...'   # paste your tunnel token
TID=$(echo "$TOKEN" | base64 -d \
  | python3 -c 'import sys,json;d=json.load(sys.stdin);open("credentials.json","w").write(json.dumps({"AccountTag":d["a"],"TunnelID":d["t"],"TunnelSecret":d["s"]}));print(d["t"])')
sed -i '' "s/REPLACE_WITH_TUNNEL_ID/$TID/" config.yml   # Linux: drop the '' after -i
echo "Tunnel ID: $TID"   # you need this for DNS in step 3
```
This writes `credentials.json` (the secret) and fills `tunnel:` in `config.yml`. If your
domain isn't `oxygenie.cc`, also edit the two `hostname:` lines in `config.yml`.

### 3. DNS (Cloudflare, both **proxied / orange**)
Point both records at the tunnel (replace `<TID>` with the id from step 2):

| Type | Name | Target | Proxy |
|---|---|---|---|
| CNAME | `oxygenie.cc` (`@`) | `<TID>.cfargotunnel.com` | **Proxied** |
| CNAME | `*` | `<TID>.cfargotunnel.com` | **Proxied** |

### 4. Secrets (outside the repo)
Keep secrets in `~/oxygenie-deploy/secrets.env` (chmod 600 — **never** in the repo / `.env`).
Minimum:
```bash
APP_HOSTNAME=oxygenie.cc
APP_NAME=oxygenie
APP_NAME_SANITIZED=oxygenie-cc      # must be globally unique among your stacks (volume names)
# Postgres / MinIO / Meili / auth
POSTGRES_USER=oxygenie POSTGRES_PASSWORD=... POSTGRES_DB=oxygenie
MINIO_ROOT_USER=... MINIO_ROOT_PASSWORD=...
MEILI_MASTER_KEY=... BETTER_AUTH_SECRET=...   # openssl rand -hex 32
# LLM gateway (ARK / Volcengine) — Bearer auth, NOT ANTHROPIC_API_KEY
ANTHROPIC_AUTH_TOKEN=ark-xxxxxxxx
ANTHROPIC_BASE_URL=https://ark.cn-beijing.volces.com/api/coding
ANTHROPIC_MODEL=glm-5.1
ANTHROPIC_DEFAULT_SONNET_MODEL=glm-5.1
ANTHROPIC_DEFAULT_OPUS_MODEL=glm-5.1
ANTHROPIC_DEFAULT_HAIKU_MODEL=doubao-seed-2.0-lite
CLAUDE_CODE_SUBAGENT_MODEL=glm-5.1
```

### 5. Build the image natively, then bring the stack up
```bash
# native build (fast on arm64 Mac; skips playwright + libreoffice)
docker build -t oxygenie:local .

set -a; . ~/oxygenie-deploy/secrets.env; set +a
export APP_IMAGE=oxygenie APP_TAG=local
docker compose -f docker-compose.tunnel.yml -p oxygenie up -d
```

### 6. Verify the stack locally (before trusting DNS)
All of these run **inside the host** and prove each hop without going out to Cloudflare.
`fetch()` from Node ignores a manual `Host` header, so test routing with `wget --header`:
```bash
# (a) everything up + db/redis/minio/meili healthy
docker compose -f docker-compose.tunnel.yml -p oxygenie ps

# (b) cloudflared connected to the edge (expect 4x "Registered tunnel connection")
docker logs ${APP_NAME_SANITIZED}-cloudflared 2>&1 | grep "Registered tunnel connection"

# (c) Traefik routes the app — through the proxy container which has busybox wget
TIP=$(docker inspect ${APP_NAME_SANITIZED}-traefik -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}')
docker exec ${APP_NAME_SANITIZED}-dockerproxy sh -c \
  "wget -qS -O /dev/null --header='Host: oxygenie.cc' http://$TIP/health 2>&1 | grep HTTP/"   # → 200
docker exec ${APP_NAME_SANITIZED}-dockerproxy sh -c \
  "wget -qS -O /dev/null --header='Host: oxygenie.cc' http://$TIP/ws/agent 2>&1 | grep HTTP/" # → 426

# (d) sandbox is viable (user + net namespace must succeed in the app container)
docker exec oxygenie-app sh -c 'unshare -Urn echo userns-ok'   # → userns-ok
```
Then open `https://oxygenie.cc` in a browser (DNS must be live from step 3).

### 7. Try the full preview + sandbox
In the chat, ask for a small multi-file web app, click **运行预览 / Run preview**. The
preview-controller spins up a sandbox container, Traefik picks it up by label, and you land on
`https://<id>.oxygenie.cc` after the one-time-token → cookie hand-off. Code execution (Python
etc.) runs in the same sandbox.

### 8. (Optional) Pre-warm the dependency cache — faster first preview
Every preview container mounts a **shared package-manager cache** (`/pm-cache`, the
`oxy-preview-pm-cache` volume) and points npm/pnpm/yarn at it, so installs reuse downloads
instead of re-fetching every run (measured: cold ≈ 15s → warm ≈ 4s for a React+Vite app).
The cache self-warms as you use it; to seed the common frameworks up front so even the very
first preview is fast, run once:
```bash
bash infra/preview/warm-cache.sh           # react/react-dom/vite/vue/typescript/tailwind…
# add more:  PREVIEW_WARM_DEPS="svelte @sveltejs/vite-plugin-svelte" bash infra/preview/warm-cache.sh
```
This applies to **all** deploy paths (the cache lives in the preview controller, not the proxy).

---

## Troubleshooting (issues actually hit bringing this up on macOS/OrbStack)

| Symptom | Cause | Fix |
|---|---|---|
| Traefik log: `client version 1.24 is too old. Minimum supported API version is 1.40` | macOS daemon (OrbStack/Docker Desktop) rejects Traefik's pinned API version | The bundled **`dockerproxy`** (nginx) rewrites the version prefix. It's already wired in `docker-compose.tunnel.yml`. (On Linux you can drop it — see below.) |
| `dockerproxy` log: `"user" directive is duplicate in /etc/nginx/nginx.conf` | Overriding `user` via `nginx -g` while the image's `nginx.conf` already sets `user nginx;` | We ship a **full** `infra/tunnel/nginx.conf` (with `user root;`) mounted at `/etc/nginx/nginx.conf` — no `-g` override. |
| `dockerproxy` → 502 `connect() to unix:/var/run/docker.sock failed (13: Permission denied)` | nginx workers ran as `nginx`; the socket is `root:root 0660` | `nginx.conf` sets `user root;` so workers can read the socket. |
| Traefik provider: `lookup dockerproxy ... no such host` | transient — `dockerproxy` was mid-recreate | Wait a few seconds / `up -d` again; Traefik retries automatically. |
| App routing returns **404** from your own `fetch()` test but the browser works | Node/undici **ignores a manual `Host` header** and sends `Host: <url-host>` → matches no router | Test with `wget --header='Host: oxygenie.cc'` (step 6c), not `fetch`. |
| Preview subdomain → **401** | Expected before auth: Traefik matched the preview router and ran forward-auth; no one-time token yet | Reach the preview through the app's **Run preview** button (it mints the token), not by hand. |
| `cloudflared` keeps reconnecting / `Unauthorized` | bad/[]rotated token or `credentials.json` mismatch | Re-run step 2 with a fresh token; confirm `tunnel:` id in `config.yml` matches `credentials.json`. |
| Site unreachable but stack is up | the host went to sleep / offline | This is a workstation path — the box must stay **on + online** for the site to be reachable. |

---

## Old Linux Docker (≤27): you may drop `dockerproxy`

The `dockerproxy` shim exists because Traefik's docker provider pins API `v1.24`, which daemons
with a minimum of `1.40` reject — that's **macOS (OrbStack/Docker Desktop)** *and* **Docker
28/29+ on any OS**. Only on **older Linux Docker (≤27)** can you delete the `dockerproxy` service
and point Traefik at the socket directly:

```yaml
  traefik:
    # remove:  - "--providers.docker.endpoint=tcp://dockerproxy:2375"
    # remove:  depends_on: [dockerproxy]
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
```

Everything else (cloudflared, the bundled Traefik, labels, DNS) is identical.

---

## Notes

- **The host must stay on + online.** This is a dev/trial path, not a 24/7 server. For an
  always-on deployment use [Path A](docker-compose.md) on a VPS or [Path B](dokploy.md).
- **`credentials.json` is a secret.** Gitignored; rotate the tunnel if it ever leaks.
- **Same images, same app** as Paths A/B — only the edge (Cloudflare tunnel vs. your own
  proxy/TLS) differs.
