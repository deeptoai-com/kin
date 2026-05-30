# Docker Compose Deployment

Deploy OxyGenie on a single server using Docker Compose. Best for self-hosted, VPS, or local testing with production-like setup.

## Prerequisites

- Docker & Docker Compose
- (Optional) Domain name and reverse proxy for HTTPS
- (Optional) Caddy or nginx for SSL

---

## Step 1: Clone and Configure

```bash
git clone https://github.com/Deeptoai-com/OxyGenie.git
cd OxyGenie
pnpm install
```

## Step 2: Environment Variables

```bash
cp .env.example .env
```

Edit `.env` and set at minimum:

```bash
# Database (Docker builds DATABASE_URL from these; do NOT set DATABASE_URL)
POSTGRES_USER="postgres"
POSTGRES_PASSWORD="your-secure-password"
POSTGRES_DB="oxygenie"

# MinIO
MINIO_ROOT_USER="minioadmin"
MINIO_ROOT_PASSWORD="your-minio-password"
MINIO_BUCKET="oxygenie-files"

# Meilisearch
MEILI_MASTER_KEY="your-strong-master-key"

# Auth (use http://localhost:5050 when accessing via Docker ports)
BETTER_AUTH_SECRET="your-secret-at-least-32-chars"
BETTER_AUTH_URL="http://localhost:5050"

# AI
ANTHROPIC_API_KEY="sk-ant-..."
ZHIPU_API_KEY="your-zhipu-key"
```

See [.env.example](../../.env.example) for all options. [.env.docker](../../.env.docker) provides Docker-specific defaults (container hostnames, `VITE_WS_URL`).

---

## Step 3: Start Services

```bash
pnpm docker:up
```

Or the full command:
```bash
docker compose --env-file .env.docker --env-file .env --profile selfhost up -d --build
```

**Why two env files?** `.env.docker` provides container hostnames (e.g. `redis://redis`, `meilisearch:7700`); `.env` provides your secrets and overrides. Both are needed for correct container-to-container communication.

This starts:

- PostgreSQL (port 5432)
- MinIO (9000, 9001)
- Redis (6379)
- Meilisearch (7700)
- Runs migrations
- Starts app and worker

---

## Step 4: Access

| Service | URL | Port |
|---------|-----|------|
| **App** | http://localhost:5050 | 5050 |
| **Claude Chat** | http://localhost:5050/agents/claude-chat | 5050 |
| **WebSocket** | ws://localhost:3051/ws/agent | 3051 |

---

## Production: Reverse Proxy + HTTPS

For production with a domain:

1. **Point DNS** to your server IP
2. **Use a reverse proxy** (Caddy, nginx, Traefik)
3. **Set** in `.env`:
   ```bash
   BETTER_AUTH_URL="https://your-domain.com"
   VITE_WS_URL="wss://your-domain.com/ws/agent"
   ```
4. **Rebuild** so `VITE_WS_URL` is baked into the frontend:
   ```bash
   docker compose --env-file .env.docker --env-file .env --profile selfhost up -d --build
   ```

Example Caddy config (see [infra/deploy/Caddyfile](../../infra/deploy/Caddyfile)):

```
your-domain.com {
    reverse_proxy localhost:5050
}

# WebSocket
your-domain.com {
    handle_path /ws/* {
        reverse_proxy localhost:3051
    }
}
```

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| `database "oxygenie" does not exist` | Run `docker compose down -v` then `up -d --build` (⚠️ deletes data) |
| Keep existing DB (ex0/constructa) | Set only `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` in `.env` to match; do NOT set `DATABASE_URL` |
| WebSocket 426 / fails | Ensure reverse proxy supports WebSocket upgrade; check VITE_WS_URL matches your domain |

See [Troubleshooting](../troubleshooting.md) for more.
