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

<div class="grid cards" markdown>

- :material-trophy:{ .lg .middle } **Full Automation**

  ***

  Create tournaments, generate brackets, start matches.  
  System handles server allocation and progression.

  [:octicons-arrow-right-24: Quick Start](getting-started/quick-start.md)

- :material-map:{ .lg .middle } **Map Veto System**

  ***

  FaceIT-style interactive pick/ban for BO1/BO3/BO5.  
  Real-time turn-based security.

  [:octicons-arrow-right-24: Learn More](features/overview.md#map-veto)

- :material-lightning-bolt:{ .lg .middle } **Real-Time Updates**

  ***

  Live scores, player tracking, bracket updates.  
  WebSocket-powered, zero refresh needed.

  [:octicons-arrow-right-24: See Features](features/overview.md)

- :material-account-group:{ .lg .middle } **Public Team Pages**

  ***

  No-auth pages for teams to view matches and veto.  
  Share a link, teams handle the rest.

  [:octicons-arrow-right-24: Team Features](features/overview.md#team-pages)

- :material-console:{ .lg .middle } **Admin Controls**

  ***

  Pause, restore, add players, broadcast messages.  
  Full RCON integration for match control.

  [:octicons-arrow-right-24: Admin Guide](guides/running-matches.md)

- :material-chart-line:{ .lg .middle } **Match Tracking**

  ***

  Player connections, round scores, statistics.  
  Complete match history and analytics.

  [:octicons-arrow-right-24: View All Features](features/overview.md)

</div>

---

## Quick Start

=== "Docker (Recommended)"

    ```bash
    git clone https://github.com/sivert-io/matchzy-auto-tournament.git
    cd matchzy-auto-tournament
    cp .env.example .env
    # Edit .env with your tokens
    docker-compose up -d --build
    ```

    **Access:** `http://localhost:3069`

=== "Local Development"

    ```bash
    npm install
    cp .env.example .env
    # Edit .env with your tokens
    npm run dev
    ```

    **Frontend:** `http://localhost:5173`
    **API:** `http://localhost:3000`

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
