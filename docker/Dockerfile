# Base image with Node.js and Yarn (via corepack)
FROM node:20-slim AS base
WORKDIR /app

# Enable Yarn via corepack (built into Node.js 20+)
RUN corepack enable && corepack prepare yarn@stable --activate

# Global Yarn config (reused in all stages that inherit from base)
RUN echo "nodeLinker: node-modules" > .yarnrc.yml && \
    echo "enableGlobalCache: false" >> .yarnrc.yml

# -------------------------------------------------------------------
# Dependencies: install all deps once (used for build + runtime)
# -------------------------------------------------------------------
FROM base AS deps

# Only copy files needed to resolve dependencies
COPY package.json yarn.lock ./

# Install all dependencies (including devDeps for build)
RUN yarn install --immutable

# -------------------------------------------------------------------
# Build: compile TypeScript backend + React frontend
# -------------------------------------------------------------------
FROM base AS build

# Reuse node_modules from deps for faster, consistent builds
COPY --from=deps /app/node_modules ./node_modules

# Copy the rest of the application source
COPY . .

# Ensure public directory exists for vite build output or static assets
RUN mkdir -p public

# Build backend and frontend
RUN yarn build:server
RUN yarn build:client

# -------------------------------------------------------------------
# Release: production image with Node.js and Caddy
# -------------------------------------------------------------------
    FROM node:20-slim AS release
    WORKDIR /app
    
    # Build arguments for platform detection
    ARG TARGETPLATFORM
    ARG BUILDPLATFORM
    
    # Pin Caddy version (bump if you want a newer one)
    ARG CADDY_VERSION=2.7.3
    
    # Install wget + CA bundle and download Caddy from GitHub releases
    RUN apt-get update && \
        apt-get install -y wget ca-certificates && \
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
        apt-get clean && rm -rf /var/lib/apt/lists/*    

# Environment
ENV NODE_ENV=production

# Copy package.json (if your app reads version/name etc. at runtime)
COPY --from=build /app/package.json ./

# Copy node_modules from deps (includes prod + dev deps; easiest version)
# If you want only production deps, you can later adjust this stage to prune.
COPY --from=deps /app/node_modules ./node_modules

# Copy built application
COPY --from=build /app/dist ./dist
COPY --from=build /app/public ./public

# Copy Caddy configuration
COPY docker/Caddyfile /app/Caddyfile

# Create data directory for demos and other files
RUN mkdir -p /app/data

# Expose Caddy port (single entry point)
EXPOSE 3069

# Health check through Caddy
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3069/health || exit 1

# Create startup script (Node API + Caddy)
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

# Run the startup script
CMD ["/app/start.sh"]
