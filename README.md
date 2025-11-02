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
- 🚀 **Automatic Server Allocation** — Matches auto-assign to available servers as rounds progress
- 🔄 **Live Updates** — Socket.io real-time match events and bracket changes
- 🖥️ **Server Fleet Management** — Add/remove CS2 servers with live status checking
- 👥 **Team Management** — Steam vanity URL resolution, player roster management
- 📡 **Event Processing** — Automatic match status updates from MatchZy webhooks
- 🔒 **Secure RCON** — Token-protected server commands with whitelisted actions
- 🎨 **Modern Web UI** — Material Design 3 dashboard with pan/zoom brackets
- 🛡️ **Live Tournament Protection** — Prevent accidental bracket resets during play
- 📚 **Auto Docs** — Interactive Swagger UI at `/api-docs`

---

## 🚀 Quick Start

**Prerequisites:**

- Node.js 18+ or Bun
- CS2 server(s) with [MatchZy plugin](https://github.com/shobhit-pathak/MatchZy) installed

**With Docker:**

```bash
cp .env.example .env
# Edit .env with your tokens
docker-compose up -d --build
```

**Local Development:**

```bash
npm install
cp .env.example .env
# Edit .env with your tokens
npm run dev
```

📖 **API Docs:** `http://localhost:3000/api-docs`  
🎨 **Web UI:** `http://localhost:5173` (dev) or `http://localhost:3000/app` (prod)

---

## ⚙️ Configuration

### Required Environment Variables

```bash
API_TOKEN=your-secure-token          # Admin authentication for Web UI & API
SERVER_TOKEN=your-server-token       # MatchZy webhook authentication
```

### Optional Environment Variables

```bash
STEAM_API_KEY=your-key               # Steam vanity URL resolution
                                     # Get free: https://steamcommunity.com/dev/apikey

BASE_URL=https://your-domain.com     # Webhook callback URL (auto-detected if not set)
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
**Infrastructure:** Docker • RCON Client • Better-SQLite3

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

<div align="center">
  <strong>Made with ❤️ for the CS2 community</strong>
</div>
