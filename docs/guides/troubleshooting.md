# Troubleshooting

## Login & Access

### How do I get to the admin dashboard after signing in with Steam?

**If you land on the dashboard:** You're an admin. Use the sidebar to access Teams, Servers, Tournament, Settings, etc.

**If you land on your player profile:**

- **You're an admin:** Click **Dashboard** in the top bar, or open the avatar menu (top right) → **Dashboard**. On your profile page, use the **Go to Admin Dashboard** button.
- **You're not an admin:** Only administrators can access the dashboard. See below.

### I can't access the admin dashboard – am I an admin?

If you **upgraded from 1.x to 2.0**, see [Migrating to 2.0](migration-to-2.md) — you likely need to promote an existing player to admin.

**Check your status:** After signing in with Steam, open:

```
https://your-mat-url/api/auth/admin-status
```

(Use the same domain and port as the app, with your browser logged in.) The response shows `isAdmin`, `hasPlayerRecord`, `reason`, and a `hint` describing what to do.

**How admin promotion works:**

1. **First user only:** The *first* Steam user to sign in (when there are no other players) is automatically promoted to admin.
2. **Fresh DB:** If you "restart" or reset the database, all players are wiped. The *first* person to sign in with Steam after that becomes admin again.
3. **Already have players?** If anyone signed in before you (or players were imported), no one is auto‑promoted. An existing admin must add you as admin manually.

**Common mistakes:**

- **Restarted DB but didn’t sign in first:** Someone else signed in before you → they’re admin, you’re not. Have them add you, or reset DB again and be the first to sign in.
- **Expecting admin without Steam:** Admin is always tied to a Steam ID. Sign in with Steam (or link Steam via Connect Steam if you use Keycloak/Discord/GitHub).
- **Not in the players table:** You need a player record. Either enable self‑registration (Settings), or have an admin add you.

**Debugging:** Set `LOG_LEVEL=debug` and check API logs when you sign in. Look for `[Steam callback] Redirect decision` (shows `isAdmin`, `redirectTo`) and `[ensureFirstAdmin]` (explains why promotion was skipped or applied).

---

## Server Issues

### Server Shows Offline

**Symptoms:** Status shows 🔴 Offline

**Check:**

- Is CS2 server running?
- Is RCON password correct?
- Can API reach server on port 27015?
- Check firewall rules

**Fix:**

1. Verify server is running
2. Test RCON: `rcon_address IP:27015; rcon_password PASSWORD; rcon status`
3. Click "Check Status" to refresh
4. Reconfigure server with correct RCON password

### Match Won't Load

**Symptoms:** "Failed to load match" error

**Check:**

- Is server status "Online"?
- Is MatchZy plugin loaded? (`css_plugins list`)
- Can server reach API for webhook?

**Fix:**

1. Verify MatchZy installed
2. Check server console for errors
3. Try manual RCON: `matchzy_loadmatch_url https://...`
4. Restart CS2 server if needed

### Events Not Arriving

**Symptoms:** No real-time updates, player connections not showing. Servers stay "Config sent – no events received yet" or "Not Configured".

**Check game server logs/console** (CS2 + MatchZy) to see if MatchZy receives the webhook config and sends events. Look for MatchZy startup messages, webhook-related output, or errors. This tells you whether the problem is on the game server side (config not received, wrong URL, etc.) or on the MAT API side (events not reaching us).

**Check API logs** to see if the game server is actually sending events:

- **`[EVENTS] Incoming webhook`** — A request reached the API. Look for `event` and `server_id` in the same log line.
- **`[EVENTS] server_configured handled`** — MatchZy sent its "configured" confirmation; we updated `last_seen` for that server.
- **`[EVENTS] Webhook reachability check (GET /test)`** — Someone (e.g. `curl`) hit `GET /api/events/test`; use this to test connectivity.

**If you see no `[EVENTS]` lines when MatchZy should be sending:**

