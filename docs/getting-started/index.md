# Getting Started

## Installation

### 1. Install Platform

```bash
# Clone repository
git clone https://github.com/sivert-io/matchzy-auto-tournament.git
cd matchzy-auto-tournament

# Create environment file
cp example.env .env

# Start platform
docker compose up -d

# Open browser
open http://localhost:3069
```

That's it! Platform is running.

### 2. Configure Webhook URL

1. Go to **Settings** → **Webhook URL**
2. Enter your public URL (e.g., `https://tournaments.example.com`)
3. This lets CS2 servers send match events back to the platform

> **Local development?** Use `http://your-local-ip:3069` (not `localhost`)

### 3. Add CS2 Server

**Option A: Automated (Recommended)**

Use the [CS2 Server Manager](https://github.com/sivert-io/cs2-server-manager) - it sets up everything with one command.

**Option B: Manual**

1. Install [CounterStrikeSharp](https://docs.cssharp.dev/) on your CS2 server
2. Install [MatchZy Enhanced v1.3.0+](https://github.com/sivert-io/matchzy-Enhanced/releases)
3. Set RCON password in `server.cfg`:
   ```
   rcon_password "your-secure-password"
   hostport 27015
   ```
4. Add server in platform:
   - **Servers** → **Add Server**
   - Enter: Name, Host, Port, RCON Password
   - Click **Test Connection** → **Save**

Server should show 🟢 Online.

---

## Your First Tournament

### 1. Create Teams

**Servers** → **Teams** → **Create Team**

```
Name: Team Astralis
Tag: AST
Players: Add 5+ players with Steam IDs
```

Repeat for at least 2 teams.

### 2. Create Tournament

**Dashboard** → **Create Tournament**

```
Name: Weekend Cup
Type: Single Elimination (or Double, Swiss, etc.)
Format: BO3
Teams: Select your teams
Maps: Use Active Duty or create custom pool
```

Click **Create Tournament**.

### 3. Start Tournament

1. Click **Start Tournament** button
2. Matches auto-create and wait for servers
3. Players join via team pages: `https://your-url.com/team/team-name`
4. Veto happens in browser
5. Match auto-loads on server
6. Bracket updates live

**That's it!** The system handles:
- Server allocation
- Match loading
- Veto process
- Score updates
- Bracket progression

---

## Next Steps

### For Tournament Admins

- [Admin Settings](../guides/admin-settings.md) - Configure webhooks, maps, defaults
- [Creating Teams](../guides/teams.md) - Bulk import, managing rosters
- [Running Tournaments](../guides/how-to-set-up-a-tournament.md) - Advanced options
- [Troubleshooting](../guides/troubleshooting.md) - Common issues

### For Players

Share team pages with your players:
```
https://your-domain.com/team/team-name
```

They can:
- See upcoming matches
- Participate in veto
- Get server connect info
- View live scores

No login required!

### For Developers

- [Contributing Guide](../.github/CONTRIBUTING.md)
- [Architecture](../development/architecture.md)
- [Testing](../development/testing-pr.md)
