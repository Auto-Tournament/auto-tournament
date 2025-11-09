<div align="center">
  <img src="client/public/icon.svg" alt="MatchZy Auto Tournament" width="140" height="140">
  
  # MatchZy Auto Tournament
  
  ⚡ **Automated CS2 tournament management — one click from bracket creation to final scores**
  
  <p>Complete tournament automation for Counter-Strike 2 using the MatchZy plugin. Zero manual server configuration.</p>

[![License: PolyForm Noncommercial](https://img.shields.io/badge/License-PolyForm%20Noncommercial-orange.svg)](LICENSE)
[![Docker](https://img.shields.io/badge/Docker-Ready-2496ED?logo=docker&logoColor=white)](docker-compose.yml)
[![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)

</div>

---

## 📚 Documentation

**👉 [Full Documentation](https://sivert-io.github.io/matchzy-auto-tournament/)**

**Quick Links:**

- 🚀 [Quick Start](https://sivert-io.github.io/matchzy-auto-tournament/getting-started/quick-start/)
- ✨ [Features](https://sivert-io.github.io/matchzy-auto-tournament/features/overview/)
- 🔧 [Troubleshooting](https://sivert-io.github.io/matchzy-auto-tournament/guides/troubleshooting/)
- 👨‍💻 [Contributing](https://sivert-io.github.io/matchzy-auto-tournament/development/contributing/)
- 🏗️ [Architecture](https://sivert-io.github.io/matchzy-auto-tournament/development/architecture/)

---

## ✨ Key Features

🏆 **Tournament Brackets** — Single/Double Elimination, Round Robin, Swiss with auto-progression  
🗺️ **Interactive Map Veto** — FaceIT-style ban/pick system for BO1/BO3/BO5  
⚡ **Real-Time Updates** — WebSocket-powered live scores and player tracking  
🎮 **Auto Server Allocation** — Matches load automatically when servers are available  
👥 **Public Team Pages** — No-auth pages for teams to monitor matches and veto  
🎛️ **Admin Match Controls** — Pause, restore, broadcast, add players via RCON  
📊 **Player Tracking** — Live connection and ready status for all 10 players  
🎬 **Demo Management** — Automatic upload and download with streaming  
🔒 **Secure** — Token-based auth for admin and server communication

**Tech Stack:** TypeScript • React • Material UI • Express • SQLite • Socket.IO • Docker

---

## 🚀 Quick Start

**Prerequisites:** Node.js 18+ or Docker, CS2 server(s) with [MatchZy plugin](https://github.com/shobhit-pathak/MatchZy)

### With Docker (Recommended)

```bash
git clone https://github.com/sivert-io/matchzy-auto-tournament.git
cd matchzy-auto-tournament

# 1. Create environment file
cp .env.example .env

# 2. Generate secure tokens
openssl rand -hex 32  # Copy this for API_TOKEN
openssl rand -hex 32  # Copy this for SERVER_TOKEN

# 3. Edit .env with your tokens and server IP
nano .env  # or use your preferred editor
```

**Required in `.env`:**

```bash
API_TOKEN=your-generated-token-here      # Admin dashboard login
SERVER_TOKEN=your-generated-token-here   # MatchZy authentication
WEBHOOK_URL=http://192.168.1.100:3000   # Your server IP (where CS2 sends events)
```

```bash
# 4. Start everything
docker-compose up -d --build
```

**Access at:** `http://localhost:3069` (Web UI, API, and docs all on one port)

### Local Development

```bash
npm install
cp .env.example .env
# Edit .env with tokens (same as above)
npm run dev
```

Frontend: `http://localhost:5173` • API: `http://localhost:3000` • Docs: `http://localhost:3000/api-docs`

**That's it!** The system auto-configures webhooks on your CS2 servers. See [full setup guide](https://sivert-io.github.io/matchzy-auto-tournament/getting-started/quick-start/) for details.

---

## ⚙️ MatchZy Plugin Requirement

> **Important:** This project requires a **modified version of the [MatchZy](https://github.com/shobhit-pathak/MatchZy)** plugin.

The official MatchZy release does not expose all the granular match and player events required for full automation.  
This system depends on a customized fork that extends MatchZy to send additional API payload data for real-time tracking.

**Modified Fork:** [sivert-io/matchzy](https://github.com/sivert-io/matchzy)  
**Build Instructions:** [MatchZy Developer Docs](https://shobhit-pathak.github.io/MatchZy/developers/)

You can clone and build the modified plugin yourself:

```bash
git clone https://github.com/sivert-io/matchzy.git
cd matchzy
dotnet build
```

Once built, copy the plugin files to your server:

```
csgo/addons/counterstrikesharp/plugins/MatchZy/
```

A pull request will be opened upstream once the extended event system is finalized and validated.

---

## 🎯 Roadmap

### ✅ Core Features (Complete)

- [x] Tournament brackets with 4 formats
- [x] Map veto system (BO1/BO3/BO5)
- [x] Real-time player tracking
- [x] Admin match controls (15+ RCON commands)
- [x] Demo file management
- [x] Public team pages
- [x] Match phase tracking
- [x] Backup player system

### 🚧 In Progress

- [ ] Enhanced player stats (K/D, MVPs, utility damage)
- [ ] Round-by-round breakdown visualization
- [ ] Pause analytics

### 🔮 Planned

- [ ] Discord bot integration
- [ ] Tournament leaderboards
- [ ] Match timeline visualization
- [ ] Live event feed with kill icons
- [ ] Observer/streaming overlay
- [ ] Player profiles & statistics
- [ ] Multi-tournament support

---

## 🤝 Contributing

Contributions are welcome! Whether you're:

- 🐛 Fixing bugs
- ✨ Adding features
- 📝 Improving docs
- 💡 Sharing ideas

**👉 [Read the Contributing Guide](.github/CONTRIBUTING.md)**

📜 [Code of Conduct](.github/CODE_OF_CONDUCT.md) • 📄 [MIT License](LICENSE)

---

## 🎵 Credits

- **Map Images**: [ghostcap-gaming/cs2-map-images](https://github.com/ghostcap-gaming/cs2-map-images)
- **Notification Sound**: [DRAGON-STUDIO](https://pixabay.com/users/dragon-studio-38165424/) from [Pixabay](https://pixabay.com/sound-effects/)
- **Bracket Engine**: [brackets-manager.js](https://github.com/Drarig29/brackets-manager.js)

---

<div align="center">
  <strong>Made with ❤️ for the CS2 community</strong>
</div>
