# Feature Overview

A comprehensive look at everything MatchZy Auto Tournament can do.

---

## Tournament Management

### Bracket Generation

**Supported Formats:**

| Format             | Teams/Players | Matches         | Description                                         |
| ------------------ | ------------- | --------------- | --------------------------------------------------- |
| Single Elimination | 2-128 teams   | ~N              | One loss = eliminated                               |
| Double Elimination | 2-128 teams   | ~2N             | Two losses = eliminated                             |
| Round Robin        | 2-32 teams    | N(N-1)/2        | Everyone plays everyone                             |
| Swiss              | 4-64 teams    | ~log₂(N) rounds | Similar records face off                            |
| Shuffle Tournament | 10+ players   | Dynamic         | Individual competition, teams reshuffled each round |

**Features:**

- ✅ Automatic bye handling for non-power-of-two team counts
- ✅ Smart seeding (random or manual)
- ✅ Walkover support (missing team advances opponent)
- ✅ Third-place match (optional)
- ✅ Bracket regeneration without losing tournament

### Tournament Lifecycle

**States:**

1. **Setup** → Configuring tournament and teams

   - Add teams
   - Select format and map pool
   - Can modify teams

2. **Ready** → Bracket generated, waiting to start
   - Bracket preview available
   - Can regenerate bracket
3. **In Progress** → Tournament active, matches running
   - Matches automatically progress
   - Real-time updates

- Tournament title can be renamed (settings remain locked)

4. **Completed** → All matches finished
   - Final results available
   - Demos ready for download

---

## Match System

### Match Statuses

**Pending** → Match created but tournament not started  
**Ready** → Tournament started, waiting for veto or server  
**Loaded** → On server, warmup mode, players connecting  
**Live** → Match in progress, rounds being played  
**Completed** → Winner determined, bracket updated

> **Shuffle tournaments (no veto)**  
> Shuffle tournaments skip the map veto phase entirely. Matches are still created with status `pending`, but once the tournament is started they behave like the “waiting for server” cases below (no "VETO PENDING" or veto-related messaging).

### Intelligent Match Status Messages

The system shows context-aware status messages:

| Status        | Condition                   | Message                                                                   |
| ------------- | --------------------------- | ------------------------------------------------------------------------- |
| Pending       | Tournament not started      | "Waiting for tournament to start..."                                      |
| Pending       | Veto not complete           | "VETO PENDING" / "Waiting for map veto to begin..."                       |
| Pending/Ready | Veto complete, no server    | "WAITING FOR SERVER" / "Veto complete - Waiting for server assignment..." |
| Ready         | Server assigned, not loaded | "READY"                                                                   |
| Loaded        | 0 players                   | "WARMUP" / "Server ready - Waiting for players (0/10)"                    |
| Loaded        | Some players                | "WARMUP" / "Waiting for players (3/10)"                                   |
| Loaded        | All players                 | "WARMUP" / "All players connected - Waiting for ready up"                 |
| Live          | -                           | "LIVE" / "Match in progress"                                              |

For **shuffle tournaments**, the system automatically treats veto as completed (since there is no voting step), so once the tournament is started and no server is assigned yet, pending/ready matches go straight to the “WAITING FOR SERVER” variants rather than showing any veto-related messages.

---

## Real-Time Features

### WebSocket Events

**Frontend automatically updates when:**

- 🔄 Match status changes (pending → ready → loaded → live → completed)
- 🔄 Players connect/disconnect
- 🔄 Players ready/unready
- 🔄 Veto actions happen (ban, pick, side selection)
- 🔄 Tournament state changes (starts, completes)
- 🔄 Bracket updates (winners determined)

**No page refresh required!**

### Player Connection Tracking

Shows **live roster** of all 10 players with status:

- ✅ **Offline** — Player not connected (gray)
- ⚠️ **Connected** — Player joined, not ready (yellow)
- ✅ **Ready** — Player typed `.ready` (green)

**Tracked via events:**

- `player_connect` → Add to roster
- `player_disconnect` → Remove from roster
- `player_ready` → Mark as ready
- `player_unready` → Mark as not ready

---

## Server Management

