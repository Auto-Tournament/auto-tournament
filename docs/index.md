# MatchZy Auto Tournament

**Automated CS2 tournament platform with zero manual server configuration.**

---

## Quick Start

**Install and run in 5 minutes:**

**1. Create a directory and save as `docker-compose.yml`:**

```yaml
services:
  postgres:
    image: postgres:16-alpine
    container_name: matchzy-postgres
    restart: unless-stopped
    environment:
      - POSTGRES_USER=${DB_USER:-postgres}
      - POSTGRES_PASSWORD=${DB_PASSWORD:-postgres}
      - POSTGRES_DB=${DB_NAME:-matchzy_tournament}
    volumes:
      - postgres-data:/var/lib/postgresql/data
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U ${DB_USER:-postgres}']
      interval: 10s
      timeout: 5s
      retries: 5
    networks:
      - matchzy-network

  matchzy-tournament:
    image: sivertio/matchzy-auto-tournament:latest
    container_name: matchzy-tournament-api
    restart: unless-stopped
    depends_on:
      postgres:
        condition: service_healthy
    env_file:
      - .env
    ports:
      - '${HOST_PORT:-3069}:3069'
    environment:
      - NODE_ENV=production
      - PORT=3000
      - DB_HOST=postgres
      - DATABASE_URL=postgresql://${DB_USER:-postgres}:${DB_PASSWORD:-postgres}@postgres:5432/${DB_NAME:-matchzy_tournament}
      - SESSION_SECRET=${SESSION_SECRET:-}
    volumes:
      - ./data:/app/data
    healthcheck:
      test: ['CMD', 'wget', '--no-verbose', '--tries=1', '--spider', 'http://localhost:3069/health']
      interval: 30s
      timeout: 3s
      retries: 3
      start_period: 10s
    networks:
      - matchzy-network

networks:
  matchzy-network:
    driver: bridge

volumes:
  postgres-data:
    driver: local
```

**2. Generate secrets (copy-paste these commands):**

```bash
# Generate session secret
openssl rand -base64 32

# Generate server token
openssl rand -base64 24 | tr -d '=+/'
```

**3. Save as `.env` (create this file in the same directory, paste the generated values above):**

```bash
# API port (behind Docker this is usually 3000)
PORT=3000

# Session secret (REQUIRED - paste the value from step 2)
SESSION_SECRET=

# Database settings
DB_HOST=127.0.0.1
DB_PORT=5432
DB_USER=postgres
DB_PASSWORD=postgres
DB_NAME=matchzy_tournament

# CS2 server authentication token (paste the generated value from step 2)
# Generate with: openssl rand -base64 24 | tr -d '=+/'
SERVER_TOKEN=

# Frontend base URL (use http:// for local, https:// for production)
FRONTEND_BASE_URL=http://localhost:3069

# Steam auth
AUTH_STEAM_ENABLED=true
# Get your Steam API key from: https://steamcommunity.com/dev/apikey
STEAM_API_KEY=

# Logging
LOG_LEVEL=info
```

**4. Start the stack:**

```bash
docker compose up -d
```

**5. Open in browser:** [http://localhost:3069](http://localhost:3069)

> **Note:** You can configure `SERVER_TOKEN` and `STEAM_API_KEY` in **Settings** after first login, but `SESSION_SECRET` must be set in `.env` for session persistence.

!!! info "Upgrading from 1.7.6 (or earlier) with existing data?"
    If you’re moving from **1.7.6 → 2.0** and have teams, matches, and players in your DB, see **[Migrating to 2.0](guides/migration-to-2.md)**. You’ll need to set `SESSION_SECRET`, `STEAM_API_KEY`, and `FRONTEND_BASE_URL`, then **promote at least one admin** before signing in. Skip this only if you’re doing a **fresh install**.

[**Full Installation Guide →**](getting-started/)

---

## Documentation

### 🎯 For Tournament Admins

**Setup:**
- [Installation](getting-started/) - Docker setup and first tournament
- [Migration (1.7.6 → 2.0)](guides/migration-to-2.md) - Upgrading with existing data, sign-in fixes
- [Server Setup](getting-started/server-setup/) - CS2 server configuration
- [Admin Settings](guides/admin-settings/) - Webhooks, maps, defaults

**Running Tournaments:**
- [Teams Guide](guides/teams/) - Creating and managing teams
- [Creating Tournaments](guides/how-to-set-up-a-tournament/) - Tournament setup
- [Running Matches](guides/running-matches/) - Match management
- [Troubleshooting](guides/troubleshooting/) - Common issues

### 👥 For Players

Players use **team pages** (no login needed):
```
https://your-domain.com/team/team-name
```

Features:
- View upcoming matches
- Participate in map veto
- Get server connection info
- Monitor live scores

[**Team Pages Guide →**](guides/team-pages/)

### 💻 For Developers

- [Contributing Guide](https://github.com/sivert-io/matchzy-auto-tournament/blob/main/.github/CONTRIBUTING.md)
- [Architecture](development/architecture/) - System design
- [Testing](development/testing-pr/) - Running tests

---

## Features

**Tournament Formats:**
- Single/Double Elimination
- Swiss System
- Round Robin
- Shuffle (player-based)

**Automation:**
- Auto server allocation
- Match loading via RCON
- Real-time bracket updates
- Demo recording & upload

**Player Experience:**
- FaceIT-style map veto
- Public team pages
- Live match tracking
- OpenSkill-based ratings

[**Full Feature List →**](features/overview/)

---

## Support

- 💬 [Discord Community](https://discord.gg/n7gHYau7aW)
- 🐛 [GitHub Issues](https://github.com/sivert-io/matchzy-auto-tournament/issues)
- 📖 [Troubleshooting Guide](guides/troubleshooting/)

---

## License

MIT License - see [LICENSE](https://github.com/sivert-io/matchzy-auto-tournament/blob/main/LICENSE)
