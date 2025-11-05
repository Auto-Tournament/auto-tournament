<div align="center">
  <img src="client/public/icon.svg" alt="MatchZy Auto Tournament" width="140" height="140">
  
  # MatchZy Auto Tournament
  
  ⚡ **Automated tournament management API for CS2 MatchZy — one click from match creation to final scores**
  
  <p>Stop manually configuring servers. Load matches, track events, and manage entire tournaments through one API. Built for MatchZy plugin.</p>
</div>

---

## ✨ What It Does

### Tournament Management
- 🏆 **Automated Brackets** — Single Elimination, Double Elimination, Round Robin, Swiss
  - Powered by [brackets-manager.js](https://github.com/Drarig29/brackets-manager.js) for robust bracket generation
- 🎯 **Smart Walkovers** — Automatic bye handling and bracket progression for any team count
- 🚀 **Automatic Server Allocation** — Matches auto-assign to available servers as rounds progress
- 🛡️ **Live Tournament Protection** — Prevent accidental bracket resets during play
- 📊 **Guided Onboarding** — Step-by-step checklist for first-time setup

### Server & Match Management
- 🖥️ **Server Fleet Management** — Add/remove CS2 servers with live status checking and refresh
- 🔄 **Auto Webhook Configuration** — Servers automatically configured when checked online
- 📡 **Event Processing** — Automatic match status updates from MatchZy webhooks
- 🎬 **Demo Recording** — Automatic demo upload and download with smart file naming
- 👥 **Player Connection Tracking** — Real-time visibility of connected players (X/10)
- 🔒 **Secure RCON** — Token-protected server commands with whitelisted actions

### Team Experience
- 🎮 **Public Team Pages** — No-login team portals with match info and server connection
- 🔊 **Sound Notifications** — Customizable alerts when matches are ready (8 sounds, volume control)
- 📈 **Performance Stats** — Win/loss records, win rate, tournament standings
- 📜 **Match History** — View past matches with scores and opponents
- 🔗 **Easy Sharing** — Copy team links from admin dashboard

### Admin & Monitoring
- 🐛 **Server Event Monitor** — Live WebSocket view of all MatchZy events by server
- 📝 **Event File Logging** — All webhook events logged to files (30-day retention)
- 🎮 **Live Match Controls** — Pause, unpause, force start from admin panel
- 🎨 **Modern Web UI** — Material Design 3 dashboard with pan/zoom brackets
- 📚 **Auto Docs** — Interactive Swagger UI at `/api-docs`

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

---

## 🛠️ Tech Stack

**Backend:** TypeScript • Express • SQLite • Socket.IO • Swagger  
**Frontend:** React • Material UI (MUI) • Vite • React Router  
**Infrastructure:** Docker • Caddy • RCON Client • Better-SQLite3  
**Bracket Engine:** [brackets-manager.js](https://github.com/Drarig29/brackets-manager.js) • brackets-memory-db

---

## 🎯 Roadmap

_Goal: One button starts the entire tournament_

- [x] Server management with CRUD and live status
- [x] Team management with Steam integration
- [x] Match loading with auto-webhook setup
- [x] Web UI with token auth and Material Design 3
- [x] Tournament brackets (Single/Double Elimination, Round Robin, Swiss)
- [x] Real-time updates via Socket.io
- [x] Automatic bracket progression
- [x] Team replacement without bracket reset
- [x] Interactive bracket visualization with pan/zoom
- [x] Automatic server allocation for matches
- [ ] Map veto system
- [ ] Discord bot notifications
- [ ] Stream overlay API
- [ ] Admin dashboard for live tournament management

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
