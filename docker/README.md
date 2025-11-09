# Docker Configuration

This directory contains all Docker-related files for the MatchZy Auto Tournament project.

## Files

- **`Dockerfile`** - Multi-stage build for the application
- **`docker-compose.yml`** - Production compose file (uses pre-built image from Docker Hub)
- **`docker-compose.dev.yml`** - Development compose file (builds locally)
- **`Caddyfile`** - Reverse proxy configuration for serving frontend and API

## Usage

### Production (Pull from Docker Hub)

```bash
docker compose -f docker/docker-compose.yml up -d
```

This pulls the latest image from `sivertio/matchzy-auto-tournament:latest`

### Development (Build Locally)

```bash
docker compose -f docker/docker-compose.dev.yml up -d --build
```

This builds the image locally from source.

### One-off Build

```bash
docker build -f docker/Dockerfile -t matchzy-auto-tournament:local .
```

## Configuration

The compose files expect a `.env` file in the project root with:

```bash
API_TOKEN=your-admin-token
SERVER_TOKEN=your-server-token
WEBHOOK_URL=http://your-ip:3069/api
```

## Ports

- **3069** - Main entry point (Caddy serves frontend at `/` and proxies `/api` to backend)
- **3000** - Backend API (internal, not exposed)

## Volumes

- `./data:/app/data` - Persists SQLite database and demos

## Architecture

```
[External:3069] → [Caddy]
                    ├─ / → Static Frontend
                    └─ /api → Backend:3000
```

Single port, clean setup! 🎯

