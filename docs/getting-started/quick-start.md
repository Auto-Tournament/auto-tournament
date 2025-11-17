# Quick Start

Get up and running in 5 minutes.

## Choose Your Setup Path

### Option A — CS2 Server Manager (recommended)

If you just want working CS2 servers with the right plugins, use the automated **[CS2 Server Manager](../guides/cs2-server-manager.md)**. It installs SteamCMD, CounterStrikeSharp, the MatchZy enhanced fork, and CS2-AutoUpdater, then keeps everything patched with `manage.sh`.

- Best for LAN hosts or new admins.
- Deploy 3–5 servers, all preconfigured for MatchZy Auto Tournament.
- Overrides (`overrides/game/csgo/`) survive updates.

### Option B — Manual install (advanced users)

- CS2 dedicated server(s) with [modified MatchZy](https://github.com/sivert-io/matchzy/releases)
- Node.js 18+ or Docker
- RCON access to each server
- Follow the [CS2 Server Setup Guide](server-setup.md) if you’re provisioning by hand.

## Installation

### Docker (Recommended - No cloning needed)

**1. Create `docker-compose.yml` in any directory:**

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
    # No port binding needed - DB is only accessible within Docker network
    # Uncomment if you need external access for backups/management:
    # ports:
    #   - '5432:5432'
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U ${DB_USER:-postgres}']
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
      - API_TOKEN=${API_TOKEN}
      - SERVER_TOKEN=${SERVER_TOKEN}
      - DB_TYPE=${DB_TYPE:-postgresql}
      - DATABASE_URL=postgresql://${DB_USER:-postgres}:${DB_PASSWORD:-postgres}@postgres:5432/${DB_NAME:-matchzy_tournament}
    volumes:
      - ./data:/app/data

volumes:
  postgres-data:
```

**2. Create `.env` file in the same directory:**

```bash
# Generate tokens
openssl rand -hex 32  # Copy for API_TOKEN
openssl rand -hex 32  # Copy for SERVER_TOKEN
```

```bash
API_TOKEN=<your-api-token>
SERVER_TOKEN=<your-server-token>
DB_USER=postgres
DB_PASSWORD=postgres
DB_NAME=matchzy_tournament
```

**3. Start:**

```bash
docker compose up -d
```

**Access:** `http://localhost:3069` (or `https://your-domain.com` in production)

??? example "Build from Source (Optional)"

    If you've cloned the repository and want to build from source:

    ```bash
    git clone https://github.com/sivert-io/matchzy-auto-tournament.git
    cd matchzy-auto-tournament
    cp .env.example .env
    # Edit .env with your tokens
    docker compose -f docker/docker-compose.local.yml up -d --build
    ```

**Database:**

- **PostgreSQL is required** for all setups (Docker and local development)
- For local development, use the convenient Yarn command:
  ```bash
  yarn db           # Start PostgreSQL container
  yarn db:stop      # Stop PostgreSQL container
  yarn db:restart   # Restart PostgreSQL container
  ```
  Or run PostgreSQL manually with Docker:
  ```bash
  docker run -d --name matchzy-postgres \
    -e POSTGRES_USER=postgres \
    -e POSTGRES_PASSWORD=postgres \
    -e POSTGRES_DB=matchzy_tournament \
    -p 5432:5432 \
    postgres:16-alpine
  ```
- The database schema is automatically initialized on first startup

??? info "Advanced: Docker Architecture"

    The Docker setup uses Caddy as a reverse proxy that serves:

    - Frontend app at `/` (root)
    - API at `/api`

    **Everything runs on port 3069** — just proxy/expose this single port for production deployments.

    **Multi-Architecture Support:**

    The Docker image automatically detects and supports multiple architectures:
    - `amd64` / `x86_64` (Intel/AMD 64-bit)
    - `arm64` / `aarch64` (ARM 64-bit, e.g., Apple Silicon, Raspberry Pi 4+)
    - `armv7` / `armv6` (ARM 32-bit, e.g., older Raspberry Pi)

    The build process automatically downloads the correct Caddy binary for your platform.

??? info "Docker Compose Files"

    The repository includes two compose files:

    - **`docker/docker-compose.yml`**: Uses pre-built image from Docker Hub (no cloning needed)
    - **`docker/docker-compose.local.yml`**: Builds from source (requires cloned repository)

    **Database:**
    - **PostgreSQL is required** for all setups (Docker and local development)
    - **Docker (both compose files)**: PostgreSQL service included. Data persists in the `postgres-data` volume.
    - **Local development (without Docker)**: PostgreSQL required. Use `yarn db` to start PostgreSQL, or run manually:
      ```bash
      docker run -d --name matchzy-postgres \
        -e POSTGRES_USER=postgres \
        -e POSTGRES_PASSWORD=postgres \
        -e POSTGRES_DB=matchzy_tournament \
        -p 5432:5432 \
        postgres:16-alpine
      ```
      Then configure your `.env` file with the connection details.

    After startup, configure the webhook URL and Steam API key from the **Settings** page in the dashboard.

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

    **Database:** PostgreSQL is required. Use `yarn db` to start PostgreSQL, or run manually:
    ```bash
    docker run -d --name matchzy-postgres \
      -e POSTGRES_USER=postgres \
      -e POSTGRES_PASSWORD=postgres \
      -e POSTGRES_DB=matchzy_tournament \
      -p 5432:5432 \
      postgres:16-alpine
    ```
    Then configure your `.env` file with `DB_HOST=localhost`, `DB_PORT=5432`, `DB_USER=postgres`, `DB_PASSWORD=postgres`, and `DB_NAME=matchzy_tournament`.

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

# Database Configuration (PostgreSQL required)
# For local development, use: yarn db
# Or run manually: docker run -d --name matchzy-postgres -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=matchzy_tournament -p 5432:5432 postgres:16-alpine
DB_TYPE=postgresql                 # Database type: postgresql (required)
DB_HOST=localhost                  # PostgreSQL host (use 'postgres' for Docker Compose, 'localhost' for local dev)
DB_PORT=5432                       # PostgreSQL port
DB_USER=postgres                   # PostgreSQL username
DB_PASSWORD=postgres               # PostgreSQL password
DB_NAME=matchzy_tournament         # PostgreSQL database name
# DATABASE_URL can be used instead of individual DB_* vars
# DATABASE_URL=postgresql://postgres:postgres@localhost:5432/matchzy_tournament

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

👉 **Prefer automation?** Skip manual installs and use the **[CS2 Server Manager](../guides/cs2-server-manager.md)** to provision everything in minutes.

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
