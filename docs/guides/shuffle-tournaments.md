# Shuffle Tournaments Guide

## Overview

Shuffle Tournaments are a unique tournament type designed for LAN parties and individual player competitions. Unlike traditional tournaments where players compete as fixed teams, shuffle tournaments dynamically reassign players to balanced teams for each round based on their ELO ratings.

**Key Features:**

- **Individual Competition**: Players compete individually, not as fixed teams
- **Dynamic Team Formation**: Teams are automatically balanced and reshuffled each round
- **ELO-Based Balancing**: Teams are balanced by average ELO to ensure fair matchups
- **Fully Automatic**: System handles team balancing, match creation, and round progression automatically
- **Player-Centric Scoring**: Tournament winner is the individual player with the most match wins

## Creating a Shuffle Tournament

### Step 1: Tournament Setup

1. Navigate to **Tournament** page
2. Select **"Shuffle Tournament"** as the tournament type
3. Enter tournament name
4. **Match Format** is automatically set to BO1 (cannot be changed)

### Step 2: Map Selection

1. Select maps from the map pool
2. **Important**: The number of maps you select determines the number of rounds
   - Example: 5 maps = 5 rounds
   - Each round uses one map (all matches in a round use the same map)

### Step 3: Team Size Configuration

Configure the number of players per team:

- **Team Size**: Select number of players per team (default: 5 for 5v5)
- **Range**: 2-10 players per team
- **Common Options**: 4v4, 5v5, 6v6
- **Minimum Players**: Must register at least `teamSize * 2` players

### Step 4: Advanced Configuration

Configure round limits and overtime settings:

**Round Limit Type:**

- **First to 13**: Matches play until one team reaches 13 rounds
- **Max Rounds**: Matches stop at a maximum number of rounds (default: 24)
  - If max rounds reached, winner determined by current score

**Overtime Mode:**

- **Enable Overtime**: Standard CS2 overtime rules (MR3 format)
- **Stop at Max Rounds**: Match ends when max rounds reached (no overtime; ties are allowed)

### Step 4: Player Registration

1. **Minimum Requirement**: At least 10 players must be registered (for 5v5 matches)
2. Click **"Register Players"** button
3. Select players from the player selection modal
4. Players can be registered individually or in bulk
5. Players are automatically whitelisted for match servers

**Note**: Players must exist in the system before registration. You can add players in several ways:

1. **Via Teams Page** (Recommended for predetermined teams):

   - Create a team and add players directly
   - **Set ELO rating** for each player when adding (optional, defaults to 3000)
   - Players are automatically created in the players table
   - Useful when you have predetermined teams with known ELO ratings

2. **Via Players Page**:

   - Create individual players
   - Bulk import players (CSV/JSON supported)
   - Set initial ELO ratings (default: 3000)
   - Edit player ELO after creation (with warning about resetting stats)
   - **Download CSV Template:** [player-import-example.csv](../PLAYER_IMPORT_EXAMPLE.csv)

3. **Bulk Import Teams** (with ELO):
   - Import teams via JSON with player ELO ratings included
   - See [Managing Teams Guide](../guides/managing-teams.md) for examples

### Step 6: Review and Start

1. Review tournament configuration
2. Verify player count (must be ≥ 10)
3. Click **"Start Tournament"**

## How Shuffle Tournaments Work

### Automatic Team Balancing

Before each round:

1. System retrieves all registered players
2. Calculates current ELO for each player
3. Uses team balancing algorithm to create balanced teams of 5 players
4. Teams are balanced by average ELO to ensure fair matchups

### Round Progression

1. **Round Generation**: System automatically generates matches for the round

   - Number of matches = `Math.floor(playerCount / (teamSize * 2))`
   - Example: 60 players with 5v5 (teamSize=5) = `Math.floor(60 / 10)` = 6 matches per round
   - Example: 40 players with 4v4 (teamSize=4) = `Math.floor(40 / 8)` = 5 matches per round

2. **Match Creation**:

   - Teams are automatically assigned to matches
   - Map is assigned (same map for all matches in the round)
   - Sides (CT/T) are randomly assigned
   - Servers are automatically allocated

3. **Round Completion**:

   - All matches in a round must complete before next round begins
   - System automatically detects when all matches are complete
   - ELO ratings are updated after each match

4. **Round Advancement**:
   - System automatically advances to next round
   - Teams are reshuffled based on updated ELO ratings
   - New matches are generated automatically
   - Servers are automatically allocated to new matches

### ELO Rating System

