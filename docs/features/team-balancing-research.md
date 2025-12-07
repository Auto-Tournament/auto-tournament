# Team Balancing Algorithm Research

## Overview

This document details research on algorithms, npm packages, and methods for balancing teams based on player ELO ratings. The goal is to create balanced teams of 5 players with similar average ELO.

## Problem Statement

**Goal**: Divide N players into teams of 5 players each, such that:

- Teams have similar average ELO
- Teams have similar total ELO
- Minimize ELO variance within and between teams
- Handle edge cases (odd number of players, extreme ELO values)

**Mathematical Problem**: This is similar to the **Partition Problem** or **Subset Sum Problem** - dividing a set into subsets with equal sums.

## Algorithm Approaches

### 1. Greedy Algorithm (Simple & Fast)

**Description**: Sort players by ELO, assign highest-rated player to team with lowest average ELO.

**Algorithm**:

```
1. Sort players by ELO (descending)
2. Initialize empty teams
3. For each player in sorted list:
   a. Calculate average ELO for each existing team
   b. Assign player to team with lowest average ELO
   c. If team is full (5 players), remove from consideration
4. Continue until all players assigned
```

**Pros**:

- Simple to implement
- Fast (O(n log n) for sorting, O(n) for assignment)
- Works well for most cases

**Cons**:

- May not find optimal solution
- Can be suboptimal with extreme ELO values

**Implementation Complexity**: Low

### 2. Snake Draft Algorithm

**Description**: Alternate team selection in a "snake" pattern.

**Algorithm**:

```
1. Sort players by ELO (descending)
2. For two teams:
   - Team 1 picks player 1 (highest)
   - Team 2 picks players 2, 3
   - Team 1 picks players 4, 5
   - Team 2 picks players 6, 7
   - Continue alternating
3. For multiple teams, adjust pattern accordingly
```

**Pros**:

- Fair distribution
- Easy to understand
- Commonly used in sports drafts

**Cons**:

- May not minimize variance optimally
- Works best for 2 teams

**Implementation Complexity**: Low

### 3. Optimization Algorithm (Partition Problem)

**Description**: Find optimal partition that minimizes ELO variance.

**Algorithm**:

```
1. Calculate all possible team combinations
2. For each combination:
   - Calculate ELO variance between teams
   - Calculate ELO variance within teams
3. Select combination with minimum total variance
```

**Pros**:

- Finds optimal solution
- Best balance possible

**Cons**:

- Computationally expensive (exponential complexity)
- Not feasible for large player counts (60+ players)

**Implementation Complexity**: High

### 4. Genetic Algorithm

**Description**: Use evolutionary algorithm to find near-optimal solution.

**Algorithm**:

```
1. Generate random team assignments (population)
2. Evaluate fitness (ELO variance)
3. Select best solutions
4. Crossover and mutate
5. Repeat until convergence
```

**Pros**:

- Good balance between quality and speed
- Can handle complex constraints

**Cons**:

- More complex to implement
- May not guarantee optimal solution

**Implementation Complexity**: Medium-High

### 5. Xwoe Matchmaking Algorithm (GitHub Reference)

**Description**: Algorithm developed for Quake Champions tournament.

**Algorithm**:

```
1. Divide players into skill tiers (equal to team size)
2. Initial seeding:
   - Best player from highest tier
   - Worst player from lowest tier
   - Random from middle tiers
3. Optimization:
   - Iteratively swap players between teams
   - Minimize score deviation
   - Continue until convergence
```

**GitHub**: https://github.com/Xwoe/matchmaking

**Pros**:

- Tested in real tournament
- Handles skill tiers well
- Optimization step improves balance

**Cons**:

- More complex implementation
- Requires iteration

**Implementation Complexity**: Medium

## NPM Packages

### Rating System Packages (Not Direct Team Balancing)

#### 1. **openskill** (Recommended for Advanced Use)

- **npm**: `openskill`
- **Version**: 4.1.0
- **Last Updated**: October 11, 2024
- **GitHub**: https://github.com/philihp/openskill.js
- **Description**: Weng-Lin Bayesian approximation method for online skill-ranking
- **TypeScript**: Yes (JavaScript with types)
- **Features**:
  - Bayesian rating system (more advanced than ELO)
  - Handles teams naturally
  - Can predict match quality
- **Use Case**: If you want to upgrade from ELO to a more sophisticated system
- **Install**: `npm install openskill`

#### 2. **ts-trueskill**

- **npm**: `ts-trueskill`
- **Version**: 5.1.0
- **Last Updated**: Recent
- **GitHub**: https://github.com/scttcper/ts-trueskill
- **Description**: TypeScript port of Python TrueSkill package
- **TypeScript**: Yes (native)
- **Features**:
  - Microsoft TrueSkill algorithm
  - Designed for team-based games
  - Handles uncertainty in ratings
