# Base image with Node.js and Yarn (via corepack)
# Using Alpine for smallest possible image size
FROM node:20-alpine AS base
WORKDIR /app

# Install necessary build tools for Alpine (only in build stages)
RUN apk add --no-cache \
    python3 \
    make \
    g++

# Enable Yarn via corepack (Node.js 20+)
# Use classic Yarn 1.x to match the repo's lockfile format
RUN corepack enable && corepack prepare yarn@1.22.19 --activate

# -------------------------------------------------------------------
# deps: install ALL dependencies (prod + dev) for building
# -------------------------------------------------------------------
FROM base AS deps

# Only copy files needed to resolve dependencies (root + workspace manifests)
COPY package.json yarn.lock ./
COPY api/package.json ./api/package.json
COPY client/package.json ./client/package.json

# Install all dependencies (including devDeps for build tools) for all workspaces
RUN yarn install

# -------------------------------------------------------------------
# build: compile TypeScript backend + React frontend
# -------------------------------------------------------------------
FROM base AS build

# Reuse node_modules from deps for build (contains devDeps)
COPY --from=deps /app/node_modules ./node_modules

# Copy the rest of the application source
COPY . .

# Ensure public directory exists for Vite/static assets
RUN mkdir -p public

# Build arguments for Vite environment variables
ARG VITE_ENABLE_DEV_PAGE
ENV VITE_ENABLE_DEV_PAGE=${VITE_ENABLE_DEV_PAGE}

# Build backend and frontend (needs devDeps like TypeScript, Vite, esbuild, etc.)
RUN yarn build:server
RUN yarn build:client

# -------------------------------------------------------------------
# release: lean production image with Node.js and Caddy
# NO node_modules needed - backend is bundled!
# Using Alpine for smallest possible image size
# -------------------------------------------------------------------
FROM node:20-alpine AS release
WORKDIR /app

# Build arguments for platform detection
ARG TARGETPLATFORM
ARG BUILDPLATFORM

# Pin Caddy version
ARG CADDY_VERSION=2.7.3

# Install ca-certificates for HTTPS and wget for Caddy download
# We'll use Node.js for health checks instead of curl (saves ~2-3 MB)
RUN apk add --no-cache ca-certificates wget && \
    ARCH="$(echo "${TARGETPLATFORM:-linux/amd64}" | cut -d'/' -f2)" && \
    if [ "$ARCH" = "amd64" ] || [ "$ARCH" = "x86_64" ]; then \
        CADDY_ARCH="amd64"; \
    elif [ "$ARCH" = "arm64" ] || [ "$ARCH" = "arm64v8" ] || [ "$ARCH" = "aarch64" ]; then \
        CADDY_ARCH="arm64"; \
    elif [ "$ARCH" = "arm" ] || [ "$ARCH" = "armv7" ] || [ "$ARCH" = "armv6" ] || [ "$ARCH" = "armv7l" ] || [ "$ARCH" = "armv6l" ]; then \
        CADDY_ARCH="armv7"; \
    else \
        echo "Warning: Unsupported architecture $ARCH, falling back to amd64" >&2; \
        CADDY_ARCH="amd64"; \
    fi && \
    wget -O /tmp/caddy.tar.gz \
      "https://github.com/caddyserver/caddy/releases/download/v${CADDY_VERSION}/caddy_${CADDY_VERSION}_linux_${CADDY_ARCH}.tar.gz" && \
    tar -xzf /tmp/caddy.tar.gz -C /usr/local/bin caddy && \
    chmod +x /usr/local/bin/caddy && \
    rm -f /tmp/caddy.tar.gz && \
    # Remove wget after use (we'll use Node.js for health checks)
    apk del wget

# Environment
ENV NODE_ENV=production

# Copy package.json (needed for version info at runtime)
COPY --from=build /app/package.json ./

# ⬇️ NO node_modules needed! Backend is bundled with esbuild
# The bundled dist/index.js contains all dependencies

# Copy built application (bundled backend + frontend)
# Backend is built into /app/api/dist and frontend into /app/api/public
# We copy them into /app/dist and /app/public so runtime paths stay consistent.
COPY --from=build /app/api/dist ./dist
COPY --from=build /app/api/public ./public

# Copy Caddy configuration
COPY docker/Caddyfile /app/Caddyfile

# Data directory for demos / uploads / etc.
RUN mkdir -p /app/data

# Expose Caddy port (single entry point)
EXPOSE 3069

# Health check using Node.js instead of curl (saves ~2-3 MB)
# Node.js http module is built-in, so no additional dependencies needed
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3069/health', (r) => { process.exit(r.statusCode === 200 ? 0 : 1) }).on('error', () => process.exit(1))" || exit 1

# Startup script (Node API + Caddy)
RUN printf '%s\n' \
  '#!/bin/sh' \
  'set -e' \
  '' \
  '# Start Express backend in background' \
  'node dist/index.js &' \
  '' \
  '# Wait a moment for backend to start' \
  'sleep 2' \
  '' \
  '# Start Caddy in foreground' \
  'exec caddy run --config /app/Caddyfile --adapter caddyfile' \
  > /app/start.sh && \
  chmod +x /app/start.sh

CMD ["/app/start.sh"]
