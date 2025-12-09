<div align="center">
  <img src="client/public/icon.svg" alt="MatchZy Auto Tournament" width="140" height="140">
  
  # MatchZy Auto Tournament
  
  ⚡ **Automated CS2 tournament management — one click from bracket creation to final scores**
  
  <p>Complete tournament automation for Counter-Strike 2 using the enhanced MatchZy plugin. Zero manual server configuration.</p>

[![License: PolyForm Noncommercial](https://img.shields.io/badge/License-PolyForm%20Noncommercial-orange.svg)](LICENSE)
[![Docker](https://img.shields.io/badge/Docker-Ready-2496ED?logo=docker&logoColor=white)](docker-compose.yml)
[![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)

**📚 <a href="https://me.sivert.io/" target="_blank">Full Documentation</a>** • <a href="https://me.sivert.io/getting-started/quick-start/" target="_blank">Quick Start</a> • <a href="https://me.sivert.io/features/overview/" target="_blank">Features</a> • <a href="https://me.sivert.io/roadmap/" target="_blank">Roadmap</a> • <a href="https://me.sivert.io/guides/troubleshooting/" target="_blank">Troubleshooting</a> • <a href="https://discord.gg/n7gHYau7aW" target="_blank">💬 Discord Support</a>

</div>

---

## ✨ Features

🏆 **Tournament Formats** — Single/Double Elimination, Round Robin, Swiss, and Shuffle tournaments with auto-progression  
🧩 **Custom Bracket Viewer** — Bundled fork of `brackets-viewer.js` with enhanced theming, matchup centering, and MatchZy integration  
🗺️ **Interactive Map Veto** — FaceIT-style ban/pick system for BO1/BO3/BO5 with map pools and MR3 overtime support  
📈 **Player Ratings** — OpenSkill-backed rating engine, ELO-style display, player pages, and public leaderboards  
📊 **Dashboard & Live Stats** — Onboarding checklist, tournament/server stats, and live match metrics  
⚡ **Real-Time Updates** — WebSocket-powered live scores, player connections, and status tracking  
🎮 **Auto Server Allocation** — Matches load automatically when servers are available  
👥 **Public Team & Match Pages** — No-auth pages for teams and viewers to monitor matches and veto  
🎬 **Demo Management** — Automatic demo upload, verification, and download

<div align="center">
  <img src="docs/assets/preview/08-bracket-view.png" alt="Tournament Bracket View" width="800">
  <p><em>Double-elimination bracket with synchronized winner and loser paths plus interactive match zoom</em></p>
</div>

**👉 <a href="https://me.sivert.io/screenshots/" target="_blank">View More Screenshots</a>**

---

## ⚙️ Requirements

- **Docker** and **Docker Compose** ([Install Docker](https://docs.docker.com/engine/install/))
- **CS2 servers** with the [enhanced MatchZy plugin](https://github.com/sivert-io/matchzy/releases)
- **RCON access** to your CS2 servers

---

## 🚀 Quick Start

Get up and running in minutes with Docker:

1. **Install the tournament platform** using Docker
2. **Set up CS2 servers** using the CS2 Server Manager (recommended) or manual setup
3. **Create your first tournament** and start playing!

👉 **[Read the complete Quick Start Guide](https://me.sivert.io/getting-started/quick-start/)** for step-by-step instructions.

---

## 🤝 Contributing

Contributions are welcome! Whether you're fixing bugs, adding features, improving docs, or sharing ideas.

👉 **[Read the Contributing Guide](.github/CONTRIBUTING.md)**

---

## 📜 License

MIT License - see [LICENSE](LICENSE) for details

**Credits:** <a href="https://github.com/sivert-io/cs2-server-manager" target="_blank">sivert-io/cs2-server-manager</a> (map images) • <a href="https://github.com/Drarig29/brackets-manager.js" target="_blank">brackets-manager.js</a> • <a href="https://github.com/Drarig29/brackets-viewer.js" target="_blank">brackets-viewer.js</a> (customized copy vendored in `client/src/brackets-viewer`)

---

<div align="center">
  <strong>Made with ❤️ for the CS2 community</strong>
</div>
