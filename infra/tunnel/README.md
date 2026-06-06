# OxyGenie via Cloudflare Tunnel (Mac / dev / any host behind NAT)

> **Canonical guide:** [`docs/deployment/tunnel.md`](../../docs/deployment/tunnel.md) (full
> steps, invariants, verification + troubleshooting). This file is the quick in-folder
> reference + what each file here is for.
>
> **Files here:** `config.yml` (tunnel ingress) · `nginx.conf` (docker-API version-rewrite
> proxy, macOS only) · `credentials.json` (the tunnel secret — **gitignored**, generated below).

Run the full OxyGenie stack — **including the Phase C preview + code sandbox** — on a
single machine (a dev Mac, a home server, any box behind NAT) and expose it on your
domain through a **Cloudflare Tunnel**. No inbound ports, no port-forwarding, no public
IP needed; Cloudflare terminates TLS at the edge.

```
Cloudflare edge (TLS)
  └─ cloudflared (outbound tunnel)  →  Traefik (:80, Host routing)
        ├─ oxygenie.cc          → app (5000) ; /ws → ws-server (3001)
        └─ <id>.oxygenie.cc     → the preview container Traefik picks up by label
```

Compose file: **`docker-compose.tunnel.yml`** (repo root).

## 1. Create the tunnel + get its token
Cloudflare dashboard → **Zero Trust → Networks → Tunnels → Create a tunnel** →
*Cloudflared* → name it → copy the **token** (`eyJ...`). Do **not** add Public Hostnames
in the dashboard — ingress is handled by `config.yml` here (so wildcards work).

## 2. Generate credentials + fill the tunnel id
From `infra/tunnel/`:
```bash
cp config.yml.example config.yml   # config.yml is gitignored (per-deploy)
TOKEN='eyJ...'   # paste your tunnel token
TID=$(echo "$TOKEN" | base64 -d \
  | python3 -c 'import sys,json;d=json.load(sys.stdin);open("credentials.json","w").write(json.dumps({"AccountTag":d["a"],"TunnelID":d["t"],"TunnelSecret":d["s"]}));print(d["t"])')
sed -i '' "s/REPLACE_WITH_TUNNEL_ID/$TID/" config.yml   # Linux: drop the ''
```
This writes `credentials.json` (gitignored — it holds the tunnel secret) and sets
`tunnel:` in `config.yml`.

## 3. DNS (Cloudflare, proxied / orange)
Point both at the tunnel (replace `<TID>` with the tunnel id from step 2):
- `oxygenie.cc`   → CNAME `<TID>.cfargotunnel.com`
- `*.oxygenie.cc` → CNAME `<TID>.cfargotunnel.com`

(CF free Universal SSL covers `oxygenie.cc` + single-level `*.oxygenie.cc`.)

## 4. Build the image + bring it up
The image is built **natively** on this host (fast on an arm64 Mac; no GHCR needed):
```bash
docker build -t oxygenie:local .
# env: APP_IMAGE=oxygenie APP_TAG=local APP_HOSTNAME=oxygenie.cc + the secrets
set -a; . ~/oxygenie-deploy/secrets.env; set +a
export APP_IMAGE=oxygenie APP_TAG=local
docker compose -f docker-compose.tunnel.yml up -d
```

## Notes
- **Preview + sandbox need privilege** the app container is granted here
  (`seccomp=unconfined`, `apparmor=unconfined`, `cap_add: NET_ADMIN`) — this is exactly
  the control a self-managed host gives you that a hardened managed PaaS may not.
- The host must stay **on + online** for the site to be reachable (it's a workstation,
  not a 24/7 server — fine for dev / full-feature trials).
- `credentials.json` is a **secret** (gitignored). Never commit it.