### Auto Server Allocation

When tournament starts or veto completes:

1. System attempts to find available servers (online + not in use)
2. **If server available:** Allocates immediately
3. **If no server available:** Backend polls every 10 seconds for available servers
4. Allocates server to match when found
5. Generates match config with teams and maps
6. Sends RCON: `matchzy_loadmatch_url "http://api/matches/{slug}.json"`
7. Configures webhook: `matchzy_remote_log_url "http://api/events/{slug}"`
8. Configures demo upload
9. Match goes to warmup
10. Updates sent via WebSocket — teams see server info automatically

!!! tip "Waiting for Server"
If all servers are busy, matches show "WAITING FOR SERVER" status. The system automatically checks every 10 seconds and assigns servers as they become available. No manual intervention needed!

**All automatic!**

### Server Status Monitoring

- **RCON Heartbeat:** Periodic status checks
- **Match Tracking:** Which match is on which server
- **Auto-Config:** Webhook configured on status check
- **Health Indicators:** Online/offline status with colors

---

## MatchZy Enhanced Configuration

### Automatic Match Configuration

The platform automatically applies **MatchZy Enhanced v1.3.0** configuration (11 cvars) based on tournament type, providing enhanced match control without manual configuration.

**Configuration Profiles:**

| Tournament Type | Profile | Auto-Ready | Pauses | Forfeit (.gg) | FFW |
|-----------------|---------|------------|--------|---------------|-----|
| Single Elimination | Official | ❌ Manual | 2 per team (5 min) | ❌ Disabled | ✅ 4 min |
| Double Elimination | Official | ❌ Manual | 2 per team (5 min) | ❌ Disabled | ✅ 4 min |
| Swiss | Official | ❌ Manual | 2 per team (5 min) | ❌ Disabled | ✅ 4 min |
| Round Robin | Official | ❌ Manual | 2 per team (5 min) | ❌ Disabled | ✅ 4 min |
| Shuffle Tournament | Shuffle | ✅ Auto | 1 per team (3 min) | ❌ Disabled | ❌ Disabled |
| Manual Matches | Default | ❌ Manual | ♾️ Unlimited | ❌ Disabled | ❌ Disabled |

**Features:**

- **Auto-Ready System** — Players automatically marked ready on connect
- **Enhanced Pause Controls** — Limit pauses per team, duration, unpause requirements
- **Side Selection Timer** — Enforce time limit after knife round
- **Match Forfeit (.gg)** — Team surrender via vote (disabled in competitive)
- **Forfeit/Walkover (FFW)** — Auto-forfeit timer when team disconnects
- **Demo Recording** — Control demo recording for performance tuning

**Official Profile (Competitive Tournaments):**

```json
{
  "matchzy_autoready_enabled": 0,              // Manual ready
  "matchzy_both_teams_unpause_required": 1,    // Both teams must unpause
  "matchzy_max_pauses_per_team": 2,            // 2 pauses per team
  "matchzy_pause_duration": 300,               // 5 minute limit
  "matchzy_side_selection_time": 60,           // 60 seconds
  "matchzy_gg_enabled": 0,                     // No forfeits
  "matchzy_ffw_enabled": 1,                    // Handle disconnects
  "matchzy_ffw_time": 240                      // 4 minutes
}
```

**Shuffle Profile (Fast-Paced):**

```json
{
  "matchzy_autoready_enabled": 1,              // Auto-ready
  "matchzy_max_pauses_per_team": 1,            // 1 pause
  "matchzy_pause_duration": 180,               // 3 minutes
  "matchzy_side_selection_time": 30,           // Quick (30s)
  "matchzy_ffw_enabled": 0                     // No FFW for temp teams
}
```

**Default Profile (Manual Matches):**

```json
{
  "matchzy_autoready_enabled": 0,              // Manual ready
  "matchzy_max_pauses_per_team": 0,            // Unlimited
  "matchzy_pause_duration": 0,                 // No limit
  "matchzy_gg_enabled": 0,                     // No forfeits
  "matchzy_ffw_enabled": 0                     // No FFW
}
```

Manual matches can override these defaults by providing custom cvars in the match configuration.

---

