<div align="center">
  <img src="client/public/icon.svg" alt="MatchZy Auto Tournament" width="140" height="140">
  
  # MatchZy Auto Tournament
  
  ⚡ **Automated CS2 tournament management — one click from bracket creation to final scores**
  
  <p>Complete tournament automation for Counter-Strike 2 using the enhanced MatchZy plugin. Zero manual server configuration.</p>

[![License: PolyForm Noncommercial](https://img.shields.io/badge/License-PolyForm%20Noncommercial-orange.svg)](LICENSE)
[![Docker](https://img.shields.io/badge/Docker-Ready-2496ED?logo=docker&logoColor=white)](docker-compose.yml)
[![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)

**📚 <a href="https://mat.sivert.io/" target="_blank">Documentation</a>** • <a href="https://discord.gg/n7gHYau7aW" target="_blank">💬 Discord</a>

</div>

---

## 🎯 Who is this for?

- **Tournament Organizers** — Run professional CS2 tournaments with automated brackets, veto, ratings, and live stats
- **Casual Players** — Quick setup to play competitive matches with friends (5v5, 2v2, or custom)
- **Developers** — Open source platform for building CS2 tournament features

---

## ⚡ Quick Start (5 minutes)

### 1. Install Platform

```bash
# Clone and start
git clone https://github.com/sivert-io/matchzy-auto-tournament.git
cd matchzy-auto-tournament
cp example.env .env
docker compose up -d

# Open http://localhost:3069
```

### 2. Add CS2 Servers

**Option A: Automated (Recommended)**
- Use the [CS2 Server Manager](https://mat.sivert.io/guides/cs2-server-manager/) to spin up servers with one command

**Option B: Manual**
- Install [CounterStrikeSharp](https://docs.cssharp.dev/) on your CS2 server
- Install [MatchZy Enhanced v1.3.0+](https://github.com/sivert-io/matchzy-Enhanced/releases)
- Add server in the platform: Settings → Servers

### 3. Create Tournament

Dashboard → New Tournament → Select format → Add teams → Start!

**That's it!** Matches auto-load on servers, veto happens in the browser, and brackets update live.

---

## ✨ What You Get

🏆 **Tournament Formats** — Single/Double Elimination, Swiss, Round Robin, Shuffle  
🗺️ **Map Veto** — FaceIT-style ban/pick for BO1/BO3/BO5  
📈 **Player Ratings** — OpenSkill-backed ELO system with leaderboards  
⚡ **Real-Time** — WebSocket updates for scores, connections, status  
🎮 **Auto-Everything** — Server allocation, match loading, bracket progression  
🎬 **Demo Recording** — Automatic upload and download  
👥 **Public Pages** — No-login team pages with server connect info

<div align="center">
  <img src="docs/assets/preview/08-bracket-view.png" alt="Tournament Bracket View" width="800">
</div>

---

## 📖 Documentation

**For Tournament Admins:**
- [Admin Dashboard](https://mat.sivert.io/guides/admin-dashboard/)
- [Server Setup](https://mat.sivert.io/getting-started/server-setup/)
- [Creating Tournaments](https://mat.sivert.io/guides/how-to-set-up-a-tournament/)

**For Developers:**
- [Contributing Guide](.github/CONTRIBUTING.md)
- [Architecture](https://mat.sivert.io/development/architecture/)
- [Testing](https://mat.sivert.io/development/testing-pr/)

---

## 🔧 Requirements

- Docker & Docker Compose
- CS2 servers with [MatchZy Enhanced v1.3.0+](https://github.com/sivert-io/matchzy-Enhanced/releases)
- RCON access to servers

---

## 🤝 Contributing

Contributions welcome! Bug fixes, features, docs improvements, or ideas.

**[Read Contributing Guide](.github/CONTRIBUTING.md)**

---

## 📜 License

MIT License - see [LICENSE](LICENSE)

**Credits:** [cs2-server-manager](https://github.com/sivert-io/cs2-server-manager) • [brackets-manager.js](https://github.com/Drarig29/brackets-manager.js) • [brackets-viewer.js](https://github.com/Drarig29/brackets-viewer.js)

---

<div align="center">
  <strong>Made with ❤️ for the CS2 community</strong>
</div>
