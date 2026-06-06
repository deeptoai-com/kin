# Deployment Overview

> **Architecture stance (read this first).**
> **OxyGenie is a standard single-node Docker Compose application. It does NOT require
> Docker Swarm, Kubernetes, or any cluster orchestrator.** Every service (Postgres,
> Redis, MinIO, Meilisearch, the app, the worker, the preview controller) is a plain
> Docker container. You can run the whole thing with `docker compose up` on one host.
>
> Docker Swarm is **neither required nor a design target.** (The Dokploy platform happens
> to use Swarm internally for *its own* components — its dashboard and Traefik — but
> OxyGenie deploys on Dokploy as a normal Compose app, not as a Swarm workload. Nothing in
> OxyGenie depends on Swarm features.) Verified: the full stack — including the Phase C
> preview engine — runs on plain Docker (no Swarm).

---

## The two supported paths

| Path | Who it's for | What you manage | Compose file |
|---|---|---|---|
| **A. Docker Compose (self-managed)** | **Anyone self-hosting on a VPS / their own box. Recommended baseline.** | The host + a reverse proxy (Traefik, bundled) | `docker-compose.prod.yml` |
| **B. Dokploy (managed PaaS)** | Teams who want a UI + managed Traefik/TLS/domains (this is how the maintainers run it) | A Dokploy install | `docker-compose.dokploy.yml` |
| **C. Cloudflare Tunnel (workstation / behind NAT)** | A dev box, home server, or workstation with **no public inbound** — full-feature trials with the least infra | The host only (TLS + DNS handled by Cloudflare; tunnel is outbound-only) | `docker-compose.tunnel.yml` |

Both run the **same images and the same app**. They differ only in **who runs the
reverse proxy / TLS / DNS**:

- **Path A** bundles its own Traefik in the compose file, so `docker compose up` gives you
  a complete stack (app + TLS + the wildcard subdomain routing the Phase C preview needs).
  You bring a domain + (for previews) a wildcard DNS record.
- **Path B** uses Dokploy's existing Traefik. You set domains + certs in Dokploy; OxyGenie's
  containers attach to Dokploy's network.
- **Path C** also bundles its own Traefik (like A) but adds a **`cloudflared`** container that
  opens an *outbound* tunnel to Cloudflare — so the host needs **no public IP and no open
  ports**. Cloudflare terminates TLS at the edge and forwards both the app host and every
  preview subdomain to the bundled Traefik. Ideal for a workstation or anything behind NAT,
  and the fastest way to get the **full** feature set (preview + sandbox) — a self-managed
  host gives the elevated container privileges (`seccomp`/`apparmor=unconfined`, `NET_ADMIN`)
  that a hardened managed PaaS may restrict.

> **Legacy:** an older Dokku + GitHub-Actions flow exists (`.github/workflows/deploy.yml`,
> `infra/deploy/`). It is not a supported path going forward — use A or B.

---

## What the preview feature needs (both paths)

The Phase C "real preview" runs each multi-file app in its own sandbox container and serves
it on a **wildcard subdomain** (`<id>.<your-domain>`) behind the reverse proxy, gated by a
one-time-token → cookie forward-auth. So both paths require:

1. A **reverse proxy that reads container labels** (Traefik) — bundled in A, provided by Dokploy in B.
2. A **wildcard DNS record** `*.<your-domain>` → the host.
3. A **TLS cert that covers the wildcard** (single-level `*.<domain>`; see the per-path guides).

The preview controller is the only component that talks to the Docker socket; it creates and
tears down preview containers via the Docker API (plain `docker`, no Swarm).

---

## Pick your guide

- **Path A — [Docker Compose](docker-compose.md)** ← start here if you're self-hosting.
- **Path B — [Dokploy](dokploy.md)** ← managed platform.
- **Path C — [Cloudflare Tunnel](tunnel.md)** ← workstation / home server / behind NAT.
  - **[Mac mini, from scratch](mac-mini.md)** ← a complete, linear recipe for Path C on a
    fresh Apple-Silicon Mac (covers the 8 GB vs 16 GB build decision + day-2 operations).

## Common requirements

- A Linux host with Docker + the Compose plugin (Path A) or a Dokploy install (Path B).
- A domain you control + DNS access (Cloudflare etc.) for the app host and the preview wildcard.
- Secrets: Postgres/MinIO/Meili passwords, `BETTER_AUTH_SECRET`, and an LLM gateway key
  (ARK `ANTHROPIC_AUTH_TOKEN` by default). See each guide's env section.
