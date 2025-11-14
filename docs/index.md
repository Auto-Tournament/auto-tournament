---
hide:
  - navigation
  - toc
---

<div align="center" markdown>

# MatchZy Auto Tournament

### **Automated CS2 tournament management**

One click from bracket creation to final scores

[Get Started :material-rocket-launch:](getting-started/quick-start.md){ .md-button .md-button--primary }
[View Features :material-star:](features/overview.md){ .md-button }

</div>

---

## Features

- :material-trophy: **Full Automation** — Create tournaments, generate brackets, start matches. System handles server allocation and progression.
- :material-map: **Map Veto System** — FaceIT-style interactive pick/ban for BO1/BO3/BO5 with real-time turn-based security.
- :material-lightning-bolt: **Real-Time Updates** — Live scores, player tracking, bracket updates. WebSocket-powered, zero refresh needed.
- :material-account-group: **Public Team Pages** — No-auth pages for teams to view matches and veto. Share a link, teams handle the rest.
- :material-console: **Admin Controls** — Pause, restore, add players, broadcast messages. Full RCON integration for match control.
- :material-chart-line: **Match Tracking** — Player connections, round scores, statistics. Complete match history and analytics.

[:octicons-arrow-right-24: View All Features](features/overview.md){ .md-button }

---

## Quick Start Paths

### 😊 Recommended: CS2 Server Manager

Use the companion **[CS2 Server Manager](guides/cs2-server-manager.md)** to deploy 3–5 CS2 servers that already include:

- CounterStrikeSharp + Metamod:Source
- MatchZy enhanced fork + CS2 AutoUpdater
- Pre-configured webhooks and RCON

Best for LANs, new admins, or anyone who wants a working fleet in minutes.

### 🛠️ Manual Setup (advanced users)

```bash
git clone https://github.com/sivert-io/matchzy-auto-tournament.git
cd matchzy-auto-tournament
cp .env.example .env
docker compose -f docker/docker-compose.yml up -d
# or build dev image:
# docker compose -f docker/docker-compose.dev.yml up -d --build
```

**Dashboard access:** `http://localhost:3069`

---

## Requirements

- CS2 servers with [modified MatchZy plugin](https://github.com/sivert-io/matchzy/releases) :material-download:
- Node.js 18+ or Docker :material-docker:
- RCON access to servers :material-server-network:

---

## Support

[:material-github: GitHub Issues](https://github.com/sivert-io/matchzy-auto-tournament/issues){ .md-button }
[:material-chat: Discussions](https://github.com/sivert-io/matchzy-auto-tournament/discussions){ .md-button }

---

<div align="center" markdown>

MIT License • Made with :material-heart: for the CS2 community

</div>
