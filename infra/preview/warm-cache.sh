#!/usr/bin/env bash
# Pre-warm the shared preview package-manager cache with the common web frameworks,
# so the FIRST preview of a React/Vite/Vue app is fast (no full cold download).
#
# Background: every preview container mounts a SHARED docker volume at /pm-cache and
# points npm/pnpm/yarn at it (see src/preview/controller.mjs). Installs reuse anything
# already downloaded, and the cache self-warms over time. This script seeds it up front
# with the usual suspects so even the very first run is quick.
#
# Safe to re-run (it only adds to the cache). Run once after deploying, or on a new host.
# Extend the set via PREVIEW_WARM_DEPS="pkg1 pkg2 ...".
set -euo pipefail

VOLUME="${PREVIEW_PM_CACHE_VOLUME:-oxy-preview-pm-cache}"
IMAGE="${PREVIEW_IMAGE:-node:24-bookworm-slim}"
USER_SPEC="${PREVIEW_CONTAINER_USER:-1001:1001}"
# Common GLM/Vite outputs. Latest of each — the cache self-warms for pinned older versions.
DEPS="${PREVIEW_WARM_DEPS:-react react-dom vite @vitejs/plugin-react vue @vitejs/plugin-vue typescript tailwindcss postcss autoprefixer}"

echo "[warm-cache] volume=$VOLUME image=$IMAGE user=$USER_SPEC"
echo "[warm-cache] deps: $DEPS"

docker run --rm \
  -v "$VOLUME:/pm-cache" \
  -e HOME=/tmp \
  -e npm_config_cache=/pm-cache/npm \
  -e COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
  "$IMAGE" \
  bash -lc "
    set -e
    mkdir -p /tmp/warm && cd /tmp/warm
    npm init -y >/dev/null 2>&1
    echo '[warm-cache] downloading into shared cache (/pm-cache/npm)…'
    npm install --no-audit --no-fund $DEPS
    rm -rf /tmp/warm/node_modules
    # Hand the cache to the preview user so preview containers (that uid) can read AND
    # update it. Matches the ownership the controller sets on /pm-cache at startup.
    chown -R $USER_SPEC /pm-cache
    echo -n '[warm-cache] cache size: '; du -sh /pm-cache 2>/dev/null | cut -f1 || true
  "
echo "[warm-cache] done."
