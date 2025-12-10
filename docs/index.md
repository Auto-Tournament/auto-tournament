---
hide:
  - navigation
  - toc
---

# MatchZy Auto Tournament

Automated tournament management for Counter-Strike 2. Run CS2 tournaments from bracket creation to final scores with a single dashboard and full server integration.

Designed to work hand-in-hand with:

- **[CS2 Server Manager](https://sivert-io.github.io/cs2-server-manager/)** – multi-server CS2 deployment and management.
- **[MatchZy Enhanced](https://me.sivert.io)** – enhanced MatchZy plugin for in-server automation.

## What it does

- **Automated brackets & match flow**: Create tournaments, generate brackets, and let MAT handle match lifecycle and progression.
- **Server allocation & monitoring**: Register CS2 servers, monitor status, and automatically load matches when servers are free.
- **Team & player management**: Create teams, manage rosters, and keep player ratings in sync with shuffle tournaments.
- **Public team pages & veto**: Share links so teams can view matches, run veto, and see server info without admin access.
- **Demo uploads & match history**: Store demos and match data for later review, statistics, and recovery.

See the **[Feature Overview](features/overview.md)** for a deeper look at everything MAT can do.

## Quick Start

For most setups, you can run MatchZy Auto Tournament with Docker:

```bash
mkdir matchzy-tournament
cd matchzy-tournament

# 1. Create docker-compose.yml (see Getting Started for the full example)
# 2. Then start the stack:
docker compose up -d
```

Open `http://localhost:3069` in your browser and log in with the password you set as `API_TOKEN`.  
Read the **[Getting Started](getting-started/quick-start.md)** guide for the complete configuration.

---

## Support

- [GitHub Issues](https://github.com/sivert-io/matchzy-auto-tournament/issues) – report bugs or request features.
- [Discussions](https://github.com/sivert-io/matchzy-auto-tournament/discussions) – ask questions and share ideas.
- [Discord Community](https://discord.gg/n7gHYau7aW) – real-time support and chat with other tournament hosts.

---

## Related projects

- [CS2 Server Manager](https://sivert-io.github.io/cs2-server-manager/) – multi-server CS2 deployment and management.
- [MatchZy Enhanced](https://me.sivert.io) – enhanced MatchZy plugin for in-server automation.

---

## License & credits

<div align="center" markdown>

MIT License • Made with :material-heart: for the CS2 community

</div>
