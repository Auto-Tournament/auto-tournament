# MatchZy Webhook Setup

This guide explains how to set up MatchZy to send events to your API for tournament automation.

## Overview

MatchZy can send game events (round ends, player deaths, series results, etc.) to your API via webhooks. This enables:

- Automatic tournament progression
- Real-time statistics tracking
- Live match updates
- Automated bracket management

**Note:** MatchZy implements a subset of Get5 events that are compatible with CS2. See the [official MatchZy events documentation](https://shobhit-pathak.github.io/MatchZy/events.html) for the complete list of supported events.

---

## Setup

### 1. Configure Server Token

Add a secure server token to your `.env`:

```bash
# Generate a secure token
openssl rand -hex 32

# Add to .env
echo "SERVER_TOKEN=your-generated-token-here" >> .env
```

**Note:** This is different from `API_TOKEN`. The `SERVER_TOKEN` is used by game servers to authenticate webhooks.

### 2. Load Match (Webhook Auto-Configured)

When loading a match, webhooks are **automatically configured by default**:

```bash
curl -X POST "http://localhost:3000/api/matches/team_a_vs_team_b/load" \
  -H "Authorization: Bearer your-api-token"
```

This automatically executes these RCON commands on the server:

```
matchzy_remote_log_url "http://your-api.com/api/events"
matchzy_remote_log_header_key "X-MatchZy-Token"
matchzy_remote_log_header_value "your-server-token"
matchzy_loadmatch_url "http://your-api.com/api/matches/team_a_vs_team_b.json"
```

**To skip webhook setup** (if needed):

```bash
curl -X POST "http://localhost:3000/api/matches/team_a_vs_team_b/load?skipWebhook=true" \
  -H "Authorization: Bearer your-api-token"
```

### 3. Manual RCON Configuration (Optional)

You can also manually configure MatchZy via RCON:

```bash
# Set webhook URL
matchzy_remote_log_url "http://your-api.com/api/events"

# Set authentication header
matchzy_remote_log_header_key "X-MatchZy-Token"
matchzy_remote_log_header_value "your-server-token"
```

To disable webhooks:

```bash
matchzy_remote_log_url ""
matchzy_remote_log_header_key ""
matchzy_remote_log_header_value ""
```

---

## Event Types

MatchZy sends various event types to your webhook:

### Series Events

- `series_start` - Match series begins
- `series_end` - Match series completes (includes winner)

### Map Events

- `map_result` - Map finished (includes scores)
- `map_picked` - Map selected in veto
- `map_vetoed` - Map banned in veto
- `side_picked` - Starting side chosen
- `going_live` - Map is going live

### Round Events

- `round_end` - Round finished (includes scores, winner)
- `round_mvp` - Round MVP awarded

### Player Events

- `player_connect` - Player joined server
- `player_disconnect` - Player left server
- `player_death` - Player killed (includes attacker, weapon)
- `player_stats_update` - Player stats updated

### Bomb Events

- `bomb_planted` - C4 planted
- `bomb_defused` - C4 defused
- `bomb_exploded` - C4 detonated

---

## Example Event Payloads

### Series Start

```json
{
  "event": "series_start",
  "matchid": "team_a_vs_team_b",
  "team1_name": "Team A",
  "team2_name": "Team B",
  "num_maps": 3
}
```

### Round End

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

### Series End

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

### Player Death

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
  "weapon": "ak47",
  "headshot": true
}
```

---

## Retrieving Events

### Get All Events for a Match

```bash
curl -H "Authorization: Bearer your-api-token" \
  http://localhost:3000/api/events/team_a_vs_team_b
```

### Filter by Event Type

```bash
curl -H "Authorization: Bearer your-api-token" \
  "http://localhost:3000/api/events/team_a_vs_team_b?type=round_end"
```

### Limit Results

```bash
curl -H "Authorization: Bearer your-api-token" \
  "http://localhost:3000/api/events/team_a_vs_team_b?limit=50"
