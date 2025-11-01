# MatchZy Events Reference

Complete reference for all events sent by MatchZy to the webhook endpoint.

**Source:** [Official MatchZy Events Documentation](https://shobhit-pathak.github.io/MatchZy/events.html)

---

## Event Structure

All events share a common base structure:

```json
{
  "event": "event_name",
  "matchid": "match_slug"
}
```

Additional fields depend on the specific event type.

---

## Series Events

### series_start

Sent when a match series begins.

```json
{
  "event": "series_start",
  "matchid": "team_a_vs_team_b",
  "team1_name": "Team A",
  "team2_name": "Team B",
  "num_maps": 3
}
```

### series_end

Sent when a match series completes.

```json
{
  "event": "series_end",
  "matchid": "team_a_vs_team_b",
  "team1_series_score": 2,
  "team2_series_score": 1,
  "winner": "team1",
  "time_until_restore": 300
}
```

**Winner values:** `team1`, `team2`, or `none` (for ties)

---

## Map Events

### map_result

Sent when a map finishes.

```json
{
  "event": "map_result",
  "matchid": "team_a_vs_team_b",
  "map_number": 1,
  "map_name": "de_dust2",
  "team1_score": 16,
  "team2_score": 14,
  "winner": "team1"
}
```

### map_picked

Sent during map veto when a team picks a map.

```json
{
  "event": "map_picked",
  "matchid": "team_a_vs_team_b",
  "map_name": "de_mirage",
  "map_number": 1,
  "picked_by": "team1"
}
```

### side_picked

Sent when a team chooses starting side.

```json
{
  "event": "side_picked",
  "matchid": "team_a_vs_team_b",
  "map_name": "de_inferno",
  "map_number": 2,
  "side": "team1_ct",
  "picked_by": "team1"
}
```

**Side values:** `team1_ct`, `team1_t`, `team2_ct`, `team2_t`

### map_vetoed

Sent during map veto when a team bans a map.

```json
{
  "event": "map_vetoed",
  "matchid": "team_a_vs_team_b",
  "map_name": "de_vertigo",
  "vetoed_by": "team2"
}
```

### going_live

Sent when a map is about to go live.

```json
{
  "event": "going_live",
  "matchid": "team_a_vs_team_b",
  "map_number": 1
}
```

### side_swap

Sent when teams swap sides (e.g., halftime, overtime).

```json
{
  "event": "side_swap",
  "matchid": "team_a_vs_team_b",
  "map_number": 1
}
```

---

## Round Events

### round_end

Sent when a round ends.

```json
{
  "event": "round_end",
  "matchid": "team_a_vs_team_b",
  "map_number": 1,
  "round_number": 15,
  "round_time": 115,
  "reason": 8,
  "winner": "team1",
  "team1_score": 8,
  "team2_score": 7
}
```

**Reason codes:** CS2 round end reason (bomb exploded, defused, eliminated, etc.)

### round_mvp

Sent when a round MVP is awarded.

```json
{
  "event": "round_mvp",
  "matchid": "team_a_vs_team_b",
  "round_number": 15,
  "player": {
    "steamid": "76561198000000001",
    "name": "Player1"
  },
  "reason": 1
}
```

---

## Player Events

### player_connect

Sent when a player connects to the server.

```json
{
  "event": "player_connect",
  "matchid": "team_a_vs_team_b",
  "player": {
    "steamid": "76561198000000001",
    "name": "Player1"
  }
}
```

### player_disconnect

Sent when a player disconnects from the server.

```json
{
  "event": "player_disconnect",
  "matchid": "team_a_vs_team_b",
  "player": {
    "steamid": "76561198000000001",
    "name": "Player1"
  }
}
```

### player_death

Sent when a player is killed.

```json
{
  "event": "player_death",
  "matchid": "team_a_vs_team_b",
  "attacker": {
    "steamid": "76561198000000001",
    "name": "Player1",
    "team": "team1"
  },
  "victim": {
    "steamid": "76561198000000011",
    "name": "Player6",
    "team": "team2"
  },
  "assister": {
    "steamid": "76561198000000002",
    "name": "Player2",
    "team": "team1"
  },
  "weapon": "ak47",
  "headshot": true
}
```

**Note:** `assister` is optional (only present if there was an assist)

### player_stats_update

Sent periodically with updated player statistics.

```json
{
  "event": "player_stats_update",
  "matchid": "team_a_vs_team_b",
  "player": {
    "steamid": "76561198000000001",
    "name": "Player1",
    "team": "team1"
  },
  "stats": {
    "kills": 15,
    "deaths": 10,
    "assists": 3,
    "headshot_kills": 8,
    "damage": 2450,
    "utility_damage": 150,
    "enemies_flashed": 12
  }
}
```

---

## Bomb Events

### bomb_planted

Sent when the C4 is planted.

```json
{
  "event": "bomb_planted",
  "matchid": "team_a_vs_team_b",
  "player": {
    "steamid": "76561198000000015",
    "name": "Player10",
    "team": "team2"
  },
  "site": "A"
}
```

**Site values:** `A` or `B`

### bomb_defused

Sent when the C4 is defused.

```json
{
  "event": "bomb_defused",
  "matchid": "team_a_vs_team_b",
  "player": {
    "steamid": "76561198000000003",
    "name": "Player3",
    "team": "team1"
  },
  "site": "A"
}
```

### bomb_exploded

Sent when the C4 explodes.

```json
{
  "event": "bomb_exploded",
  "matchid": "team_a_vs_team_b",
  "site": "B"
}
```

---

## Backup Events

### backup_loaded

Sent when a backup/restore is loaded.

```json
{
  "event": "backup_loaded",
  "matchid": "team_a_vs_team_b",
  "map_number": 1,
  "round_number": 12
}
```

---

## Important Notes

### CS2 Limitations

MatchZy for CS2 implements a subset of the original Get5 events. Some events that were available in CS:GO Get5 may not be available due to CS2 API limitations.

### Event Frequency

- High-frequency events: `player_death`, `round_end`
- Medium-frequency events: `player_stats_update`, `round_mvp`
- Low-frequency events: `series_start`, `series_end`, `map_result`

### Team Identifiers

- Teams are always identified as `team1` or `team2`
- These correspond to the team definitions in your match configuration
- Team names are available in `series_start` and other relevant events

### Steam IDs

All Steam IDs are in SteamID64 format (e.g., `76561198000000001`)

---

## Event Processing Tips

### Database Storage

Store events in a time-series format for easy querying:

```sql
SELECT * FROM match_events
WHERE match_slug = 'team_a_vs_team_b'
  AND event_type = 'round_end'
ORDER BY received_at DESC;
```

### Real-time Statistics

Calculate live statistics from events:

```typescript
// Count kills per player
const kills = events
  .filter((e) => e.event_type === 'player_death')
  .reduce((acc, e) => {
    const data = JSON.parse(e.event_data);
    acc[data.attacker.steamid] = (acc[data.attacker.steamid] || 0) + 1;
    return acc;
  }, {});
```

### Match Status Tracking

Use key events to track match progression:

- `series_start` → Match is live
- `map_result` → Map completed, update bracket if needed
- `series_end` → Match completed, advance winner

---

## Testing Events

Test your webhook endpoint manually:

```bash
curl -X POST http://localhost:3000/api/events \
  -H "X-MatchZy-Token: your-server-token" \
  -H "Content-Type: application/json" \
  -d '{
    "event": "round_end",
    "matchid": "test_match",
    "map_number": 1,
    "round_number": 1,
    "round_time": 90,
    "reason": 1,
    "winner": "team1",
    "team1_score": 1,
    "team2_score": 0
  }'
```

---

## References

- [Official MatchZy Events Documentation](https://shobhit-pathak.github.io/MatchZy/events.html)
- [MatchZy GitHub Repository](https://github.com/shobhit-pathak/MatchZy)
- [MatchZy Configuration Guide](https://github.com/shobhit-pathak/MatchZy/wiki/Configuration)
