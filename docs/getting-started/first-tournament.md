# Your First Tournament

Step-by-step guide to running a complete tournament with MatchZy Auto Tournament .

## Before You Start

Make sure you have:

- [x] System installed and running
- [x] At least 2 teams created with 5+ players each
- [x] At least one CS2 server with the [enhanced MatchZy plugin](https://me.sivert.io) installed

> **Haven't set up your CS2 server yet?** See the [CS2 Server Setup Guide](server-setup.md) for detailed installation instructions.

## Add Your First Server

Add your configured CS2 server to the system:

1. Click **Servers** in the sidebar
2. Click **"Add Server"**
3. Fill in:
   ```
   Name: My Server 1
   Host: 192.168.1.50
   Port: 27015
   RCON Password: <your-rcon-password>
   ```
4. Click **"Test Connection"** (optional)
5. Click **"Add Server"**

Server should show as 🟢 Online.

## Step 1: Create Tournament

1. Go to **Tournaments** page
2. Click **"Create Tournament"**

### Basic Info

```
Name: Weekend Cup 2025
Description: 8-team single elimination
```

### Choose Format

**Tournament Type:**

- **Single Elimination** - Fast, one loss and you're out
- **Double Elimination** - Second chance via lower bracket
- **Shuffle Tournament** - Individual player competition with dynamic team balancing (see [Shuffle Tournaments Guide](../guides/shuffle-tournaments.md))
- **Round Robin** - Everyone plays everyone
- **Swiss System** - Pairs teams by W/L record

**Match Format:**

- **BO1** - One map, veto required (7 maps → ban 6, pick sides)
- **BO3** - Three maps, veto required (7 maps → ban 4, pick 2, decider with side pick)
- **BO5** - Five maps, veto required (7 maps → ban 2, pick 4, decider with knife round)
- **Round Robin/Swiss** - Pre-set maps, no veto

### Select Teams

Check boxes for teams to include:

```
[x] Team Awesome
[x] Team Legends
[x] Team Alpha
[x] Team Beta
[x] Team Gamma
[x] Team Delta
[x] Team Echo
[x] Team Foxtrot
```

Power of 2 (2, 4, 8, 16) recommended for elimination brackets.

### Map Pool (for BO1/BO3/BO5)

Select a map pool from the dropdown:

**Options:**

- **Active Duty** - Default 7 competitive maps (recommended)
  - Ancient, Anubis, Dust II, Inferno, Mirage, Nuke, Vertigo
- **Custom Pools** - Any pools you've created (see [Managing Maps](../guides/managing-maps.md))
- **Custom** - Manually select maps for this tournament

**Requirements:**

- ⚠️ Need exactly 7 maps for proper veto flow
- Active Duty pool automatically has 7 maps
- Custom pools must have exactly 7 maps (warning shown if not)

> **Tip:** Create reusable map pools in the **Maps** page for quick selection in future tournaments.

## Step 2: Generate Bracket

Click **"Generate Bracket"**

System creates all matches with proper seeding. View bracket in:

- **Graph View** - Visual bracket tree
- **List View** - Simple match list

## Step 3: Share Team Pages

Before starting, send teams their URLs:

```
Team Awesome: https://your-domain.com/team/team-awesome
Team Legends: https://your-domain.com/team/team-legends
...
```

Teams should bookmark these - they'll use them for veto and monitoring.

## Step 4: Start Tournament

Click **"Start Tournament"**

### What Happens Next

**For BO1/BO3/BO5:**

1. Tournament status → "In Progress"
2. Teams receive notification to start veto
3. Teams visit their team page
4. Interactive map veto begins
5. When veto completes:
   - System finds available server
   - Generates match config with picked maps
   - Loads match automatically
   - Teams see server IP on their page

**For Round Robin/Swiss:**

1. Tournament status → "In Progress"
2. System allocates servers immediately
3. Matches load automatically
4. Teams see server IPs right away

## Step 5: Monitor Matches

### Matches Page

Real-time overview:

```
LIVE MATCHES
━━━━━━━━━━━━━━━━━━━━━━
Match #1 - Quarterfinals
Team Awesome  11 - 7  Team Legends
de_mirage • Live • 8/10 players
```

Click any match for:

- Detailed scores
- Player connection roster
- Admin controls

### Bracket Page

Visual bracket updates in real-time:

- Green checkmarks for completed matches
- Live scores for ongoing matches
- Winner advancement automatic

## Map Veto Process

(For BO1/BO3/BO5 matches)

### BO1 Example (CS Major Format):

```
1. Team A bans 1 map (first of 2)
2. Team A bans 1 map (second of 2)
3. Team B bans 1 map (first of 3)
4. Team B bans 1 map (second of 3)
5. Team B bans 1 map (third of 3)
6. Team A bans 1 map
7. Team B picks starting side on remaining map
```

### BO3 Example (CS Major Format):

```
1. Team A bans 1 map
2. Team B bans 1 map
3. Team A picks Map 1
4. Team B picks side for Map 1
5. Team B picks Map 2
6. Team A picks side for Map 2
7. Team B bans 1 map
8. Team A bans 1 map
9. Team B picks side for Map 3 (decider)
```

Teams see turn-based interface with:

- Colored action prompt (BAN/PICK/SIDE)
- Clickable map cards
- Veto history
- Real-time opponent actions

## During Matches

### Warmup

Players connect and type `.ready`:

```
connect 192.168.1.100:27015
.ready
```

Monitor progress: "8/10 players connected, 5 ready"

### Live Match

Automatic updates:

- Current score
- Round number
- Match phase (live, halftime, overtime, paused)

### Match Completion

When match ends:

- Winner auto-determined
- Winner advances in bracket
- Next match becomes "Ready"
- Demo file auto-uploaded
- Server freed for next match

## Admin Interventions

If issues arise, open match modal for:

**Quick Actions:**

- Pause/Unpause
- Swap Teams
- Restart Round

**Advanced:**

- Restore Backup (previous round)
- Add Backup Player
- Broadcast Message
- Force Start / End Match

See [Running Matches](../guides/running-matches.md) for detailed scenarios.

??? warning "Common Issues"

    **Veto stuck:**

    - Admin Controls → Skip Veto
    - Manually set maps if needed

    **No server available:**

    - Check server status (Admin Tools)
    - Free up busy servers
    - Add more servers

    **Player can't connect:**

    - Pause match
    - Add as backup player via admin controls
    - Verify Steam ID is correct

    **Match not auto-starting:**

    - Check all 10 players ready
    - Force start via admin controls
    - Check MatchZy console for errors

## Post-Tournament

### Results

- Bracket shows full tournament progression
- Download demos from match details
- Export bracket screenshot

### Players, ELO & Stats

- All players added to teams are also created in the global **Players** list with a display ELO.
- New players without an explicit ELO use your configured **Default Player ELO** from **Settings** (FaceIT-style, 3000 by default).
- After each match, player ratings are updated automatically using the OpenSkill engine, and detailed stats (ADR, K/D, MVPs, damage, etc.) are stored.
- You can open any player's public page (`/player/:steamId`) to see:
  - ELO history for all tournament types (not just shuffle)
  - Match history with per-map stats
  - Performance metrics and trends

### Cleanup

- Archive demo files
- Export team/match data if needed
- Server status should auto-reset to "Online"

## Tips

**Before tournament:**

- Test veto with dummy match
- Verify all servers online
- Share team pages in advance
- Have backup servers ready

**During tournament:**

- Monitor matches page continuously
- Have admin controls ready
- Communicate via broadcast
- Log any incidents

**After tournament:**

- Download all demos
- Screenshot final bracket
- Survey teams for feedback

## Next Steps

- **[Running Matches](../guides/running-matches.md)** - Detailed match operations
- **[Admin Controls](../features/overview.md)** - All admin features
- **[Troubleshooting](../guides/troubleshooting.md)** - Fix common issues
