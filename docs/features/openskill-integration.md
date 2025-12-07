# OpenSkill Integration - Simplified Admin Experience

## Overview

OpenSkill is a superior rating system compared to ELO, offering:

- **20x faster** than TrueSkill
- Better handling of team-based games
- Bayesian uncertainty (sigma) for confidence measurement
- Support for asymmetric teams

However, OpenSkill uses two parameters (mu, sigma) instead of a single ELO number, which could complicate the admin interface.

## Solution: ELO-to-OpenSkill Conversion

### Approach: Keep Admin Interface Simple

**Admin Experience**: Admins still set a single "ELO" number (as before)
**Internal System**: Convert ELO to OpenSkill rating (mu, sigma) automatically
**Display**: Use OpenSkill's `ordinal()` function to show a single number

### Conversion Strategy

#### Option 1: Linear Scaling (Recommended)

```typescript
// Convert ELO to OpenSkill rating
function eloToOpenSkill(elo: number, isNewPlayer: boolean = true): Rating {
  // Scale ELO to mu (OpenSkill default mu is 25)
  // FaceIT-style ELO (3000 default) maps to reasonable mu
  const mu = elo / 100; // 3000 ELO = 30 mu (close to default 25)

  // Sigma represents uncertainty
  // New players: higher sigma (8.33 default)
  // Experienced players: lower sigma (more confident)
  const sigma = isNewPlayer ? 8.333 : 4.0; // Adjust based on match count

  return rating({ mu, sigma });
}

// Convert OpenSkill rating back to "ELO" for display
function openSkillToElo(rating: Rating): number {
  // Use ordinal() which returns mu - 3*sigma
  // This gives a conservative estimate (99.7% confidence)
  const ordinalValue = ordinal(rating);

  // Scale back to ELO range
  return Math.round(ordinalValue * 100);
}
```

**Pros**:

- Simple conversion
- Maintains ELO-like scale (3000 = 30 mu)
- Easy to understand

**Cons**:

- Linear scaling may not be optimal
- Need to tune scaling factor

#### Option 2: Normalized Mapping

```typescript
// Map ELO range to OpenSkill mu range
// ELO: 2000-4000 range → mu: 20-40 range (OpenSkill default: 25)
function eloToOpenSkill(elo: number, matchCount: number = 0): Rating {
  // Normalize ELO to mu range
  const eloMin = 2000;
  const eloMax = 4000;
  const muMin = 20;
  const muMax = 40;

  const normalized = (elo - eloMin) / (eloMax - eloMin);
  const mu = muMin + normalized * (muMax - muMin);

  // Sigma decreases with experience
  // New player: 8.33 (default)
  // After 10 matches: 6.0
  // After 30 matches: 4.0
  const sigma = Math.max(4.0, 8.33 - matchCount * 0.1);

  return rating({ mu, sigma });
}
```

**Pros**:

- Maps to OpenSkill's natural range
- Sigma decreases with experience (realistic)

**Cons**:

- More complex
- Requires tracking match count

#### Option 3: Direct Mapping (Simplest)

```typescript
// Simple 1:1 mapping with offset
function eloToOpenSkill(elo: number): Rating {
  // OpenSkill default mu is 25
  // FaceIT default ELO is 3000
  // Offset: 3000 - 25*100 = 500
  const mu = (elo - 500) / 100; // 3000 ELO = 25 mu

  // Use default sigma for all players initially
  // Can adjust based on match history later
  const sigma = 8.333;

  return rating({ mu, sigma });
}

function openSkillToElo(rating: Rating): number {
  const ordinalValue = ordinal(rating);
  return Math.round(ordinalValue * 100 + 500);
}
```

**Pros**:

- Simplest conversion
- Maintains exact mapping (3000 ELO = 25 mu)
- Easy to implement

**Cons**:

- Fixed sigma for all players
- Less sophisticated

## Recommended Implementation

### Phase 1: Simple Conversion (MVP)