1. **Test reachability** from the game server (or same network):
   - Docker: `curl http://YOUR_MAT_IP:3069/api/events/test`
   - Local dev: `curl http://YOUR_MAT_IP:3000/api/events/test`
   - Check API logs for `[EVENTS] Webhook reachability check`. If that appears, the API is reachable; MatchZy may not be sending or may be using a different URL.
2. Verify **webhook URL** in Settings matches what the game server can reach (often `http://MAT_IP:3069`, not `localhost`).
3. Verify **SERVER_TOKEN** matches what MatchZy sends (`matchzy_remote_log_header_value`).
4. **Check the game server console/logs** for MatchZy output (e.g. `[MatchZy] Remote log sent: ...`) or errors. This confirms whether MatchZy is receiving config and attempting to send events.
5. Click **Retry** on the server card to resend config, then check both **game server** and **API** logs again for `[EVENTS] Incoming webhook` / `server_configured handled`.
6. Check firewall allows **inbound** on port **3069** (Docker) or **3000** (local dev).

## Match Issues

### Player Can't Connect

**Symptoms:** "Auth rejected" or similar

**Fix:**

1. Verify Steam ID is correct
2. Add as backup player:
   - Match Details → Player Management
   - Search player, select team, add
3. Ensure `get5_check_auths true` is set

### Veto Not Starting

**Symptoms:** No "Start Veto" button on team page

**Check:**

- Is tournament started?
- Is match format BO1/BO3/BO5?
- Is match status "ready"?

**Fix:**

1. Verify tournament is in "In Progress" state
2. Refresh team page
3. If stuck, admin can skip veto

### Match Stuck in Warmup

**Symptoms:** Waiting for players, but all are connected

**Check:**

- Are all players actually ready? (typed `.ready`)
- Are there 10/10 players?

**Fix:**

1. Check player roster for who's not ready
2. Ask players to type `.ready`
3. Or force start: Admin Controls → End Warmup

### Scores Not Updating

**Symptoms:** Live scores not changing

**Check:**

- Are events arriving? (check API logs)
- Is WebSocket connected? (check browser console)

**Fix:**

1. Refresh page
2. Check server events endpoint
3. Verify match is actually live on server

## Bracket Issues

### Winner Not Advancing

**Symptoms:** Match complete but bracket not updating

**Fix:**

1. Verify match status is "completed"
2. Check winner is set correctly
3. Manually set winner if needed:
   - Click match in bracket
   - Set Winner → Select team
4. Refresh bracket page

### Team Shows as "TBD"

**Symptoms:** Team slot shows "TBD" instead of team name

**Explanation:** Normal - waiting for previous match

**Fix:**

- Previous match must complete first
- Winner auto-fills the slot

## Network Issues

### API Server Unreachable

**Symptoms:** CS2 servers can't send webhooks

**Fix:**

1. Test API is reachable (from CS2 server):
   - Docker: `curl http://192.168.1.50:3069/api/events/test`
   - Local dev: `curl http://192.168.1.50:3000/api/events/test`
2. Check firewall allows inbound on port **3069** (Docker) or **3000** (local dev)
3. Verify the webhook URL in the dashboard **Settings** matches your setup:
   - Docker: typically `https://your-domain.com`
   - Local dev: `http://your-ip:3000`
4. Use IP address instead of hostname if DNS issues

### CS2 Server Unreachable

**Symptoms:** Can't send RCON commands

**Fix:**

1. Check server is running
2. Verify port 27015 is open
3. Test from API server: `nc -zv server-ip 27015`
4. Check RCON password is correct

## Access Issues

### Can't Sign In After Upgrade or Lost Admin Access

**Symptoms:** Can't log in, no admin users, or lost admin privileges after upgrade

**When to use:** This is an advanced recovery method for cases where you can't access the dashboard (e.g., after an upgrade, database migration, or if all admin accounts were removed).

**Solution:** Manually add or promote a user to admin via direct database access.

> **Important:** Run SQL commands directly on the `matchzy-postgres` container. The API container may not have `psql` installed or configured correctly.

#### Method 1: Add a new admin player

If the player doesn't exist in the database yet:

