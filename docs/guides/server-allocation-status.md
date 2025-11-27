# MatchZy Server Allocation Status Guide

This document explains how to determine when a CS2 server running MatchZy is ready for match allocation by monitoring the `matchzy_tournament_status` convar.

## Overview

MatchZy exposes server status through the `matchzy_tournament_status` convar. Your allocation API should poll this value to determine if a server is available for new matches.

## Status Values

The `matchzy_tournament_status` convar can have the following values:

| Status     | Meaning    | Ready for Allocation? | Description                                                             |
| ---------- | ---------- | --------------------- | ----------------------------------------------------------------------- |
| `idle`     | ✅ **YES** | ✅ **READY**          | Server is empty and ready for a new match. No active match, no players. |
| `loading`  | ❌ NO      | ❌ **BUSY**           | Match is being loaded/configured.                                       |
| `warmup`   | ❌ NO      | ❌ **BUSY**           | Match is in warmup phase, players are readying up.                      |
| `knife`    | ❌ NO      | ❌ **BUSY**           | Knife round is in progress.                                             |
| `live`     | ❌ NO      | ❌ **BUSY**           | Match is live and in progress.                                          |
| `paused`   | ❌ NO      | ❌ **BUSY**           | Match is live but paused.                                               |
| `halftime` | ❌ NO      | ❌ **BUSY**           | Match is live, halftime break.                                          |
| `postgame` | ❌ NO      | ❌ **BUSY**           | Map just ended, waiting for next map or series end.                     |
| `error`    | ⚠️ MAYBE   | ⚠️ **CHECK LOGS**     | Error state. Server may need attention.                                 |

## Status Lifecycle

### Complete Match Lifecycle

```
idle → loading → warmup → knife → live → paused (optional) → halftime → live → postgame → (next map or idle)
                                                                                        ↓
                                                                                    series_end
                                                                                        ↓
                                                                                   idle (ready)
```

### Detailed Status Transitions

1. **`idle`** → **`loading`**

   - When: Match is loaded via `matchzy_loadmatch` command
   - Duration: < 1 second
   - Server state: Empty or has players waiting

2. **`loading`** → **`warmup`**

   - When: Match configuration is loaded, map changes to first map
   - Duration: ~5-10 seconds (map load time)
   - Server state: Players can connect, warmup phase begins

3. **`warmup`** → **`knife`** (optional) OR **`live`**

   - When: All required players ready up
   - Duration: Variable (depends on players readying)
   - Server state: Players readying up
   - If knife round enabled: goes to `knife`, otherwise directly to `live`

4. **`knife`** → **`live`**

   - When: Knife round completes, side selection done
   - Duration: ~1-2 minutes (knife round + side selection)
   - Server state: Knife round in progress

5. **`live`** → **`paused`** (optional, can happen multiple times)

   - When: Team requests pause or admin pauses
   - Duration: Variable (can be unpaused)
   - Server state: Match is paused

6. **`live`** → **`halftime`**

   - When: First half ends (typically 12 rounds)
   - Duration: ~15 seconds (halftime duration)
   - Server state: Half-time break, switching sides

7. **`halftime`** → **`live`**

   - When: Halftime break ends
   - Duration: Automatic transition
   - Server state: Second half begins

8. **`live`** → **`postgame`**

   - When: Map ends (one team reaches required rounds)
   - Duration: See "Postgame Duration" below
   - Server state: Map is complete, determining if series continues

9. **`postgame`** → **`warmup`** OR **`idle`**
   - If series continues (BO3/BO5): → **`warmup`** (next map)
   - If series ends: → **`idle`** (after players kicked)

## Timing Information

### Critical Timing Values

| Event                    | Duration                 | Notes                                                  |
| ------------------------ | ------------------------ | ------------------------------------------------------ |
| **Map End to Next Map**  | ~90-120 seconds          | `restartDelay` (typically 90s for GOTV, can be longer) |
| **Demo Upload Start**    | 15 seconds after map end | Demo file needs time to write to disk                  |
| **Demo Upload Duration** | Variable                 | Depends on file size (10-200 MB) and network speed     |
| **Series End to Idle**   | ~150 seconds             | `restartDelay + 60` seconds after last map ends        |

### Postgame Duration (Map Ends)

When a map ends:

1. **Immediate**: Status changes to `postgame`
2. **0-15 seconds**: Demo recording stops, waiting for file write
3. **~15 seconds**: Demo upload starts (if configured)
4. **~90-120 seconds**: Next map loads (if series continues) OR series ends

**For series end:**

- Status becomes `postgame` immediately
- After `restartDelay + 60` seconds: All players kicked, status → `idle`

### Series End to Ready (Idle)

When a series ends (BO3/BO5 complete):

```
Map Ends → postgame
    ↓
Wait restartDelay + 60 seconds (~150 seconds total)
    ↓
Kick all players
    ↓
Update status to idle
    ↓
Reset match (2 seconds)
    ↓
Server is READY for allocation
```

**Total time from series end to idle: ~150-152 seconds**

## Checking Server Status

### Method 1: Query Server ConVars

Query the server's RCON console for:

```
matchzy_tournament_status
matchzy_tournament_match
matchzy_tournament_updated
```

**Example response:**