Use **Option 3 (Direct Mapping)** for initial implementation:

```typescript
import { rating, rate, ordinal } from 'openskill';

// Constants
const ELO_OFFSET = 500;
const ELO_SCALE = 100;
const DEFAULT_SIGMA = 8.333;

// Convert admin's "ELO" to OpenSkill rating
export function eloToOpenSkill(elo: number): Rating {
  const mu = (elo - ELO_OFFSET) / ELO_SCALE;
  return rating({ mu, sigma: DEFAULT_SIGMA });
}

// Convert OpenSkill rating back to "ELO" for display
export function openSkillToElo(rating: Rating): number {
  const ordinalValue = ordinal(rating);
  return Math.round(ordinalValue * ELO_SCALE + ELO_OFFSET);
}

// Update ratings after match
export function updateRatings(
  team1Ratings: Rating[],
  team2Ratings: Rating[],
  team1Won: boolean
): [Rating[], Rating[]] {
  const teams = [team1Ratings, team2Ratings];
  const ranks = team1Won ? [1, 2] : [2, 1]; // Lower rank = better (win)

  return rate(teams, { rank: ranks });
}
```

### Phase 2: Enhanced (Future)

Add experience-based sigma adjustment:

```typescript
export function eloToOpenSkill(elo: number, matchCount: number = 0): Rating {
  const mu = (elo - ELO_OFFSET) / ELO_SCALE;

  // Sigma decreases with experience
  // New: 8.33, After 10 matches: 6.0, After 30: 4.0, Min: 2.0
  const sigma = Math.max(2.0, 8.33 - Math.min(matchCount * 0.2, 6.33));

  return rating({ mu, sigma });
}
```

## Database Schema Changes

### Option 1: Store Both (Recommended)

```sql
CREATE TABLE players (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  -- Admin-facing "ELO" (for compatibility)
  current_elo INTEGER NOT NULL DEFAULT 3000,
  starting_elo INTEGER NOT NULL DEFAULT 3000,
  -- OpenSkill internal values
  openskill_mu REAL NOT NULL DEFAULT 25.0,
  openskill_sigma REAL NOT NULL DEFAULT 8.333,
  match_count INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
```

**Benefits**:

- Admin still sees familiar "ELO" numbers
- System uses OpenSkill internally
- Can migrate gradually
- Display uses `ordinal()` converted back to ELO

### Option 2: Store Only OpenSkill

```sql
CREATE TABLE players (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  -- OpenSkill values only
  openskill_mu REAL NOT NULL DEFAULT 25.0,
  openskill_sigma REAL NOT NULL DEFAULT 8.333,
  match_count INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
```

**Display**: Always use `ordinal()` and convert to "ELO" for display

## Admin Interface

### Player Creation/Import

**Admin sees**: Single "ELO" field (as before)

- Default: 3000
- Can set custom value
- Simple number input

**System does**: Automatically converts to OpenSkill rating

- ELO 3000 → mu: 25, sigma: 8.333
- ELO 3200 → mu: 27, sigma: 8.333
- etc.

### Player Display

**Admin sees**: "ELO" number (converted from OpenSkill ordinal)

- Looks and feels like ELO
- Updates after matches
- Familiar interface

**System does**:

- Stores OpenSkill (mu, sigma)
- Displays using `ordinal()` converted to ELO scale
- Updates using OpenSkill's `rate()` function

## Team Balancing with OpenSkill

OpenSkill ratings can be used directly for team balancing:

```typescript
function balanceTeamsWithOpenSkill(players: Player[], teamSize: number = 5): Team[] {
  // Convert ELO to OpenSkill ratings
  const ratings = players.map((p) => ({
    player: p,
    rating: eloToOpenSkill(p.current_elo),
    ordinal: ordinal(eloToOpenSkill(p.current_elo)),
  }));

  // Sort by ordinal (conservative estimate)
  ratings.sort((a, b) => b.ordinal - a.ordinal);

  // Use greedy algorithm with ordinal values
  // (Same as ELO-based balancing, but using ordinal)
  // ... rest of greedy algorithm
}
```