- **Use Case**: Alternative to ELO with team support
- **Install**: `npm install ts-trueskill`

### Team Balancing Packages

**Note**: No dedicated npm packages found specifically for team balancing. However, algorithms can be implemented using standard libraries.

## Recommended Approach

### Option 1: Greedy Algorithm (Recommended for MVP)

**Why**: Simple, fast, works well for most cases, easy to implement.

**Implementation**:

```typescript
function balanceTeams(players: Player[], teamSize: number = 5): Team[] {
  // Sort players by ELO (descending)
  const sorted = [...players].sort((a, b) => b.elo - a.elo);

  // Initialize teams
  const teams: Team[] = [];
  const numTeams = Math.floor(sorted.length / teamSize);

  for (let i = 0; i < numTeams; i++) {
    teams.push({ players: [], totalELO: 0, averageELO: 0 });
  }

  // Assign players greedily
  for (const player of sorted) {
    // Find team with lowest average ELO that isn't full
    let minTeam = teams[0];
    let minAvg = minTeam.averageELO;

    for (const team of teams) {
      if (team.players.length < teamSize) {
        const avg = team.totalELO / (team.players.length || 1);
        if (avg < minAvg || minTeam.players.length >= teamSize) {
          minTeam = team;
          minAvg = avg;
        }
      }
    }

    // Add player to team
    minTeam.players.push(player);
    minTeam.totalELO += player.elo;
    minTeam.averageELO = minTeam.totalELO / minTeam.players.length;
  }

  return teams;
}
```

**Time Complexity**: O(n log n + n \* t) where n = players, t = teams
**Space Complexity**: O(n)

### Option 2: Xwoe Algorithm (Recommended for Production)

**Why**: Tested in real tournaments, handles edge cases well, optimization step improves balance.

**Implementation Steps**:

1. Divide players into skill tiers
2. Initial seeding with tier-based assignment
3. Optimization phase with player swapping
4. Minimize variance

**Reference**: https://github.com/Xwoe/matchmaking

### Option 3: Hybrid Approach

**Why**: Combine simplicity of greedy with optimization step.

**Algorithm**:

1. Use greedy algorithm for initial assignment
2. Apply optimization swaps to improve balance
3. Continue until variance is minimized or max iterations reached

## Algorithm Comparison

| Algorithm    | Complexity              | Quality   | Speed  | Implementation |
| ------------ | ----------------------- | --------- | ------ | -------------- |
| Greedy       | O(n log n)              | Good      | Fast   | Easy           |
| Snake Draft  | O(n log n)              | Good      | Fast   | Easy           |
| Optimization | O(2^n)                  | Optimal   | Slow   | Hard           |
| Genetic      | O(n \* generations)     | Very Good | Medium | Medium         |
| Xwoe         | O(n log n + iterations) | Very Good | Medium | Medium         |

## Edge Cases Handling

### Odd Number of Players

**Solutions**:

1. **Rotate Out**: One player sits out each round (rotate)
2. **4v5 Match**: Create one team with 4 players (handicap)
3. **Spectator**: Player observes and gets average ELO change

**Recommendation**: Rotate out (fair for all players)

### Extreme ELO Values

**Problem**: Very high or very low ELO players can unbalance teams.

**Solutions**:

1. **Distribution**: Ensure extreme players are distributed across matches
2. **Capping**: Cap ELO differences in same match
3. **Tiering**: Group players into tiers, balance within tiers

**Recommendation**: Distribute extreme players across different matches

### Multiple Matches Per Round

**Problem**: Need to balance teams across all matches, not just within matches.

**Solution**:

1. Balance teams within each match
2. Ensure ELO distribution is balanced across all matches
3. Prevent all high ELO players in one match

## Implementation Recommendations

### Phase 1: MVP (Greedy Algorithm)

1. Implement simple greedy algorithm
2. Test with various player distributions
3. Measure balance quality (variance)
4. Iterate if needed

### Phase 2: Optimization (Xwoe-style)

1. Add optimization step after greedy assignment
2. Implement player swapping to minimize variance
3. Set convergence criteria
4. Test and compare with greedy-only

### Phase 3: Advanced (If Needed)

1. Consider genetic algorithm for complex scenarios
2. Implement tier-based balancing
3. Add constraints (e.g., prevent same players together)

## Testing Strategy

### Test Cases

1. **Even Distribution**: Players with similar ELO (3000-3100)
2. **Wide Distribution**: Players with wide ELO range (2500-3500)
3. **Extreme Values**: Few very high (4000+) and very low (2000-) ELO players
4. **Odd Count**: 61 players (one sits out)
5. **Perfect Balance**: 60 players, all ELO = 3000

