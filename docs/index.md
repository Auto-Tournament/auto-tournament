# MatchZy Auto Tournament

**Automated CS2 tournament platform with zero manual server configuration.**

---

## Quick Start

**Install and run in 5 minutes:**

```bash
git clone https://github.com/sivert-io/matchzy-auto-tournament.git
cd matchzy-auto-tournament
cp example.env .env
docker compose up -d
# Open http://localhost:3069
```

[**Full Installation Guide →**](getting-started/)

---

## Documentation

### 🎯 For Tournament Admins

**Setup:**
- [Installation](getting-started/) - Docker setup and first tournament
- [Server Setup](getting-started/server-setup/) - CS2 server configuration
- [Admin Settings](guides/admin-settings/) - Webhooks, maps, defaults

**Running Tournaments:**
- [Teams Guide](guides/teams/) - Creating and managing teams
- [Creating Tournaments](guides/how-to-set-up-a-tournament/) - Tournament setup
- [Running Matches](guides/running-matches/) - Match management
- [Troubleshooting](guides/troubleshooting/) - Common issues

### 👥 For Players

Players use **team pages** (no login needed):
```
https://your-domain.com/team/team-name
```

Features:
- View upcoming matches
- Participate in map veto
- Get server connection info
- Monitor live scores

[**Team Pages Guide →**](guides/team-pages/)

### 💻 For Developers

- [Contributing Guide](https://github.com/sivert-io/matchzy-auto-tournament/blob/main/.github/CONTRIBUTING.md)
- [Architecture](development/architecture/) - System design
- [Testing](development/testing-pr/) - Running tests

---

## Features

**Tournament Formats:**
- Single/Double Elimination
- Swiss System
- Round Robin
- Shuffle (player-based)

**Automation:**
- Auto server allocation
- Match loading via RCON
- Real-time bracket updates
- Demo recording & upload

**Player Experience:**
- FaceIT-style map veto
- Public team pages
- Live match tracking
- OpenSkill-based ratings

[**Full Feature List →**](features/overview/)

---

## Support

- 💬 [Discord Community](https://discord.gg/n7gHYau7aW)
- 🐛 [GitHub Issues](https://github.com/sivert-io/matchzy-auto-tournament/issues)
- 📖 [Troubleshooting Guide](guides/troubleshooting/)

---

## License

MIT License - see [LICENSE](https://github.com/sivert-io/matchzy-auto-tournament/blob/main/LICENSE)
