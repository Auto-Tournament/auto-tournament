# Running Matches

## Match Flow

### 1. Tournament Start

**For BO1/BO3/BO5 (with veto):**
- Teams notified to start veto
- Teams visit their team page
- Complete map veto (see [Map Veto](../features/map-veto.md))
- System auto-allocates server after veto
- Match loads automatically

**For Round Robin/Swiss (no veto):**
- System immediately allocates servers
- Matches load automatically
- Teams receive server IPs

### 2. Warmup Phase

Players connect to server:
```
connect 192.168.1.100:27015
```

- Players auto-assigned to correct team
- Type `.ready` when ready
- Match starts when all 10 players ready

**Monitor progress:**
- Matches page shows "8/10 players connected"
- Click match for detailed player roster
- See who's connected and ready

### 3. Live Match

Real-time updates show:
- Current score
- Round number
- Match phase (live, halftime, overtime, paused)

### 4. Match Complete

- Winner auto-determined
- Bracket auto-updates
- Demo file auto-uploaded
- Server freed for next match

## Admin Controls

Available from match details modal:

### Match Control
- **Pause** - Admin pause (players can't unpause)
- **Unpause** - Force resume
- **Swap Teams** - Switch sides
- **Restart Round** - Restart current round

### Advanced Actions
- **Skip Veto** - Skip map veto if stuck
- **End Warmup** - Force start match
- **End Match** - Complete match early
- **Restart Match** - Full reset
- **Restore Backup** - Load previous round
- **Add Time** - Extend match time
- **Broadcast Message** - Send message to all players
- **Change Map** - Switch map

### Player Management
- **Add Backup Player** - Add substitute mid-match

## Common Scenarios

### Player Connection Issues

**Problem:** Player can't connect, gets "Auth rejected"

**Solution:**
1. Pause match
2. Admin Controls → Player Management → Add Backup Player
3. Search for player, select team
4. Player can now connect

### Server Issues / Lag

**Solution:**
1. Pause match immediately
2. Broadcast message: "Technical pause - investigating"
3. Check server status
4. Options:
   - Restore backup to previous round
   - Restart round
   - Move to backup server (if available)
5. Resume match

### Disputed Round

**Solution:**
1. Pause match
2. Review situation with teams
3. Options:
   - Continue (ruling: round stands)
   - Restore backup to previous round
   - Restart round

### Server Crash

**Solution:**
1. Note last completed round
2. Restart CS2 server
3. Re-add server in system
4. Load match manually
5. Restore to last completed round
6. Resume

## Match Monitoring

**Matches Page:**
- See all live matches
- Real-time scores
- Player connection status
- Click for full details

**Bracket Page:**
- Visual bracket with live updates
- Click matches for details
- See progression

**Team Pages:**
- Teams monitor their own matches
- No admin access needed
- Shows server IP, player roster, scores

## Demo Files

- Automatically uploaded at map end
- Download from match details
- Saved to `demos/{match-slug}/` folder
- Use for reviews, disputes, highlights

## Best Practices

### Before Match
- Notify teams 30 minutes early
- Verify server is online
- Have backup server ready
- Join server to test

### During Match
- Monitor matches page
- Be ready to pause for issues
- Communicate via broadcast
- Log any incidents

### Communication
Use broadcast for announcements:
```
"Technical pause - investigating lag"
"Pausing for 5 minutes - player hardware issue"
"Round will be restored to round 15"
```
