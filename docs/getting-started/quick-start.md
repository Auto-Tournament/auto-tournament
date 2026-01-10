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
      # Token used by CS2 servers to authenticate webhooks
      - SERVER_TOKEN=your-server-token-here

      # Auth providers – at least Steam is recommended
      # Steam (players + admins)
      - AUTH_STEAM_ENABLED=true
      # Get this from https://steamcommunity.com/dev/apikey
      - STEAM_API_KEY=your-steam-web-api-key
      # Public base URL of MAT (used for login redirects)
      - FRONTEND_BASE_URL=http://localhost:3069

      # Optional: Keycloak SSO
      # - AUTH_KEYCLOAK_ENABLED=true
      # - KEYCLOAK_ISSUER_URL=https://sso.example.com/realms/matchzy
      # - KEYCLOAK_CLIENT_ID=matchzy-dashboard
      # - KEYCLOAK_CLIENT_SECRET=your-keycloak-secret
      #   # In your Keycloak client, set Redirect URI to:
      #   #   FRONTEND_BASE_URL + /api/auth/keycloak/callback

      # Optional: Discord SSO
      # - AUTH_DISCORD_ENABLED=true
      # - DISCORD_CLIENT_ID=your-discord-client-id
      # - DISCORD_CLIENT_SECRET=your-discord-secret
      #   # In your Discord app, set Redirect URL to:
      #   #   FRONTEND_BASE_URL + /api/auth/discord/callback

      # Optional: GitHub SSO
      # - AUTH_GITHUB_ENABLED=true
      # - GITHUB_CLIENT_ID=your-github-client-id
      # - GITHUB_CLIENT_SECRET=your-github-secret
      #   # In your GitHub OAuth app, set Authorization callback URL to:
      #   #   FRONTEND_BASE_URL + /api/auth/github/callback

      # Database connection
      - DATABASE_URL=postgresql://postgres:postgres@postgres:5432/matchzy_tournament
    volumes:
      - ./data:/app/data

volumes:
  postgres-data:
```

**2. Get a Steam Web API key (for login):**

To enable “Sign in with Steam” as your primary login:

1. Go to `https://steamcommunity.com/dev/apikey` and request a Web API key.
2. Copy the key and paste it into the `STEAM_API_KEY` line in your `docker-compose.yml`.
3. Leave `AUTH_STEAM_ENABLED=true` and `FRONTEND_BASE_URL=http://localhost:3069` for local testing.

If you also want Keycloak, Discord, or GitHub SSO, fill in the optional auth variables
in the `environment:` block above.

**3. Start the platform:**

```bash
docker compose up -d
```

**4. Access the dashboard:**

Open `http://localhost:3069` in your browser.

**5. Login:**

You'll see the login form in the center of the screen. Click **Sign in with Steam**  
(or another configured provider like Keycloak/Discord/GitHub if you enabled them).
The **first Steam user** to sign in is automatically granted admin rights; additional
admins can be managed later in the UI/DB.

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
