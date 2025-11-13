# Troubleshooting

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

**Symptoms:** No real-time updates, player connections not showing

**Check:**

- CS2 console: `[MatchZy] Remote log sent: ...`
- API console for events
- Webhook configuration
- SERVER_TOKEN matches

**Fix:**

1. Check CS2 can reach API (from your CS2 server):
    - Docker: `curl http://192.168.1.50:3069/api/events/test`
    - Local dev: `curl http://192.168.1.50:3000/api/events/test`
2. Verify `matchzy_remote_log_url` is set correctly
3. Verify `matchzy_remote_log_header_value` matches SERVER_TOKEN
4. Click "Check Status" to reconfigure webhooks
5. Check firewall allows inbound on port **3069** (Docker) or **3000** (local dev)

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

## Docker Issues

### Container Won't Start

**Fix:**

```bash
# Check logs
docker compose logs api

# Common issues:
# - Port already in use: change PORT in .env
# - Database locked: rm data/tournament.db (WARNING: deletes data)
# - Missing .env: cp .env.example .env
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
# .env
LOG_LEVEL=debug
NODE_ENV=development
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
npm run build
npm start
```

## Getting Help

If you're still stuck:

1. Check GitHub Issues: https://github.com/sivert-io/matchzy-auto-tournament/issues
2. Start a Discussion: https://github.com/sivert-io/matchzy-auto-tournament/discussions
3. Include:
   - What you were trying to do
   - Error messages (API logs, CS2 console)
   - Browser console errors (if frontend issue)
   - Your setup (Docker/local, network config)
