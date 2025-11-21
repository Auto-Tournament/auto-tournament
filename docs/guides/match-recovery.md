# Match Recovery on Restart

This guide explains how the MatchZy Auto Tournament system recovers match state when the application is restarted during a live tournament.

## Overview

When the MAT system restarts while matches are live, it automatically recovers the current state by:

1. **Finding active matches** - Identifies all matches with status `loaded` or `live`
2. **Syncing state from servers** - Fetches current match state via match reports
3. **Reconfiguring webhooks** - Ensures MatchZy continues sending events
4. **Reconfiguring demo uploads** - Ensures demos continue uploading
5. **Refreshing connections** - Updates player connection status

## How It Works

### Automatic Recovery on Startup

When the application starts, it automatically:

```typescript
// On startup (src/index.ts)
recoverActiveMatches();
```

This process:

1. **Queries database** for matches with `status IN ('loaded', 'live')` and `server_id IS NOT NULL`
2. **For each match:**
   - Fetches match report from server (`matchzy_match_report` or `css_match_report`)
   - Applies report to sync:
     - Current map and map number
     - Round scores (team1/team2)
     - Series scores
     - Player connections
     - Match phase (warmup/live/halftime/etc)
   - Reconfigures webhook URL
   - Reconfigures demo upload URL
   - Refreshes player connections

### Recovery Process Details

#### 1. State Synchronization

The system uses MatchZy's match report commands to get current state:

```bash
matchzy_match_report  # Primary command
css_match_report      # Fallback command
```

The report includes:

- Current map name and number
- Round scores (team1/team2)
- Series scores
- Match phase (warmup, live, halftime, etc.)
- Connected players
- Player stats

#### 2. Webhook Reconfiguration

After syncing state, webhooks are reconfigured:

```bash
matchzy_remote_log_url "https://your-domain.com/api/events/{matchSlug}"
matchzy_remote_log_header_key "X-MatchZy-Token"
matchzy_remote_log_header_value "{SERVER_TOKEN}"
```

This ensures MatchZy continues sending events after restart.

#### 3. Demo Upload Reconfiguration

Demo upload URL is also reconfigured:

```bash
matchzy_demo_upload_url "https://your-domain.com/api/demos/{matchSlug}/upload"
```

This ensures demos continue uploading after restart.

## Verification

### Check Recovery Logs

On startup, look for logs like:

```
[Recovery] Starting match recovery on startup...
[Recovery] Found 2 active match(es) to recover
[Recovery] Recovering match r1m1 on server server-123
[Recovery] Synced match state for r1m1
[Recovery] Reconfigured webhook for r1m1
[Recovery] Reconfigured demo upload for r1m1
[Recovery] Successfully recovered match r1m1
[Recovery] Recovery complete: 2/2 matches recovered successfully
```

### Manual Recovery

You can manually trigger recovery via API:

**Endpoint:** `POST /api/recovery/recover`

```bash
curl -X POST \
  -H "Authorization: Bearer YOUR_API_TOKEN" \
  http://localhost:3000/api/recovery/recover
```

**Response:**

```json
{
  "success": true,
  "message": "Recovery completed: 2/2 matches recovered",
  "summary": {
    "total": 2,
    "successful": 2,
    "failed": 0,
    "details": [
      {
        "matchSlug": "r1m1",
        "success": true,
        "stateSynced": true,
        "webhookReconfigured": true,
        "demoReconfigured": true
      },
      {
        "matchSlug": "r1m2",
        "success": true,
        "stateSynced": true,
        "webhookReconfigured": true,
        "demoReconfigured": true
      }
    ]
  }
}
```

### Replay Recent Events

You can also replay events from the database:

**Endpoint:** `POST /api/recovery/replay/:matchSlug`

```bash
curl -X POST \
  -H "Authorization: Bearer YOUR_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"sinceTimestamp": 1700000000}' \
  http://localhost:3000/api/recovery/replay/r1m1
```

This replays events from the database that occurred during downtime.

## What Gets Recovered

### ✅ Recovered Automatically

- **Match state** (current map, scores, phase)
- **Player connections** (who's connected, ready status)
- **Live stats** (round scores, series scores)
- **Webhook configuration** (events continue flowing)
- **Demo upload configuration** (demos continue uploading)

### ⚠️ Limitations

- **Events during downtime** - Events that occurred while MAT was down are not automatically replayed (but can be manually replayed)
- **In-memory state** - Some in-memory state (like live stats cache) is reset, but synced from server
- **WebSocket connections** - Client connections are lost and need to reconnect

## Troubleshooting

### Recovery Fails

**Symptoms:**

- Logs show "Failed to recover match"
- Match state not synced

**Solutions:**

1. Check server connectivity: `GET /api/servers/:id/status`
2. Verify RCON credentials are correct
3. Check MatchZy plugin is running on server
4. Verify match report commands work: `matchzy_match_report`

### State Not Synced

**Symptoms:**

- Recovery succeeds but match state is wrong
- Scores don't match server

**Solutions:**

1. Check match report response in logs
2. Verify match report format matches expected structure
3. Manually trigger recovery: `POST /api/recovery/recover`
4. Check server logs for MatchZy errors

### Webhooks Not Reconfigured

**Symptoms:**

- Events stop flowing after restart
- Webhook reconfiguration fails

**Solutions:**

1. Verify `SERVER_TOKEN` is set in environment
2. Verify `webhook_url` is configured in settings
3. Check RCON connection to server
4. Verify MatchZy plugin version supports webhooks

## Best Practices

1. **Monitor startup logs** - Check recovery logs on every restart
2. **Test recovery** - Manually trigger recovery during testing
3. **Keep events** - Events are stored in database for replay if needed
4. **Verify webhooks** - After restart, verify events are flowing
5. **Check match reports** - Use match reports to verify state sync

## Related Endpoints

- `POST /api/recovery/recover` - Manually trigger recovery
- `POST /api/recovery/replay/:matchSlug` - Replay events for a match
- `GET /api/matches/:slug` - Check match state
- `GET /api/servers/:id/status` - Check server connectivity
