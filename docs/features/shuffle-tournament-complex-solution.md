# Shuffle Tournament Type - Complex Solution

## Overview

This document details the **complex solution** for implementing a shuffle tournament type where players are dynamically reassigned to teams for each match based on ELO ratings. This solution provides full automation of team balancing, ELO calculation, and match progression.

**Key Differentiator**: Unlike the simple solution which relies on manual team assignment and external Excel-based ELO tracking, the complex solution provides a fully integrated, automated system.

## Core Concept

- **Individual Player Competition**: Players compete individually, not as fixed teams
- **Dynamic Team Formation**: Teams are automatically formed and balanced before each round
- **ELO-Based Balancing**: Teams are balanced by average ELO to ensure fair matchups
- **Fully Automatic System**: System handles everything automatically - no manual intervention required
- **Automatic Progression**: System automatically advances rounds, reshuffles teams, and updates ELO
- **Player-Centric Scoring**: Tournament winner is the individual player with most match wins
- **Player Whitelisting**: Players must be whitelisted to join servers (prevents unauthorized players from disrupting matches)

## Match Structure

### Format

- **Match Type**: Best of 1 (BO1) - single map per match
- **Team Size**: Configurable players per team (default: 5 for 5v5 matches)
  - Admin can set team size during tournament creation
  - Common options: 4v4, 5v5, 6v6
  - Minimum: 2 players per team
  - Maximum: 10 players per team (practical limit)
- **Side Assignment**: Random CT/T assignment (no knife round)
- **Veto System**: Completely disabled - no map voting

### Round Configuration

- **Round Limit Options**:
  - **Option 1**: Play until 13 rounds (first to 13 wins)
  - **Option 2**: Use max rounds limit (default: 24 rounds)
    - If max rounds reached, winner determined by current score
- **Admin Configuration**: Admin selects round limit during tournament setup
  - Choose between "First to 13" or "Max Rounds" (with configurable limit)
  - Default: Max Rounds = 24

### Overtime Handling

- **Overtime Configuration** (when max rounds reached):
  - **Option 1**: Enable Overtime
    - Standard CS2 overtime rules (MR3 format - first to 4 rounds with 10k start money)
    - Continue until winner determined
    - ✅ **Implemented**: MR3 overtime configuration is set via cvars in match config
  - **Option 2**: Stop at Max Rounds
    - Match ends when max rounds reached
    - Winner determined by current score
    - ✅ **Implemented**: Overtime is disabled when this mode is selected
- **Admin Configuration**: Admin selects overtime handling during tournament setup
  - Default: Enable Overtime (standard CS2 rules)
- **Implementation Status**: 
  - ✅ Overtime mode selection is stored in database and applied to MatchZy match config via cvars
  - ✅ MR3 format (first to 4 rounds, 10k start money) is configured via `mp_overtime_maxrounds` and `mp_overtime_startmoney` cvars
  - ✅ Round limit configuration: "First to 13" uses 24 max rounds, "Max Rounds" uses configured value

### Map Management

- **Fixed Map Per Round**: All matches in a round use the same predetermined map
- **Sequential Map Progression**: Maps progress sequentially through rounds
  - Round 1: Map 1 (e.g., `de_dust2`)
  - Round 2: Map 2 (e.g., `de_mirage`)
  - Round 3: Map 3 (e.g., `de_inferno`)
  - Continues through selected maps
- **Map Selection**: Admin selects maps during tournament setup
- **Number of Rounds**: Number of maps selected = number of rounds to be played
  - Example: Admin selects 5 maps → Tournament will have 5 rounds
  - Simple and straightforward - no complex round calculations

### Round Synchronization

- **Round Completion Requirement**: All matches in a round must complete before next round begins
- **Automatic Detection**: System automatically detects when all matches in a round are complete
- **Automatic Advancement**: System automatically advances to next round (no manual trigger needed)

## Core Features

### 1. Rating System (ELO or OpenSkill)