```

**Response:**

```json
{
  "success": true,
  "count": 42,
  "events": [
    {
      "id": 123,
      "eventType": "round_end",
      "data": {
        "event": "round_end",
        "matchid": "team_a_vs_team_b",
        "round_number": 15,
        ...
      },
      "receivedAt": 1699000000
    }
  ]
}
```

---

## Automatic Match Status Updates

The API automatically updates match status based on events:

| Event          | Status Change        |
| -------------- | -------------------- |
| `series_start` | `pending` → `live`   |
| `series_end`   | `live` → `completed` |

You can check match status:

```bash
curl -H "Authorization: Bearer your-token" \
  http://localhost:3000/api/matches/team_a_vs_team_b
```

---

## Security

### Server Token Authentication

All webhook requests must include the `X-MatchZy-Token` header:

```
X-MatchZy-Token: your-server-token
```

Without this header or with an invalid token, requests are rejected with 401 Unauthorized.

### Best Practices

1. **Use HTTPS in production** - Protect tokens in transit
2. **Rotate tokens regularly** - Update `SERVER_TOKEN` periodically
3. **Monitor webhook logs** - Watch for unauthorized attempts
4. **Firewall your API** - Only allow traffic from your game servers

---

## Production Deployment

### Using Ngrok for Testing

```bash
# Start ngrok tunnel
ngrok http 3000

# Copy the HTTPS URL (e.g., https://abc123.ngrok.io)
# Use it as your base URL in match loading
```

### Using a Public Server

1. Deploy your API to a public server (VPS, cloud hosting)
2. Ensure your domain/IP is accessible from game servers
3. Use HTTPS with valid SSL certificates
4. Update `.env` with production URLs

### Configure MatchZy

```bash
# Production webhook URL
matchzy_remote_log_url "https://your-domain.com/api/events"

# Authentication header
matchzy_remote_log_header_key "X-MatchZy-Token"
matchzy_remote_log_header_value "your-production-server-token"
```

---

## Troubleshooting

### Events Not Received

1. **Check server token** - Ensure `SERVER_TOKEN` is set in `.env`
2. **Verify URL** - Test `POST /api/events` manually
3. **Check firewall** - Ensure game servers can reach your API
4. **Review logs** - Check API console for errors

### Test Webhook Manually

```bash
curl -X POST http://localhost:3000/api/events \
  -H "X-MatchZy-Token: your-server-token" \
  -H "Content-Type: application/json" \
  -d '{
    "event": "series_start",
    "matchid": "test_match",
    "team1_name": "Test Team 1",
    "team2_name": "Test Team 2",
    "num_maps": 1
  }'
```

Expected response:

```json
{
  "success": true,
  "message": "Event received"
}
```

### View Server Logs

```bash
# In your API console, you should see:
📡 Received event: series_start for match test_match
🎮 Series started: Test Team 1 vs Test Team 2
```

---

## Event Handler Customization

The event handler is in `src/routes/events.ts`. Customize the `handleEvent()` function to add your tournament automation logic:

```typescript
function handleEvent(event: MatchZyEvent): void {
  switch (event.event) {
    case 'series_end':
      // Your custom logic
      updateTournamentBracket(event.matchid, event.winner);
      scheduleNextMatch(event.matchid);
      break;

    case 'round_end':
      // Real-time stats
      updateLiveStats(event);
      break;
  }
}
```

---

## Reference

- [MatchZy Events Documentation](https://shobhit-pathak.github.io/MatchZy/events.html) - Official event schema
- [MatchZy Configuration CVARs](https://github.com/shobhit-pathak/MatchZy/wiki/Configuration) - Server configuration
- [MatchZy GitHub](https://github.com/shobhit-pathak/MatchZy) - Plugin source code

**Important:** MatchZy for CS2 implements a subset of Get5 events. Some events from the original Get5 plugin may not be available due to CS2 limitations. Always refer to the [official events documentation](https://shobhit-pathak.github.io/MatchZy/events.html) for the current supported events.