- **Rating System**: Uses OpenSkill (Bayesian rating system)
- **Admin Interface**: Simple "ELO" number (system handles conversion internally)
- **Default Starting ELO**: 3000 (FaceIT-style)
- **Rating Updates**: Based on team result (win/loss)
  - All players on winning team get ELO increase
  - All players on losing team get ELO decrease
  - ELO change depends on opponent team's average ELO
- **No Individual Performance Adjustment**: ELO changes based solely on team result

### Odd Number of Players

If you have an odd number of players (e.g., 61 instead of 60):

- **Player Rotation**: System automatically rotates players who sat out
- Players who sat out last round will play this round
- Ensures fair rotation - no player sits out multiple rounds in a row
- If rotation cannot be completed, system logs a warning

## Viewing Tournament Progress

### Public Tournament Leaderboard

Navigate to `/tournament/:id/leaderboard` (public, no authentication required)

**Displays:**

- Tournament name and status
- Current round number and progress
- Player leaderboard (sorted by wins, then ELO)
- Links to individual player pages

**Leaderboard Columns:**

- Player name and avatar
- Current ELO
- Match wins
- Match losses
- Win rate
- Average ADR (if available)
- ELO change (since tournament start)

### Player Pages

Each player has a public profile page at `/player/:steamId`

**Displays:**

- Player name, avatar, and current ELO
- ELO progression chart (visual history)
- Match history with detailed stats
- Performance metrics (wins, losses, win rate, ADR)

**Finding Your Player Page:**

- Navigate to `/player` (Find Player page)
- Paste your Steam profile URL or Steam ID
- System redirects to your player page

## Setting Player ELO Ratings

ELO ratings are crucial for shuffle tournaments as they determine team balancing. You can set ELO in several ways:

### When Adding Players to Teams

1. Go to **Teams** page
2. Create or edit a team
3. When adding a player via Steam URL:
   - Enter Steam ID/URL
   - Enter player name
   - **Enter ELO rating (optional)** - Defaults to 3000 if not specified
4. Click **"Add"** to add player to team

### Bulk Import Teams with ELO

Import teams with player ELO ratings included. Teams must be imported in JSON format (CSV is not supported due to nested player structure):

**Download JSON Template:** [team-import-example.json](../TEAM_IMPORT_EXAMPLE.json)

```json
[
  {
    "name": "Team Alpha",
    "tag": "ALPHA",
    "players": [
      { "steamId": "76561198012345678", "name": "Player One", "elo": 3200 },
      { "steamId": "76561198012345679", "name": "Player Two", "elo": 3100 },
      { "steamId": "76561198012345680", "name": "Player Three" },
      { "steamId": "76561198012345681", "name": "Player Four", "elo": 3000 }
    ]
  }
]
```

**Note:** The `elo` field is optional. If omitted, players default to 3000 ELO.

### Bulk Import Players with ELO

Import players directly via the Players page. Both JSON and CSV formats are supported.

**JSON Format:**

```json
[
  {
    "steamId": "76561198012345678",
    "name": "Player One",
    "initialELO": 3200
  },
  {
    "steamId": "76561198012345679",
    "name": "Player Two",
    "initialELO": 3100
  },
  {
    "steamId": "76561198012345680",
    "name": "Player Three"
  }
]
```

**CSV Format:**

```csv
steamId,name,initialELO,avatarUrl
76561198012345678,Player One,3200,https://steamcdn-a.akamaihd.net/steamcommunity/public/images/avatars/fe/fef49e7fa7e1997310d705b2a6158ff8dc1cdfeb_full.jpg
76561198012345679,Player Two,3100,
76561198012345680,Player Three,3000,
76561198012345681,Player Four,,
```

**CSV Column Headers:**

- `steamId` or `steamid` or `steam_id` (required)
- `name` (required)
- `initialELO` or `initialelo` or `initial_elo` or `elo` (optional, defaults to 3000)
- `avatarUrl` or `avatarurl` or `avatar_url` or `avatar` (optional)

**Note:** The `initialELO` field is optional. If omitted, players default to 3000 ELO. Empty CSV cells are treated as optional fields.

**Download CSV Template:** [player-import-example.csv](../PLAYER_IMPORT_EXAMPLE.csv)

## Tournament Winner

The tournament winner is determined by:

1. **Primary**: Most match wins
2. **Tie-breaker**: Highest ELO
3. **Additional**: Average ADR or other performance metrics

## Tips and Best Practices

### Player Management

- **Bulk Import**: Use the Players page to bulk import players before tournament creation
- **Initial ELO**: Set accurate initial ELO for better team balancing
- **Editing ELO**: You can edit a player's ELO after creation by clicking on their player card and updating the ELO field. **Warning**: Changing a player's ELO will reset their stats and rating history. A confirmation dialog will appear before the change is applied.
- **Player Names**: Ensure player names are correct (they appear in match views)

