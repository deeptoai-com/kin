#!/usr/bin/env bash
#
# dev-up.sh — one-command local dev for OxyGenie (hybrid: Docker deps + local node).
#
# What it does:
#   1. Starts dependency services in Docker (Postgres, Redis, MinIO, Meilisearch).
#   2. Runs DB migrations.
#   3. Builds the app (Vite SSR + Nitro) — unless --no-build.
#   4. Starts the app: Nitro on :3000 + WebSocket server on :3001.
#
# This is the recipe that was verified end-to-end on 2026-05-30 (see
# docs/project/WORKLOG.md). It deliberately runs the APP as a local node process
# (not a Docker container), so only the 4 dependency containers show up in Docker.
#
# Usage:
#   ./scripts/dev-up.sh              # deps + migrate + build + start
#   ./scripts/dev-up.sh --no-build   # skip the (slow) build, reuse existing .output
#   ./scripts/dev-up.sh --deps-only  # only start Docker deps + migrate, don't start app
#
# Prereqs:
#   - Docker (OrbStack/Docker Desktop) running
#   - .env present (copy from .env.example; for LOCAL hybrid run set:
#       DATABASE_URL=...@localhost:5432/oxygenie
#       BETTER_AUTH_URL=http://localhost:3000
#       VITE_BASE_URL=http://localhost:3000
#       VITE_WS_URL=ws://localhost:3001/ws/agent
#       ENABLE_EXEC_SANDBOX=0      # macOS dev; Linux prod uses 1)
#   - .env.docker present (copy from .env.docker.example)
set -euo pipefail

cd "$(dirname "$0")/.."
ROOT="$(pwd)"

NO_BUILD=0
DEPS_ONLY=0
for arg in "$@"; do
  case "$arg" in
    --no-build) NO_BUILD=1 ;;
    --deps-only) DEPS_ONLY=1 ;;
    *) echo "Unknown arg: $arg"; exit 2 ;;
  esac
done

[ -f .env ] || { echo "ERROR: .env missing. Copy .env.example → .env and set local values (see header)."; exit 1; }
[ -f .env.docker ] || { echo "ERROR: .env.docker missing. Copy .env.docker.example → .env.docker."; exit 1; }

# Load env into this shell. Compose's ${VAR:?} interpolation reads from the
# environment, not just --env-file, so we MUST source it (a known gotcha).
set -a; . ./.env; . ./.env.docker; set +a

echo "▶ 1/4 Starting dependency services (Postgres/Redis/MinIO/Meilisearch)…"
docker compose --env-file .env.docker --env-file .env \
  up -d db create-db redis minio provision-minio meilisearch

echo "▶ waiting for Postgres to be healthy…"
for i in $(seq 1 30); do
  if docker exec ex0-db pg_isready -U "${POSTGRES_USER:-postgres}" >/dev/null 2>&1; then
    echo "  ✓ Postgres ready"; break
  fi
  sleep 1
  [ "$i" = 30 ] && { echo "  ✗ Postgres not ready after 30s"; exit 1; }
done

echo "▶ 2/4 Running DB migrations…"
pnpm db:migrate

if [ "$DEPS_ONLY" = 1 ]; then
  echo "✓ Deps + migrations done (--deps-only). App not started."
  exit 0
fi

if [ "$NO_BUILD" = 0 ]; then
  echo "▶ 3/4 Building app (Vite SSR + Nitro)… (this takes a few minutes)"
  NODE_OPTIONS="--max-old-space-size=8192" pnpm build
else
  echo "▶ 3/4 Skipping build (--no-build); reusing .output"
fi
[ -f .output/server/index.mjs ] || { echo "ERROR: .output/server/index.mjs missing — run without --no-build."; exit 1; }

echo "▶ 4/4 Starting app: Nitro :3000 + WebSocket :3001  →  http://localhost:3000"
exec env PORT=3000 APP_URL=http://localhost:3000 node start-production.mjs