```bash
docker exec matchzy-postgres psql -U postgres -d matchzy_tournament -c "
INSERT INTO players (
    id, name, current_elo, starting_elo, openskill_mu, openskill_sigma, 
    match_count, is_admin, created_at, updated_at
) VALUES (
    '76561198000000001',
    'Admin User',
    1500, 1500, 25.0, 8.333, 0, 1,
    EXTRACT(EPOCH FROM NOW())::bigint,
    EXTRACT(EPOCH FROM NOW())::bigint
);
"
```

#### Method 2: Promote existing player to admin

If the player already exists but isn't an admin:

```bash
docker exec matchzy-postgres psql -U postgres -d matchzy_tournament -c "
UPDATE players 
SET is_admin = 1, updated_at = EXTRACT(EPOCH FROM NOW())::bigint 
WHERE id = '76561198000000001';
"
```

#### Troubleshooting: Still redirected to profile after update

If you ran the SQL update successfully but still get redirected to your profile when trying to access admin sections:

**1. Verify the update worked:**

```bash
docker exec matchzy-postgres psql -U postgres -d matchzy_tournament -c "
SELECT id, name, is_admin FROM players WHERE id = '76561198000000001';
"
```

You should see `is_admin = 1`. If it shows `0` or `NULL`, the update didn't work.

**2. Check Steam ID matches your session:**

The Steam ID in the database must match the Steam ID in your login session. Verify:
- The Steam ID you used in the SQL command is correct
- You're logged in with the same Steam account
- Check your session Steam ID: Look at the URL when redirected (`/player/76561198000000001`) - that's your session Steam ID

**3. Log out and log back in:**

The session may have cached your old admin status. After updating the database:
1. **Log out** completely (clear cookies or use incognito/private window)
2. **Log back in** via Steam
3. The new admin status should be recognized

**4. Verify the value is exactly 1:**

If `is_admin` shows as something other than `1`, fix it:

```bash
docker exec matchzy-postgres psql -U postgres -d matchzy_tournament -c "
UPDATE players 
SET is_admin = 1 
WHERE id = '76561198000000001';
"
```

**5. Check API logs:**

If still not working, check the API logs for auth errors:

```bash
docker compose logs api | grep -i "admin\|auth\|steam"
```

Look for messages like `"Steam user X is not an admin"` - this will show which Steam ID the system is checking.