> **Background – What are ELO and OpenSkill?**  
> - **ELO**: Classic rating system from chess – each player has a single number that goes up or down after each game based on who they played and whether they won or lost.  
> - **OpenSkill**: A modern Bayesian rating system for competitive games (similar family to Microsoft TrueSkill) that handles **teams**, changing teammates, and uncertainty much better than plain ELO. See the official docs at [openskill.me](https://openskill.me) for a deeper explanation.  
> - In this design, admins still work with an **ELO-style number** (e.g. 3000), while the system can internally run OpenSkill and convert between ELO and OpenSkill values.

#### Rating System Options

**Option A: Standard Chess ELO** (Simpler)

- Traditional ELO system
- Single number per player
- Simple to understand and implement
- See [ELO Package Research](./elo-package-research.md)

**Option B: OpenSkill** (Recommended - Superior)

- **20x faster** than TrueSkill
- Better for team-based games
- Bayesian uncertainty tracking (sigma)
- Supports asymmetric teams
- See [OpenSkill Integration](./openskill-integration.md) for details

**Recommendation**: Use **OpenSkill** with simplified admin interface (admins still set "ELO" numbers, system converts internally)

#### Rating Management

- **Initial Rating Assignment**:
  - Admin can set starting rating for each player individually
  - Support for bulk import of starting ratings
  - **Default Starting Rating**: 3000 (FaceIT-style default for new players)
    - Applied automatically when no rating is specified during player creation
    - Used when creating players from Players page without rating
    - Used when creating players from Teams page without rating
    - Used when bulk importing players without rating field
  - Default starting rating is configurable globally in application **Settings** (Default Player ELO)
  - Import from existing system/Excel (future enhancement)

- **Editing Player ELO After Creation**:
  - Admins can edit a player's ELO after the player has been created
  - Accessible through the Players page by clicking on a player card
  - **Warning System**: When changing a player's ELO, a confirmation dialog appears warning that:
    - The change will reset the player's stats and rating history
    - This action cannot be undone
  - The warning shows the old and new ELO values for confirmation
  - If the admin cancels, the ELO field resets to the original value
  - Use with caution - typically only needed for correcting initial ELO values or resetting a player's rating

#### Rating Calculation

**If Using ELO**:

- **Chess-Style ELO System**:
  - Uses standard chess ELO calculation formula
  - ELO updates based on **team result** (win or loss)
  - Individual player gets win/loss based on their team's result
  - No individual performance adjustment - purely win/loss based
- **Calculation Factors**:
  - Player's current ELO
  - Opponent team's average ELO
  - Match result (1 for win, 0 for loss)
  - K-factor (sensitivity of ELO changes, typically 32)

**If Using OpenSkill** (Recommended):

- **OpenSkill System**:
  - Uses Weng-Lin Bayesian approximation method
  - Updates based on **team result** (win or loss)
  - Tracks uncertainty (sigma) - decreases with more matches
  - Better handling of team-based scenarios
  - Faster calculations
- **Admin Interface**: Admins still set single "ELO" number
  - System automatically converts to OpenSkill (mu, sigma)
  - Display converts back to "ELO" for familiarity
  - See [OpenSkill Integration](./openskill-integration.md) for conversion details

#### ELO Formula (If Using ELO)

- **Standard Chess ELO Formula**:

  ```
  Expected Score = 1 / (1 + 10^((opponent_avg_elo - player_elo) / 400))
  ELO Change = K * (Actual - Expected)

  Where:
  - K = K-factor (typically 32, configurable)
  - Actual = 1 if team won, 0 if team lost
  - Expected = Expected probability of winning based on ELO difference
  ```

- **Simplified Approach**:
  - Player's ELO changes based solely on whether their team won or lost
  - Individual performance metrics (ADR, damage, etc.) do not affect ELO
  - Keeps system simple and fair - team result determines ELO change

#### OpenSkill Formula (If Using OpenSkill)

- **OpenSkill Rating Update**:

  - Uses `rate()` function from `openskill` package
  - Input: Teams with player ratings (mu, sigma)
  - Output: Updated ratings for all players
  - Handles team results automatically
  - See [OpenSkill Integration](./openskill-integration.md) for implementation

- **Rating History**: Track all rating changes with timestamps and match references

#### Stat-Based ELO Adjustments (Optional)

- **Hybrid Rating System**:
  - **Base Rating**: OpenSkill calculates base ELO change based on team win/loss (pure Bayesian rating)
  - **Stat Adjustments**: Optional stat-based adjustments applied as post-processing step
  - **Final ELO**: Base ELO + stat adjustments = final displayed ELO

- **Default Behavior**: Pure OpenSkill (no stat adjustments)
  - Only team win/loss affects ELO
  - Individual performance stats tracked but not used in rating
  - Simple, fair, and statistically sound

- **ELO Calculation Templates**:
  - Admins can create custom templates defining how stats affect ELO
  - Templates specify weights for each stat (kills, deaths, assists, ADR, etc.)
  - Templates can be enabled/disabled per tournament
  - See [ELO Calculation Templates](./elo-calculation-templates.md) for detailed design

- **Available Stats for Adjustment**:
  - Kills, Deaths, Assists
  - Flash Assists, Headshot Kills
  - Damage, Utility Damage
  - KAST, MVPs, Score
  - ADR (Average Damage per Round)

- **Template Examples**:
  - **Pure Win/Loss** (default): No stat adjustments
  - **Kill-Focused**: Rewards fragging (kills, headshots, MVPs)
  - **Support-Focused**: Rewards support play (assists, utility, KAST)
  - **Balanced Performance**: Balanced approach rewarding all aspects

- **Implementation**:
  - Templates stored in `elo_calculation_templates` table
  - Tournament references template via `elo_template_id`
  - Rating history stores both base ELO and stat adjustments
  - Both values available for analysis and transparency

### 2. Automatic Team Assignment

#### Team Balancing Algorithm

- **Goal**: Create balanced teams of 5 players with similar average ELO
- **Algorithm Requirements**:
  - Use established, trialed-and-tested formulas (research online)
  - Balance by average ELO (teams should have similar total/average ELO)
  - Minimize ELO variance within teams
  - Handle edge cases (odd number of players, very high/low ELO players)
- **Approach Options**:
  - Greedy algorithm (assign highest ELO to team with lowest average)
  - Genetic algorithm (optimize for balanced teams)
  - Round-robin pairing with ELO consideration
  - Research existing team balancing algorithms for competitive gaming

#### Team Formation Process

1. Get all registered players for tournament
2. Sort players by current ELO
3. Apply team balancing algorithm to create balanced pairs of teams
4. Assign teams to matches
5. Ensure all players are assigned to exactly one match per round

#### Edge Cases

- **Odd Number of Players**:
  - Option 1: One player sits out (rotate each round)
  - Option 2: Create one team with 4 players (handicap system)
  - Option 3: Allow spectator/substitute role
- **Very High/Low ELO Players**:
  - Ensure they're distributed across matches
  - Prevent all high ELO players on one team
- **Player Availability**:
  - Track player availability/status
  - Handle players who can't play a round

### 3. Automatic Match Creation

#### Match Generation

- **Automatic Creation**: System automatically creates matches for each round
- **Match Count Calculation**:
  - Based on number of registered players and team size
  - Formula: `Math.floor(playerCount / (teamSize * 2))` matches per round
  - Example: 60 players with 5v5 (teamSize=5) = `Math.floor(60 / 10)` = 6 matches per round
  - Example: 40 players with 4v4 (teamSize=4) = `Math.floor(40 / 8)` = 5 matches per round
- **Match Assignment**:
  - Automatically assign balanced teams to matches
  - Assign map for the round
  - Assign random sides (CT/T)
  - Generate match configs

#### Match Configuration

- **BO1 Format**: Single map per match
- **No Veto**: Skip veto system completely
- **Fixed Map**: Use predetermined map for round
- **Random Sides**: Randomly assign CT/T sides
- **Round Limit**:
  - Configurable: "First to 13" or "Max Rounds" (default: 24)
  - Set during tournament creation
- **Overtime Handling**:
  - Configurable: Enable Overtime, or Stop at Max Rounds
  - Set during tournament creation
  - Default: Enable Overtime (standard CS2 MR3 format)
- **Player Assignment**: Assign players to teams based on team balancing
- **Player Whitelisting**: All assigned players are automatically whitelisted for their match server
- **Fully Automatic**: No manual match creation or configuration needed - system handles everything

### 4. Individual Player Leaderboard

#### Player Statistics Tracking

- **Match Wins**: Count of matches won (player's team won)
- **Match Losses**: Count of matches lost (player's team lost)
- **Current ELO**: Current ELO rating
- **ELO Change**: ELO change over tournament
- **Performance Metrics**:
  - Average ADR (Average Damage per Round)
  - Total Damage
  - K/D Ratio
  - Other relevant stats
- **Match History**: List of all matches played with results

#### Leaderboard Display

- **Sorting Options**:
  - Primary: Match wins (descending)
  - Secondary: ELO (descending)
  - Tertiary: ADR or other performance metrics
- **Display Columns**:
  - Player name
  - Current ELO
  - Match wins
  - Match losses
  - Win rate
  - Average ADR
  - ELO change (since tournament start)
- **Real-time Updates**: Leaderboard updates automatically as matches complete

#### Tournament Winner

- **Primary Criteria**: Player with most match wins
- **Tie-breaking**:
  - Secondary: Highest ELO
  - Tertiary: Highest ADR or other performance metric
  - Additional criteria as needed

### 6. Tournament Results & Standings

#### Public Tournament Standings Page

- **Public Access**: No authentication required - any player can view
- **URL**: `/tournament/:id/standings` or similar public route
- **Display Content**:
  - Tournament name and status
  - Current round number and progress
  - Player standings/leaderboard
  - Links to individual player pages
  - Tournament winner (when completed)
- **Real-time Updates**: Standings update automatically as matches complete
- **Sorting**: Same sorting options as leaderboard (wins, ELO, ADR, etc.)

#### Player Pages

- **URL Structure**: `/player/:steamId` (e.g., `/player/76561198012345678`)
- **Public Access**: No authentication required
- **Page Content** (Similar to existing team pages):
  - Player name and avatar
  - Current ELO and ELO history chart
  - Match history with detailed stats
  - Performance metrics (ADR, damage, K/D, etc.)
  - Tournament standings (current position)
  - Link to view player's matches
- **Match Details**: Show all matches player participated in with:
  - Match result (win/loss)
  - Map played
  - Round number
  - Team composition (other players on team)
  - Individual performance stats for that match
  - ELO change from that match

#### Find Player Page

- **URL**: `/player` (no slug - base route)
- **Public Access**: No authentication required
- **Functionality**:
  - Input field for Steam profile URL or Steam ID
  - "Find Player" button
  - Redirects to `/player/:steamId` page
  - Supports various Steam URL formats:
    - `https://steamcommunity.com/profiles/76561198012345678`
    - `https://steamcommunity.com/id/username`
    - Direct Steam ID: `76561198012345678`
- **User Experience**:
  - Players can copy/paste their Steam profile URL
  - System extracts Steam ID and redirects
  - No need for Steam authentication or sign-in

#### Player Page Links

- **Integration**: Add "View Player Page" button/link similar to existing team page links
- **Location**:
  - In match views (click player name)
  - In leaderboard (click player name)
  - In tournament standings (click player name)
- **Behavior**: Opens player page in new tab
- **Consistency**: Same UX pattern as existing team page links

### 5. Automatic Round Progression

#### Round Completion Detection

- **Status Tracking**: Monitor all matches in current round
- **Completion Check**: Detect when all matches have status 'completed'
- **Validation**: Ensure all match results are recorded before advancing

#### Automatic Advancement

- **ELO Update**: Automatically update all player ELOs based on completed matches
- **Team Reshuffling**: Automatically reshuffle teams based on updated ELO
- **Next Round Creation**: Automatically create matches for next round
- **Map Assignment**: Automatically assign next map in sequence
- **Match Configuration**: Automatically generate match configs for new round

#### Round Flow

1. Round N starts → All matches created with balanced teams
2. Matches play → Players compete, results tracked
3. All matches complete → System detects completion
4. ELO updated → All player ELOs recalculated
5. Teams reshuffled → New balanced teams formed
6. Round N+1 starts → New matches created automatically
7. Process repeats until tournament ends

## Data Model & Relationships

### Player-Team Integration

- **Unified Player System**:
  - All players are stored in the `players` table
  - Players have ELO, stats, and match history
  - Players are the primary entity for shuffle tournaments
- **Team Import Creates Players**:

  - When bulk importing teams, system extracts players from team data
  - Creates players in `players` table if they don't exist
  - Links players to teams
  - Maintains single source of truth for player data

- **Team Creation Options**:

  - **Method 1**: Paste Steam URL (creates player if needed, adds to team)
  - **Method 2**: Select from existing players (uses players from players table)
  - Both methods ensure players exist in players table first

- **Benefits**:
  - No duplicate player data
  - ELO and stats tracked per player across all teams/tournaments
  - Easy to manage players centrally
  - Players can be reused across teams/tournaments

### Bulk Import Format

#### Players Import (CSV/JSON)

**CSV Format**:

```csv
steamId,name,initialELO,avatarUrl
76561198012345678,Player One,3000,https://...
76561198012345679,Player Two,3200,https://...
76561198012345680,Player Three,,https://...
```

**JSON Format**:

```json
[
  {
    "steamId": "76561198012345678",
    "name": "Player One",
    "initialELO": 3000,
    "avatarUrl": "https://..."
  },
  {
    "steamId": "76561198012345679",
    "name": "Player Two",
    "initialELO": 3200
  },
  {
    "steamId": "76561198012345680",
    "name": "Player Three"
  }
]
```

**Required Fields**: `steamId`, `name`  
**Optional Fields**:

- `initialELO` (defaults to the configured Default Player ELO if not specified - FaceIT-style default, 3000 by default)
- `avatarUrl`

**Note**: If `initialELO` is omitted or empty, player will be created with default ELO of 3000.

#### Team Import (Modified)

- When importing teams, players are automatically extracted and created
- Team import format remains the same (as existing system)
- System processes teams and creates players in background
- Players are linked to teams after creation

## Technical Architecture

### Database Schema Changes

#### New Tables

**`players` Table**

**If Using ELO**:

```sql
CREATE TABLE players (
  id TEXT PRIMARY KEY, -- Steam ID
  name TEXT NOT NULL,
  avatar_url TEXT,
  current_elo INTEGER NOT NULL DEFAULT 3000, -- FaceIT-style default
  starting_elo INTEGER NOT NULL DEFAULT 3000, -- FaceIT-style default
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
```

**If Using OpenSkill** (Recommended):

```sql
CREATE TABLE players (
  id TEXT PRIMARY KEY, -- Steam ID
  name TEXT NOT NULL,
  avatar_url TEXT,
  -- Admin-facing "ELO" (for compatibility and display)
  current_elo INTEGER NOT NULL DEFAULT 3000, -- FaceIT-style default
  starting_elo INTEGER NOT NULL DEFAULT 3000, -- FaceIT-style default
  -- OpenSkill internal values
  openskill_mu REAL NOT NULL DEFAULT 25.0,
  openskill_sigma REAL NOT NULL DEFAULT 8.333,
  match_count INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
```

**Note**:

- Default ELO (Default Player ELO) is applied when no ELO is specified during player creation
- If using OpenSkill, ELO is converted to OpenSkill (mu, sigma) internally
- Display uses OpenSkill's `ordinal()` converted back to ELO scale
- See [OpenSkill Integration](./openskill-integration.md) for conversion details

**`player_rating_history` Table**

**If Using ELO**:

```sql
CREATE TABLE player_elo_history (
  id SERIAL PRIMARY KEY,
  player_id TEXT NOT NULL REFERENCES players(id),
  match_slug TEXT NOT NULL REFERENCES matches(slug),
  elo_before INTEGER NOT NULL,
  elo_after INTEGER NOT NULL,
  elo_change INTEGER NOT NULL,
  match_result TEXT NOT NULL, -- 'win' or 'loss'
  performance_data TEXT, -- JSON with ADR, damage, etc.
  created_at INTEGER NOT NULL,
  FOREIGN KEY (player_id) REFERENCES players(id),
  FOREIGN KEY (match_slug) REFERENCES matches(slug)
);
```

**If Using OpenSkill** (Recommended):

```sql
CREATE TABLE player_rating_history (
  id SERIAL PRIMARY KEY,
  player_id TEXT NOT NULL REFERENCES players(id),
  match_slug TEXT NOT NULL REFERENCES matches(slug),
  -- Display values (for admin/UI)
  elo_before INTEGER NOT NULL, -- Converted from OpenSkill
  elo_after INTEGER NOT NULL, -- Converted from OpenSkill
  elo_change INTEGER NOT NULL,
  -- OpenSkill values
  mu_before REAL NOT NULL,
  mu_after REAL NOT NULL,
  sigma_before REAL NOT NULL,
  sigma_after REAL NOT NULL,
  match_result TEXT NOT NULL, -- 'win' or 'loss'
  performance_data TEXT, -- JSON with ADR, damage, etc.
  created_at INTEGER NOT NULL,
  FOREIGN KEY (player_id) REFERENCES players(id),
  FOREIGN KEY (match_slug) REFERENCES matches(slug)
);
```

**`player_match_stats` Table**

```sql
CREATE TABLE player_match_stats (
  id SERIAL PRIMARY KEY,
  player_id TEXT NOT NULL REFERENCES players(id),
  match_slug TEXT NOT NULL REFERENCES matches(slug),
  team TEXT NOT NULL, -- 'team1' or 'team2'
  won_match BOOLEAN NOT NULL,
  adr REAL,
  total_damage INTEGER,
  kills INTEGER,
  deaths INTEGER,
  assists INTEGER,
  -- Other stats as needed
  created_at INTEGER NOT NULL,
  FOREIGN KEY (player_id) REFERENCES players(id),
  FOREIGN KEY (match_slug) REFERENCES matches(slug)
);
```

**`shuffle_tournament_players` Table** (Tournament Registration)

```sql
CREATE TABLE shuffle_tournament_players (
  tournament_id INTEGER NOT NULL REFERENCES tournament(id),
  player_id TEXT NOT NULL REFERENCES players(id),
  registered_at INTEGER NOT NULL,
  PRIMARY KEY (tournament_id, player_id),
  FOREIGN KEY (tournament_id) REFERENCES tournament(id),
  FOREIGN KEY (player_id) REFERENCES players(id)
);
```

#### Modified Tables

**`tournament` Table**

- Add `type: 'shuffle'` to TournamentType
- Add `map_sequence: TEXT` (JSON array of maps in order - number of maps = number of rounds)
- Add `elo_settings: TEXT` (JSON with ELO configuration)
- Add `round_limit_type: TEXT` ('first_to_13' or 'max_rounds')
- Add `max_rounds: INTEGER` (default: 24, used when round_limit_type is 'max_rounds')
- Add `overtime_mode: TEXT` ('enabled', 'disabled', 'metric_based')
- Add `team_size: INTEGER` (default: 5, number of players per team)
- Add `elo_template_id: TEXT` (references elo_calculation_templates table, nullable)
- Note: No bracket generation needed for shuffle tournaments (individual competition, not bracket-based)

**`matches` Table**

- Support matches without fixed `team1_id`/`team2_id` (nullable)
- Add `round_number: INTEGER` for shuffle tournaments
- Add `is_shuffle_match: BOOLEAN` flag

**New Match Structure for Shuffle**

- Instead of `team1_id` and `team2_id`, use dynamic player assignments
- Store player assignments in match config or separate table
- Track which players were on which team for each match

**Player-Team Relationship**

- Players and teams are separate entities
- Teams reference players from players table
- When teams are bulk imported, players are automatically created
- Players can exist without being on a team
- Players can be on multiple teams (across different tournaments)
- For shuffle tournaments, teams are temporary and players are the primary entity

### Service Architecture

#### New Services

**`ratingService.ts`** (or `eloService.ts` if using ELO)

**If Using ELO**:

- `calculateELOChange(playerId, matchResult, opponentAvgELO)`
- `updatePlayerELO(playerId, matchSlug, newELO)`
- `getPlayerELO(playerId)`
- `getELOHistory(playerId, tournamentId?)`
- `bulkUpdateELO(matchResults)`

**If Using OpenSkill** (Recommended):

- `eloToOpenSkill(elo: number, matchCount?: number): Rating` - Convert admin's ELO to OpenSkill
- `openSkillToDisplayElo(rating: Rating): number` - Convert OpenSkill back to "ELO" for display
- `updatePlayerRatings(team1Players, team2Players, team1Won, matchSlug, templateId?)` - Update using OpenSkill + optional stat adjustments
- `getPlayerRating(playerId): Rating` - Get OpenSkill rating
- `getRatingHistory(playerId, tournamentId?)` - Get rating change history
- `getDisplayElo(playerId): number` - Get "ELO" for display (converted from OpenSkill)

**`eloTemplateService.ts`** (New)

- `createTemplate(input)` - Create new ELO calculation template
- `updateTemplate(id, input)` - Update existing template
- `deleteTemplate(id)` - Delete template
- `getTemplate(id)` - Get template by ID
- `getAllTemplates()` - List all templates
- `applyTemplate(templateId, baseELO, playerStats)` - Apply template to calculate stat adjustments

**`teamBalancingService.ts`**

- `balanceTeams(players: Player[], teamSize: number): Team[]`
- `calculateTeamELO(players: Player[]): number`
- `findOptimalTeamDistribution(players: Player[]): TeamPair[]`
- `handleOddPlayerCount(players: Player[]): Team[]`

**`shuffleTournamentService.ts`**

- `createShuffleTournament(config)`
- `registerPlayers(tournamentId, playerIds)` - Automatically whitelists players
- `generateRoundMatches(tournamentId, roundNumber)` - Automatic, no manual trigger
- `checkRoundCompletion(tournamentId, roundNumber)`
- `advanceToNextRound(tournamentId)` - Automatic advancement
- `getPlayerLeaderboard(tournamentId)` - Get sorted leaderboard
- `getTournamentStandings(tournamentId)` - Get public standings (no auth required)

**`playerService.ts`**

- `createPlayer(steamId, name, initialELO?)` - If initialELO not provided, defaults to 3000
- `bulkImportPlayers(players: PlayerImport[])` - Import from CSV/JSON, missing ELO defaults to 3000
- `updatePlayer(playerId, updates)`
- `getPlayer(playerId)` - Get player details (public)
- `getAllPlayers()` - Get all players (for selection modal)
- `getPlayersForSelection(teamId?)` - Get players with team membership status
- `getPlayerMatchHistory(playerId, tournamentId?)` - Get all matches player participated in
- `findPlayerBySteamUrl(steamUrl)` - Extract Steam ID from URL and find player
- `getPlayerStats(playerId, tournamentId?)` - Get aggregated player statistics
- `createPlayersFromTeamImport(teamData)` - Create players when importing teams

#### Modified Services

**`teamService.ts`** (Modified)

- `bulkImportTeams(teams: TeamImport[])` - Modified to also create players
  - When importing teams, extract players from team data
  - Create players in players table if they don't exist
  - Link players to teams
- `createTeamWithPlayers(teamData, playerIds)` - Create team and assign players
- `addPlayersToTeam(teamId, playerIds)` - Add players to existing team
- `getTeamPlayers(teamId)` - Get all players in team

**`tournamentService.ts`**

- Add support for `'shuffle'` tournament type
- Handle shuffle-specific tournament creation
- Support shuffle tournament queries

**`matchConfigBuilder.ts`**

- Support shuffle match config generation
- Handle dynamic player assignments
- Skip veto for shuffle tournaments
- Random side assignment

**`matchEventHandler.ts`**

- Track individual player stats for shuffle matches
- Update ELO after match completion
- Trigger round advancement checks

### API Endpoints

#### Player Management

- `POST /api/players` - Create player
- `POST /api/players/bulk-import` - Bulk import players (CSV/JSON)
- `GET /api/players` - List all players (for admin management)
- `GET /api/players/selection` - Get players for selection modal (with team membership status)
- `GET /api/players/:playerId` - Get player details (public)
- `PUT /api/players/:playerId` - Update player (admin)
- `DELETE /api/players/:playerId` - Delete player (admin)
- `GET /api/players/:playerId/elo-history` - Get ELO history (public)
- `GET /api/players/:playerId/matches` - Get player match history (public)
- `GET /api/players/find` - Find player by Steam URL/ID (public)

#### Team Management (Modified)

- `POST /api/teams` - Create team (modified to support player selection)
- `POST /api/teams/bulk-import` - Bulk import teams (modified to create players)
- `POST /api/teams/:id/players` - Add players to team (from selection or URL)
- `DELETE /api/teams/:id/players/:playerId` - Remove player from team

#### Tournament Management

- `POST /api/tournaments` - Create tournament (support shuffle type)
- `POST /api/tournaments/:id/register-players` - Register players to tournament
- `GET /api/tournaments/:id/players` - Get registered players
- `GET /api/tournaments/:id/leaderboard` - Get player leaderboard
- `GET /api/tournaments/:id/standings` - Get tournament standings (public, no auth required)
- `GET /api/tournaments/:id/round-status` - Get current round status
- Note: All round generation and advancement is automatic - no manual triggers needed
- Note: No bracket endpoints needed - shuffle tournaments don't use brackets

#### ELO Configuration

- `GET /api/tournaments/:id/elo-settings` - Get ELO settings
- `PUT /api/tournaments/:id/elo-settings` - Update ELO settings
- `GET /api/tournament/:id/elo-template` - Get tournament's ELO template
- `PUT /api/tournament/:id/elo-template` - Set ELO template for tournament

#### ELO Calculation Templates

- `GET /api/elo-templates` - List all templates
- `GET /api/elo-templates/:id` - Get template details
- `POST /api/elo-templates` - Create new template
- `PUT /api/elo-templates/:id` - Update template
- `DELETE /api/elo-templates/:id` - Delete template

### UI/UX Components

#### Tournament Creation

- **Tournament Type Selection**: Add "Shuffle Tournament" option
- **Player Registration**:
  - Bulk import interface (CSV/JSON upload)
  - Individual player addition
  - Set initial ELO for each player
  - Players are automatically whitelisted for matches
- **Map Selection**:
  - Select maps from map pool
  - Number of maps selected = number of rounds
  - Simple selection - no complex configuration
- **Team Size Configuration**:
  - Select number of players per team (default: 5 for 5v5)
  - Common options: 4v4, 5v5, 6v6
  - Minimum: 2 players per team
  - Maximum: 10 players per team
- **Round Configuration**:
  - Select round limit type: "First to 13" or "Max Rounds"
  - If "Max Rounds" selected, set max rounds value (default: 24)
- **Overtime Configuration**:
  - Select overtime handling:
    - "Enable Overtime" (standard CS2 MR3 format)
    - "Stop at Max Rounds" (end when max rounds reached)
    - "Stop Based on Metric" (use total team damage if tied)
  - Default: Enable Overtime
- **ELO Settings**:
  - Configure ELO parameters
  - Set default starting ELO (default: 3000, FaceIT-style)
  - Set K-factor (default: 32, standard chess ELO)
- **Fully Automatic**: Once tournament is created and started, system handles everything automatically

#### Players Page (Admin)

- **Page Route**: `/players` (admin only)
- **Bulk Import**:

  - CSV/JSON import similar to teams
  - Required fields: `steamId`, `name`
  - Optional fields: `initialELO`, `avatarUrl`
  - Format example:

    ```json
    [
      {
        "steamId": "76561198012345678",
        "name": "Player Name",
        "initialELO": 3000,
        "avatarUrl": "https://..."
      },
      {
        "steamId": "76561198012345679",
        "name": "Player Without ELO"
      }
    ]
    ```

    **Note**: If `initialELO` is omitted, player gets default ELO of 3000.

    ```

    ```

- **Player List**:
  - Grid/table view of all players
  - Columns: Avatar, Name, Steam ID, Current ELO, Actions
  - Search/filter functionality
  - Edit/delete actions
- **Individual Creation**:
  - Form to add single player
  - Fields: Steam ID, Name, Initial ELO (optional, defaults to 3000)
  - If Initial ELO is left empty, defaults to 3000 (FaceIT-style)

#### Team Creation/Editing

- **Two Methods for Adding Players**:

  1. **Paste Steam URL** (Existing):

     - Input field for Steam profile URL
     - System extracts Steam ID
     - Creates player if doesn't exist
     - Adds to team

  2. **Select from Players** (New):
     - "Select Players" button
     - Opens modal with player selection grid
     - Modal features:
       - Grid of player cards
       - Each card: Avatar, Name, Steam ID, Checkbox
       - Search/filter players
       - Selection counter: "X players selected"
       - Gray out players already in team
       - "Add to Team" button (enabled when players selected)
       - "Cancel" button
     - Visual states:
       - Normal: White background, enabled checkbox
       - Selected: Highlighted border, checked checkbox
       - Disabled: Gray background, disabled checkbox, tooltip "Already in team"

- **Team Player List**:
  - Show all players currently in team
  - Remove player button for each
  - Add more players using either method

#### Player Management

- **Players Page** (Similar to Teams Page):
  - **Bulk Import**:
    - Import players via CSV/JSON (similar to team import)
    - Required fields: Steam ID, Name
    - Optional fields: Initial ELO, Avatar URL
    - Format: Same as team import but with ELO field added
  - **Player List**:
    - Display all players in system
    - Show: Avatar, Name, Steam ID, Current ELO
    - Edit player details (name, ELO)
    - Delete player
  - **Individual Player Creation**:
    - Add single player manually
    - Enter Steam ID, Name, Initial ELO
  - **ELO Management**:
    - View ELO history per player
    - Manually adjust ELO (admin only)
    - Bulk ELO import/update

#### Team Creation with Player Integration

- **Player-Team Relationship**:

  - When bulk importing teams, automatically create players in players table
  - Each player from team import is added to players table
  - Players and teams are linked but separate entities
  - Players can exist without being on a team
  - Teams reference players from the players table

- **Team Creation Options** (Two Separate Methods):

  1. **Paste Steam URL** (Existing Method):

     - Admin pastes Steam profile URL
     - System extracts Steam ID and creates player if doesn't exist
     - Adds player to team
     - Same as current implementation

  2. **Select from Players** (New Method):
     - "Select Players" button opens player selection modal
     - Modal shows grid of player cards
     - Each card displays:
       - Player avatar
       - Player name
       - Steam ID
       - Checkbox for selection
     - Features:
       - Select multiple players via checkboxes
       - Counter showing "X players selected"
       - Gray out players already in the team (disabled state)
       - Search/filter players by name or Steam ID
       - "Add to Team" button (adds selected players)
       - "Cancel" button (closes modal without changes)
     - Visual feedback:
       - Selected players highlighted
       - Disabled players grayed out with tooltip "Already in team"
       - Selection counter updates in real-time

- **Team Management**:
  - When viewing/editing team, show list of players
  - Can remove players from team
  - Can add more players using either method (URL or selection)
  - Players remain in players table even if removed from team

#### Match View

- **Shuffle Match Display**:
  - Show dynamically assigned teams
  - Display player names (not just team names)
  - Show current ELO for each player
- **Round Status**:
  - Display current round number
  - Show round completion progress
  - Indicate when round is complete

#### Leaderboard

- **Individual Player Leaderboard**:
  - Sortable columns
  - Real-time updates
  - Filter/search functionality
  - Export to CSV/JSON
  - Click player name to open player page
- **Player Detail View**:
  - Click player to see detailed stats
  - Match history
  - ELO progression chart
  - Link to full player page

#### Tournament Standings (Public Page)

- **Public Tournament Standings**:
  - Display tournament name and status
  - Current round progress
  - Player standings table
  - Links to individual player pages
  - Tournament winner display (when completed)
  - No authentication required
- **Real-time Updates**: Standings update automatically

#### Player Pages

- **Player Page** (`/player/:steamId`):
  - Player profile (name, avatar, current ELO)
  - ELO history chart
  - Match history with detailed stats
  - Performance metrics
  - Tournament standings link
  - Public access (no auth required)
- **Find Player Page** (`/player`):
  - Input field for Steam URL or Steam ID
  - "Find Player" button
  - Redirects to player page
  - Supports various Steam URL formats
  - Public access (no auth required)
- **Player Page Links**:
  - "View Player Page" button/link (similar to team pages)
  - Available in match views, leaderboard, standings
  - Opens in new tab

#### Round Management

- **Round Progress Indicator**:
  - Show matches in current round
  - Completion status
  - Auto-advancement status
- **Fully Automatic**: No manual controls needed - system handles everything automatically

## Algorithm Specifications

### ELO Calculation Algorithm

#### Package Recommendation

- **ELO Package Research**: See [ELO Package Research](./elo-package-research.md) for detailed analysis of available npm packages
- **Recommended Package**: `@echecs/elo` - Follows FIDE rules (official chess ELO standard), updated October 2024
- **Alternative**: `teslo` - TypeScript support, updated May 2025
- **Implementation Option**: Manual implementation is also straightforward (~10 lines of code)

#### Standard Chess ELO Formula

```
Expected Score = 1 / (1 + 10^((opponent_avg_elo - player_elo) / 400))
ELO Change = K * (Actual - Expected)

Where:
- K = K-factor (default: 32, standard chess ELO)
- Actual = 1 if team won, 0 if team lost
- Expected = Expected probability of winning based on ELO difference
- opponent_avg_elo = Average ELO of opponent team
```

#### Implementation Details

- **Win/Loss Based**: ELO changes based solely on team result
  - If player's team wins → Actual = 1
  - If player's team loses → Actual = 0
- **No Performance Adjustment**:
  - Individual performance metrics (ADR, damage, K/D) do not affect ELO
  - Keeps system simple and fair
  - All players on winning team get same ELO change
  - All players on losing team get same ELO change
- **Opponent Strength Considered**:
  - ELO change depends on opponent team's average ELO
  - Beating stronger team (higher avg ELO) = larger ELO gain
  - Losing to weaker team (lower avg ELO) = larger ELO loss
- **K-Factor**:
  - Default: 32 (standard chess ELO)
  - Configurable in tournament settings
  - Higher K = more volatile ELO changes
  - Lower K = more stable ELO changes

#### Example Calculation

```
Player ELO: 3000
Opponent Team Avg ELO: 3100
K-factor: 32
Result: Team Won

Expected = 1 / (1 + 10^((3100 - 3000) / 400))
Expected = 1 / (1 + 10^(100 / 400))
Expected = 1 / (1 + 10^0.25)
Expected = 1 / (1 + 1.778)
Expected = 0.36

ELO Change = 32 * (1 - 0.36)
ELO Change = 32 * 0.64
ELO Change = +20.48 ≈ +20

New ELO: 3020
```

### Team Balancing Algorithm

#### Algorithm Research

- **Team Balancing Research**: See [Team Balancing Research](./team-balancing-research.md) for detailed analysis of algorithms and approaches
- **Recommended Approach**: Greedy Algorithm + Optimization Step (Xwoe-style)
- **Reference Implementation**: Xwoe Matchmaking Algorithm (https://github.com/Xwoe/matchmaking)
- **No NPM Package**: No dedicated npm packages found for team balancing - custom implementation needed

#### Greedy Algorithm Approach (Recommended for MVP)

```
1. Sort players by ELO (descending)
2. Initialize teams as empty arrays
3. For each player in sorted list:
   a. Calculate average ELO for each existing team
   b. Assign player to team with lowest average ELO
   c. If team is full (teamSize players), remove from consideration
4. Continue until all players assigned
```

**Time Complexity**: O(n log n + n \* t) where n = players, t = teams  
**Pros**: Simple, fast, works well for most cases  
**Cons**: May not find optimal solution

#### Optimization Algorithm Approach (Recommended for Production)

```
1. Use greedy algorithm for initial assignment
2. Calculate current ELO variance between teams
3. Iteratively swap players between teams
4. Accept swap if it reduces variance
5. Continue until convergence or max iterations
```

**Reference**: Xwoe Matchmaking Algorithm  
**Pros**: Better balance quality, tested in tournaments  
**Cons**: More complex, requires iteration

#### Alternative Approaches

- **Snake Draft**: Alternate team selection (simple but less optimal)
- **Genetic Algorithm**: Evolutionary approach (complex, good quality)
- **Full Optimization**: Find optimal solution (too slow for 60+ players)

#### Research Required

- Study existing team balancing algorithms (see research document)
- Test greedy algorithm with various player distributions
- Implement optimization step based on Xwoe algorithm
- Handle edge cases (odd players, extreme ELOs)

## Implementation Phases

### Phase 1: Foundation & Database

1. Add `'shuffle'` tournament type to type system
2. Create database schema for players and ELO tracking
3. Create `players` table and related tables
4. Update `tournament` table for shuffle support
5. Update `matches` table for shuffle matches
6. Create migration scripts

### Phase 2: Player Management

1. Create `playerService.ts`
2. Implement player CRUD operations
3. Implement bulk player import (CSV/JSON)
4. Create Players page (similar to Teams page)
   - Bulk import interface
   - Player list with ELO display
   - Individual player creation
   - Player editing/deletion
5. Add initial ELO assignment interface
6. Modify team import to create players
7. Implement player-team linking

### Phase 3: Rating System (ELO or OpenSkill)

1. **Decision**: Choose ELO or OpenSkill

   - Review [ELO Package Research](./elo-package-research.md) for ELO options
   - Review [OpenSkill Integration](./openskill-integration.md) for OpenSkill approach
   - **Recommendation**: OpenSkill (faster, better for teams, simple admin interface)

2. **If Using ELO**:

   - Install selected ELO package (e.g., `@echecs/elo` or `teslo`) or implement manually
   - Implement standard chess ELO calculation algorithm
   - Implement `eloService.ts` with win/loss based calculation
   - Create ELO configuration interface (K-factor setting)

3. **If Using OpenSkill** (Recommended):

   - Install `openskill` package: `npm install openskill`
   - Implement ELO-to-OpenSkill conversion functions
   - Implement `ratingService.ts` with OpenSkill integration
   - Admin interface remains simple (single "ELO" number)
   - System converts internally to OpenSkill (mu, sigma)
   - Display converts back to "ELO" for familiarity

4. **Common Steps**:
   - Implement rating history tracking
   - Test rating calculations with various scenarios
   - Verify rating changes are fair and balanced
   - Test with 60 players

### Phase 4: Team Balancing

1. Review [Team Balancing Research](./team-balancing-research.md)
2. Implement greedy algorithm (MVP)
3. Test with various player distributions
4. Add optimization step (Xwoe-style)
5. Implement `teamBalancingService.ts`
6. Handle edge cases (odd players, extreme ELOs)
7. Performance testing with 60 players

### Phase 5: Tournament Management

1. Create `shuffleTournamentService.ts`
2. Implement tournament creation for shuffle type
3. Implement player registration (with automatic whitelisting)
4. Implement automatic round generation (no manual triggers)
5. Implement round completion detection
6. Implement automatic round advancement
7. Implement tournament standings page (public)

### Phase 6: Match Integration

1. Update `matchConfigBuilder.ts` for shuffle matches
   - Support round limit configuration (first to 13 or max rounds)
   - Support overtime mode configuration
2. Update `matchEventHandler.ts` to track player stats
3. Implement ELO updates after match completion (win/loss based)
4. Implement match end detection based on round limit and overtime settings
5. Update match display for shuffle tournaments
6. Disable veto system for shuffle matches

### Phase 7: Leaderboard & Player Pages

1. Create player leaderboard component
2. Implement real-time leaderboard updates
3. Create public tournament standings page
4. Create player page (`/player/:steamId`)
5. Create find player page (`/player`)
6. Implement Steam URL parsing and Steam ID extraction
7. Add player page links throughout UI (matches, leaderboard, standings)
8. Create player detail view with match history
9. Add ELO progression charts
10. Create round status indicators

### Phase 8: Team Creation with Player Selection

1. Create player selection modal component
2. Implement player card grid with checkboxes
3. Add selection counter
4. Implement gray-out for players already in team
5. Integrate with team creation/editing
6. Test both methods (Steam URL and player selection)

### Phase 9: Testing & Polish

1. End-to-end testing with 60 players
2. Performance testing
3. Edge case testing
4. UI/UX polish
5. Documentation

## Open Questions & Decisions Needed

### ELO System

1. **Rating System**:

   - **Option A (ELO)**: ✅ Standard chess ELO formula (win/loss based)
   - **Option B (OpenSkill)**: ✅ OpenSkill system (recommended - faster, better for teams)
   - ✅ No individual performance adjustment
   - ✅ Rating change based solely on team result and opponent strength
   - ✅ Admin interface simple (single "ELO" number) - system handles conversion if using OpenSkill

2. **ELO Parameters**:

   - ✅ Default starting ELO value: 3000 (FaceIT-style, applied when no ELO specified)
   - ❓ K-factor values (new vs established players)
   - ❓ Maximum/minimum ELO bounds
   - ❓ ELO change limits per match

3. **Initial ELO Assignment**:
   - ✅ Players without initial ELO get default of 3000 (FaceIT-style)
   - ✅ Applied automatically on player creation (Players page, Teams page, bulk import)
   - ❓ Import format for bulk ELO import
   - ❓ Should admin be able to manually adjust ELO mid-tournament?

### Team Balancing

1. **Algorithm Selection**:

   - ❓ Which algorithm to use (greedy, optimization, genetic, etc.)
   - ❓ How to handle odd number of players
   - ❓ How to ensure balanced distribution across matches (not just within teams)

2. **Balancing Criteria**:
   - ❓ Strictly by average ELO, or consider other factors?
   - ❓ Should we consider player roles/positions?
   - ❓ How to handle very high/low ELO outliers?

### Tournament Structure

1. **Match Frequency**:

   - ❓ How many rounds/matches per player?
   - ❓ Round-robin style (everyone plays everyone)?
   - ❓ Fixed number of rounds?
   - ❓ Based on player count?

2. **Tournament End**:

   - ✅ Fixed number of rounds (determined by number of maps selected)
   - ✅ Tournament ends when all rounds complete
   - ❓ Should there be a final ranking round or just use cumulative stats?

3. **Round Limit & Overtime**:

   - ✅ Configurable: "First to 13" or "Max Rounds" (default: 24)
   - ✅ Overtime options: Enable or Disable
   - ❓ Default overtime mode preference?

4. **Tie-breaking**:
   - ❓ Primary: Match wins
   - ❓ Secondary: ELO?
   - ❓ Tertiary: ADR or other metric?
   - ❓ Additional criteria?

### Technical Decisions

1. **Player Identification**:

   - ❓ Use Steam ID as primary key?
   - ❓ Support multiple tournaments with same players?
   - ❓ Player name management (overwrite from server?)

2. **Match Structure**:

   - ❓ How to store dynamic team assignments?
   - ❓ Store in match config or separate table?
   - ❓ How to query matches by player?

3. **Performance**:
   - ❓ How to handle 60+ players efficiently?
   - ❓ Caching strategy for leaderboard?
   - ❓ Real-time update frequency?

## Success Criteria

### Functional Requirements

- ✅ System automatically creates balanced teams for each round
- ✅ ELO updates automatically after each match
- ✅ Teams reshuffle automatically between rounds
- ✅ Rounds advance automatically when all matches complete
- ✅ Leaderboard displays accurate player rankings
- ✅ Tournament winner determined by match wins (with tie-breaking)

### Performance Requirements

- ✅ Handle 60+ players efficiently
- ✅ Leaderboard updates in real-time
- ✅ Round advancement happens within seconds of completion
- ✅ Team balancing completes quickly (< 1 second for 60 players)

### User Experience

- ✅ Admin can easily create shuffle tournament
- ✅ Admin can import players and set initial ELO
- ✅ System is fully automatic - no manual intervention needed
- ✅ Players can view their stats and leaderboard (public access)
- ✅ Players can find their own page using Steam URL
- ✅ Clear indication of round status and progression
- ✅ Public tournament standings page for easy viewing

## Next Steps

1. **Rating System Selection**:

   - **Option A**: Review [ELO Package Research](./elo-package-research.md) - select ELO package
   - **Option B**: Review [OpenSkill Integration](./openskill-integration.md) - use OpenSkill (recommended)
   - **Recommendation**: OpenSkill - faster, better for teams, simple admin interface
   - Install selected package and test with sample calculations

2. **Review Excel Sheet** (Optional):

   - Get Excel sheet from issue creator (if available)
   - Compare with standard chess ELO formula
   - Document any differences or customizations

3. **Research Team Balancing**:

   - Review [Team Balancing Research](./team-balancing-research.md)
   - Study Xwoe matchmaking algorithm (GitHub reference)
   - Implement greedy algorithm first (MVP)
   - Add optimization step for production
   - Test with sample player distributions

4. **Design Detailed Architecture**:

   - Finalize database schema
   - Design API endpoints
   - Plan UI components

5. **Create Implementation Plan**:

   - Break down into tasks
   - Estimate effort
   - Set milestones

6. **Prototype Core Features**:

   - ELO calculation
   - Team balancing
   - Round progression

7. **Iterate and Refine**:
   - Test with issue creator
   - Gather feedback
   - Adjust as needed
