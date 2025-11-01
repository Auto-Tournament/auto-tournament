<div align="center">
  <img src="client/public/icon.svg" alt="MatchZy Auto Tournament" width="140" height="140">
  
  # MatchZy Auto Tournament
  
  **The one-button CS2 tournament automation API**
  
  <p>Stop manually configuring servers. Load matches, track events, and manage entire tournaments through one API. Built for MatchZy plugin.</p>
</div>

---

## ✨ What It Does

- 🎯 **One-Click Match Setup** — Teams, configs, and webhooks in one command
- 🖥️ **Server Fleet Management** — Add/remove CS2 servers dynamically
- 👥 **Team Management** — Steam vanity URL resolution, Discord role integration
- 📡 **Live Event Stream** — Real-time game events from MatchZy
- 🔒 **Secure RCON** — Token-protected server commands
- 🎨 **Modern Web UI** — Material Design 3 dashboard with authentication
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

- [x] Server management with CRUD
- [x] Team management with Steam integration
- [x] Match loading with auto-webhook setup
- [x] Web UI with token auth
- [ ] Swiss-system bracket generation
- [ ] Automatic server allocation
- [ ] Map veto system
- [ ] Discord bot notifications
- [ ] Stream overlay API

---

## 📄 License

MIT License • [Contributing](.github/CONTRIBUTING.md)

<div align="center">
  <strong>Made with ❤️ for the CS2 community</strong>
</div>
