# Deployment Overview

OxyGenie supports multiple deployment options. Choose based on your infrastructure and preferences.

## Deployment Options

| Method | Best For | Complexity | Links |
|--------|----------|------------|-------|
| **Docker Compose** | Single server, quick start, self-host | Low | [Guide](docker-compose.md) |
| **Dokploy** | Managed platform, Traefik, multi-app | Medium | [Guide](dokploy.md) |
| **Dokku + CI/CD** | GitHub Actions → Dokku | Medium | [GitHub workflow](../../.github/workflows/deploy.yml) |

---

## Quick Comparison

### Docker Compose

- **Pros**: One command, local or VPS, full control
- **Cons**: Manual SSL (or Caddy/nginx), single host
- **Files**: `docker-compose.yml`, `.env`, `.env.docker`
- **Command**: `pnpm docker:up` (or full `docker compose --env-file .env.docker --env-file .env --profile selfhost up -d --build`)

### Dokploy

- **Pros**: Traefik (auto SSL), UI, multi-app on same host
- **Cons**: Requires Dokploy setup
- **Files**: `docker-compose.dokploy.yml`, `infra/deploy/env.dokploy.example`
- **Docs**: [Dokploy Deployment Guide](dokploy.md) → [Full guide (Chinese)](../../infra/deploy/DOKPLOY_DEPLOYMENT.md)

### Dokku + GitHub Actions

- **Pros**: Push to deploy, Git-based workflow
- **Cons**: Needs Dokku server, GitHub secrets
- **Flow**: `workflow_dispatch` → build image → SCP to server → `docker compose` + `dokku git:from-image`
- **Details**: See [.github/workflows/deploy.yml](../../.github/workflows/deploy.yml) and [infra/deploy/](../../infra/deploy/)

---

## Common Requirements

All deployment methods need:

1. **PostgreSQL** (with pgvector) – database
2. **Redis** – background jobs (BullMQ)
3. **Meilisearch** – search
4. **MinIO** (or S3) – file storage
5. **Environment variables** – see [.env.example](../../.env.example)

---

## Next Steps

- [Docker Compose Deployment](docker-compose.md) – step-by-step for single-server
- [Dokploy Deployment](dokploy.md) – Traefik-based managed deployment
- [Troubleshooting](../troubleshooting.md) – common deployment issues
