# Getting Started

## Quick start (copy-paste)

Create a folder, add two files, then run Docker.

**1. Save as `docker-compose.yml`:**

```yaml
services:
  postgres:
    image: postgres:16-alpine
    container_name: matchzy-postgres
    restart: unless-stopped
    environment:
      - POSTGRES_USER=postgres
      - POSTGRES_PASSWORD=postgres
      - POSTGRES_DB=matchzy_tournament
    volumes:
      - postgres-data:/var/lib/postgresql/data
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U postgres']
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
    ports:
      - '3069:3069'
    environment:
      - NODE_ENV=production
      - PORT=3000
      - SERVER_TOKEN=${SERVER_TOKEN:-change-me}
      - AUTH_STEAM_ENABLED=true
      - STEAM_API_KEY=${STEAM_API_KEY:-}
      - FRONTEND_BASE_URL=${FRONTEND_BASE_URL:-http://localhost:3069}
      - LOG_LEVEL=info
      - DATABASE_URL=postgresql://postgres:postgres@postgres:5432/matchzy_tournament
      - DB_HOST=postgres
      - DB_PORT=5432
      - DB_USER=postgres
      - DB_PASSWORD=postgres
      - DB_NAME=matchzy_tournament
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

**2. Save as `.env` (optional, for production):**

```bash
# CS2 server authentication token (required for servers to connect)
SERVER_TOKEN=your-secure-token-here

# Steam API key (required for Steam login - get from https://steamcommunity.com/dev/apikey)
STEAM_API_KEY=your-steam-api-key

# Frontend base URL (for auth redirects)
FRONTEND_BASE_URL=http://localhost:3069
```

**3. Start the stack:**

```bash
docker compose up -d
```

**4. Open in browser:** [http://localhost:3069](http://localhost:3069)

> **Note:** The docker-compose.yml works without a `.env` file for quick testing, but you'll need to set `SERVER_TOKEN` and `STEAM_API_KEY` (via `.env` or environment variables) for full functionality. You can also configure these in **Settings** after first login.

---

## Install from repository

If you prefer to clone and use the project’s compose files:

```bash
git clone https://github.com/sivert-io/matchzy-auto-tournament.git
cd matchzy-auto-tournament

# Optional: create .env for SERVER_TOKEN, FRONTEND_BASE_URL, etc.
cp example.env .env

# Start (uses pre-built image from Docker Hub)
docker compose -f docker/docker-compose.yml up -d

# Open browser
open http://localhost:3069
```

To build from source instead:

```bash
docker compose -f docker/docker-compose.local.yml up -d --build
```

---

## Configure Webhook URL

1. Go to **Settings** → **Webhook URL**
2. Enter your public URL (e.g. `https://tournaments.example.com`)
3. CS2 servers use this to send match events to the platform

> **Local / same machine?** Use `http://your-local-ip:3069` (not `localhost`) so servers can reach the app.

---

## Add CS2 Server

**Option A: Automated (recommended)**

Use the [CS2 Server Manager](https://github.com/sivert-io/cs2-server-manager) — it configures everything with one command.

**Option B: Manual**

1. Install [CounterStrikeSharp](https://docs.cssharp.dev/) on your CS2 server
2. Install [MatchZy Enhanced v1.3.0+](https://github.com/sivert-io/matchzy-Enhanced/releases)
3. In `server.cfg` set:
   ```
   rcon_password "your-secure-password"
   hostport 27015
   ```
4. In the platform: **Servers** → **Add Server** → enter Name, Host, Port, RCON password → **Test Connection** → **Save**

The server should show 🟢 Online.

---

## Your First Tournament

### 1. Create teams

**Servers** → **Teams** → **Create Team**

```
Name: Team Astralis
Tag: AST
Players: Add 5+ players with Steam IDs
```

Create at least 2 teams.

### 2. Create tournament

**Dashboard** → **Create Tournament**

```
Name: Weekend Cup
Type: Single Elimination (or Double, Swiss, etc.)
Format: BO3
Teams: Select your teams
Maps: Active Duty or custom pool
```

Click **Create Tournament**.

### 3. Start tournament

1. Click **Start Tournament**
2. Matches are created and wait for servers
3. Players use team pages: `https://your-url.com/team/team-name`
4. Veto runs in the browser
5. Match loads on the server
6. Bracket updates live

The system handles server allocation, match loading, veto, score updates, and bracket progression.

---

## Next steps

### For tournament admins

- [Admin Settings](../guides/admin-settings.md) — webhooks, maps, defaults
- [Creating Teams](../guides/teams.md) — bulk import, rosters
- [Running Tournaments](../guides/how-to-set-up-a-tournament.md) — advanced options
- [Troubleshooting](../guides/troubleshooting.md) — common issues

### For players

Share team pages:

```
https://your-domain.com/team/team-name
```

Players can view upcoming matches, take part in veto, get server connect info, and see live scores. No login required.

### For developers

- [Contributing](../development/contributing.md)
- [Architecture](../development/architecture.md)
- [Testing PRs](../development/testing-pr.md)
