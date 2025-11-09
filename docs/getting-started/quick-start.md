# Quick Start

Get up and running in 5 minutes.

## Prerequisites

- CS2 dedicated server(s) with [modified MatchZy plugin](https://github.com/sivert-io/matchzy/releases)
- Node.js 18+ or Docker
- RCON access to your servers

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

# Start everything
docker compose up -d --build
```

**Access:** `http://localhost:3069` (development) or `https://your-domain.com` (production)

!!! info "Docker Architecture"
The Docker setup uses **Caddy** as a reverse proxy that serves:

    - Frontend app at `/` (root)
    - API at `/api`

    **Everything runs on port 3069** — just proxy/expose this single port for production deployments.

### Local Development

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

# Docker: Use port 3069 with /api path (Caddy routes it internally)
WEBHOOK_URL=http://192.168.1.100:3069/api

# Local dev: Use port 3000 directly (no Caddy)
# WEBHOOK_URL=http://192.168.1.100:3000

# Optional
STEAM_API_KEY=<your-steam-key>     # For vanity URL resolution
PORT=3000                          # API port (default: 3000)
```

### Token Explanation

- **API_TOKEN**: Used to login to admin panel
- **SERVER_TOKEN**: CS2 servers use this to authenticate webhooks
- **WEBHOOK_URL**: Where CS2 servers send events
  - Docker: `http://your-ip:3069/api` (Caddy handles routing)
  - Local dev: `http://your-ip:3000` (direct to API)

## CS2 Server Setup

### Prerequisites

**Install CounterStrikeSharp:**

1. Download [CounterStrikeSharp with runtime](https://github.com/roflmuffin/CounterStrikeSharp/releases)
2. Extract to your CS2 server's `csgo/` directory
3. Verify by typing `meta list` in server console

📖 [CounterStrikeSharp Installation Guide](https://docs.cssharp.dev/guides/getting-started/)

### Install MatchZy (Modified Version)

> ⚠️ **Important:** This project uses a modified version of [MatchZy](https://github.com/shobhit-pathak/MatchZy) with enhanced event tracking for tournament automation.

**Download:** [github.com/sivert-io/matchzy/releases](https://github.com/sivert-io/matchzy/releases)

**Installation:**

```bash
# Navigate to your CS2 server directory
cd /path/to/cs2/game/csgo

# Extract the plugin (it includes the correct folder structure)
unzip MatchZy-*.zip

# Restart your CS2 server
```

**Verify installation:**

Type `css_plugins list` in server console. You should see **MatchZy by WD-** listed.

**Expected structure:**

```
csgo/
└── addons/
    └── counterstrikesharp/
        └── plugins/
            └── MatchZy/
                ├── MatchZy.dll
                └── ...
```

The plugin zip file already contains the full `addons/counterstrikesharp/plugins/MatchZy/` structure, so extracting to `csgo/` puts everything in the right place.

### Enable RCON

```cfg
rcon_password "your-secure-rcon-password"
hostport 27015
```

That's it! The system auto-configures webhooks when you load matches.

## First Login

1. Navigate to `http://localhost:3069` (or your domain)
2. Click **"Login"** (top right)
3. Enter your `API_TOKEN`
4. You're in! 🎉

## Add Your First Server

1. Go to **Admin Tools** → **Servers**
2. Click **"Add Server"**
3. Fill in:
   ```
   Name: My Server 1
   Host: 192.168.1.50
   Port: 27015
   RCON Password: <your-rcon-password>
   ```
4. Click **"Test Connection"** (optional)
5. Click **"Add Server"**

Server should show as 🟢 Online.

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

You're ready to create your first tournament!

👉 **[First Tournament Guide](first-tournament.md)** - Step-by-step tournament setup

## Network Notes

**Private Network (LAN):**

- Everything on `192.168.x.x` - works out of the box
- Share team pages with local IPs

**Public Internet:**

- Get a domain or use public IP
- **Docker:** Expose/proxy port **3069** only - Caddy serves both app and API
  - `WEBHOOK_URL=https://your-domain.com/api`
- **Local dev:** Expose port **3000** for API, **5173** for frontend
  - `WEBHOOK_URL=http://your-ip:3000`

**Recommended:** Run on private network, expose via reverse proxy if needed.

!!! tip "Docker = Single Port"
With Docker, CS2 servers hit `your-domain.com/api/events/...` (port 3069).  
 Caddy routes `/api` internally - no need to expose port 3000!

## Troubleshooting

**Can't login:**

- Verify API_TOKEN in `.env` matches what you're entering
- Restart API after changing `.env`

**Server shows offline:**

- Check RCON password is correct in `.env`
- Verify CS2 server is running
- Test RCON connectivity from your API server:
  ```bash
  # Replace with your CS2 server's IP and RCON port
  nc -zv 192.168.1.100 27015
  ```
  Should show "succeeded" if connection works

**Events not arriving:**

- Test CS2 server can reach API (run this from your CS2 server):

  ```bash
  # Docker: Test via Caddy
  curl http://192.168.1.50:3069/api/events/test

  # Local dev: Test direct API
  curl http://192.168.1.50:3000/api/events/test
  ```

  Should return `{"message":"Test received"}`

- Verify `WEBHOOK_URL` in `.env` matches your setup:
  - Docker: `http://your-ip:3069/api` or `https://your-domain.com/api`
  - Local dev: `http://your-ip:3000`
- Check firewall allows inbound on port **3069** (Docker) or **3000** (local dev)

More help: **[Troubleshooting Guide](../guides/troubleshooting.md)**
