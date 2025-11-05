# Installation

Detailed installation instructions for different environments.

---

## Docker Installation (Recommended)

### Prerequisites

- Docker 20.10+
- Docker Compose 2.0+
- At least 1GB free disk space

### Steps

1. **Clone the repository:**
   ```bash
   git clone https://github.com/yourusername/matchzy-auto-tournament.git
   cd matchzy-auto-tournament
   ```

2. **Create environment file:**
   ```bash
   cp .env.example .env
   ```

3. **Configure tokens:**
   ```bash
   # Generate secure tokens
   openssl rand -hex 32  # Use this for API_TOKEN
   openssl rand -hex 32  # Use this for SERVER_TOKEN
   
   # Edit .env
   nano .env
   ```

4. **Start the stack:**
   ```bash
   docker-compose up -d --build
   ```

5. **Verify it's running:**
   ```bash
   docker-compose ps
   docker-compose logs -f
   ```

### What Gets Deployed

**Services:**

- **API Server** — Express.js backend (port 3000 internal)
- **Frontend** — React app (port 5173 internal)
- **Caddy** — Reverse proxy (port 3069 exposed)

**Volumes:**

- `./data` — SQLite database, demos, logs
- Caddy data — SSL certificates (if configured)

**Access:**

- 🌐 **Everything:** http://localhost:3069
- Frontend: /
- API: /api
- API Docs: /api-docs

---

## Local Development Installation

### Prerequisites

- Node.js 18+ or Bun
- npm or pnpm
- Git

### Steps

1. **Clone repository:**
   ```bash
   git clone https://github.com/yourusername/matchzy-auto-tournament.git
   cd matchzy-auto-tournament
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Configure environment:**
   ```bash
   cp .env.example .env
   nano .env  # Edit with your tokens
   ```

4. **Run development servers:**
   ```bash
   npm run dev
   ```

   This starts:
   - Backend API on port 3000
   - Frontend dev server on port 5173
   - Hot reload enabled

5. **Access the app:**
   - Frontend: http://localhost:5173
   - API: http://localhost:3000
   - API Docs: http://localhost:3000/api-docs

### Production Build

```bash
npm run build
npm start
```

---

## Bun Installation (Alternative)

Bun is a faster JavaScript runtime alternative to Node.js.

```bash
# Install dependencies
bun install

# Development
bun run dev

# Production
bun run build
bun start
```

---

## Updating

### Docker

```bash
cd matchzy-auto-tournament
git pull
docker-compose down
docker-compose up -d --build
```

### Local/Bun

```bash
git pull
npm install  # or: bun install
npm run build
npm start
```

---

## Uninstallation

### Docker

```bash
docker-compose down -v  # -v removes volumes (deletes database)
cd ..
rm -rf matchzy-auto-tournament
```

### Local

```bash
# Just delete the folder
cd ..
rm -rf matchzy-auto-tournament
```

!!! warning "Data Loss"
    This deletes everything including:
    
    - Tournament data
    - Team rosters
    - Match history
    - Demo files
    
    Backup `./data` folder if you want to keep records!

---

## Next Steps

- ⚙️ **[Configuration Guide](configuration.md)** — Environment variables explained
- 🎮 **[First Tournament](first-tournament.md)** — Run your first event

