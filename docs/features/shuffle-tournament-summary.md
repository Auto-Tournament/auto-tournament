# Shuffle Tournament Type – Feature Summary

> **Audience**: High-level feature overview  
> **Technical design**: See `shuffle-tournament-complex-solution.md`  
> **Admin usage**: See `guides/shuffle-tournaments.md`  
> **Implementation status**: See `shuffle-tournament-implementation-verification.md`

## Overview

Shuffle tournaments introduce a tournament type where players compete **individually**, and teams are **re-balanced automatically before each round** based on ELO. The tournament winner is the player with the most match wins, with ELO and ADR used as tie-breakers.

## Core Problem Statement

### Current System Limitations

The current tournament system is designed around **fixed teams**:

- Teams are created with a fixed roster of players
- Teams remain consistent throughout the tournament
- Tournament progression tracks team wins/losses
- Map veto system is team-based

### User's Use Case

- **Event**: LAN Party with ~60 players
- **Challenge**: Wide range of player skill levels (ELO differences)
- **Current Workaround**: Manual Excel sheet that:
  - Tracks individual player ELO values
  - Calculates average team ELO
  - Attempts to balance teams (5 players per team) with similar average ELO
  - Records match results per player
- **Goal**: Individual players compete, not teams. Player with most match wins wins the tournament.

## Key Requirements

### 1. Match Structure

- **Format**: Best of 1 (BO1) - single map per match
- **Team size**: 5 players per team (5v5 matches)
- **No knife round**: Sides are assigned randomly, no knife round for side selection
- **No veto system**: Map veto is completely bypassed
- **Random side assignment**: Team sides (CT/T) are randomly assigned per match

### 2. Dynamic Team Composition

- **No fixed teams**: Players should not be permanently assigned to teams
- **Core implementation approach**: "Not fixing Player IDs to Teams" - players are not bound to specific team entities
- **Shuffled teams per match**: Teams are formed dynamically for each match
- **Flexible player assignment**: Any player can join any server/match (players can join any available server)
- **Team balancing**: Teams should be balanced by ELO/skill level (5 players per team with similar average ELO)

### 3. Map Management

- **Fixed map per round**: All matches in a round use the same map
- **Round-based progression**: Maps are assigned sequentially per round
  - Example: Round 1 → all matches use `de_dust2`
  - Round 2 → all matches use `de_mirage`
  - Round 3 → all matches use `de_inferno`
  - And so on...
- **Admin-controlled**: Maps are predetermined for each round during tournament setup
- **No map voting**: Map veto system is completely disabled for this tournament type

### 4. Round Synchronization

- **Round completion requirement**: All matches in a round must complete before the next round can begin
- **Synchronized progression**: The tournament waits for all teams to finish their matches in the current round before advancing
- **Match coordination**: System must track round completion status and prevent premature round advancement

### 5. Individual Player Tracking

- **Player-centric scoring**: Track wins/losses per individual player (not teams)
- **No team winner**: Tournament winner is the individual player with most match wins
- **Player statistics**: Track individual performance across all matches
- **ELO tracking**: Track and update individual player ELO values based on match performance

### 6. Match Creation

- Shuffle tournaments use the standard tournament lifecycle (setup → in progress → completed) without a bracket tree.
- Matches are created **automatically** for each round based on registered players and configured team size.
- Teams are assigned automatically using the team-balancing algorithm, and players are whitelisted via MatchZy match configs.

## Proposed Solutions

### Solution A: Simple Implementation (Priority for Initial Release)

**Description**: Basic match creation without tournament bracket structure - **Target: Dec 27th for LAN Party**

**Features**:

- **Match Creation**: Allow match creation **without requiring a tournament tree/bracket**
  - Can create individual matches without creating a full tournament
  - Admin creates 6 matches manually between each round
- **Player Registration** (Optional):
  - Bulk import of Steam IDs via CSV/JSON
  - Player whitelisting not required (players can join without being whitelisted)
  - Even number of players expected (no sub in/out needed)
- **Player Names**: Admin can set custom player names (already works)
- **Player Avatars** (Low Priority):
  - Set custom avatars per player or per team
  - Does not contribute to gameplay functionality
- **Player Dashboard** (Low Priority):
  - Can communicate connection URLs through Discord/website instead
- **Maps**:
  - Choose from map pool (pre-assigned maps not critical)
  - Fixed map per round simplifies tournament management
- **Round Creation**: **MANUAL** - Admin creates new round after previous round finishes
- **Team Formation**: **MANUAL** - Admin manually assigns players/teams to each match
  - No auto-assignment (relies on Excel ELO calculations)
  - Player assignment optional (players can join correct server/side themselves)
- **Round Progression**: **MANUAL TRIGGER** - Admin manually triggers next round
  - All matches must finish before next round can start
  - System tracks round completion but doesn't auto-advance
