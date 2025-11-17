# Use Node.js for build with Yarn (better optional dependency handling)
FROM node:20-slim AS base
WORKDIR /app

# Enable Yarn via corepack (built into Node.js 20+)
RUN corepack enable && corepack prepare yarn@stable --activate

# Install dependencies (production only for runtime)
FROM base AS dependencies

# Install Python and build tools for native modules (better-sqlite3)
RUN apt-get update && \
    apt-get install -y python3 make g++ && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

COPY package.json yarn.lock package-lock.json* ./
# Configure Yarn to use node_modules and set cache directory
RUN echo "nodeLinker: node-modules" > .yarnrc.yml && \
    echo "enableGlobalCache: false" >> .yarnrc.yml
# Install production dependencies only
RUN yarn install --production --immutable 2>&1 || yarn install --immutable

# Build TypeScript backend and React frontend
FROM base AS build

# Install all dependencies (including devDependencies for build)
RUN apt-get update && \
    apt-get install -y python3 make g++ && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

COPY package.json yarn.lock package-lock.json* ./
# Configure Yarn to use node_modules and set cache directory
RUN echo "nodeLinker: node-modules" > .yarnrc.yml && \
    echo "enableGlobalCache: false" >> .yarnrc.yml
RUN yarn install --immutable

COPY . .
# Ensure public directory exists for vite build output
RUN mkdir -p public
RUN yarn build:server
RUN yarn build:client

# Production image with Node.js and Caddy (better-sqlite3 requires Node)
FROM node:20-slim AS release
WORKDIR /app

# Build arguments for platform detection
ARG TARGETPLATFORM
ARG BUILDPLATFORM

# Install build tools, Caddy, and procps (for pgrep in tests)
# Dynamically detect architecture for Caddy download
RUN apt-get update && \
    apt-get install -y wget python3 make g++ procps && \
    ARCH=$(echo "${TARGETPLATFORM:-linux/amd64}" | cut -d '/' -f2) && \
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
    wget -O /usr/local/bin/caddy "https://caddyserver.com/api/download?os=linux&arch=${CADDY_ARCH}" && \
    chmod +x /usr/local/bin/caddy && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

# Copy package files first
COPY --from=build /app/package.json ./

# Copy node_modules
COPY --from=dependencies /app/node_modules ./node_modules

# Rebuild native modules for Node.js runtime
RUN npm rebuild better-sqlite3 --build-from-source

# Copy application files
COPY --from=build /app/dist ./dist
COPY --from=build /app/public ./public

# Copy Caddy configuration
COPY docker/Caddyfile /app/Caddyfile

# Create data directory for SQLite database
RUN mkdir -p /app/data

# Expose Caddy port (single entry point)
EXPOSE 3069

# Set environment to production
ENV NODE_ENV=production

# Health check through Caddy
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3069/health || exit 1

# Create startup script
RUN echo '#!/bin/sh\n\
# Start Express backend in background\n\
node dist/index.js &\n\
\n\
# Wait a moment for backend to start\n\
sleep 2\n\
\n\
# Start Caddy in foreground\n\
exec caddy run --config /app/Caddyfile --adapter caddyfile' > /app/start.sh && \
chmod +x /app/start.sh

# Run the startup script
CMD ["/app/start.sh"]

