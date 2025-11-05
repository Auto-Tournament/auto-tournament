# Your First Tournament

This guide walks you through creating and running your first tournament from start to finish.

---

## Step 1: Add CS2 Servers

1. Navigate to **Admin Tools** in the sidebar
2. Scroll to **Server Management**
3. Click **Add Server**
4. Fill in server details:
   ```
   Server ID: ntlan_1
   Server Name: NTLAN Server #1
   Host: 192.168.1.50
   Port: 27015
   RCON Password: your-rcon-password
   ```
5. Click **Add Server**
6. Click **Check Status** to verify RCON connection

!!! tip "Server Status"
    Servers should show as **ONLINE** with a green indicator. If offline:
    
    - Verify the server is running
    - Check host/port are correct
    - Verify RCON password matches
    - Ensure firewall allows connection

!!! info "Auto-Configuration"
    When you check server status, the system automatically configures:
    
    - MatchZy webhook URL
    - Event header authentication
    - Whitelist protection
    
    You don't need to manually configure `matchzy_remote_log_url`!

---

## Step 2: Add Teams

1. Go to **Tournament** page
2. In the **Teams** section, click **Add Team**
3. Enter team details:
   ```
   Team ID: team-alpha
   Team Name: Team Alpha
   Tag: ALPHA (optional)
   ```
4. Add **5 players** to the team:
   - Enter Steam ID or profile URL
   - System automatically fetches Steam names
5. Click **Add Team**
6. Repeat for all teams

!!! example "Minimum Teams Required"
    - **Single/Double Elimination:** 2, 4, 8, 16, 32, 64, or 128 teams
    - **Round Robin:** Any number (2-32)
    - **Swiss:** 4, 8, 16, 32, or 64 teams

---

## Step 3: Create Tournament

1. Scroll to **Tournament Configuration**
2. Click **Create New Tournament**
3. Fill in tournament details:
   ```
   Name: November LAN Tournament
   Type: Single Elimination
   Format: Best of 3 (BO3)
   Teams: Select all your teams
   ```
4. Choose map pool (CS2 active duty maps)
5. Click **Create Tournament**

!!! success "Bracket Generated"
    The system automatically generates the bracket based on your tournament type and team count!

---

## Step 4: Review Bracket

1. Go to **Bracket** page
2. See your tournament structure:
   - **Grid View:** Visual bracket with rounds
   - **List View:** All matches in order
3. Click any match to see details

!!! info "Match Status Colors"
    - **Gray:** Pending (not started)
    - **Yellow:** Ready (waiting for veto/server)
    - **Blue:** Loaded (warmup, players connecting)
    - **Red:** Live (match in progress)
    - **Green:** Completed (winner determined)

---

## Step 5: Start Tournament

### For BO1/BO3/BO5 Tournaments (with Veto)

1. Click **Start Tournament** button
2. Teams will see **map veto interface** on their team pages
3. Teams complete veto (alternating bans/picks)
4. Match automatically loads on available server
5. Players connect and match goes live

### For Round Robin/Swiss Tournaments (no Veto)

1. Click **Start Tournament** button
2. Matches immediately load on available servers
3. Players connect and matches go live

!!! warning "Ensure Servers Available"
    Make sure you have at least one online server before starting!
    Check **Admin Tools → Server Status** to verify.

---

## Step 6: Share Team Pages

1. In the **Bracket** view, click on a team
2. Click **Copy Team Link**
3. Share the link with that team

Example team URL:
```
http://localhost:3069/team/team-alpha/match
```

!!! success "What Teams See"
    Teams can access their page without logging in to:
    
    - ✅ Complete map veto (BO1/BO3/BO5)
    - ✅ See server connection info
    - ✅ View opponent and match status
    - ✅ Check player connection status
    - ✅ View match history and stats

---

## Step 7: Monitor Matches

### As Admin

**View Live Matches:**
- **Matches Page:** All live and upcoming matches
- **Bracket Page:** See tournament progression
- **Match Modal:** Click any match for detailed view

**Admin Controls:**
- Pause/unpause match
- Broadcast messages
- Add backup players
- Restart rounds/matches
- View player roster with ready status

### Event Monitoring

1. Go to **Admin Tools**
2. Scroll to **Server Events Monitor**
3. Select a server
4. See all events in real-time:
   ```
   [14:30:15] player_connect
   [14:30:18] player_ready
   [14:30:45] going_live
   ```

---

## Step 8: Match Completion & Progression

When a match completes:

1. ✅ **Winner determined** automatically
2. ✅ **Bracket advances** — Winner moves to next round
3. ✅ **Server freed** — Available for next match
4. ✅ **Demo saved** — Download from match details

The system automatically allocates servers to next round matches as they become ready!

---

## Common First-Time Issues

!!! failure "Veto interface not showing?"
    - Verify tournament status is **IN PROGRESS**
    - Check match status is **READY**
    - Ensure format is BO1, BO3, or BO5 (Round Robin/Swiss don't use veto)

!!! failure "Players can't connect?"
    - Check `get5_check_auths true` is set (auto-configured)
    - Verify player Steam IDs match team roster exactly
    - Players must be in the team roster to join

!!! failure "Events not showing?"
    - Verify `WEBHOOK_URL` in `.env` is reachable from CS2 servers
    - Check `SERVER_TOKEN` matches in `.env` and server config
    - Look for errors in API console logs

---

## Next Steps

- 📖 **[Learn about Map Veto](../features/map-veto.md)** — How the veto system works
- 🎮 **[Admin Controls Guide](../features/admin-controls.md)** — All available match controls
- 📡 **[Event Processing](../features/events.md)** — Understanding MatchZy events
- 🔧 **[Troubleshooting](../troubleshooting/common-issues.md)** — Fix common problems

---

**Congratulations! You've run your first tournament.** 🎉

Explore the rest of the documentation to learn about advanced features like player statistics, demo analysis, and more!

