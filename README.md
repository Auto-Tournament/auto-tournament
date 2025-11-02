<div align="center">
  <img src="client/public/icon.svg" alt="MatchZy Auto Tournament" width="140" height="140">
  
  # MatchZy Auto Tournament
  
  ⚡ **Automated tournament management API for CS2 MatchZy — one click from match creation to final scores**
  
  <p>Stop manually configuring servers. Load matches, track events, and manage entire tournaments through one API. Built for MatchZy plugin.</p>
</div>

---

## ✨ What It Does

- 🏆 **Automated Brackets** — Single Elimination, Double Elimination, Round Robin, Swiss
- 🎯 **Smart Walkovers** — Automatic bye handling and bracket progression
- 🔄 **Live Updates** — Socket.io real-time match events and bracket changes
- 🖥️ **Server Fleet Management** — Add/remove CS2 servers with live status checking
- 👥 **Team Management** — Steam vanity URL resolution, Discord role integration
- 📡 **Event Processing** — Automatic match status updates from MatchZy webhooks
- 🔒 **Secure RCON** — Token-protected server commands with whitelisted actions
- 🎨 **Modern Web UI** — Material Design 3 dashboard with pan/zoom brackets
- 🛡️ **Live Tournament Protection** — Prevent accidental bracket resets during play
- 📚 **Auto Docs** — Interactive Swagger UI

---

## 🚀 Quick Start

**With Docker:**

```bash
cp .env.example .env
docker-compose up -d --build
```

**Local Dev:**

```bash
bun install && cp .env.example .env
bun run dev
```

📖 **API Docs:** `http://localhost:3000/api-docs`  
🎨 **Web UI:** `http://localhost:5173` (dev) or `/app` (prod)

**Environment Variables:**

```bash
# Required
API_TOKEN=your-secure-token          # Admin authentication
SERVER_TOKEN=your-server-token       # MatchZy webhook auth

# Optional
STEAM_API_KEY=your-steam-key         # Enable Steam vanity URL resolution
                                     # Get free key: https://steamcommunity.com/dev/apikey
```

---

## 🛠️ Stack

TypeScript • Express • React • Material UI • SQLite • Docker

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
- [ ] Automatic server allocation for matches
- [ ] Map veto system
- [ ] Discord bot notifications
- [ ] Stream overlay API
- [ ] Admin dashboard for live tournament management

---

## 📄 License

MIT License • [Contributing](.github/CONTRIBUTING.md)

<div align="center">
  <strong>Made with ❤️ for the CS2 community</strong>
</div>
