# Getting Started

Get MatchZy Auto Tournament running using Docker.

This page is only about **running MAT itself**. After this, you’ll:

- Configure one or more CS2 servers
- Adjust basic settings
- Create your first tournament

## Prerequisites

- **Docker** and **Docker Compose** installed ([Install Docker](https://docs.docker.com/engine/install/))

## Step 1: Install the tournament platform

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

---

## Next steps

Once you can log in to the MAT dashboard, continue with these pages:

### 1. Configure your CS2 servers

- **Recommended:** use **CS2 Server Manager** – see the [CS2 Server Manager Guide](../guides/cs2-server-manager.md).
- If you already run your own servers and want to install the plugin manually, see the developer-focused [CS2 Server Setup](server-setup.md).
- After your servers are ready, add them in the MAT UI (see [Your First Tournament](first-tournament.md#add-your-first-server)).

### 2. Configure basic settings

- Go through the admin-focused [Admin Settings](../guides/admin-settings.md) guide.
- Make sure the **Webhook URL** is set correctly for your environment.

### 3. Run your first tournament

- Follow [Your First Tournament](first-tournament.md) for a detailed UI walkthrough.
- Or use the shorter admin guide [How to set up a tournament](../guides/how-to-set-up-a-tournament.md).

---

## Updating

To update to the latest version:

```bash
docker compose pull
docker compose up -d
```

Your data (teams, tournaments, matches) is stored in PostgreSQL and persists across updates.

## Need help?

- **If something fails during install:** See the [Troubleshooting Guide](../guides/troubleshooting.md)
- **Manual/advanced server setup:** [CS2 Server Setup](server-setup.md)
- **Local development:** [Development Guide](../development/contributing.md)
