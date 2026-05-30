#!/usr/bin/env bash
#
# dev-down.sh — stop the local hybrid dev stack started by dev-up.sh.
#
# Stops the Docker dependency containers (Postgres/Redis/MinIO/Meilisearch).
# Does NOT delete volumes by default (your DB data is kept). Use --volumes to wipe.
#
# Note: the app itself runs as a local node process (start-production.mjs); stop it
# with Ctrl-C in its terminal, or: pkill -f start-production.mjs
#
# Usage:
#   ./scripts/dev-down.sh            # stop dep containers, keep data
#   ./scripts/dev-down.sh --volumes  # stop + delete volumes (wipes DB/MinIO/Meili data)
set -euo pipefail
cd "$(dirname "$0")/.."

WIPE=0
for arg in "$@"; do
  case "$arg" in
    --volumes) WIPE=1 ;;
    *) echo "Unknown arg: $arg"; exit 2 ;;
  esac
done

set -a; [ -f .env ] && . ./.env; [ -f .env.docker ] && . ./.env.docker; set +a

if [ "$WIPE" = 1 ]; then
  echo "▶ Stopping dep containers AND deleting volumes (DB/MinIO/Meili data will be lost)…"
  docker compose --env-file .env.docker --env-file .env down --volumes
else
  echo "▶ Stopping dependency containers (data kept)…"
  docker compose --env-file .env.docker --env-file .env down
fi

# Best-effort: stop a locally-running app process if present.
if pgrep -f start-production.mjs >/dev/null 2>&1; then
  echo "▶ Note: a local app process (start-production.mjs) is still running."
  echo "  Stop it with: pkill -f start-production.mjs"
fi
echo "✓ Done."