**Note**: Can use `ordinal()` values for balancing (single number, like ELO)

## Advantages of OpenSkill

1. **Better for Teams**: Designed for team-based games
2. **Uncertainty Tracking**: Sigma represents confidence
3. **Faster**: 20x faster than TrueSkill
4. **Flexible**: Supports asymmetric teams, partial play, etc.
5. **Future-Proof**: Can add advanced features later

## Migration Strategy

### Step 1: Add OpenSkill Support

- Install `openskill` package
- Add conversion functions
- Store both ELO and OpenSkill values

### Step 2: Dual System

- Calculate with OpenSkill
- Display as "ELO" (converted)
- Both systems run in parallel

### Step 3: Full Migration (Optional)

- Remove ELO storage
- Use only OpenSkill internally
- Display always converts from OpenSkill

## Code Example: Complete Integration

```typescript
import { rating, rate, ordinal } from 'openskill';

// Conversion constants
const ELO_OFFSET = 500;
const ELO_SCALE = 100;
const DEFAULT_SIGMA = 8.333;

// Convert admin's ELO input to OpenSkill
export function eloToOpenSkill(elo: number, matchCount: number = 0): Rating {
  const mu = (elo - ELO_OFFSET) / ELO_SCALE;
  const sigma = Math.max(2.0, DEFAULT_SIGMA - Math.min(matchCount * 0.2, 6.33));
  return rating({ mu, sigma });
}

// Convert OpenSkill back to "ELO" for display
export function openSkillToDisplayElo(rating: Rating): number {
  const ordinalValue = ordinal(rating);
  return Math.round(ordinalValue * ELO_SCALE + ELO_OFFSET);
}

// Update player ratings after match
export async function updatePlayerRatings(
  team1Players: Player[],
  team2Players: Player[],
  team1Won: boolean
): Promise<void> {
  // Get OpenSkill ratings
  const team1Ratings = team1Players.map((p) => eloToOpenSkill(p.current_elo, p.match_count));
  const team2Ratings = team2Players.map((p) => eloToOpenSkill(p.current_elo, p.match_count));

  // Update using OpenSkill
  const teams = [team1Ratings, team2Ratings];
  const ranks = team1Won ? [1, 2] : [2, 1];
  const [newTeam1Ratings, newTeam2Ratings] = rate(teams, { rank: ranks });

  // Update all players
  const allPlayers = [...team1Players, ...team2Players];
  const allNewRatings = [...newTeam1Ratings, ...newTeam2Ratings];

  for (let i = 0; i < allPlayers.length; i++) {
    const player = allPlayers[i];
    const newRating = allNewRatings[i];

    // Convert back to "ELO" for storage/display
    const newElo = openSkillToDisplayElo(newRating);

    await db.updateAsync(
      'players',
      {
        current_elo: newElo,
        openskill_mu: newRating.mu,
        openskill_sigma: newRating.sigma,
        match_count: player.match_count + 1,
      },
      'id = ?',
      [player.id]
    );
  }
}
```

## Recommendation

**Use OpenSkill with Simple ELO Interface**:

1. ✅ **Admin Experience**: Unchanged - still sets single "ELO" number
2. ✅ **System Benefits**: Get OpenSkill's advantages (speed, team support)
3. ✅ **Display**: Show "ELO" numbers (converted from OpenSkill ordinal)
4. ✅ **Migration**: Can start with dual storage, migrate fully later

**Conversion Formula** (Recommended):

- `mu = (elo - 500) / 100` (3000 ELO = 25 mu)
- `sigma = 8.333` (default, can adjust with experience)
- Display: `elo = ordinal(rating) * 100 + 500`

This gives admins the simplicity of ELO while getting OpenSkill's benefits!
