# Use official Bun image
FROM oven/bun:1 AS base
WORKDIR /app

# Install dependencies
FROM base AS dependencies

# Install Python and build tools for native modules (better-sqlite3)
RUN apt-get update && \
    apt-get install -y python3 make g++ && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

COPY package.json ./
RUN bun install

# Build TypeScript backend and React frontend
FROM dependencies AS build
COPY . .
RUN bun run build:server
RUN bun run build:client

# Production image with Caddy
FROM base AS release

# Install Caddy
RUN apt-get update && apt-get install -y wget && \
    wget -O /usr/local/bin/caddy "https://caddyserver.com/api/download?os=linux&arch=amd64" && \
    chmod +x /usr/local/bin/caddy && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

# Copy application files
COPY --from=dependencies /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/public ./public
COPY --from=build /app/package.json ./
COPY --from=build /app/docs ./docs

# Copy Caddy configuration
COPY Caddyfile /app/Caddyfile

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
bun run start &\n\
\n\
# Wait a moment for backend to start\n\
sleep 2\n\
\n\
# Start Caddy in foreground\n\
exec caddy run --config /app/Caddyfile --adapter caddyfile' > /app/start.sh && \
chmod +x /app/start.sh

# Run the startup script
CMD ["/app/start.sh"]

