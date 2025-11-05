# Team Pages

## Overview

Each team gets a public page at:
```
https://your-domain:3069/team/{team-slug}
```

**No authentication required** - teams can bookmark and access freely.

## What Teams See

### Upcoming Matches
- Match number and round
- Opponent team
- Match status
- "Start Map Veto" button (for BO1/BO3/BO5)

### Live Matches
- Current score
- Map name  
- Server IP (click to copy)
- Player connection status
- Player ready status

### Match History
- Past results
- Final scores
- Maps played

## Map Veto

For BO1/BO3/BO5 matches, teams veto maps directly on their page:

### How It Works

1. Match status becomes "Ready"
2. "Start Map Veto" button appears
3. Teams click to open veto interface
4. **Turn-based system** - only current team can take actions
5. Maps are banned/picked per format
6. Side selection for picked maps
7. After veto completes, server auto-allocated

### Veto Interface

**Map Cards:**
- **Available**: Full color, clickable
- **Banned**: Grayed out with 🚫
- **Picked**: Green border with "MAP 1" label

**Turn Indicator:**
- Your turn: "BAN A MAP" / "PICK A MAP" in red/green
- Opponent's turn: "Waiting for Team X to..."
- Cards disabled when not your turn

**Veto History:**
Shows all bans/picks in order:
```
✓ Team Pinger banned Vertigo
✓ Team Simper banned Ancient
✓ Team Pinger picked Mirage
...
```

See [Map Veto](../features/map-veto.md) for detailed format rules.

## Connecting to Server

When match is loaded:

1. Server IP appears on team page
2. Click "Copy Server IP" button
3. In CS2 console:
   ```
   connect 192.168.1.100:27015
   ```
4. You're auto-assigned to your team
5. Type `.ready` when ready to start

## Player Roster

Live roster shows:
```
Your Team (Team Pinger):
✓ Simpert      Connected • Ready
✓ Player2      Connected • Not Ready
✗ Player3      Not Connected
...

Opponents (Team Simper):
✓ OpponentA    Connected • Ready
...
```

Updates in real-time as players connect/disconnect/ready.

## Real-Time Updates

Team pages update automatically via WebSocket:
- Veto progress
- Match scores
- Player connections
- Server allocation
- Match completion

**No refresh needed!**

## Mobile Support

Team pages are fully responsive - teams can monitor on phones/tablets.

## For Admins

### Sharing Team Pages

Send teams their URL before tournament:
- Via email/Discord
- Posted in tournament info
- QR codes for LAN events

### Team Page Shows:
- Team name and tag
- Match schedule
- Server IPs (during matches)
- Player Steam IDs

### Team Page Hides:
- Admin controls
- RCON passwords
- Other teams by default
- Tournament settings
