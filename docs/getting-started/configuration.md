# Configuration

Complete guide to environment variables and configuration options.

---

## Environment Variables

### Required Variables

#### `API_TOKEN`

**Purpose:** Admin authentication for Web UI and API access

**Generate:**
```bash
openssl rand -hex 32
```

**Used by:**
- Web UI login
- All authenticated API endpoints
- Protected routes

**Example:**
```bash
API_TOKEN=a1b2c3d4e5f67890abcdef1234567890abcdef1234567890abcdef1234567890
```

---

#### `SERVER_TOKEN`

**Purpose:** CS2 server authentication for MatchZy webhooks

**Generate:**
```bash
openssl rand -hex 32
```

**Used by:**
- MatchZy webhook event authentication (`X-MatchZy-Token` header)
- Match config loading (Bearer token)
- Validating all communication from game servers

**Example:**
```bash
SERVER_TOKEN=fedcba0987654321fedcba0987654321fedcba0987654321fedcba0987654321
```

!!! danger "Security Warning"
    **Never use default values in production!**
    
    Always generate unique random tokens. These control access to your entire system.

---

#### `WEBHOOK_URL`

**Purpose:** URL where CS2 servers send MatchZy events and fetch match configs

**Must be reachable from your CS2 servers!**

**Examples:**

| Environment | Example | Notes |
|-------------|---------|-------|
| Local testing | `http://localhost:3000` | Only works if CS2 server on same machine |
| LAN/Same network | `http://192.168.1.100:3000` | Use your machine's local IP |
| Cloud/VPS | `https://api.yourdomain.com` | Public domain with SSL |
| Production | `https://tournament.example.com` | Full production setup |

**How to find your local IP:**

```bash
# Linux/Mac
hostname -I | awk '{print $1}'

# Windows
ipconfig | findstr IPv4
```

---

### Optional Variables

#### `STEAM_API_KEY`

**Purpose:** Resolve Steam vanity URLs to Steam IDs

**Get one for free:** https://steamcommunity.com/dev/apikey

**Example:**
```bash
STEAM_API_KEY=ABCDEF1234567890ABCDEF1234567890
```

**Enables:**
- Adding players by profile URL: `https://steamcommunity.com/id/username`
- Without it: Must use Steam64 ID directly

---

#### `API_URL`

**Purpose:** Base URL for webhook configuration (fallback if not in request)

**Example:**
```bash
API_URL=http://192.168.1.100:3001
```

**Used for:** Auto-loading matches after veto completion

---

#### `PORT`

**Purpose:** Port for API server

**Default:** `3000`

**Example:**
```bash
PORT=3001
```

---

#### `NODE_ENV`

**Purpose:** Environment mode

**Options:** `development` | `production`

**Default:** `development`

**Effects:**
- Production: Minified logs, no debug output
- Development: Verbose logs, better error messages

---

#### `LOG_LEVEL`

**Purpose:** Logging verbosity

**Options:** `error` | `warn` | `info` | `debug`

**Default:** `info`

**Example:**
```bash
LOG_LEVEL=debug  # Show everything
```

---

#### `CORS_ORIGIN`

**Purpose:** Socket.IO CORS origin

**Default:** `*` (allow all)

**Example:**
```bash
CORS_ORIGIN=https://yourdomain.com
```

---

## Complete `.env` Example

```bash title=".env"
# ===== REQUIRED =====

# Admin authentication
API_TOKEN=a1b2c3d4e5f67890abcdef1234567890abcdef1234567890abcdef1234567890

# CS2 server authentication  
SERVER_TOKEN=fedcba0987654321fedcba0987654321fedcba0987654321fedcba0987654321

# Webhook URL (CS2 servers must reach this)
WEBHOOK_URL=http://192.168.1.100:3000

# ===== OPTIONAL =====

# Steam vanity URL support
STEAM_API_KEY=ABCDEF1234567890ABCDEF1234567890

# API base URL (for veto auto-load)
API_URL=http://192.168.1.100:3001

# Server configuration
PORT=3001
NODE_ENV=production
LOG_LEVEL=info

# Socket.IO CORS
CORS_ORIGIN=*
```

---

## CS2 Server Configuration

### MatchZy Installation

1. **Download MatchZy:**
   - Get latest from: https://github.com/shobhit-pathak/MatchZy/releases
   - Requires CounterStrikeSharp installed

2. **Install plugin:**
   ```bash
   # Extract to your CS2 server directory:
   csgo/addons/counterstrikesharp/plugins/MatchZy/
   ```

3. **Restart server:**
   ```bash
   # Server will load MatchZy plugin
   ```

### Webhook Auto-Configuration

!!! success "Automatic Setup"
    The system **auto-configures** MatchZy when you:
    
    - Check server status in Admin Tools
    - Load a match (manual or automatic)
    - Start the tournament
    
    You don't need to manually edit MatchZy config files!

**What gets configured:**

```
matchzy_remote_log_url "http://192.168.1.100:3000/api/events/{match-slug}"
matchzy_remote_log_header_key "X-MatchZy-Token"
matchzy_remote_log_header_value "{your-server-token}"
get5_check_auths true
```

### Manual Configuration (Optional)

If you want persistent configuration, add to `server.cfg`:

```cfg title="csgo/cfg/server.cfg"
// MatchZy Auto Tournament Integration
exec matchzy_tournament.cfg
```

```cfg title="csgo/cfg/matchzy_tournament.cfg"
matchzy_remote_log_url "http://192.168.1.100:3000/api/events"
matchzy_remote_log_header_key "X-MatchZy-Token"  
matchzy_remote_log_header_value "your-server-token-here"
matchzy_remote_log_events "all"
get5_check_auths true
```

---

## Firewall Configuration

### Ports to Open

**API Server (inbound):**
- `3000/tcp` — API and webhooks (from CS2 servers)
- `3069/tcp` — Docker reverse proxy (optional)

**CS2 Servers (inbound):**
- `27015/tcp` — RCON connections (from API server)
- `27015/udp` — Game traffic (players)

**Example UFW rules:**
```bash
sudo ufw allow 3000/tcp comment 'MatchZy API'
sudo ufw allow 27015/tcp comment 'CS2 RCON'
sudo ufw allow 27015/udp comment 'CS2 Game'
```

---

## Database Configuration

### SQLite Database

**Location:** `./data/tournament.db`

**Schema:** Auto-created on first run

**Backup:**
```bash
# Copy database file
cp data/tournament.db data/tournament.db.backup

# Or use Docker volume backup
docker run --rm -v matchzy-auto-tournament_data:/data -v $(pwd):/backup ubuntu tar czf /backup/data-backup.tar.gz /data
```

---

## Next Steps

- 🎮 **[First Tournament](first-tournament.md)** — Run your first event
- 🔧 **[Troubleshooting](../troubleshooting/common-issues.md)** — Fix common problems

