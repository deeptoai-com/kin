# Dokploy Deployment

Deploy OxyGenie on [Dokploy](https://dokploy.com/) with Traefik for automatic HTTPS, SSL certificates, and routing.

## Prerequisites

- Dokploy installed and configured
- Traefik enabled (Dokploy default)
- Domain name pointing to your server
- Environment variables prepared

---

## Quick Start

1. **Create application** in Dokploy → choose "Docker Compose"
2. **Compose path**: `docker-compose.dokploy.yml`
3. **Add environment variables** from [infra/deploy/env.dokploy.example](../../infra/deploy/env.dokploy.example)
4. **Deploy**

---

## Detailed Guide

For full step-by-step instructions (in Chinese), see:

- **[Dokploy 部署指南](../../infra/deploy/DOKPLOY_DEPLOYMENT.md)** – complete guide
- **[Environment Checklist](../../infra/deploy/DOKPLOY_ENV_CHECKLIST.md)** – required variables

---

## Key Configuration

### Required Variables

| Variable | Example | Description |
|----------|---------|-------------|
| `APP_NAME` | claude-agent-chat | Application name |
| `APP_HOSTNAME` | app.example.com | Public domain |
| `POSTGRES_USER` | your_db_user | Database user |
| `POSTGRES_PASSWORD` | *** | Database password |
| `POSTGRES_DB` | claude_agent_chat | Database name |
| `MINIO_ROOT_USER` | minioadmin | MinIO user |
| `MINIO_ROOT_PASSWORD` | *** | MinIO password |
| `MINIO_BUCKET` | oxygenie-files | S3 bucket name |
| `MEILI_MASTER_KEY` | *** | Meilisearch key |
| `BETTER_AUTH_SECRET` | *** | Auth secret (32+ chars) |
| `BETTER_AUTH_URL` | https://app.example.com | Public auth URL |
| `BETTER_AUTH_INTERNAL_URL` | http://localhost:5000 | Internal auth URL |
| `VITE_WS_URL` | wss://app.example.com/ws/agent | WebSocket URL (HTTPS) |
| `ANTHROPIC_API_KEY` | sk-ant-... | Claude API key |

### Traefik / Routing

`docker-compose.dokploy.yml` includes Traefik labels. Traefik handles:

- HTTP → app (port 5000)
- WebSocket `/ws/*` → app (port 3001), priority 10
- HTTPS via Let's Encrypt

---

## Verification

```bash
# Health check
curl https://your-domain.com/health

# WebSocket (browser console)
const ws = new WebSocket('wss://your-domain.com/ws/agent');
ws.onopen = () => console.log('OK');
```

---

## Troubleshooting

See [DOKPLOY_DEPLOYMENT.md – 常见问题](../../infra/deploy/DOKPLOY_DEPLOYMENT.md#-常见问题) for:

- WebSocket 426 / connection fails
- Database connection errors
- MinIO / S3 errors
- Traefik routing issues
- Docker volume name errors
- Migration failures
