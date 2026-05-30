# Local Development Setup (pnpm + Docker)

This guide describes how to run OxyGenie in a **portable development environment**: Docker for infrastructure (PostgreSQL, Redis, Meilisearch, MinIO) and pnpm for the application. This enables fast iteration without running the full stack in Docker.

## Prerequisites

- **Node.js** ≥ 22.12
- **pnpm** (recommended; npm/yarn also work)
- **Docker** & **Docker Compose** (for infrastructure)
- **(Optional)** MailHog for local email testing

## Run Modes

| Mode | Infrastructure | Application | Use Case |
|------|----------------|--------------|----------|
| **Full Docker** | Docker | Docker | Production-like, one-command |
| **Hybrid** | Docker | Local (pnpm) | Development, fast HMR or stable build |
| **Full Local** | Local services | Local (pnpm) | No Docker dependency |

This guide focuses on **Hybrid** mode.

---

## Hybrid Mode: Step by Step

### 1. Start Infrastructure

```bash
pnpm run ex0 -- init
```

Or manually:
```bash
docker compose up -d db minio provision-minio redis meilisearch
```

For email testing (verification codes):
```bash
docker compose --profile dev up -d mailhog
```

### 2. Configure Environment

Copy the example and set values for localhost:

```bash
cp .env.example .env
```

Ensure these point to localhost (Docker exposes ports 5432, 6379, 7700, 9000):

```bash
# Database (match POSTGRES_* from .env.docker if using ex0 init)
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/oxygenie"
POSTGRES_USER="postgres"
POSTGRES_PASSWORD="postgres"
POSTGRES_DB="oxygenie"

# Redis, Meilisearch, MinIO
REDIS_URL="redis://localhost:6379"
MEILI_HOST="http://localhost:7700"
MEILI_MASTER_KEY="changeme-master-key"
S3_ENDPOINT="http://localhost:9000"
S3_ACCESS_KEY_ID="minioadmin"
S3_SECRET_ACCESS_KEY="minioadmin"
S3_BUCKET="oxygenie-files"

# Auth
BETTER_AUTH_SECRET="your-secret-key-here"
BETTER_AUTH_URL="http://localhost:3000"

# AI (required for Claude Chat)
ANTHROPIC_API_KEY="sk-ant-..."
```

### 3. Run Migrations (if needed)

```bash
pnpm db:migrate
```

Skip if the database was already initialized by Docker.

### 4. Start the Application

Two options:

#### Option A: Development (with HMR)

```bash
# Terminal 1: main app
pnpm dev

# Terminal 2: WebSocket server (for Claude Chat)
node ws-server.mjs
```

- App: http://localhost:3000  
- Claude Chat: http://localhost:3000/agents/claude-chat  

#### Option B: Production Build (more stable, no HMR)

If `pnpm dev` shows HeadersTimeoutError or page keeps loading:

```bash
# Build (with Claude Chat WebSocket URL)
NODE_OPTIONS="--max-old-space-size=8192" VITE_WS_URL="ws://localhost:3001/ws/agent" pnpm build

# Start (app + WebSocket in one process)
pnpm start:hybrid
```

- App: http://localhost:3000  
- Claude Chat: http://localhost:3000/agents/claude-chat  

---

## Port Summary

| Service | Port | Exposed |
|---------|------|---------|
| App (Nitro) | 3000 | ✓ |
| WebSocket | 3001 | ✓ |
| PostgreSQL | 5432 | ✓ |
| Redis | 6379 | ✓ |
| Meilisearch | 7700 | ✓ |
| MinIO | 9000, 9001 | ✓ |
| MailHog (SMTP) | 1025 | When `--profile dev` |

---

## Common Issues

| Issue | Solution |
|-------|----------|
| Page keeps loading | Use `pnpm start:hybrid` instead of `pnpm dev` (see [Troubleshooting](../troubleshooting.md)) |
| Build OOM | Add `NODE_OPTIONS="--max-old-space-size=8192"` before `pnpm build` |
| `DATABASE_URL is not defined` | Ensure `.env` exists; `start-production.mjs` loads it via dotenv |
| Redis/Meilisearch unreachable | Ensure `docker compose` has redis/meilisearch with `ports` exposed (see main README) |

See [Troubleshooting](troubleshooting.md) for more.
