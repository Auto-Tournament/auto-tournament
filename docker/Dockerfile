# Where the release stage gets the built app from: `build` (compiled here) or
# `prebuilt` (compiled on the CI runner; see the build job in ci.yml).
ARG APP_BUILD=build

# Base image with Node.js and Yarn (via corepack)
# Using Alpine for smallest possible image size
# node from AWS ECR Public, the mirror of Docker's official images: Docker Hub
# rate-limits and times out on CI runners (2026-10-09).
FROM public.ecr.aws/docker/library/node:20-alpine AS base
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
# manifests: dependency manifests with the release version blanked out
# -------------------------------------------------------------------
# Every release bumps "version" in all three package.json files. Copying them
# straight into deps would invalidate the (slow) yarn install layer on each
# bump even though no dependency changed. The files produced here are
# byte-identical across version bumps, and COPY --from is cached on content, so
# deps keeps hitting the layer cache. The real package.json files still reach
# the image through `COPY . .` in the build stage.
FROM public.ecr.aws/docker/library/node:20-alpine AS manifests
WORKDIR /app
COPY package.json yarn.lock ./
COPY api/package.json ./api/package.json
COPY client/package.json ./client/package.json
RUN node -e "const fs = require('fs'); for (const f of ['package.json', 'api/package.json', 'client/package.json']) { const p = JSON.parse(fs.readFileSync(f, 'utf8')); p.version = '0.0.0'; fs.writeFileSync(f, JSON.stringify(p, null, 2) + '\n'); }"

# -------------------------------------------------------------------
# deps: install ALL dependencies (prod + dev) for building
# -------------------------------------------------------------------
FROM base AS deps

# Only copy files needed to resolve dependencies (root + workspace manifests)
COPY --from=manifests /app/package.json /app/yarn.lock ./
COPY --from=manifests /app/api/package.json ./api/package.json
COPY --from=manifests /app/client/package.json ./client/package.json

# Install all dependencies (including devDeps for build tools) for all workspaces
# Add retry logic for network issues, especially in ARM64 emulation
# Use verbose output to show progress during long installs
RUN echo "Starting yarn install (this may take several minutes)..." && \
    yarn install --network-timeout 300000 --network-concurrency 1 --verbose || \
    (echo "⚠️  First yarn install attempt failed, retrying in 5 seconds..." && sleep 5 && \
     echo "Retry attempt 1/2..." && \
     yarn install --network-timeout 300000 --network-concurrency 1 --verbose) || \
    (echo "⚠️  Second yarn install attempt failed, retrying in 10 seconds..." && sleep 10 && \
     echo "Retry attempt 2/2 (final attempt)..." && \
     yarn install --network-timeout 300000 --network-concurrency 1 --verbose) && \
    echo "✅ yarn install completed successfully"

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

# Release day of this version's x.y.0 (YYYY-MM-DD), for the license line date
# (api/src/services/license/lineDate.ts). Set by the release workflow for
# patch releases; empty otherwise, and the build day is used. An ARG is in the
# environment of the RUN below, where api/esbuild.config.js reads it.
ARG AT_LINE_RELEASE_DATE=

# Build backend and frontend (needs devDeps like TypeScript, Vite, esbuild, etc.)
RUN echo "Building backend (TypeScript compilation)..." && \
    yarn build:server && \
    echo "✅ Backend build complete" && \
    echo "Building frontend (Vite bundling)..." && \
    yarn build:client && \
    echo "✅ Frontend build complete" && \
    node scripts/third-party-notices.mjs

# -------------------------------------------------------------------
# prebuilt: the same files, compiled on the CI runner with its cached
# node_modules, so CI skips the in-image yarn install (6+ minutes whenever
# yarn.lock changes). Laid out like /app in the build stage.
# -------------------------------------------------------------------
FROM scratch AS prebuilt
COPY ci-prebuilt/ /app/

# The stage the release copies from.
FROM ${APP_BUILD} AS app-build

# -------------------------------------------------------------------
# release: lean production image with Node.js and Caddy
# NO node_modules needed - backend is bundled!
# Using Alpine for smallest possible image size
# -------------------------------------------------------------------
FROM public.ecr.aws/docker/library/node:20-alpine AS release
WORKDIR /app

# Build arguments for platform detection
ARG TARGETPLATFORM
ARG BUILDPLATFORM

# Pin Caddy version
ARG CADDY_VERSION=2.7.3

# Install ca-certificates for HTTPS and wget for Caddy download
# We'll use Node.js for health checks instead of curl (saves ~2-3 MB)
# ffmpeg: highlight downloads with music mixed in (cs2/demos/music.ts)
RUN apk add --no-cache ca-certificates wget ffmpeg && \
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
COPY --from=app-build /app/package.json ./

# ⬇️ NO node_modules needed! Backend is bundled with esbuild
# The bundled dist/index.js contains all dependencies