### Metrics

- **Variance**: Calculate ELO variance between teams
- **Max Difference**: Maximum ELO difference between teams
- **Average Difference**: Average ELO difference
- **Balance Score**: Custom metric combining above

## Code Examples

### Greedy Algorithm (TypeScript)

```typescript
interface Player {
  id: string;
  elo: number;
  name: string;
}

interface Team {
  players: Player[];
  totalELO: number;
  averageELO: number;
}

function balanceTeamsGreedy(players: Player[], teamSize: number = 5): Team[] {
  // Sort by ELO descending
  const sorted = [...players].sort((a, b) => b.elo - a.elo);

  const numTeams = Math.floor(sorted.length / teamSize);
  const teams: Team[] = Array.from({ length: numTeams }, () => ({
    players: [],
    totalELO: 0,
    averageELO: 0,
  }));

  for (const player of sorted) {
    // Find team with lowest average ELO that isn't full
    let bestTeam = teams.find((t) => t.players.length < teamSize);
    if (!bestTeam) break;

    for (const team of teams) {
      if (team.players.length >= teamSize) continue;
      const currentAvg =
        bestTeam.players.length > 0 ? bestTeam.totalELO / bestTeam.players.length : Infinity;
      const teamAvg = team.players.length > 0 ? team.totalELO / team.players.length : 0;

      if (teamAvg < currentAvg) {
        bestTeam = team;
      }
    }

    // Add player
    bestTeam.players.push(player);
    bestTeam.totalELO += player.elo;
    bestTeam.averageELO = bestTeam.totalELO / bestTeam.players.length;
  }

  return teams;
}
```

### Optimization Step (Post-Greedy)

```typescript
function optimizeTeams(teams: Team[], maxIterations: number = 100): Team[] {
  let iterations = 0;
  let improved = true;

  while (improved && iterations < maxIterations) {
    improved = false;
    iterations++;

    // Calculate current variance
    const averages = teams.map((t) => t.averageELO);
    const currentVariance = calculateVariance(averages);

    // Try swapping players between teams
    for (let i = 0; i < teams.length; i++) {
      for (let j = i + 1; j < teams.length; j++) {
        for (const player1 of teams[i].players) {
          for (const player2 of teams[j].players) {
            // Try swap
            const newTeams = swapPlayers(teams, i, j, player1, player2);
            const newAverages = newTeams.map((t) => t.averageELO);
            const newVariance = calculateVariance(newAverages);

            if (newVariance < currentVariance) {
              teams = newTeams;
              improved = true;
              break;
            }
          }
          if (improved) break;
        }
        if (improved) break;
      }
      if (improved) break;
    }
  }

  return teams;
}

function calculateVariance(values: number[]): number {
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const squaredDiffs = values.map((v) => Math.pow(v - mean, 2));
  return squaredDiffs.reduce((a, b) => a + b, 0) / values.length;
}
```

## References

### GitHub Repositories

1. **Xwoe Matchmaking**: https://github.com/Xwoe/matchmaking

   - Quake Champions tournament algorithm
   - Includes optimization step
   - Tested in production

2. **MatchMaker Discord Bot**: https://github.com/feraskhemakhem/MatchMaker
   - Discord bot for team balancing
   - Rank-based team creation
   - Can be adapted

### Research Papers

- Partition Problem algorithms
- Subset Sum Problem solutions
- Team balancing in competitive gaming

### Stack Overflow Discussions

- Team balancing algorithms: https://stackoverflow.com/questions/8951996/
- ELO-based team balancing: https://stackoverflow.com/questions/14720537/

## Final Recommendation

### For Initial Implementation: **Greedy Algorithm**

**Why**:

- Simple to implement and understand
- Fast enough for 60 players (< 1ms)
- Good balance quality for most cases
- Easy to test and debug

### For Production: **Greedy + Optimization**

**Why**:

- Greedy provides good starting point
- Optimization step improves balance
- Can be tuned (max iterations, convergence)
- Best balance of quality and performance

### Package Usage

**ELO Calculation**: Use `@echecs/elo` (already recommended)
**Team Balancing**: Implement custom algorithm (no suitable npm package found)

## Next Steps

1. **Implement Greedy Algorithm**:

   - Start with basic greedy approach
   - Test with various player distributions
   - Measure balance quality

2. **Add Optimization Step**:

   - Implement player swapping
   - Test improvement over greedy-only
   - Tune iteration limits

3. **Handle Edge Cases**:

   - Odd number of players
   - Extreme ELO values
   - Multiple matches per round

4. **Performance Testing**:

   - Test with 60 players
   - Measure execution time
   - Verify balance quality

5. **Integration**:
   - Integrate with `teamBalancingService.ts`
   - Test with real tournament data
   - Iterate based on results
