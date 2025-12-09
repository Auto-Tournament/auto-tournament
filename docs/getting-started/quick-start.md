# Quick Start

Get MatchZy Auto Tournament running in minutes using Docker.

## Prerequisites

- **Docker** and **Docker Compose** installed ([Install Docker](https://docs.docker.com/engine/install/))
- **CS2 Server(s)** with the [enhanced MatchZy plugin](https://me.sivert.io) (setup instructions below)

## Step 1: Install the Tournament Platform

**1. Create a directory and the Docker Compose file:**

```bash
mkdir matchzy-tournament
cd matchzy-tournament
```

Create `docker-compose.yml` with this content:

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
      # This is your password to sign in to the admin panel
      - API_TOKEN=your-admin-password-here
      # This token is used by CS2 servers to authenticate webhooks (should be different from API_TOKEN)
      - SERVER_TOKEN=your-server-token-here
      - DATABASE_URL=postgresql://postgres:postgres@postgres:5432/matchzy_tournament
    volumes:
      - ./data:/app/data

volumes:
  postgres-data:
```

**2. Edit the tokens in `docker-compose.yml`:**

Open `docker-compose.yml` and replace:

- `your-admin-password-here` with a simple password you'll use to login (e.g., `mypassword123`)
- `your-server-token-here` with a different token for CS2 servers (e.g., `server-token-456`)

These don't need to be super secure—just something you can remember.

**3. Start the platform:**

```bash
docker compose up -d
```

**4. Access the dashboard:**

Open `http://localhost:3069` in your browser.

**5. Login:**

You'll see the login form in the center of the screen. Enter the password you set for `API_TOKEN` in the `docker-compose.yml` file.

That's it! The tournament platform is now running. 🎉

## Step 2: Set Up CS2 Servers

You need at least one CS2 server with the [enhanced MatchZy plugin](https://me.sivert.io) installed.

### CS2 Server Manager (Recommended) ⭐

The easiest way to set up CS2 servers. One command installs everything:

**Quick install (interactive):**

```bash
wget https://raw.githubusercontent.com/sivert-io/cs2-server-manager/master/install.sh
bash install.sh
```

**Auto-install (non-interactive, installs 5 servers):**

```bash
wget https://raw.githubusercontent.com/sivert-io/cs2-server-manager/master/install.sh
bash install.sh --auto --servers 5
```

**Customize the installation:**

Set environment variables before running the installer to customize your setup:

```bash
# Set number of servers (default: 3, max: 5)
export NUM_SERVERS=5

# Set RCON password (default: ntlan2025)
export RCON_PASSWORD=my-secure-password

# Run the installer
wget https://raw.githubusercontent.com/sivert-io/cs2-server-manager/master/install.sh
bash install.sh --auto --servers $NUM_SERVERS
```

**Available options:**

- `NUM_SERVERS` - Number of servers to install (3-5, default: 3)
- `RCON_PASSWORD` - RCON password for all servers (default: `ntlan2025`)

That's it! The installer will:

- Download and install SteamCMD
- Set up CounterStrikeSharp + Metamod:Source
- Install the MatchZy enhanced fork
- Configure servers with auto-updates
- Start all servers automatically

**Add servers to the tournament platform:**

- Go to **Servers** in the dashboard
- Click **"Add Server"**
- Enter server IP, RCON port, and RCON password (default: `ntlan2025`)

See the [CS2 Server Manager Guide](../guides/cs2-server-manager.md) for detailed instructions and management commands.

??? example "Manual Server Setup (Advanced)"

    If you already have CS2 servers, install the [enhanced MatchZy plugin](https://me.sivert.io) manually.

    See the [CS2 Server Setup Guide](server-setup.md) for step-by-step instructions.

## Step 3: Configure Settings

1. Go to **Settings** in the dashboard
2. Set the **Webhook URL** (how your CS2 servers reach the API):
   - **Local/LAN:** `http://your-server-ip:3069` (e.g., `http://192.168.1.50:3069`)
   - **Public:** `https://your-domain.com`
3. Enter your **Steam Web API Key** (get one from [Steam](https://steamcommunity.com/dev/apikey))
4. (Optional but recommended) Set the **Default Player ELO** value:
   - New players created without an explicit ELO (Players page, Teams page, imports) will use this value
   - Default is **3000** (FaceIT-style) and is used by the rating system and shuffle tournaments
5. Click **"Save Settings"**

## Step 4: Create Your First Tournament

1. **Add Teams:**

   - Go to **Teams** → **"Create Team"**
   - Enter team name, tag, and add at least 5 players (Steam IDs)

2. **Create Tournament:**

   - Go to **Tournaments** → **"Create Tournament"**
   - Choose format (Single/Double Elimination, Round Robin, Swiss)
   - Select teams and configure match settings

3. **Start Matches:**
   - Matches will automatically start when servers are available
   - Teams can access their match pages via the public links

👉 **Need more help?** See the [First Tournament Guide](first-tournament.md) for detailed steps.

## Updating

To update to the latest version:

```bash
docker compose pull
docker compose up -d
```

Your data (teams, tournaments, matches) is stored in PostgreSQL and persists across updates.

## Need Help?

- **Troubleshooting:** See the [Troubleshooting Guide](../guides/troubleshooting.md)
- **Advanced Setup:** See the [CS2 Server Setup Guide](server-setup.md) for manual installation
- **Development:** See the [Development Guide](../development/contributing.md) for local development setup