- **Win Condition**: Not needed (relies on Excel sheet for tracking)
- **Match Stat Overview** (Priority 2):
  - **Critical**: Display ADR (Average Damage per Round) or Total Damage per player after match
  - **Alternative**: Export stats to webhook/Discord/JSON/CSV after match ends
  - Currently players screenshot stats and send to admins

**Pros**:

- Faster to implement (target Dec 27th)
- Allows user to maintain their existing Excel-based tournament tree
- Minimal changes to existing system
- Works with current ELO calculation workflow

**Cons**:

- Still requires manual team management
- Doesn't leverage the platform's automation capabilities
- Relies on external Excel sheet for ELO tracking

### Solution B: Complex Implementation (Recommended)

**Description**: Full ELO-based system with automatic team assignment

**Features**:

- **Custom ELO System**:
  - Admin can set starting ELO for each player
  - Configurable ELO change parameters based on match performance
  - ELO updates after each match based on player stats
- **Automatic Team Assignment**:
  - Algorithm balances teams by average ELO
  - Forms teams of 5 players with similar total ELO
  - Assigns balanced teams to matches
- **Match Scheduling**:
  - Automatic match creation and team assignment
  - Players matched based on ELO and availability
- **Individual Player Leaderboard**:
  - Track match wins per player
  - Display player statistics (ELO, wins, losses, performance metrics)
  - Tournament winner = player with most match wins

**Pros**:

- Fully automated system
- Better player experience
- Leverages platform capabilities
- Scalable for large events

**Cons**:

- More complex to implement
- Requires ELO algorithm design
- Needs team balancing algorithm

## Technical Considerations

### Database Schema Changes

- **New tournament type**: Add `'shuffle'` or `'individual'` to `TournamentType`
- **Player ELO tracking**: New table or fields to store:
  - Player ELO values
  - ELO history/changes
  - Player match statistics
- **Match structure**: May need to support matches without fixed `team1_id`/`team2_id`
- **Player assignments**: Track which players were on which team for each match

### Match Configuration

- **Match format**: BO1 (Best of 1) - single map per match
- **Team assignment**: Dynamic team assignment at match creation time (5 players per team)
- **Map configuration**:
  - Fixed map per round (all matches in round use same map)
  - No veto system - maps are predetermined
  - Map sequence defined during tournament setup
- **Side assignment**: Random CT/T assignment (no knife round)
- **Player tracking**: Track individual players across matches, not just teams
- **Round synchronization**: System must ensure all matches in a round complete before advancing

### UI/UX Changes

- **Match creation**:
  - Allow creating matches without tournament tree
  - Manual match creation interface (create 6 matches per round)
  - Manual player/team assignment to matches
- **Player management** (Optional):
  - Bulk import players via CSV/JSON
  - Set custom player names (already works)
  - Set custom player avatars (low priority)
- **Match view**: Display manually assigned teams/players
- **Match stats display** (Priority 2):
  - Show ADR or Total Damage per player after match
  - Export option: webhook/Discord/JSON/CSV
- **Round management**:
  - Manual round creation trigger
  - Round completion status display
  - Manual next round trigger button
- **Leaderboard**: Individual player leaderboard (for complex solution)

### Algorithm Requirements

#### Simple Solution (Initial Release)

- **Round completion detection**:
  - Logic to detect when all matches in a round are complete
  - Display round completion status to admin
  - **Manual trigger** required to start next round (no auto-advancement)
- **Match stat extraction**:
  - Extract ADR or Total Damage from match results
  - Display per player after match completion
  - Export capability (webhook/Discord/JSON/CSV)

#### Complex Solution (Future)

- **Team balancing**:
  - Algorithm to create balanced teams of 5 players from player pool
  - Balance by average ELO (teams should have similar total/average ELO)
  - Use established, trialed-and-tested formulas (can be researched online)
  - Handle edge cases (odd number of players, etc.)
- **ELO calculation**:
  - Formula to update ELO based on match results and individual performance
  - Issue creator's Excel sheet has specific formula (created by "CS2 Tournament Master")
  - Very dynamic system based on match performance of every player
  - Consider both team result (win/loss) and individual performance stats (ADR/Damage)
- **Round progression**:
  - Automatic advancement to next round with new map assignment
  - Automatic team reshuffling based on updated ELO

## Implementation Phases

### Phase 1: Foundation

1. Add new tournament type to type system
2. Modify database schema to support player-centric tracking
3. Update tournament creation UI to include new type
4. Basic match creation without bracket requirement

### Phase 2: Core Match Structure (Simple Solution - Target Dec 27th)

1. **Match Creation Without Tournament**:
   - Allow creating individual matches without tournament tree
   - Manual match creation interface
