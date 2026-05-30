# OxyGenie Documentation

Documentation hub for developers and deployers.

## Documentation Index

| Document | Description |
|----------|-------------|
| [Local Development Setup](development/local-setup.md) | pnpm + Docker hybrid mode, portable dev environment |
| [Deployment Overview](deployment/overview.md) | Deployment options: Docker Compose, Dokploy, Dokku |
| [Docker Compose Deployment](deployment/docker-compose.md) | Single-server self-host with Docker Compose |
| [Dokploy Deployment](deployment/dokploy.md) | Deploy on Dokploy with Traefik |
| [Troubleshooting](troubleshooting.md) | Common issues (HeadersTimeout, OOM, connection errors) |
| [Environment Variables](../.env.example) | All configuration options (see file comments) |

## Quick Links

- **Getting Started**: See the main [README](../README.md) for installation and Quick Start
- **Deployment**: [Docker Compose](../README.md#option-a-docker-compose-recommended) | [infra/deploy](../infra/deploy/) for Dokploy, Ansible
- **Contributing**: [CONTRIBUTING.md](../CONTRIBUTING.md)

## Other Documents

- [MODIFICATION_AUDIT.md](MODIFICATION_AUDIT.md) – Change audit
- [DEPLOYMENT_MEMORY_FIX.md](DEPLOYMENT_MEMORY_FIX.md) – Memory fix for deployment
- [DISCUSSION-开源文档与环境变量规划.md](DISCUSSION-开源文档与环境变量规划.md) – Planning discussion (env vars, doc structure)
