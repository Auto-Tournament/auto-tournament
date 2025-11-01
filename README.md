<div align="center">
  <img src="docs/icon.svg" alt="MatchZy Auto Tournament" width="200" height="200">
  
  # MatchZy Auto Tournament
  
  **Automated tournament management API for Counter-Strike 2 using the MatchZy plugin**
  
  <p>A TypeScript-based REST API that automates CS2 tournament workflows. Load matches, manage servers, and track game events—all through a single API. Built for tournament admins who want to focus on running events, not managing servers.</p>
</div>

---

## ✨ Features

- 🎯 **One-Click Match Loading** — Configure teams, load matches, and setup webhooks automatically
- 🖥️ **Dynamic Server Management** — Add, update, or remove CS2 servers on the fly
- 📡 **Real-Time Event Tracking** — Receive and store all MatchZy game events as they happen
- 🔒 **Secure RCON Control** — Execute predefined commands with token-based authentication
- 📊 **Match Status Automation** — Automatically update match states (pending → live → completed)
- 📚 **Interactive API Docs** — Built-in Swagger UI at `/api-docs`

---

## 🚀 Quick Start

### 1. Install Dependencies

```bash
bun install
```

### 2. Configure Environment

Create a `.env` file:

```env
PORT=3000
API_TOKEN=your-secret-admin-token
SERVER_TOKEN=your-matchzy-webhook-token
LOG_LEVEL=info
```

### 3. Start the Server

```bash
bun run dev
```

The API will be available at `http://localhost:3000` with interactive docs at `/api-docs`.

---

## 📖 Usage

### Add Your CS2 Servers

```bash
curl -X POST http://localhost:3000/api/servers \
  -H "Authorization: Bearer your-secret-admin-token" \
  -H "Content-Type: application/json" \
  -d '{
    "id": "server1",
    "name": "Tournament Server #1",
    "host": "192.168.1.100",
    "port": 27015,
    "password": "rcon_password_here"
  }'
```

### Create a Match

```bash
curl -X POST http://localhost:3000/api/matches \
  -H "Authorization: Bearer your-secret-admin-token" \
  -H "Content-Type: application/json" \
  -d '{
    "slug": "grand_final",
    "serverId": "server1",
    "config": {
      "matchid": "grand_final",
      "team1": {
        "name": "Team A",
        "players": {
          "76561198XXXXXXXX": "Player1"
        }
      },
      "team2": {
        "name": "Team B",
        "players": {
          "76561198XXXXXXXX": "Player2"
        }
      },
      "num_maps": 3,
      "maplist": ["de_mirage", "de_inferno", "de_ancient"]
    }
  }'
```

### Load Match on Server

This automatically configures MatchZy webhooks and loads the match:

```bash
curl -X POST http://localhost:3000/api/matches/grand_final/load \
  -H "Authorization: Bearer your-secret-admin-token"
```

**Done!** 🎉 The match is now live and events will flow to your API automatically.

---

## 🏗️ Architecture

```
┌─────────────────┐
│  Tournament     │
│  Admin          │
└────────┬────────┘
         │ REST API (create match, load)
         ▼
┌─────────────────┐         RCON Commands
│  MatchZy Auto   ├──────────────────────┐
│  Tournament API │                      │
└────────┬────────┘                      ▼
         │                      ┌─────────────────┐
         │ Webhook Events       │  CS2 Server     │
         ◄──────────────────────┤  (MatchZy)      │
         │                      └─────────────────┘
         ▼
┌─────────────────┐
│  SQLite DB      │
│  (Match Data)   │
└─────────────────┘
```

---

## 🔐 Authentication

All administrative endpoints require the `Authorization: Bearer <API_TOKEN>` header.

MatchZy webhooks use the `X-MatchZy-Token` header with your `SERVER_TOKEN`.

---

## 📡 API Endpoints

### Servers

- `GET /api/servers` — List all servers
- `POST /api/servers` — Add server(s)
- `PUT /api/servers/:id` — Update server
- `DELETE /api/servers/:id` — Remove server

### Matches

- `GET /api/matches` — List matches
- `POST /api/matches` — Create match
- `POST /api/matches/:slug/load` — Load match + configure webhooks
- `GET /api/matches/:slug.json` — Match config (public, for MatchZy)
- `DELETE /api/matches/:slug` — Delete match

### RCON Commands

- `POST /api/rcon/practice-mode` — Enable practice mode
- `POST /api/rcon/start-match` — Force start match
- `POST /api/rcon/change-map` — Change map
- `POST /api/rcon/say` — Send message to server
- `POST /api/rcon/broadcast` — Send message to all servers

### Events

- `POST /api/events` — Webhook endpoint (for MatchZy)
- `GET /api/events/:matchSlug` — Get match events

📚 **Full documentation:** `http://localhost:3000/api-docs`

---

## 🛠️ Tech Stack

- **Runtime:** Bun + TypeScript
- **Framework:** Express.js
- **Database:** SQLite (easily upgradeable to PostgreSQL/MySQL)
- **RCON:** dathost-rcon-client
- **Logging:** Pino (with pretty output)
- **Docs:** Swagger/OpenAPI

---

## 🎯 Roadmap

This API is the foundation for **fully automated tournaments**. The goal is one-button tournament execution:

- [ ] **Bracket Generation** — Auto-create tournament brackets
- [ ] **Match Scheduling** — Queue and auto-start matches
- [ ] **Server Allocation** — Intelligently assign matches to available servers
- [ ] **Map Veto System** — Handle map picks/bans via API or web UI
- [ ] **Spectator Management** — Auto-add casters/observers
- [ ] **Stream Integration** — Trigger stream overlays on match events
- [ ] **Discord Bot** — Send match updates and control via Discord
- [ ] **Web Dashboard** — Visual tournament management UI

---

## 📝 License

MIT

---

## 🤝 Contributing

Built for LAN tournaments and online events. Contributions welcome!

1. Fork the repo
2. Create a feature branch
3. Make your changes
4. Submit a pull request

---

**Made with ❤️ for the CS2 tournament community**