2. **BO1 Match Format**: Single map per match
3. **Fixed Map Assignment**: Same map for all matches in round (choose from map pool)
4. **Disable Veto System**: No map veto for shuffle tournament type
5. **Random Side Assignment**: No knife round, random CT/T assignment
6. **Manual Team/Player Assignment**:
   - Interface for admin to manually assign players/teams to matches
   - Support assigning individual players or teams
7. **Round Synchronization**:
   - Track round completion status (all matches must finish)
   - Manual trigger for next round (no auto-advancement)
8. **Match Stat Display** (Priority 2):
   - Extract and display ADR or Total Damage per player after match
   - Export option: webhook/Discord/JSON/CSV
9. **Player Import** (Optional):
   - Bulk import Steam IDs via CSV/JSON
   - Player name management

### Phase 3: ELO System & Team Balancing

1. Research and select team balancing algorithm (use established formulas)
2. Design and implement ELO calculation system
   - Review issue creator's Excel sheet for formula details
   - Implement ELO update logic based on match results
3. Create team balancing algorithm (5 players per team, balanced by ELO)
4. Automatic match creation and team assignment per round
5. Player ELO management interface (set initial ELO, view history)
6. Enhanced player leaderboard with ELO, wins, and statistics

### Phase 4: Polish

1. Admin controls for ELO parameters
2. Match history per player
3. Performance analytics
4. Export capabilities for results

## Confirmed Details

1. **Team size**: ✅ **5 players per team** (5v5 matches)
2. **Match format**: ✅ **Best of 1 (BO1)** - single map per match
3. **No knife round**: ✅ Sides are randomly assigned, no knife round
4. **No veto**: ✅ Map veto system is completely disabled
5. **Map assignment**: ✅ **Same map for all matches in a round**
   - Round 1: All matches use map 1 (e.g., `de_dust2`)
   - Round 2: All matches use map 2 (e.g., `de_mirage`)
   - Round 3: All matches use map 3 (e.g., `de_inferno`)
   - Continues sequentially...
6. **Round synchronization**: ✅ **All matches in a round must complete before next round starts**
   - System waits for all teams to finish their matches in current round
   - Next round cannot begin until all matches in current round are completed
7. **Side assignment**: ✅ Random side assignment (CT/T) per match

## Match Flow Example

### Simple Solution Workflow (Manual Process)

#### Round 1 Setup (Admin Actions)

1. **Admin creates 6 matches manually** (for 60 players = 6 matches of 5v5)
   - No tournament tree needed - just create individual matches
2. **Admin manually assigns players/teams** to each match
   - Uses Excel sheet to calculate balanced teams based on ELO
   - Assigns 5 players to team1, 5 players to team2 for each match
   - OR assigns existing teams if using team system
3. **Admin selects map** for round 1 (e.g., `de_dust2`)
   - All 6 matches will use this same map
4. **Sides**: Randomly assigned per match (no knife round)

#### Round 1 Execution

- All 6 matches play simultaneously (or as servers allow)
- Each match is BO1 on `de_dust2`
- Sides are randomly assigned per match
- Players join servers (whitelisting optional)

#### Round 1 Completion

- System tracks when **all 6 matches** complete
- After each match: **ADR or Total Damage displayed per player**
- Admin can export stats to webhook/Discord/JSON/CSV
- Admin updates ELO in Excel sheet based on match results

#### Round 2 Setup (After Round 1 Completes - Admin Actions)

1. **Admin manually triggers "Create Next Round"** button
2. **Admin creates 6 new matches** for round 2
3. **Admin manually assigns players/teams** again
   - Uses updated ELO from Excel to balance teams
   - Players reshuffled into new balanced teams
4. **Admin selects map** for round 2 (e.g., `de_mirage`)
   - All 6 matches will use this same map
5. **Sides**: Randomly assigned again

#### Round 2 Execution

- All matches play on `de_mirage`
- Process repeats

#### Tournament Winner

- Tracked in Excel sheet (not in system for simple solution)
- Player with **most match wins** across all rounds wins
- Individual player leaderboard (handled externally)

### Complex Solution Workflow (Future - Automated)

#### Round 1 Setup (Automatic)

- **System automatically creates matches** based on player count
- **System automatically balances teams** using ELO algorithm
- **System automatically assigns map** for round 1
- **Sides**: Randomly assigned

#### Round 1 Execution

- All matches play simultaneously
- Individual player results tracked

#### Round 1 Completion (Automatic)

- System detects all matches complete
- **System automatically updates ELO** for all players
- **System automatically reshuffles teams** based on new ELO
- **System automatically advances to next round**

#### Round 2 Setup (Automatic)

- **System automatically creates new matches** with reshuffled teams
- **System automatically assigns map** for round 2
- Process continues automatically