## Event Processing

### 25+ MatchZy Events Processed

**Player Events:**

- `player_connect`, `player_disconnect`
- `player_ready`, `player_unready`
- `player_death`, `round_mvp`

**Match Phase Events:**

- `series_start`, `series_end`
- `going_live`, `warmup_ended`
- `knife_round_started`, `knife_round_ended`
- `halftime_started`, `overtime_started`

**Round Events:**

- `round_started`, `round_end`
- `bomb_planted`, `bomb_defused`, `bomb_exploded`

**Pause Events:**

- `match_paused`, `unpause_requested`, `match_unpaused`

**Admin Events:**

- `side_swap`, `backup_loaded`

**All events:**

- ✅ Logged to console
- ✅ Stored in database (`match_events` table)
- ✅ Logged to files (`data/logs/events/`)
- ✅ Broadcast via WebSocket
- ✅ Trigger appropriate service updates

---

## Admin Controls

### Live Match Controls

**Available during warmup/live:**

- ▶️ Start match (force start)
- 🔄 Restart match
- ⏸️ Pause match (admin pause - players can't unpause)
- ▶️ Unpause match
- 💬 Broadcast message
- 🔄 Restore backup (specific round)
- 🗺️ Change map
- 🔀 Swap teams
- ⏭️ Skip veto
- 🔪 Toggle knife round
- ⏱️ Add time
- 🏁 End match
- 👥 **Add backup player** (new!)

### Backup Player System

**How it works:**

1. Admin opens match modal
2. Scrolls to "Add Backup Player"
3. Types player name in autocomplete search
4. Selects player from dropdown (shows all tournament players)
5. Chooses target team (Team 1 or Team 2)
6. Clicks "Add Player to Match"

**Backend sends RCON:**

```
get5_addplayer {steamId} {team} "{nickname}"
```

**Features:**

- ✅ Searches across all teams in tournament
- ✅ Filters out players already in match
- ✅ Shows player's original team
- ✅ Real-time autocomplete
- ✅ Requires player to reconnect after adding

---

## Demo Recording

### Automatic Demo Upload

MatchZy automatically uploads demos when matches complete:

**Backend endpoint:** `POST /api/demos/{matchSlug}/upload`

**Features:**

- ✅ Streaming upload (doesn't load entire file into memory)
- ✅ Match-specific folders (`demos/{matchSlug}/`)
- ✅ Original filename preserved
- ✅ Metadata from headers (map number, match ID)

### Demo Download

Admins can download demos from:

- Match Details modal
- Match History page
- API: `GET /api/demos/{matchSlug}/download`

---

## Team Experience

### Public Team Pages

**URL Format:** `/team/{team-id}/match`

**No login required** — teams access via shared link

**Features:**

- 🎮 Current match info (opponent, round, status)
- 🗺️ Map veto interface (BO1/BO3/BO5)
- 🖥️ Server connection details (IP, port, connect command)
- 📊 Live player status (who's connected, who's ready)
- 📈 Team statistics (wins, losses, win rate)
- 📜 Match history (past opponents and scores)
- 🔊 Sound notifications (customizable)

### Sound Notifications

**8 Available Sounds:**

- Notification (default)
- Alert
- Bell
- Chime
- Ding
- Ping
- Pop
- Success

**Controls:**

- 🔊 Volume slider
- 🔇 Mute toggle
- 🎵 Sound preview
- 💾 Persists per browser

**Plays when:** Match status changes to "loaded" or "live"

---

## Monitoring & Debugging

### Server Events Monitor

**Admin Tools → Server Events Monitor**

Shows **unfiltered stream** of all MatchZy events from all servers:

- ✅ Last 100 events buffered
- ✅ Real-time WebSocket updates
- ✅ Color-coded by event type
- ✅ Full JSON payload display
- ✅ Pause/resume streaming
- ✅ Server filter (optional)

**Perfect for debugging:**

- Verify events are being sent
- Check player Steam IDs
- Monitor match progression
- Identify configuration issues

### Event File Logging

All events logged to: `data/logs/events/{serverId}/{date}.log`

**Retention:** 30 days  
**Format:** JSON lines  
**Use case:** Historical analysis, debugging, recovery

---

## Maps & Map Pools

### Custom Map Management

**Features:**

- ✅ **Automatic map import** - Latest maps imported from GitHub on first start
- ✅ Add custom maps with Map ID and display name
- ✅ Upload map images or fetch from GitHub automatically
- ✅ Edit map details (display name, image)
- ✅ Delete unused maps

**Automatic Import:**

- Fetches maps from [CS2 Server Manager repository](https://github.com/sivert-io/cs2-server-manager/tree/master/map_thumbnails)
- Imports all `de_`, `cs_`, and `ar_` maps automatically
- Creates map pools by type (Defusal, Hostage, Arms Race)
- Runs on first start or when maps table is empty

### Map Pool System

**Create Reusable Pools:**

- ✅ Build custom map pools for different tournament types
- ✅ Active Duty pool (7 competitive maps) always available
- ✅ **Automatic pools** - Defusal only, Hostage only, and Arms Race only pools created automatically
- ✅ Select pools during tournament creation
- ✅ Save custom selections as new pools

**Tournament Integration:**

- Select from Active Duty, custom pools, or create custom selection
- System validates 7 maps required for veto formats (BO1/BO3/BO5)
- Map pools used in Round Robin/Swiss for rotation

> 📖 **[Managing Maps](../guides/managing-maps.md)** — Complete guide to maps and map pools

---

## Players, Ratings & Shuffle Tournaments

### Global Player System

- ✅ **Players page** – Central directory of all players with name, avatar, Steam ID, and current ELO
- ✅ **Team integration** – Team import and team editing automatically create/link players (single source of truth)
- ✅ **Public player pages** – `/player/:steamId` with ELO history, match history, performance metrics, **and current/next match info including server connect details**
- ✅ **Find Player flow** – `/player` search by Steam URL/ID

### OpenSkill-Based Rating Engine

- ✅ **OpenSkill-backed ratings** – Bayesian rating with FaceIT-style ELO scale for all tournament types
- ✅ **Global Skill Rating system** – Single Skill Rating per player (default ~1500 from OpenSkill), shared across all tournaments and matches
- ✅ **Per-match rating updates** – Ratings update automatically when matches complete
- ✅ **Rating history** – `player_rating_history` tracks before/after ELO and OpenSkill values per match

> ℹ️ **Background reading**
>
> - **OpenSkill**: modern Bayesian rating system for teams and games – see the official docs at [openskill.me](https://openskill.me).
> - **ELO-style ratings**: classic chess-inspired rating model; we present OpenSkill results as an ELO-like number so it feels familiar.
> - **Bayesian ratings vs. simple ELO**: Bayesian systems (like TrueSkill/OpenSkill) handle uncertainty and team games better than naive win–loss ELO.

### ELO Calculation Templates

- ✅ **ELO templates** – Define how stats (ADR, K/D, assists, utility, MVPs, etc.) adjust base ELO
- ✅ **Per-tournament configuration** – Select template per tournament or use pure win/loss mode
- ✅ **Stat storage** – Detailed per-match stats stored in `player_match_stats` and surfaced on player pages

### Shuffle Tournament Mode

- ✅ **Shuffle tournament format** – Individual player competition with teams reshuffled every round
- ✅ **Automatic team balancing** – Greedy + optimization algorithm balances teams by updated ELO each round
- ✅ **Automatic rounds** – System generates matches, detects round completion, reshuffles teams, and advances
- ✅ **Player leaderboard** – Tournament-specific leaderboard sorted by wins → ELO → ADR with public leaderboard page
- ✅ **Player-centric match access** – Players can keep their `/player/:steamId` page open to always see their current/next shuffle match and server connect info (no per-round team links needed)

---

## Next Steps

- 🗺️ **[Managing Maps](../guides/managing-maps.md)** — Maps and map pools guide
- 🎮 **[Map Veto System](map-veto.md)** — Interactive pick/ban flow
- 📖 **[Running Matches](../guides/running-matches.md)** — Match management guide
- 🎯 **[First Tournament](../getting-started/first-tournament.md)** — Step-by-step tutorial
