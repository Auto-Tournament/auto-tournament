# Quick Start

Get up and running in 5 minutes.

## Prerequisites

- CS2 dedicated server(s) with [modified MatchZy plugin](https://github.com/sivert-io/matchzy/releases)
- Node.js 18+ or Docker
- RCON access to your servers

> **New to CS2 server setup?** See the [CS2 Server Setup Guide](server-setup.md) for detailed installation instructions.

## Installation

### Docker (Recommended)

```bash
# Clone repository
git clone https://github.com/sivert-io/matchzy-auto-tournament.git
cd matchzy-auto-tournament

# Setup environment
cp .env.example .env

# Edit .env with your tokens (see below)
nano .env

# Start everything (pulls from Docker Hub)
docker compose -f docker/docker-compose.yml up -d

# OR build locally from source
# docker compose -f docker/docker-compose.dev.yml up -d --build
```

**Access:** `http://localhost:3069` (development) or `https://your-domain.com` (production)

??? info "Advanced: Docker Architecture"

    The Docker setup uses Caddy as a reverse proxy that serves:

    - Frontend app at `/` (root)
    - API at `/api`

    **Everything runs on port 3069** — just proxy/expose this single port for production deployments.

??? example "Using Docker Compose"

    Create a `docker-compose.yml` file:

    ```yaml
    version: '3.8'

    services:
      matchzy-tournament:
        image: sivertio/matchzy-auto-tournament:latest
        container_name: matchzy-tournament-api
        restart: unless-stopped
        ports:
          - '3069:3069'
        environment:
          - API_TOKEN=${API_TOKEN}
          - SERVER_TOKEN=${SERVER_TOKEN}
        volumes:
          - ./data:/app/data
    ```

    After startup, configure the webhook URL and Steam API key from the **Settings** page in the dashboard.

    Then run:
    ```bash
    docker compose up -d
    ```

??? example "Advanced: Local Development (without Docker)"

    ```bash
    # Install dependencies
    npm install

    # Setup environment
    cp .env.example .env

    # Edit .env
    nano .env

    # Start in dev mode
    npm run dev
    ```

    **Frontend:** `http://localhost:5173`
    **API:** `http://localhost:3000`

## Environment Setup

Generate secure tokens:

```bash
openssl rand -hex 32
```

Edit `.env`:

```bash
# Required
API_TOKEN=<token-from-above>       # Admin authentication
SERVER_TOKEN=<different-token>     # CS2 server authentication

PORT=3000                          # API port (default: 3000)
```

??? info "What do these tokens do?"

    - **API_TOKEN**: Used to login to admin panel
    - **SERVER_TOKEN**: CS2 servers use this to authenticate webhooks
    - Configure the webhook URL and Steam API key from the in-app **Settings** page once the server is running.

## First Login

1. Navigate to `http://localhost:3069` (or your domain)
2. Click **"Login"** (top right)
3. Enter your `API_TOKEN`
4. You're in! 🎉

## Add Your First Team

1. Go to **Teams**
2. Click **"Create Team"**
3. Fill in:
   ```
   Team Name: Team Awesome
   Team Tag: AWE
   ```
4. Add players (minimum 5):
   ```
   Steam ID: 76561199486434142
   Name: Player1
   ```
   Repeat for all players
5. Click **"Create Team"**

Repeat for all teams (minimum 2 for a tournament).

## Next Steps

👉 **[CS2 Server Setup](server-setup.md)** - Install the modified MatchZy plugin on your CS2 server(s)

👉 **[First Tournament Guide](first-tournament.md)** - Step-by-step tournament setup

??? abstract "Advanced: Network Configuration"

    **Private Network (LAN):**

    - Everything on `192.168.x.x` - works out of the box
    - Share team pages with local IPs

    **Public Internet:**

    - Get a domain or use public IP
    - **Docker:** Expose/proxy port **3069** only - Caddy serves both app and API
      - Set the webhook base URL in **Settings** to your public domain (e.g. `https://your-domain.com`)
    - **Local dev:** Expose port **3000** for API, **5173** for frontend
      - In **Settings**, use your machine IP (e.g. `http://your-ip:3000`)

    **Recommended:** Run on private network, expose via reverse proxy if needed.

    **Single Port Architecture:**

    With Docker, CS2 servers hit `your-domain.com/api/events/...` (port 3069).
    Caddy routes `/api` internally - no need to expose port 3000!

## Troubleshooting

??? failure "Can't login?"

    - Verify API_TOKEN in `.env` matches what you're entering
    - Restart API after changing `.env`: `docker compose restart`

??? failure "Server shows offline?"

    - Check RCON password is correct in `.env`
    - Verify CS2 server is running
    - Test RCON connectivity from your API server:
        ```bash
        # Replace with your CS2 server's IP and RCON port
        nc -zv 192.168.1.100 27015
        ```
        Should show "succeeded" if connection works

??? failure "Events not arriving?"

    - Test CS2 server can reach API (run this from your CS2 server):
        ```bash
        # Docker: Test via Caddy
        curl http://192.168.1.50:3069/api/events/test

        # Local dev: Test direct API
        curl http://192.168.1.50:3000/api/events/test
        ```
        Should return `{"message":"Test received"}`
    - Verify the webhook URL in **Settings → Webhook URL** matches how your CS2 servers reach the API
    - Check firewall allows inbound on port **3069** (Docker) or **3000** (local dev)

**Need more help?** See the **[Troubleshooting Guide](../guides/troubleshooting.md)**
