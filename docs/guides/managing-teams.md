# Managing Teams

## Adding Teams

### Single Team

1. Go to **Teams** page
2. Click **"Create Team"**
3. Fill in:
   - Team Name
   - Team Tag (2-8 characters)
   - Logo URL (optional)
4. Add players:
   - Steam ID or vanity URL
   - Player name
   - **ELO rating (optional)** – Defaults to your configured **Default Player ELO** in Settings (3000 by default)
   - Minimum 5 players required
5. Click **"Create Team"**

??? example "Advanced: Bulk Import (JSON)"

    For multiple teams, use JSON import:

    ```json
    [
      {
        "name": "Team Pinger",
        "tag": "PING",
        "players": [
          { "steamId": "76561199486434142", "name": "Simpert", "elo": 3200 },
          { "steamId": "76561198765432109", "name": "Player2", "elo": 3100 },
          { "steamId": "76561198765432108", "name": "Player3" },
          { "steamId": "76561198765432107", "name": "Player4", "elo": 3000 },
          { "steamId": "76561198765432106", "name": "Player5" }
        ]
      }
    ]
    ```

    **Note:** The `elo` field is optional. If not specified, players will be created with the configured **Default Player ELO** (FaceIT-style, 3000 by default). This is useful for shuffle tournaments where ELO ratings are used for team balancing.

    **Download JSON Template:** [team-import-example.json](../TEAM_IMPORT_EXAMPLE.json)

    **Note:** Teams must be imported in JSON format. CSV import is not supported due to the nested player structure.

## Team Pages

Each team gets a public URL:

```
https://your-domain.com/team/team-pinger
```

Share this with teams - no authentication needed. They can:

- View upcoming matches
- Participate in map veto
- See live scores
- Get server connection info
- Monitor player connections

## Managing Players

### Adding Players

- Edit team → Add Player
- Enter Steam ID (Steam64, Steam32, or vanity URL)
- Enter player name
- **Set ELO rating (optional)** – Defaults to your configured **Default Player ELO** in Settings if not specified
- Configure a Steam API key in the dashboard **Settings** to enable vanity URL resolution

**Note:** When adding players directly to teams, you can set their initial ELO rating. This is especially useful for shuffle tournaments where ELO is used for team balancing. If ELO is not specified, it defaults to the configured **Default Player ELO** (FaceIT-style, 3000 by default).

### Backup Players (Mid-Match)

If a player can't connect during a match:

1. Open match details
2. **Player Management** → Add Backup Player
3. Search for player
4. Select team
5. System executes `css_add_player` via RCON

## Replacing Teams

If a team withdraws mid-tournament:

1. Find replacement team
2. Click **"Replace in Tournament"**
3. Select team to replace
4. Bracket updates automatically

??? warning "Common Issues"

    **Player can't connect: "Auth rejected"**

    - Verify Steam ID is correct
    - Add as backup player via admin controls
    - Check `get5_check_auths true` is set

    **Team not appearing in tournament creation**

    - Ensure team has at least 5 players
    - Refresh page
    - Check team wasn't deleted