```
matchzy_tournament_status = "idle"
matchzy_tournament_match = ""
matchzy_tournament_updated = "1704067200"
```

### Method 2: Get5 API Status Endpoint

If the server exposes the Get5 API status endpoint:

```
GET http://server-ip:port/get5_status
```

Returns JSON with game state and match information.

## Allocation Decision Logic

### ✅ Allocate to Server When:

1. **Status is `idle`**

   - AND `matchzy_tournament_match` is empty (no match loaded)
   - OR `matchzy_tournament_match` exists but status is `idle` (series ended, ready for new match)

2. **Status is `error`** (optional)
   - You may want to check logs or skip these servers

### ❌ Do NOT Allocate to Server When:

- Status is: `loading`, `warmup`, `knife`, `live`, `paused`, `halftime`, `postgame`
- Status is `idle` BUT `matchzy_tournament_match` has a value AND timestamp is very recent (< 5 minutes)

### Recommended Allocation Flow

```javascript
async function isServerReady(serverInfo) {
  // Query server status
  const status = await queryRcon(serverInfo, "matchzy_tournament_status");
  const matchId = await queryRcon(serverInfo, "matchzy_tournament_match");
  const updated = await queryRcon(serverInfo, "matchzy_tournament_updated");

  // Server is ready if status is idle
  if (status === "idle") {
    // Double-check: if matchId exists but is old (> 5 min), it's safe
    const timestamp = parseInt(updated) || 0;
    const age = Date.now() / 1000 - timestamp;

    if (matchId && matchId.trim() !== "" && age < 300) {
      // Match was recently ended, might still be resetting
      return false;
    }

    return true; // Server is ready
  }

  return false; // Server is busy
}
```

## Status Update Timestamps

The `matchzy_tournament_updated` convar contains a Unix timestamp of when the status was last updated. This is useful for:

- Detecting stale status (if timestamp is very old, server might be dead)
- Knowing when a server transitioned to idle (to avoid immediate re-allocation)

## Example Timeline: BO3 Match

```
00:00 - idle → loading (match loaded)
00:05 - loading → warmup (map loaded)
05:30 - warmup → knife (players ready)
07:00 - knife → live (knife round done)
27:00 - live → postgame (Map 1 ends, 16-10)
        → postgame → warmup (next map loading)
29:00 - warmup → live (Map 2 starts)
49:00 - live → postgame (Map 2 ends, 16-8)
        → postgame → warmup (next map loading)
51:00 - warmup → live (Map 3 starts)
71:00 - live → postgame (Map 3 ends, 16-12)
        → postgame → (series ends)
73:30 - Kicking players...
73:32 - idle (SERVER READY FOR ALLOCATION)
```

**Total match duration: ~73 minutes**
**Time from series end to ready: ~2.5 minutes**

## Best Practices

1. **Poll Frequency**: Check server status every 10-30 seconds

   - Don't poll too frequently (wastes resources)
   - Don't poll too rarely (delays allocation)

2. **Grace Period**: Wait 5 minutes after status becomes `idle` before allocating

   - Ensures demo uploads are complete
   - Ensures match reset is finished
   - Prevents race conditions

3. **Error Handling**: If status is `error`, investigate or skip the server

   - Check server logs
   - Consider marking server as "needs attention"

4. **Timestamp Checking**: Use `matchzy_tournament_updated` to:

   - Verify server is responsive (recent timestamp)
   - Avoid allocating immediately after idle (wait for grace period)

5. **Match ID Checking**: When status is `idle` but match ID exists:
   - Check timestamp age
   - If > 5 minutes old, safe to allocate
   - If < 5 minutes old, wait

## API Integration Example

### Pseudocode for Allocation Check

```javascript
async function checkServerAvailability(serverInfo) {
  try {
    // Query server status
    const response = await queryRcon(serverInfo, [
      "matchzy_tournament_status",
      "matchzy_tournament_match",
      "matchzy_tournament_updated",
    ]);

    const status = response["matchzy_tournament_status"];
    const matchId = response["matchzy_tournament_match"];
    const updated = parseInt(response["matchzy_tournament_updated"] || "0");

    // Check if server is idle
    if (status !== "idle") {
      return {
        available: false,
        reason: `Server is ${status}`,
        status: status,
      };
    }

    // Check if recently became idle
    const now = Math.floor(Date.now() / 1000);
    const age = now - updated;

    if (matchId && matchId.trim() !== "" && age < 300) {
      return {
        available: false,
        reason: "Server recently ended match, still resetting",
        status: status,
        timeUntilReady: 300 - age,
      };
    }

    // Server is ready!
    return {
      available: true,
      status: status,
      matchId: matchId || null,
      lastUpdate: updated,
    };
  } catch (error) {
    return {
      available: false,
      reason: "Failed to query server",
      error: error.message,
    };
  }
}
```

## Summary

- **Only allocate when**: `matchzy_tournament_status = "idle"`
- **Wait after idle**: 5 minutes grace period recommended
- **Series end timing**: ~2.5 minutes from series end to idle
- **Check timestamp**: Use `matchzy_tournament_updated` to verify freshness
- **Poll frequency**: Every 10-30 seconds
- **Match duration**: BO3 typically takes 60-90 minutes total