> **Note:** 
> - Replace `76561198000000001` with the actual Steam64 ID
> - Find your Steam64 ID at [steamid.io](https://steamid.io/) or [steamidfinder.com](https://steamidfinder.com/)
> - If using custom database credentials, adjust `PGPASSWORD`, `-U`, `-d` accordingly
> - **Most common fix:** Log out and log back in after running the SQL update

#### Alternative: Interactive PostgreSQL session

If you prefer an interactive session to run multiple queries:

```bash
# Connect to PostgreSQL interactively
docker exec -it matchzy-postgres psql -U postgres -d matchzy_tournament

# Then run SQL commands:
UPDATE players SET is_admin = 1, updated_at = EXTRACT(EPOCH FROM NOW())::bigint WHERE id = '76561198000000001';

# Or for a new player:
INSERT INTO players (id, name, current_elo, starting_elo, openskill_mu, openskill_sigma, match_count, is_admin, created_at, updated_at)
VALUES ('76561198000000001', 'Admin User', 1500, 1500, 25.0, 8.333, 0, 1, EXTRACT(EPOCH FROM NOW())::bigint, EXTRACT(EPOCH FROM NOW())::bigint);

# Verify:
SELECT id, name, is_admin FROM players WHERE id = '76561198000000001';

# Exit
\q
```

## Docker Issues

### Container Won't Start

**Fix:**

```bash
# Check logs
docker compose logs api

# Common issues:
# - Port already in use: change PORT environment variable
# - Database connection issues: check DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME env vars
# - Missing environment variables: ensure SERVER_TOKEN and DB_* vars are set
```

### Can't Access from Other Machines

**Fix:**

```bash
# Ensure ports are exposed
docker compose ps

# Should show 0.0.0.0:3069->3069
# If not, check docker compose.yml ports section
```

## General Tips

### Enable Debug Logging

```bash
# Set environment variables
export LOG_LEVEL=debug
export NODE_ENV=development
```

Restart API to see detailed logs.

### Check Browser Console

Press F12 in browser, check Console tab for:

- WebSocket connection errors
- API request failures
- JavaScript errors

### Verify Environment

```bash
# Check all services
docker compose ps  # All should be "Up"

# Check API health
curl http://localhost:3069/api/events/test

# Check CS2 server
rcon_address IP:27015
rcon_password PASSWORD
rcon status
```

### Clean Slate Restart

If all else fails:

```bash
# Restart everything
docker compose down
docker compose up -d --build

# Or without Docker:
yarn build
yarn start
```

## Advanced Setup

### Build from Source

If you've cloned the repository and want to build from source:

```bash
git clone https://github.com/sivert-io/matchzy-auto-tournament.git
cd matchzy-auto-tournament
docker compose -f docker/docker-compose.local.yml up -d --build
```

### Local Development (without Docker)

For development with hot-reload:

```bash
# Install all dependencies for API and client (Yarn workspaces)
yarn install

# Start PostgreSQL (or use your own)
yarn db

# Set environment variables
export SERVER_TOKEN=your-server-token
export DB_HOST=localhost
export DB_PORT=5432
export DB_USER=postgres
export DB_PASSWORD=postgres
export DB_NAME=matchzy_tournament

# Start in dev mode (API + client)
yarn dev
```

**Frontend:** `http://localhost:5173`  
**API:** `http://localhost:3000`

**Configure Webhook URL:**

When you start the dev server, you'll see output like:

```
[CLIENT]   VITE v5.4.21  ready in 450 ms
[CLIENT]
[CLIENT]   ➜  Local:   http://localhost:5173/
[CLIENT]   ➜  Network: http://192.168.2.5:5173/
[CLIENT]   ➜  Network: http://100.110.237.14:5173/
[CLIENT]   ➜  Network: http://192.168.10.158:5173/
```

1. Go to **Settings** in the dashboard
2. Set the **Webhook URL** to the API endpoint:
   - **If CS2 servers are on the same machine:** `http://localhost:3000`
   - **If CS2 servers are on the network:** Use one of the Network IPs shown above, but change the port to `3000` (e.g., `http://192.168.2.5:3000`)
   - Use whichever IP your CS2 servers can reach
3. Click **"Save Settings"**

> **Note:** The frontend runs on port `5173`, but webhooks must point to the API on port `3000`.

### Docker Architecture

The Docker setup uses Caddy as a reverse proxy:

- Frontend app at `/` (root)
- API at `/api`
- Everything runs on port **3069** — just expose this single port for production

**Multi-Architecture Support:**

- `amd64` / `x86_64` (Intel/AMD 64-bit)
- `arm64` / `aarch64` (ARM 64-bit, e.g., Apple Silicon, Raspberry Pi 4+)
- `armv7` / `armv6` (ARM 32-bit, e.g., older Raspberry Pi)

### Network Configuration

**Private Network (LAN):**

- Everything on `192.168.x.x` - works out of the box
- Share team pages with local IPs

**Public Internet:**

- Get a domain or use public IP
- Expose/proxy port **3069** only
- Set webhook base URL in **Settings** to your public domain

**Recommended:** Run on private network, expose via reverse proxy if needed.

## Getting Help

If you're still stuck:

1. **Join our Discord Community**: [https://discord.gg/n7gHYau7aW](https://discord.gg/n7gHYau7aW) - Get real-time support, share ideas, and connect with other tournament hosts
2. Check GitHub Issues: https://github.com/sivert-io/matchzy-auto-tournament/issues
3. Start a Discussion: https://github.com/sivert-io/matchzy-auto-tournament/discussions

When asking for help, please include:
   - What you were trying to do
   - Error messages (API logs, CS2 console)
   - Browser console errors (if frontend issue)
   - Your setup (Docker/local, network config)
