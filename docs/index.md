# MatchZy Auto Tournament

<div align="center">
  <img src="https://raw.githubusercontent.com/yourusername/matchzy-auto-tournament/main/client/public/icon.svg" alt="MatchZy Auto Tournament" width="140" height="140">
  
  **Automated tournament management system for CS2 MatchZy**
  
  _Stop manually configuring servers. Load matches, track events, and manage entire tournaments through one API._
</div>

---

## What is MatchZy Auto Tournament?

MatchZy Auto Tournament is a complete tournament automation system for Counter-Strike 2, built specifically to work with the [MatchZy plugin](https://github.com/shobhit-pathak/MatchZy). It handles everything from bracket generation to live match monitoring, with zero manual server configuration.

## Key Highlights

### 🚀 One-Click Tournament Management
Create a tournament, add teams, click "Start" — matches automatically load on your server fleet with proper configurations.

### 🗺️ Professional Map Veto
Teams use an interactive web interface to ban and pick maps (FaceIT-style), with real-time synchronization and turn-based security.

### 📡 Real-Time Everything
WebSocket-powered live updates for player connections, match status, veto progress, and bracket advancement.

### 🎮 Team Experience
Public team pages (no login required) show server info, connection instructions, match history, and stats — shareable via simple links.

### 🛡️ Production-Ready
Docker deployment, automatic demo recording, comprehensive event logging, and secure RCON communication.

---

## Quick Links

- **[Quick Start Guide](getting-started/quick-start.md)** — Get running in 5 minutes
- **[Feature Overview](features/overview.md)** — See everything it can do
- **[API Reference](api/overview.md)** — Complete API documentation
- **[GitHub Repository](https://github.com/yourusername/matchzy-auto-tournament)** — Source code and issues

---

## Tournament Flow

```mermaid
graph LR
    A[Create Tournament] --> B[Add Teams]
    B --> C[Generate Bracket]
    C --> D[Start Tournament]
    D --> E{Format?}
    E -->|BO1/BO3/BO5| F[Teams Complete Veto]
    E -->|Round Robin/Swiss| G[Load Matches]
    F --> G
    G --> H[Players Connect]
    H --> I[Match Goes Live]
    I --> J[Auto Bracket Progression]
    J --> K{More Rounds?}
    K -->|Yes| G
    K -->|No| L[Tournament Complete]
```

---

## Supported Tournament Formats

| Format | Description | Min Teams | Max Teams | Uses Veto |
|--------|-------------|-----------|-----------|-----------|
| **Single Elimination** | One loss and you're out | 2 | 128 | ✅ (BO1/3/5) |
| **Double Elimination** | Two losses to be eliminated | 2 | 128 | ✅ (BO1/3/5) |
| **Round Robin** | Everyone plays everyone | 2 | 32 | ❌ |
| **Swiss System** | Similar records face each other | 4 | 64 | ❌ |

---

## What Makes It Different?

### vs. Manual MatchZy Configuration
- ❌ **Manual:** Create JSON configs, upload to server, run RCON commands for each match
- ✅ **Auto Tournament:** Click "Start Tournament" and it handles everything

### vs. Other Tournament Systems
- ✅ **Built for MatchZy** — Native integration with all events and commands
- ✅ **Real-time player tracking** — See exactly who's connected and ready
- ✅ **Team-centric UX** — Public pages teams can access without admin login
- ✅ **Map veto included** — Professional pick/ban system built-in

---

## Screenshots

<div align="center">
  <img src="assets/bracket-view.png" alt="Bracket View" width="600">
  <p><em>Interactive bracket with pan/zoom and live match status</em></p>
  
  <img src="assets/veto-interface.png" alt="Map Veto" width="600">
  <p><em>FaceIT-style map veto with real-time team synchronization</em></p>
  
  <img src="assets/player-roster.png" alt="Player Roster" width="600">
  <p><em>Live player connection and ready status tracking</em></p>
</div>

---

## Community & Support

- 📖 **Documentation:** You're reading it!
- 🐛 **Bug Reports:** [GitHub Issues](https://github.com/yourusername/matchzy-auto-tournament/issues)
- 💡 **Feature Requests:** [GitHub Discussions](https://github.com/yourusername/matchzy-auto-tournament/discussions)
- 🤝 **Contributing:** [Contributing Guide](development/contributing.md)

---

<div align="center">
  <strong>Made with ❤️ for the CS2 community</strong>
</div>

