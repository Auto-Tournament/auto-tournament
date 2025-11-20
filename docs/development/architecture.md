# MatchZy Auto Tournament - Architecture

## Bracket Generation System

### Overview

The bracket generation system uses a **unified interface pattern** that makes it easy to add new tournament types. All generators implement the `IBracketGenerator` interface.

### Structure

```
src/services/
├── bracketGenerators/
│   ├── index.ts              # Central registry mapping tournament types to generators
│   └── types.ts              # IBracketGenerator interface definition
├── swissBracketGenerator.ts  # Custom Swiss system implementation
├── standardBracketGenerator.ts # Single/Double elimination & Round Robin (via brackets-manager library)
└── matchConfigBuilder.ts     # Builds individual match configs (used by all generators)
```

### How It Works

??? example "Technical Implementation Details"

    **1. Interface (`bracketGenerators/types.ts`)**

    ```typescript
    interface IBracketGenerator {
      generate(tournament, getMatchesCallback): Promise<BracketMatch[] | BracketGeneratorResult>;
      reset?(): void; // Optional state reset
    }
    ```

    **2. Registry (`bracketGenerators/index.ts`)**

    Maps tournament types to their generators:

    ```typescript
    const bracketGenerators: Record<TournamentType, IBracketGenerator> = {
      single_elimination: standardBracketGenerator,
      double_elimination: standardBracketGenerator,
      round_robin: standardBracketGenerator,
      swiss: swissBracketGenerator,
    };
    ```

    **3. Usage (`tournamentService.ts`)**

    ```typescript
    const generator = getBracketGenerator(tournament.type);
    generator.reset?.(); // Reset state if stateful
    const result = await generator.generate(tournament, () => this.getMatches());
    ```

### Adding New Tournament Types

To add a new tournament type (e.g., `group_stage`):

1. **Create the generator** (implements `IBracketGenerator`):

```typescript
// src/services/groupStageBracketGenerator.ts
export class GroupStageBracketGenerator implements IBracketGenerator {
  async generate(tournament, getMatchesCallback) {
    // Your custom logic here
  }
}
export const groupStageBracketGenerator = new GroupStageBracketGenerator();
```

2. **Add to type definition**:

```typescript
// src/types/tournament.types.ts
export type TournamentType =
  | 'single_elimination'
  | 'double_elimination'
  | 'round_robin'
  | 'swiss'
  | 'group_stage'; // Add here
```

3. **Register in the registry**:

```typescript
// src/services/bracketGenerators/index.ts
import { groupStageBracketGenerator } from '../groupStageBracketGenerator';

export const bracketGenerators: Record<TournamentType, IBracketGenerator> = {
  // ... existing
  group_stage: groupStageBracketGenerator,
};
```

That's it! The system will automatically use your generator when a tournament of that type is created.

### Current Generators

#### Standard Bracket Generator

- **File**: `standardBracketGenerator.ts`
- **Handles**: `single_elimination`, `double_elimination`, `round_robin`
- **Implementation**: Wraps the `brackets-manager` library
- **Stateful**: Yes (uses in-memory storage, needs reset)

#### Swiss Bracket Generator

- **File**: `swissBracketGenerator.ts`
- **Handles**: `swiss`
- **Implementation**: Custom pairing algorithm
- **Stateful**: No (direct DB operations)

### Match Config Builder

**File**: `matchConfigBuilder.ts`

This is **not** a bracket generator - it builds individual match configurations:

- Team data
- Veto state
- Map selection
- Player counts
- Side selections

All bracket generators use this to create match configs.

## Benefits of This Architecture

1. **Extensible**: Add new tournament types without modifying existing code
2. **Type-safe**: TypeScript ensures all generators implement the interface correctly
3. **Maintainable**: Each generator is isolated in its own file
4. **Clear separation**: Generator logic vs match config logic
5. **Easy to test**: Mock the interface for unit tests

## File Naming Convention

- `*BracketGenerator.ts` - Generates bracket structure
- `matchConfigBuilder.ts` - Builds individual match configs
- `bracketGenerators/` - Interface and registry

## Frontend Bracket Viewer

The React client ships with a **vendored copy of [`brackets-viewer.js`](https://github.com/Drarig29/brackets-viewer.js)** located at `client/src/brackets-viewer/`. We maintain a fork because the stock package does not yet expose the behaviours we rely on:

- Extended metadata ingestion (seed positions, `nextMatchId` wiring, parent match hints)
- Reactive theming hooks to map into the Material UI design system
- Smooth `zoomToElement` focus when opening our match modal
- Small UX tweaks (separated BoX labels, hover states, popover styling)

When updating to a newer upstream release:

1. Pull the new source from the upstream repository.
2. Re-run the build script from the upstream project to regenerate assets (SCSS → CSS, TypeScript → JS).
3. Copy the distribution files back into `client/src/brackets-viewer/`.
4. Re-apply local adjustments (search for `// MatchZy` comments) and run `yarn lint`.
5. Validate the bracket view for single elimination, double elimination, losers bracket transfers, and Swiss layouts.

Keeping the fork checked in ensures deterministic builds and avoids shipping multiple runtime bundles.
