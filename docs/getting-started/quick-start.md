# Quick Start

Get up and running in 5 minutes.

## Prerequisites

- CS2 dedicated server(s) with MatchZy plugin
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
docker-compose up -d --build
```

**Access:** `http://localhost:3069` (development) or `https://your-domain.com` (production)

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
WEBHOOK_URL=http://192.168.1.100:3000  # Your API server IP

# Optional
STEAM_API_KEY=<your-steam-key>     # For vanity URL resolution
PORT=3000                          # API port (default: 3000)
```

### Token Explanation

- **API_TOKEN**: Used to login to admin panel
- **SERVER_TOKEN**: CS2 servers use this to authenticate webhooks
- **WEBHOOK_URL**: Where CS2 servers send events (your API server)

## CS2 Server Setup

### Install MatchZy (Modified Version)

> ⚠️ **Note:** This project uses a modified version of [MatchZy](https://github.com/shobhit-pathak/MatchZy) to send additional granular match and player data to the API.

Use the forked version instead of the standard release:

```bash
git clone https://github.com/sivert-io/matchzy.git
cd matchzy
dotnet build
```

Refer to the official [MatchZy Developer Documentation](https://shobhit-pathak.github.io/MatchZy/developers/) for detailed build and setup instructions.

After building, copy the compiled plugin to your CS2 server:

```
csgo/addons/counterstrikesharp/plugins/MatchZy/
```

A pull request will be submitted upstream once this fork’s extended event system is finalized.

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
- Use reverse proxy (Caddy/Nginx) with SSL
- Update `WEBHOOK_URL` to public address
- Port forward 3069 (or proxy port)

**Recommended:** Run on private network, expose via reverse proxy if needed.

## Troubleshooting

**Can't login:**
- Verify API_TOKEN in `.env` matches what you're entering
- Restart API after changing `.env`

**Server shows offline:**
- Check RCON password is correct
- Verify server is running
- Test from API server: `nc -zv server-ip 27015`

**Events not arriving:**
- Check CS2 can reach API: `curl http://api-ip:3000/api/events/test`
- Verify WEBHOOK_URL in `.env` is correct
- Check firewall allows port 3000

More help: **[Troubleshooting Guide](../guides/troubleshooting.md)**
