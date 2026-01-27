# ---- Stage 1: Build ----------------------------------------------------------
FROM node:24-bookworm-slim AS builder

# TLS root store for outbound HTTPS
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    procps \
  && rm -rf /var/lib/apt/lists/*

# Allow Vite build to use more memory inside the builder container
ENV NODE_OPTIONS="--max-old-space-size=8192"

# Build-time args for Vite environment variables
ARG VITE_WS_URL
ENV VITE_WS_URL=${VITE_WS_URL}

# OAuth client IDs (optional - for social login)
ARG VITE_GITHUB_CLIENT_ID
ENV VITE_GITHUB_CLIENT_ID=${VITE_GITHUB_CLIENT_ID}

ARG VITE_GOOGLE_CLIENT_ID
ENV VITE_GOOGLE_CLIENT_ID=${VITE_GOOGLE_CLIENT_ID}

# Use pnpm
RUN corepack enable && corepack prepare pnpm@10.17.1 --activate

WORKDIR /app

# Install dependencies (with lockfile)
COPY package.json pnpm-lock.yaml ./
RUN echo "=== Memory before pnpm install ===" && free -m && \
    pnpm install --frozen-lockfile && \
    echo "=== Memory after pnpm install ===" && free -m

# Copy source and build
COPY . .
ENV NODE_ENV=production
# Set CLAUDE_SESSIONS_ROOT at build time so Nitro knows about it
ENV CLAUDE_SESSIONS_ROOT=/data/users

# Build with memory monitoring
RUN echo "=== Memory before build ===" && free -m && \
    echo "=== Starting Vite build (client + ssr + nitro) ===" && \
    pnpm run build && \
    echo "=== Memory after build ===" && free -m && \
    echo "=== Build output size ===" && du -sh .output/

# ---- Stage 2: Runtime --------------------------------------------------------
FROM node:24-bookworm-slim AS runner

# Install runtime dependencies including Python and common data libraries
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    bash \
    bubblewrap \
    ripgrep \
    python3 \
    python3-pip \
    python3-numpy \
    python3-pandas \
    python3-matplotlib \
    python3-pil \
    python3-yaml \
    python3-scipy \
    python3-seaborn \
    python3-bs4 \
    python3-lxml \
  && rm -rf /var/lib/apt/lists/*
RUN python3 -m pip install --no-cache-dir --break-system-packages markitdown-mcp
RUN npm install -g pnpm@10.17.1

WORKDIR /app
ENV PORT=5000

# Install runtime dependencies (keep dev tools for migrations/worker)
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

ENV NODE_ENV=production

# Copy build output and runtime assets
# TanStack Start outputs to .output/
COPY --from=builder /app/.output ./.output
COPY --from=builder /app/public ./public
COPY --from=builder /app/drizzle ./drizzle

# Include source for the worker (runs via tsx in production)
COPY --from=builder /app/src ./src
COPY --from=builder /app/tsconfig.json ./tsconfig.json
COPY --from=builder /app/drizzle.config.ts ./drizzle.config.ts

# Non-root user (Debian adduser/addgroup syntax)
RUN addgroup --gid 1001 nodejs \
  && adduser --uid 1001 --gid 1001 --disabled-password --gecos "" nodejs

# Copy WebSocket server, worker, and production startup script
COPY --from=builder --chown=nodejs:nodejs /app/ws-server.mjs ./ws-server.mjs
COPY --from=builder --chown=nodejs:nodejs /app/ws-query-worker.mjs ./ws-query-worker.mjs
COPY --from=builder --chown=nodejs:nodejs /app/start-production.mjs ./start-production.mjs
RUN chmod +x ./start-production.mjs

# Create data directories for Claude Agent (skills-store for global Skills, users for sessions)
RUN mkdir -p /data/users /data/skills-store && chown -R nodejs:nodejs /data

USER nodejs

# Expose main app port and WebSocket port
EXPOSE 5000 3001

# Environment variables for WebSocket
ENV WS_PORT=3001
ENV APP_URL=http://localhost:5000

# Claude Agent sessions root directory
ENV CLAUDE_SESSIONS_ROOT=/data/users

# Start production script (runs both Nitro and WebSocket servers in same process)
CMD ["node", "start-production.mjs"]
