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

## 📋 Prerequisites

**Production:** [Docker](https://docs.docker.com/get-docker/) 20.10+  
**Development:** [Bun](https://bun.sh/) 1.0+ or [Node.js](https://nodejs.org/) 18+

---

## 🚀 Quick Start

### Docker (Recommended)

```bash
cp .env.example .env
# Edit .env with your tokens
docker-compose up -d --build
```

### Local Development

```bash
bun install
cp .env.example .env
# Edit .env with your tokens
bun run dev
```

**API:** `http://localhost:3000` | **Docs:** `http://localhost:3000/api-docs`

---

## 📡 API Documentation

All API endpoints, examples, and schemas are available in the interactive documentation:

👉 **[View API Docs](http://localhost:3000/api-docs)** (when running)

**Quick Overview:**

- 🖥️ **Servers** — Manage CS2 servers
- 🎮 **Matches** — Create and load match configurations
- 🎛️ **RCON** — Execute server commands
- 📡 **Events** — MatchZy webhook integration

**Authentication:** `Authorization: Bearer <API_TOKEN>`

---

## 🛠️ Tech Stack

- **Runtime:** Bun + TypeScript
- **Framework:** Express.js
- **Database:** SQLite
- **RCON:** dathost-rcon-client
- **Docs:** Swagger/OpenAPI
- **Deploy:** Docker + Docker Compose

---

## 🎯 Roadmap

**Goal:** One-button fully automated tournaments

- [ ] Bracket generation & scheduling
- [ ] Intelligent server allocation
- [ ] Map veto system
- [ ] Web dashboard UI
- [ ] Discord bot integration
- [ ] Stream overlay triggers

---

## 🤝 Contributing

Contributions welcome! See [CONTRIBUTING.md](.github/CONTRIBUTING.md) for guidelines.

## 📄 License

MIT License - see [LICENSE](LICENSE) file.

---

<div align="center">
  <strong>Made with ❤️ for the CS2 tournament community</strong>
</div>
