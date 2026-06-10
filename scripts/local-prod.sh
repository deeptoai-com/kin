#!/usr/bin/env bash
# Build + run the OxyGenie *production* server locally against the shared Docker
# backend. This is the canonical "run it on my machine against real data" flow.
#
#   scripts/local-prod.sh --build   # first time / after code changes (rebuilds)
#   scripts/local-prod.sh           # re-run the existing build (no rebuild)
#
# NOTE: `pnpm dev` (vite hot-reload) is currently BROKEN by a nitro-nightly dev
# runtime bug ("Missing `fetch` export") — every page 500s. Until that is fixed,
# this rebuild-and-run loop is the local dev path. See oxygenie/CLAUDE.md
# → "## 本地运行环境（共享 Docker 后端）".
set -euo pipefail
cd "$(dirname "$0")/.."                                  # -> oxygenie/
PORT="${OXY_LOCAL_PORT:-3100}"

# 1) Ensure shared-backend connectivity (socat bridges + .env.local).
if [ -z "$(docker ps -q -f name='^oxygenie-devbridge-db$')" ] || [ ! -f .env.local ]; then
  ./scripts/local-backend.sh up
fi

# 2) Build if asked, or if there is no build yet. SSR build peaks ~4 GB → needs a
#    bigger heap than the default or it OOMs.
if [ "${1:-}" = "--build" ] || [ "${1:-}" = "-b" ] || [ ! -f .output/server/index.mjs ]; then
  echo "→ building (8 GB heap)…"
  NODE_OPTIONS="--max-old-space-size=8192" pnpm build
fi

# 3) Run the production Nitro server, loading .env then .env.local (later wins).
echo "→ production server on http://127.0.0.1:${PORT}  (Ctrl-C to stop)"
echo "  first run? open the URL, sign up a user (email verification is off)."
PORT="$PORT" NITRO_PORT="$PORT" HOST=127.0.0.1 \
  node --env-file=.env --env-file=.env.local .output/server/index.mjs