### Tournament Configuration

- **Map Selection**: Choose maps that work well for your player skill level
- **Round Limits**: Consider your time constraints when selecting round limit type
- **Overtime**: Enable overtime for standard CS2 experience, or disable for faster matches

### During Tournament

- **Monitor Progress**: Use the public standings page to track tournament progress
- **Round Status**: Check the Bracket page for round completion status
- **Player Stats**: Players can view their individual stats on their player pages

## Troubleshooting

### "Not enough players registered"

- **Solution**: Register at least 10 players before starting the tournament
- Use the Players page to create/import players
- Then register them to the tournament

### "Odd number of players" warning

- **Normal**: This is expected if you have an odd number of players
- **Rotation**: System automatically rotates players who sit out
- **Impact**: One player sits out per round (rotates each round)

### Players can't connect to server

- **Check**: Players must be registered to the tournament
- **Whitelisting**: Registered players are automatically whitelisted
- **Verify**: Check that player Steam IDs are correct

### Round not advancing

- **Check**: All matches in the round must be completed
- **Status**: Verify all matches show "completed" status
- **Automatic**: Round advancement happens automatically (no manual trigger needed)

## Technical Details

### Team Balancing Algorithm

- Uses greedy algorithm with optimization step
- Balances teams by average ELO (OpenSkill ordinal value)
- Handles edge cases (odd players, extreme ELO values)

### Server Allocation

- Servers are automatically allocated when rounds advance
- If no servers available, system polls every 10 seconds
- Matches load automatically when servers are allocated

### Match Configuration

- **Format**: Always BO1 (Best of 1)
- **Veto**: Disabled (no map voting)
- **Sides**: Randomly assigned (no knife round)
- **Round Limits**: Configurable (First to 13 or Max Rounds)
- **Overtime**: Configurable (Enable or Disable). A metric-based overtime mode is a future idea and is **not** available in the current release.

## API Endpoints

For programmatic access, the following endpoints are available. All endpoints require Bearer token authentication unless otherwise noted. Full OpenAPI documentation is available at `/api-docs` when the server is running.

### Tournament Management

**Create Shuffle Tournament**

- `POST /api/tournament/shuffle`
- Creates a new shuffle tournament
- Required fields: `name`, `mapSequence`, `roundLimitType`, `overtimeMode`
- Optional: `maxRounds` (if `roundLimitType` is `max_rounds`)

**Get Tournament**

- `GET /api/tournament`
- Returns current tournament details

### Player Registration

**Register Players**

- `POST /api/tournament/:id/register-players`
- Register one or more players to the tournament
- Body: `{ "playerIds": ["steamId1", "steamId2", ...] }`
- Returns: `{ "success": boolean, "registered": number, "errors": [...] }`
- Status 207 (Multi-Status) if some players failed to register

**Get Registered Players**

- `GET /api/tournament/:id/players`
- Returns list of all registered players with their current ELO

### Leaderboards & Standings

**Get Leaderboard**

- `GET /api/tournament/:id/leaderboard`
- Returns player leaderboard sorted by wins, then ELO
- Includes: wins, losses, win rate, ELO change

**Get Standings (Public)**

- `GET /api/tournament/:id/standings`
- Public endpoint (no auth required)
- Returns: tournament info, leaderboard, current round status

**Get Round Status**

- `GET /api/tournament/:id/round-status`
- Returns current round number, map, match completion status
- Used for round progress indicators

### Player Management

- `GET /api/players` - List all players
- `POST /api/players` - Create player
- `PUT /api/players/:playerId` - Update player (name, avatar, ELO)
  - **Warning**: Updating ELO will reset the player's stats and rating history
- `GET /api/players/:playerId` - Get player details (public)
- `GET /api/players/:playerId/rating-history` - Get rating history
- `GET /api/players/:playerId/matches` - Get match history
- `GET /api/players/find` - Find player by Steam URL/ID

### Example API Usage

```bash
# Create shuffle tournament
curl -X POST http://localhost:3000/api/tournament/shuffle \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "LAN Party 2025",
    "mapSequence": ["de_dust2", "de_mirage", "de_inferno"],
    "roundLimitType": "max_rounds",
    "maxRounds": 24,
    "overtimeMode": "enabled"
  }'

# Register players
curl -X POST http://localhost:3000/api/tournament/1/register-players \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "playerIds": ["76561198000000000", "76561198000000001"]
  }'

# Get standings (public, no auth)
curl http://localhost:3000/api/tournament/1/standings
```

## See Also

- [Players Page Guide](./managing-players.md) - Managing players
- [Running Matches](./running-matches.md) - Match flow and controls
- [Team Pages](./team-pages.md) - Team page features