# Copy built application (bundled backend + frontend)
# Backend is built into /app/api/dist and frontend into /app/api/public
# We copy them into /app/dist and /app/public so runtime paths stay consistent.
COPY --from=app-build /app/api/dist ./dist
COPY --from=app-build /app/api/public ./public
# Swagger UI's own CSS and JS. The bundle inlines swagger-ui-express's code but
# not swagger-ui-dist's static files, and this image has no node_modules to
# serve them from — without these, /api-docs is a blank page. See
# copySwaggerUiAssets in api/esbuild.config.js and SWAGGER_UI_DIR in
# api/src/config/publicPaths.ts.
COPY --from=app-build /app/api/swagger-ui ./swagger-ui
# The offline game catalog (DESIGN-modules §10): a committed snapshot of the
# Auto-Tournament/packs repository, and signed code-module releases. Offered
# as "available" in the catalog, installable with no network; none of it is
# installed on its own. See seedBundledPacks in
# api/src/services/gamePackService.ts and api/src/modules/catalogFeed.ts.
COPY --from=app-build /app/api/bundled-packs ./bundled-packs
COPY --from=app-build /app/api/bundled-modules ./bundled-modules
# The generated OpenAPI spec. Without it, swagger-jsdoc has no .ts sources to
# read in this image and /api-docs would list every endpoint with none of the
# hand-written descriptions. See resolveOpenApiSpec in api/src/config/swagger.ts.
COPY --from=app-build /app/docs/openapi.json ./docs/openapi.json

# Copy Caddy configuration
COPY docker/Caddyfile /app/Caddyfile
# License terms travel with the image (PolyForm Noncommercial requires it),
# with the notices of the third-party packages bundled into the server and the
# web app (their licenses ask for them; the image has no node_modules that
# would carry them). The web app also serves them at /third-party-notices.txt.
COPY LICENSE NOTICE /app/
COPY --from=app-build /app/THIRD_PARTY_NOTICES.md /app/THIRD_PARTY_NOTICES.md
COPY --from=app-build /app/THIRD_PARTY_NOTICES.md /app/public/third-party-notices.txt

LABEL org.opencontainers.image.title="Auto Tournament" \
      org.opencontainers.image.description="Self-hosted tournament platform: brackets, map veto, game servers and results run themselves." \
      org.opencontainers.image.url="https://autotournament.gg" \
      org.opencontainers.image.documentation="https://docs.autotournament.gg" \
      org.opencontainers.image.source="https://github.com/Auto-Tournament/auto-tournament" \
      org.opencontainers.image.vendor="Sivert Gullberg Hansen" \
      org.opencontainers.image.licenses="PolyForm-Noncommercial-1.0.0"

# Data directory for demos / event logs / uploaded map images.
#
# Both compose files bind-mount a host directory here (`./data:/app/data`),
# which is what makes anything written at runtime survive a container
# recreate. Everything else in this image -- including /app/public -- is
# build output and is replaced wholesale by every update, so nothing the app
# writes may live outside this directory. See api/src/config/dataDir.ts and
# api/src/config/publicPaths.ts.
RUN mkdir -p /app/data/map-images

# Recovery: `docker exec auto-tournament reset-admin` prints a one-time code
# (1 hour) for /setup that resets a local admin's password or creates one.
# See api/src/cli/resetAdmin.ts.
RUN printf '%s\n' \
  '#!/bin/sh' \
  'cd /app && LOG_LEVEL="${RESET_ADMIN_LOG_LEVEL:-error}" exec node dist/reset-admin.js "$@"' \
  > /usr/local/bin/reset-admin && \
  chmod +x /usr/local/bin/reset-admin

# Expose Caddy port (single entry point)
EXPOSE 3069

# Health check using Node.js instead of curl (saves ~2-3 MB)
# Node.js http module is built-in, so no additional dependencies needed
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3069/health', (r) => { process.exit(r.statusCode === 200 ? 0 : 1) }).on('error', () => process.exit(1))" || exit 1

# Startup script (Node API + Caddy)
#
# Both processes are supervised. Previously Caddy ran in the foreground as PID 1
# with Node backgrounded, so if Node exited -- e.g. it lost the race with
# Postgres on a host reboot and died with "the database system is starting up"
# -- the container stayed "up" and Caddy served 502 for every request, forever.
# The restart policy never fired because the container had not exited, and the
# healthcheck could only mark it unhealthy.
#
# Now the container exits as soon as either process does, so
# `restart: unless-stopped` can actually recover it.
RUN printf '%s\n' \
  '#!/bin/sh' \
  'set -e' \
  '' \
  '# Start Express backend' \
  'node dist/index.js &' \
  'NODE_PID=$!' \
  '' \
  '# Give the backend a moment before Caddy starts proxying to it' \
  'sleep 2' \
  '' \
  '# Start Caddy' \
  'caddy run --config /app/Caddyfile --adapter caddyfile &' \
  'CADDY_PID=$!' \
  '' \
  'term() {' \
  '  kill "$NODE_PID" "$CADDY_PID" 2>/dev/null || true' \
  '  exit 0' \
  '}' \
  'trap term TERM INT' \
  '' \
  '# Exit if either process dies, so the container is restarted rather than' \
  '# left serving 502s from a half-dead stack.' \
  'while kill -0 "$NODE_PID" 2>/dev/null && kill -0 "$CADDY_PID" 2>/dev/null; do' \
  '  sleep 5' \
  'done' \
  '' \
  'if kill -0 "$NODE_PID" 2>/dev/null; then' \
  '  echo "[start.sh] Caddy exited; shutting down so the container restarts." >&2' \
  'else' \
  '  echo "[start.sh] Node API exited; shutting down so the container restarts." >&2' \
  'fi' \
  '' \
  'kill "$NODE_PID" "$CADDY_PID" 2>/dev/null || true' \
  'exit 1' \
  > /app/start.sh && \
  chmod +x /app/start.sh

CMD ["/app/start.sh"]
