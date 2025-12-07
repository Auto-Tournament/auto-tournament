# ELO Rating Package Research

## Top Recommendations (Based on npm search)

### 🏆 **@echecs/elo** (RECOMMENDED - Best Match)

- **npm**: `@echecs/elo`
- **Version**: 1.0.7
- **Last Updated**: October 18, 2024 (Recent!)
- **GitHub**: https://github.com/mormubis/elo
- **Description**: "ELO is part of the ECHECS project, providing an implementation of the ELO Rating System following FIDE rules."
- **Keywords**: chess, elo, fide, matchmaking, pvp, rank, ranking, rating, score, scoring
- **Why Recommended**:
  - ✅ **Follows FIDE rules** (official chess ELO standard)
  - ✅ Recent update (Oct 2024)
  - ✅ Specifically designed for chess-style ratings
  - ✅ Active maintenance
- **Install**: `npm install @echecs/elo`

### 🥈 **teslo** (TypeScript Support)

- **npm**: `teslo`
- **Version**: 1.0.0
- **Last Updated**: May 7, 2025 (Very Recent!)
- **GitHub**: https://github.com/williamgrosset/teslo
- **Description**: "Elo rating system"
- **Keywords**: typescript, elo, rating, elo-rating, elo-rating-system, multiplayer, games, matchmaking, leaderboard, ranking-system, player-stats
- **Why Recommended**:
  - ✅ **TypeScript support** (native)
  - ✅ Very recent (May 2025)
  - ✅ Designed for games/matchmaking
  - ✅ Good for multiplayer scenarios
- **Install**: `npm install teslo`

### 🥉 **@rocambille/elo** (Well Maintained)

- **npm**: `@rocambille/elo`
- **Version**: 2.1.8
- **Last Updated**: October 5, 2025 (Very Recent!)
- **GitHub**: https://github.com/rocambille/elo
- **Description**: "Enrich your objects with Elo rating."
- **Keywords**: elo, rating, ranking, chess, go, game
- **Why Recommended**:
  - ✅ Very recent (Oct 2025)
  - ✅ Chess/go/game focused
  - ✅ Well maintained (v2.1.8)
- **Install**: `npm install @rocambille/elo`

### 4. **elo-elo** (Minimal, Recent)

- **npm**: `elo-elo`
- **Version**: 0.0.7
- **Last Updated**: November 7, 2025 (Most Recent!)
- **GitHub**: https://github.com/mcclowes/elo-elo
- **Description**: "Elo rating functionality"
- **Note**: Very minimal package, may be too simple
- **Install**: `npm install elo-elo`

## Packages to Avoid (Too Old)

- ❌ **elo-rating** - Last updated July 2016 (9 years old)
- ❌ **elo-calculator** - Last updated February 2017 (8 years old)
- ❌ **arpad** - Last updated November 2020 (5 years old)
- ❌ **@pelevesque/elo** - Last updated February 2020 (5 years old)

## Final Recommendation

### **Primary Choice: @echecs/elo**

- Best match for chess-style ELO
- Follows FIDE rules (official standard)
- Recent and maintained
- Specifically designed for chess ratings

### **Alternative: teslo**

- If TypeScript support is critical
- Good for game/matchmaking scenarios
- Very recent updates

## Manual Implementation Alternative

If packages don't meet requirements, implementing the chess ELO formula is straightforward (~10 lines):

```typescript
function calculateELO(
  playerELO: number,
  opponentAvgELO: number,
  result: 'win' | 'loss',
  kFactor: number = 32
): number {
  const expected = 1 / (1 + Math.pow(10, (opponentAvgELO - playerELO) / 400));
  const actual = result === 'win' ? 1 : 0;
  const change = kFactor * (actual - expected);
  return Math.round(playerELO + change);
}
```

## Next Steps

1. **Test @echecs/elo**:

   ```bash
   npm install @echecs/elo
   ```

   - Check GitHub for usage examples
   - Verify it supports configurable K-factor
   - Test with win/loss scenarios

2. **If @echecs/elo doesn't work, try teslo**:

   ```bash
   npm install teslo
   ```

   - Check TypeScript definitions
   - Verify API matches needs

3. **If neither works, implement manually** (simple enough)

## Verification Checklist

Before choosing a package, verify:

- ✅ Uses standard chess ELO formula
- ✅ Supports configurable K-factor
- ✅ Handles win/loss (not draws)
- ✅ TypeScript support (if needed)
- ✅ Active maintenance
- ✅ Good documentation