#### Tournament Winner

- **System tracks match wins** per player
- **System displays leaderboard** with ELO, wins, stats
- Player with most match wins wins tournament

## Open Questions (Simple Solution)

1. **Player Registration**:

   - ✅ Bulk import via CSV/JSON confirmed
   - ✅ Player whitelisting not required (optional)
   - ✅ Even number of players expected
   - ❓ Format for CSV/JSON import?

2. **Match Stat Export**:

   - ✅ ADR or Total Damage needed
   - ✅ Export to webhook/Discord/JSON/CSV as alternative
   - ❓ Preferred export format?
   - ❓ Webhook URL configuration?

3. **Match Creation Flow**:
   - ✅ Can create matches without tournament
   - ✅ Manual assignment of players/teams
   - ❓ How to group matches into rounds?
   - ❓ How to track which matches belong to which round?

## Open Questions (Complex Solution - Future)

1. **ELO formula**: What specific formula should be used?
   - Issue creator's Excel sheet has formula (created by "CS2 Tournament Master")
   - Very dynamic system based on match performance
   - Should review Excel sheet for exact formula
   - How should ELO change based on individual performance (ADR/Damage) vs team result?
2. **Team balancing algorithm**:
   - Should use established, trialed-and-tested formulas (can be found online)
   - Balance strictly by average ELO, or consider other factors?
   - How to handle odd number of players?
3. **Match frequency**: How many matches per player?
   - Round-robin style where everyone plays everyone?
   - Fixed number of rounds?
   - Based on player count?
4. **Tie-breaking**: How to handle ties in match wins?
   - Secondary criteria (ELO, round difference, etc.)?
5. **Starting ELO**: How are initial ELO values set?
   - Admin sets manually for each player?
   - Default starting value?
   - Import from existing system?

## Feature Priorities (From Issue Creator)

### Priority 1: Round/Team Creation (Critical)

- **Manual match creation** without tournament tree
- **Manual player/team assignment** to matches
- Player whitelisting not required (optional)
- Player assignment optional (players can join servers themselves)
- Bulk import of players via CSV/JSON (if implementing player registration)

### Priority 2: Match Stat Overview (Critical)

- Display **ADR (Average Damage per Round)** or **Total Damage** per player after match
- **Alternative**: Export stats to webhook/Discord/JSON/CSV after match ends
- Currently players screenshot stats and send to admins - this needs to be automated

### Priority 3: Everything Else (Nice to Have)

- Fixed map per match
- Player avatars
- Player dashboard
- Other enhancements

## Timeline & Support

- **Target Date**: Simple solution needed by **December 27th, 2024** (LAN Party on New Year's)
- **Donation**: 100 Euros total (half upfront, half after priority features implemented)
- **User Support**: User willing to help with testing, documentation, or system setup
- **Location**: Switzerland 🇨🇭

## Additional Context

- **Excel reference**: User has an Excel sheet with complex ELO calculations (created by "CS2 Tournament Master" friend)
- **User availability**: User is willing to provide the Excel sheet and potentially present it in a call
- **Support**: User is interested in donating if feature is implemented
- **Use case**: LAN party events with ~60 players, so real-time coordination is important
- **Current workflow**: User manually manages teams and ELO in Excel, wants to automate match creation and stat collection
- **ELO System**: Very dynamic, based on match performance of every player - handled externally in Excel for now

## Related Code Areas

### Files to Modify/Create

- `src/types/tournament.types.ts` - Add new tournament type
- `client/src/types/tournament.types.ts` - Frontend type updates
- `client/src/constants/tournament.ts` - Add new tournament type constant
- `src/services/tournamentService.ts` - Tournament creation logic
- `src/services/matchConfigBuilder.ts` - Match configuration for shuffle type
- `src/config/database.schema.ts` - Database schema updates
- New service: `src/services/eloService.ts` - ELO calculation and management
- New service: `src/services/teamBalancingService.ts` - Team balancing algorithm
- `client/src/pages/TournamentPage.tsx` - UI for new tournament type
- `client/src/components/` - New components for player management and leaderboard

### Current Tournament Types (for reference)

- `single_elimination`
- `double_elimination`
- `round_robin`
- `swiss`

## Next Steps

1. **Clarify requirements** with issue creator:

   - Confirm team size and match structure
   - Discuss ELO formula preferences
   - Understand exact workflow expectations

2. **Design architecture**:

   - Database schema for player ELO and statistics
   - Team balancing algorithm design
   - ELO calculation formula

3. **Create implementation plan**:

   - Break down into smaller tasks
   - Prioritize simple vs complex solution
   - Estimate effort for each phase

4. **Prototype**:
   - Start with simple solution to validate approach
   - Iterate based on feedback
