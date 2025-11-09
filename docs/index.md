# MatchZy Auto Tournament

**Automated CS2 tournament management** - one click from match creation to final scores.

## What Is This?

A complete tournament system for Counter-Strike 2 using the MatchZy plugin. Handles everything:

- Create tournaments (Single/Double Elimination, Round Robin, Swiss)
- Manage teams and players
- Interactive map veto system (BO1/BO3/BO5)
- Automatic server allocation and match loading
- Real-time match tracking and live scores
- Player connection monitoring
- Admin match controls (pause, restore, broadcast, etc.)
- Automatic bracket progression
- Demo file management
- Public team pages (no auth needed)

## Key Features

### 🎮 **Fully Automated**

- Add teams and servers
- Generate bracket
- Click "Start Tournament"
- System handles the rest

### 🗺️ **Professional Map Veto**

- FaceIT-style pick/ban system
- Turn-based security
- Real-time updates
- Side selection

### 📊 **Real-Time Everything**

- Live scores via WebSocket
- Player connection tracking
- Match phase monitoring
- Instant bracket updates

### 🎯 **Admin Controls**

- Pause/unpause matches
- Restore round backups
- Add backup players mid-match
- Broadcast messages
- Full RCON integration

### 👥 **Team Pages**

- Public pages for each team
- No authentication needed
- Participate in veto
- Monitor matches
- See server IPs

## How It Works

**The Flow:**

1. **Admin Creates Tournament** → Select teams, format, map pool
2. **Teams Start Veto** → Interactive map ban/pick process
3. **Server Auto-Allocated** → System finds available server
4. **Match Loads** → Config generated and sent to server
5. **Players Connect** → Teams join and ready up
6. **Match Goes Live** → Automatic start when all ready
7. **Winner Auto-Advanced** → Bracket updates in real-time
8. **Next Match Ready** → Process repeats

### The Magic

1. **MatchZy webhook** sends events to API (player connects, round ends, etc.)
2. **API processes** events and updates database
3. **WebSocket broadcasts** to all connected clients
4. **Frontend updates** in real-time (no refresh!)

## Quick Start

### With Docker (Recommended)

```bash
git clone https://github.com/sivert-io/matchzy-auto-tournament.git
cd matchzy-auto-tournament
cp .env.example .env
# Edit .env with your tokens
docker-compose up -d --build
```

**Access at:** `http://localhost:3069` (or your domain without port in production)

### Without Docker

```bash
npm install
cp .env.example .env
# Edit .env
npm run dev
```

**Frontend:** `http://localhost:5173`  
**API:** `http://localhost:3000`  
**API Docs:** `http://localhost:3000/api-docs`

## Requirements

- **CS2 servers** with MatchZy plugin
- **Node.js 18+** or Bun
- **Docker** (for production)

Recommended: Run on private network, expose via reverse proxy.

## Configuration

Generate secure tokens:

```bash
openssl rand -hex 32
```

Required in `.env`:

```bash
API_TOKEN=your-admin-token        # Admin login
SERVER_TOKEN=your-server-token    # CS2 ↔ API auth
WEBHOOK_URL=http://your-ip:3000   # Where CS2 sends events
```

Optional:

```bash
STEAM_API_KEY=your-key            # For vanity URLs
PORT=3000                         # API port
```

## First Tournament

1. **Add Servers** (Admin Tools → Servers)
   - CS2 IP, port, RCON password
2. **Add Teams** (Teams → Create Team)
   - Team name, players with Steam IDs
3. **Create Tournament** (Tournaments → Create)
   - Type, format, teams, map pool
4. **Generate Bracket**
5. **Start Tournament**
6. System takes over! ✨

## Documentation

- **[Quick Start](getting-started/quick-start.md)** - Setup guide
- **[First Tournament](getting-started/first-tournament.md)** - Step-by-step
- **[Features](features/overview.md)** - What it can do
- **[Running Matches](guides/running-matches.md)** - Admin operations
- **[Troubleshooting](guides/troubleshooting.md)** - Common issues

## Tech Stack

**Backend:** TypeScript • Express • SQLite • Socket.IO • RCON  
**Frontend:** React • Material UI • Vite  
**Bracket System:** Extensible generator pattern with `brackets-manager.js`  
**Deploy:** Docker • Caddy

**For Developers:**

- **[Architecture](development/architecture.md)** - System design and patterns
- **[Contributing](development/contributing.md)** - How to contribute

## Support

- **Issues:** [GitHub Issues](https://github.com/sivert-io/matchzy-auto-tournament/issues)
- **Discussions:** [GitHub Discussions](https://github.com/sivert-io/matchzy-auto-tournament/discussions)

## License

MIT License - Made with ❤️ for the CS2 community
