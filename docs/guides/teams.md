# Teams Guide

## Creating Teams

### Quick Create

1. Go to **Teams** page
2. Click **"Create Team"**
3. Fill in:
   - Team Name
   - Team Tag (2-8 characters, e.g. `NAVI`, `G2`)
   - Logo URL (optional)
4. Add players (minimum 5):
   - Steam ID, Steam32, or vanity URL
   - Player name
   - Skill Rating (optional, defaults to 1500)
5. Click **"Create Team"**

### Bulk Import (JSON)

For multiple teams:

```json
[
  {
    "name": "Team Pinger",
    "tag": "PING",
    "players": [
      { "steamId": "76561199486434142", "name": "Simpert", "elo": 3200 },
      { "steamId": "76561198765432109", "name": "Player2" }
    ]
  }
]
```

- Download [team-import-example.json](../TEAM_IMPORT_EXAMPLE.json)
- `elo` field is optional (defaults to 1500)
- Import via Teams page → Import button

## Public Team Pages

Each team gets a public URL:

```
https://your-domain.com/team/team-pinger
```

Share with teams (no login needed). They can:

- View upcoming matches
- Participate in map veto
- See live scores
- Get server connection info
- Monitor player connections

## Managing Players

### Add Players

- Edit team → Add Player
- Enter Steam ID or vanity URL (requires Steam API key in Settings)
- Set initial Skill Rating (optional, useful for shuffle tournaments)

### Backup Players (During Match)

If a player can't connect:

1. Open match details
2. **Player Management** → Add Backup Player
3. Search and select player
4. Choose team
5. System executes `css_add_player` via RCON

## Replacing Teams

If a team withdraws mid-tournament:

1. Find replacement team
2. Click **"Replace in Tournament"**
3. Select team to replace
4. Bracket updates automatically

## Troubleshooting

**Player can't connect: "Auth rejected"**
- Verify Steam ID is correct (use SteamID.io)
- Add as backup player via admin controls

**Team not appearing in tournament creation**
- Ensure team has at least 5 players
- Refresh page
