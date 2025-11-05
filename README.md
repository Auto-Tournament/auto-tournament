<div align="center">
  <img src="client/public/icon.svg" alt="MatchZy Auto Tournament" width="140" height="140">
  
  # MatchZy Auto Tournament
  
  ⚡ **Automated tournament management API for CS2 MatchZy — one click from match creation to final scores**
  
  <p>Stop manually configuring servers. Load matches, track events, and manage entire tournaments through one API. Built for MatchZy plugin.</p>
</div>

---

## 📚 Documentation

**Full documentation:** https://sivert-io.github.io/matchzy-auto-tournament/

Quick links:
- [Quick Start](https://sivert-io.github.io/matchzy-auto-tournament/getting-started/quick-start/) - Get running in 5 minutes
- [First Tournament](https://sivert-io.github.io/matchzy-auto-tournament/getting-started/first-tournament/) - Complete walkthrough
- [Features](https://sivert-io.github.io/matchzy-auto-tournament/features/overview/) - What it can do
- [Troubleshooting](https://sivert-io.github.io/matchzy-auto-tournament/guides/troubleshooting/) - Common issues

---

## ✨ What It Does

### Tournament Management
- 🏆 **Automated Brackets** — Single Elimination, Double Elimination, Round Robin, Swiss
  - Powered by [brackets-manager.js](https://github.com/Drarig29/brackets-manager.js) for robust bracket generation
- 🎯 **Smart Walkovers** — Automatic bye handling and bracket progression for any team count
- 🚀 **Intelligent Tournament Start** — Veto-based formats (BO1/BO3/BO5) wait for map selection, Round Robin/Swiss load immediately
- 🛡️ **Live Tournament Protection** — Prevent accidental bracket resets during play
- 📊 **Guided Onboarding** — Step-by-step checklist for first-time setup
- 🔄 **Auto Bracket Regeneration** — Missing brackets auto-regenerate on tournament start

### Map Veto System (BO1/BO3/BO5)
- 🗺️ **Interactive Veto Interface** — Teams ban/pick maps in professional CS format (FaceIT-style)
- 🔐 **Turn-Based Security** — Teams can only act on their turn, UI disables when waiting
- 🎨 **Visual Map Cards** — CS2 map pool with images, hover effects, banned/picked states
- ⚡ **Real-time Sync** — WebSocket updates between teams during veto
- 🔪 **Side Selection** — Teams pick starting side (CT/T) for each map
- 📋 **Veto Timeline** — Shows complete ban/pick history with team names
- 🎯 **Format-Specific Logic** — Different veto flows for BO1 (6 bans), BO3 (2 bans, 2 picks), BO5 (2 bans, 4 picks)
- 🚫 **Tournament Gate** — Veto only available after tournament starts (prevents premature configuration)

### Server & Match Management
- 🖥️ **Server Fleet Management** — Add/remove CS2 servers with live RCON status checking
- 🔄 **Smart Webhook Configuration** — Match-specific webhook URLs (`/api/events/{match-slug}`) for precise tracking
- 📡 **Comprehensive Event Processing** — 25+ MatchZy events processed in real-time
  - Player lifecycle (connect, disconnect, ready, unready)
  - Match phases (warmup, knife, halftime, overtime)
  - Pause system (paused, unpause requested, resumed)
  - Round events (started, ended, MVP, scores)
  - In-game events (bomb planted/defused/exploded, deaths)
- 🎬 **Demo Recording** — Automatic demo upload with streaming, match-specific folders
- 👥 **Player Roster Display** — Shows all 10 players with live connection and ready status
- 🔒 **Secure RCON** — Token-protected server commands with 30+ whitelisted actions
- 🎮 **Match Loading** — Auto-generates configs with veto results, allocates servers, configures webhooks
- 🛡️ **Whitelist Protection** — `get5_check_auths` prevents unauthorized players from joining

### Team Experience
- 🎮 **Public Team Pages** — No-login team portals with match info and server connection
- 🔊 **Sound Notifications** — Customizable alerts when matches are ready (8 sounds, volume control, mute)
- 📈 **Performance Stats** — Win/loss records, win rate, tournament standings
- 📜 **Match History** — View past matches with scores and opponents
- 🔗 **Easy Sharing** — Copy team links from admin dashboard or bracket view
- 🗺️ **Team Veto Interface** — Teams complete map veto directly from their page
- ⏳ **Tournament Status Awareness** — Clear messaging about tournament state (setup vs started)

### Admin & Monitoring
- 🐛 **Server Event Monitor** — Live unfiltered WebSocket view of all MatchZy events from all servers (100 event buffer)
- 📝 **Event File Logging** — All webhook events logged to files with 30-day retention
- 🎮 **Advanced Match Controls** — 
  - Start/restart/end match
  - Pause/unpause (tactical/tech)
  - Broadcast messages
  - Restore round backups
  - Add backup players (autocomplete search across all tournament players)
  - Change map, swap teams, skip veto
  - Toggle knife round, playout mode
- 🎨 **Modern Web UI** — Material Design 3 dashboard with dark mode
- 🖼️ **Interactive Bracket Visualization** — Pan/zoom, click matches for details
- 📊 **Match Status Intelligence** — 
  - "Teams voting for maps..." (during veto)
  - "Waiting for players (3/10)" (during warmup)
  - "Match in progress" (live)
- 📚 **Auto API Docs** — Interactive Swagger UI at `/api-docs`
- 🔍 **Comprehensive Logging** — Structured console logs with colored output, request/response tracking

---

## 🌟 Key Features Explained

### Tournament Flow
```
1. Create Tournament → 2. Add Teams → 3. Generate Bracket → 4. Start Tournament
                                                              ↓
   ┌──────────────────────────────────────────────────────────┘
   │
   ├─ BO1/BO3/BO5: Teams complete map veto → Match loads → Players connect
   └─ Round Robin/Swiss: Matches load immediately → Players connect
```

### Map Veto Flow (BO1/BO3/BO5 Only)
1. **Admin starts tournament** → Tournament status: `in_progress`
2. **Teams see veto interface** on their team page
3. **Alternating turns:** Team A bans → Team B bans → Team A picks → Team B picks side...
4. **Real-time updates:** Other team sees UI disabled with "Waiting for {Team} to ban a map..."
5. **Auto-load:** Once veto complete, match auto-allocates to available server
6. **Players join:** Teams receive server IP and connect

### Player Connection Tracking
- **Events processed:** `player_connect`, `player_disconnect`, `player_ready`, `player_unready`
- **Frontend displays:** Live roster showing all 10 players with connection + ready status
- **WebSocket updates:** Real-time status changes without page refresh
- **Match config whitelist:** Only players in team rosters can join (`get5_check_auths`)

### Event Processing Pipeline
```
MatchZy Plugin → HTTP POST /api/events/{match-slug} → Backend processes event
                                                      ↓
                    ┌─────────────────────────────────┴─────────────────────┐
                    ↓                                 ↓                     ↓
            Database storage              Update services          WebSocket emit
         (match_events table)        (player tracking,          (frontend receives
                                      server status)              real-time update)
```

---

## 🚀 Quick Start

**Prerequisites:**

- Node.js 18+ or Bun
- CS2 server(s) with [MatchZy plugin](https://github.com/shobhit-pathak/MatchZy) installed

**With Docker (Recommended for Production):**

```bash
cp .env.example .env
# Edit .env with your tokens
docker-compose up -d --build
```

**Access Everything at:** `http://localhost:3069`

- 🎨 **Web UI:** `http://localhost:3069/`
- 📖 **API:** `http://localhost:3069/api`
- 📚 **API Docs:** `http://localhost:3069/api-docs`

> **Note:** Docker includes Caddy as an internal reverse proxy. Frontend at `/`, API at `/api`. Single port (3069) for everything!

**Local Development:**

```bash
npm install
cp .env.example .env
# Edit .env with your tokens
npm run dev
```

📖 **API Docs:** `http://localhost:3000/api-docs`  
🎨 **Web UI:** `http://localhost:5173` (dev)

---

## ⚙️ Configuration

### Required Environment Variables

All tokens should be secure random strings. Generate them with:
```bash
openssl rand -hex 32
```

```bash
API_TOKEN=your-secure-admin-token-here
# Admin authentication for accessing the Web UI and API endpoints
# Used by: Web UI login, all authenticated API calls

SERVER_TOKEN=your-secure-server-token-here
# CS2 server authentication - validates all communication from MatchZy plugin
# Used by:
#   - MatchZy webhook events (player connections, match events, etc.)
#   - Match config loading (bearer token for matchzy_loadmatch_url)

WEBHOOK_URL=http://localhost:3000
# URL where CS2 servers send MatchZy events and fetch match configs
# Examples:
#   - Same machine:  http://localhost:3000
#   - Same network:  http://192.168.1.100:3000
#   - Production:    https://yourdomain.com
```

### Optional Environment Variables

```bash
STEAM_API_KEY=your-key               # Steam vanity URL resolution
                                     # Get free: https://steamcommunity.com/dev/apikey

PORT=3000                            # Server port (default: 3000)
NODE_ENV=production                  # Environment mode
LOG_LEVEL=info                       # Logging level (info | debug)
CORS_ORIGIN=*                        # Socket.IO CORS origin
```

See [`.env.example`](.env.example) for a complete template.

### CS2 Server Setup

**Install MatchZy on your CS2 servers:**
```bash
# Download latest MatchZy from
# https://github.com/shobhit-pathak/MatchZy/releases

# Extract to your CS2 server:
# csgo/addons/counterstrikesharp/plugins/MatchZy/
```

**Configure MatchZy to send events:**
```bash
# Add to server.cfg or via RCON:
matchzy_remote_log_url "http://your-api-url:3000/api/events"
matchzy_remote_log_header_key "X-MatchZy-Token"
matchzy_remote_log_header_value "your-server-token-here"
get5_check_auths true  # Enable whitelist
```

**Note:** The system auto-configures webhooks when you:
- Check server status in Admin Tools
- Load a match (manual or automatic)
- Start the tournament

---

## 🏗️ Architecture Overview

### How Everything Connects

```
┌─────────────────────┐
│   Admin Dashboard   │  ← Create tournament, add teams, manage matches
└──────────┬──────────┘
           │
           ↓
┌─────────────────────┐     WebSocket      ┌──────────────────┐
│    Backend API      │ ←──────────────→  │  Team Pages      │
│  (Express + SQLite) │    Real-time       │  (Public, no auth)│
└──────────┬──────────┘    Updates         └──────────────────┘
           │
           ↓
    ┌──────┴──────┐
    │             │
    ↓             ↓
┌─────────┐  ┌─────────┐
│  CS2    │  │  CS2    │  ← Game servers running MatchZy
│ Server1 │  │ Server2 │
└────┬────┘  └────┬────┘
     │            │
     └────────┬───┘
              │
      MatchZy Events (HTTP POST)
      player_connect, player_ready,
      going_live, round_end, etc.
              │
              ↓
       Backend processes
       and emits to frontend
```

### Data Flow Example: Player Connects to Match

```
1. Player joins CS2 server
        ↓
2. MatchZy: POST /api/events/r1m1
   {
     "event": "player_connect",
     "player": { "steamid": "76561...", "name": "Simpert" }
   }
        ↓
3. Backend: 
   - Extracts match slug from URL (r1m1)
   - Looks up team from match config
   - Updates playerConnectionService
   - Stores event in database
   - Emits WebSocket: match:update
        ↓
4. Frontend (all viewers):
   - Receives WebSocket event
   - Updates player roster display
   - Shows "Simpert CONNECTED" in player list
   - Updates progress: "1/10 players"
```

---

## 🛠️ Tech Stack

**Backend:** TypeScript • Express • SQLite • Socket.IO • Swagger  
**Frontend:** React • Material UI (MUI) • Vite • React Router  
**Infrastructure:** Docker • Caddy • RCON Client • Better-SQLite3  
**Bracket Engine:** [brackets-manager.js](https://github.com/Drarig29/brackets-manager.js) • brackets-memory-db

---

## 🎯 Roadmap

_Goal: Complete professional tournament automation with zero manual intervention_

### ✅ Completed
- [x] Server management with CRUD and live RCON status
- [x] Team management with Steam integration (vanity URL support)
- [x] Match loading with auto-webhook setup
- [x] Web UI with token auth and Material Design 3
- [x] Tournament brackets (Single/Double Elimination, Round Robin, Swiss)
- [x] Real-time updates via Socket.io (match, bracket, veto, tournament events)
- [x] Automatic bracket progression and walkovers
- [x] Team replacement without bracket reset
- [x] Interactive bracket visualization with pan/zoom
- [x] Automatic server allocation for matches
- [x] **Map veto system** (BO1/BO3/BO5 with FaceIT-style pick/ban)
- [x] **Comprehensive event processing** (25+ MatchZy events)
- [x] **Player connection & ready tracking** (individual player status)
- [x] **Match phase tracking** (warmup, knife, halftime, overtime, paused)
- [x] **Backup player system** (admin can add players mid-match)
- [x] **Admin match controls** (15+ RCON commands)
- [x] **Demo file management** (automatic upload/download)

### 🚧 In Progress
- [ ] **Enhanced player stats dashboard** — K/D, MVPs, utility damage from events
- [ ] **Round-by-round breakdown** — Visual timeline of each round's outcome
- [ ] **Pause analytics** — Track tactical timeouts and tech pause usage

### 🔮 Planned Features

**Live Match Enhancements**
- [ ] **Match timeline visualization** — Visual event timeline with phase markers
- [ ] **Live event feed** — Real-time log of kills, bomb plants, MVPs with icons
- [ ] **Observer dashboard** — Clean broadcast overlay for streaming
- [ ] **Match highlights detector** — Identify aces, clutches, last-second defuses

**Analytics & Statistics**
- [ ] **Tournament leaderboards** — Top players by K/D, MVPs, ADR
- [ ] **Team performance comparison** — Head-to-head records, map pool analysis
- [ ] **Economy tracker** (pending MatchZy support) — Buy rounds, eco detection
- [ ] **Heatmap generation** (pending MatchZy position data) — Death locations, bomb sites

**Integrations & Notifications**
- [ ] **Discord bot** — Match notifications, live scores, admin commands
- [ ] **Mobile PWA notifications** — Push alerts for match start, halftime, completion
- [ ] **Twitch/Stream overlays** — Browser source for OBS with live scores

**UX Improvements**
- [ ] **Player profiles** — Stats across all tournament matches
- [ ] **Live spectator mode** — Watch matches in browser with scoreboard
- [ ] **Match prediction model** — Win probability based on historical data
- [ ] **Multi-tournament support** — Run multiple concurrent tournaments

---

## 🤝 Contributing

<div align="center">
  <img src="docs/contribute.png" alt="Contributing" width="600">
</div>

Want to help make this project even better? **We'd love your contributions!**

Whether you're fixing bugs, adding features, improving docs, or sharing ideas — all contributions are welcome.

👉 **[Read the Contributing Guide](.github/CONTRIBUTING.md)** to get started

📜 **[Code of Conduct](.github/CODE_OF_CONDUCT.md)** • 📄 **[MIT License](LICENSE)**

---

## 🎵 Credits

- **Notification Sound**: [DRAGON-STUDIO](https://pixabay.com/users/dragon-studio-38165424/) from [Pixabay](https://pixabay.com/sound-effects/)

---

<div align="center">
  <strong>Made with ❤️ for the CS2 community</strong>
</div>
