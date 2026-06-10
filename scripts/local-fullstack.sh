#!/usr/bin/env bash
# Bring up the FULL local stack — Nitro app + WebSocket server + worker — against the
# shared Docker backend, for LIVE verification of WS features (e.g. branch-on-reply).
#
#   scripts/local-fullstack.sh --build   # first time / after code changes (rebuilds)
#   scripts/local-fullstack.sh           # re-run the existing build (no rebuild)
#
# DIFFERENCE vs local-prod.sh: local-prod runs ONLY the Nitro server (enough to click
# the UI). This one runs `start-production.mjs`, which starts the ws-server in the same
# process — so real chat / branching works end to end. It also:
#   • pulls the ARK token (ANTHROPIC_*) from the running oxygenie-app container so the
#     worker can actually call the model (never written to .env, only gitignored .env.local);
#   • runs the ws-server on WS_PORT 3201 (NOT the prod default 3001 — a stale phasec
#     server may hold 3001) and bakes VITE_WS_URL so the browser connects to it;
#   • points session storage at a local dir (the shared DB is reused, but JSONL files
#     live on THIS host — fresh local sessions only; container /data/users is not shared).
#
# Cleanup: scripts/local-backend.sh down   (removes bridges + .env.local)
set -euo pipefail
cd "$(dirname "$0")/.."                                  # -> oxygenie/

APP="${OXY_APP_CONTAINER:-oxygenie-app}"
PORT="${OXY_LOCAL_PORT:-3100}"
WS_PORT="${OXY_WS_PORT:-3201}"
SESS_ROOT="${OXY_SESSIONS_ROOT:-$HOME/.oxygenie-local-sessions}"

# 1) Shared-backend connectivity (socat bridges + base .env.local) — reuse local-backend.sh.
if [ -z "$(docker ps -q -f name='^oxygenie-devbridge-db$')" ] || [ ! -f .env.local ]; then
  ./scripts/local-backend.sh up
fi
[ -n "$(docker ps -q -f name="^${APP}$")" ] || { echo "✗ ${APP} not running — start the Docker stack first"; exit 1; }

# 2) (Re)write a managed block in .env.local with the full-stack + ARK vars.
#    Idempotent: strip any prior block first, then append a fresh one.
#    sed -i '' is BSD/macOS syntax; GNU sed would be `sed -i`.
sed -i '' '/# >>> local-fullstack/,/# <<< local-fullstack/d' .env.local 2>/dev/null \
  || sed -i '/# >>> local-fullstack/,/# <<< local-fullstack/d' .env.local 2>/dev/null || true

mkdir -p "$SESS_ROOT"
{
  echo "# >>> local-fullstack (regenerated each run; gitignored; DO NOT COMMIT)"
  echo "WS_PORT=${WS_PORT}"
  echo "APP_URL=http://127.0.0.1:${PORT}"
  echo "CLAUDE_SESSIONS_ROOT=${SESS_ROOT}"
  echo "VITE_WS_URL=ws://127.0.0.1:${WS_PORT}/ws/agent"
  echo "ENABLE_STRUCTURED_OUTPUTS=false"
  # CRITICAL: neutralize any ANTHROPIC_API_KEY coming from .env (loaded BEFORE .env.local).
  # The repo .env sets a NON-empty ANTHROPIC_API_KEY (the ARK token reused as an api key);
  # if it survives, the SDK uses x-api-key and ARK's /api/coding gateway rejects it
  # ("Invalid API key"). The container forces Bearer by keeping API_KEY EMPTY + setting
  # ANTHROPIC_AUTH_TOKEN — we replicate that exactly. .env.local wins (loaded last).
  echo "ANTHROPIC_API_KEY="
  # ARK model gateway: copy every ANTHROPIC_* from the container EXCEPT ANTHROPIC_API_KEY
  # (we just forced it empty above; AUTH_TOKEN/BASE_URL/MODEL/aliases come from the container).
  docker exec "$APP" printenv \
    | grep -E '^ANTHROPIC_' \
    | grep -v -E '^ANTHROPIC_API_KEY=' || true
  echo "# <<< local-fullstack"
} >> .env.local
echo "  ✓ wrote local-fullstack block to .env.local  (WS_PORT=${WS_PORT}, sessions=${SESS_ROOT})"

# 3) Build if asked / if missing. VITE_WS_URL is baked into the client bundle at build
#    time, so a build is REQUIRED the first time (and whenever WS_PORT changes).
if [ "${1:-}" = "--build" ] || [ "${1:-}" = "-b" ] || [ ! -f .output/server/index.mjs ]; then
  echo "→ building (8 GB heap; bakes VITE_WS_URL=ws://127.0.0.1:${WS_PORT}/ws/agent)…"
  NODE_OPTIONS="--max-old-space-size=8192" pnpm build
fi

# 4) Run Nitro + ws-server in one process (start-production.mjs).
# CRITICAL: Node's --env-file does NOT override variables already present in the ambient
# environment. A Claude Code / dev shell may export ANTHROPIC_BASE_URL (= the real
# https://api.anthropic.com) and/or ANTHROPIC_API_KEY for its own use; those would shadow
# the ARK gateway from .env(.local), so the ARK token gets sent to Anthropic and rejected
# ("Invalid bearer token"). Strip any ambient ANTHROPIC_* so the file values win.
for v in $(env | sed -n 's/^\(ANTHROPIC_[A-Za-z0-9_]*\)=.*/\1/p'); do unset "$v"; done

echo "→ full stack:  app http://127.0.0.1:${PORT}   ws ws://127.0.0.1:${WS_PORT}/ws/agent   (Ctrl-C to stop)"
PORT="$PORT" NITRO_PORT="$PORT" HOST=127.0.0.1 \
  node --env-file=.env --env-file=.env.local start-production.mjs
