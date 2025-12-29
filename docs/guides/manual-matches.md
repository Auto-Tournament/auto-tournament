# Manual Matches Guide

This guide explains how to create and run **manual matches** outside of a shuffle tournament,
including how max rounds and overtime settings map to MatchZy and CS2.

## When to use manual matches

Use manual matches when you want to:

- Spin up a one‑off scrim or test match.
- Run a custom showmatch that is not part of the shuffle tournament bracket.
- Quickly create a match between two existing teams or ad‑hoc lineups.

Manual matches:

- Are stored in the same `matches` table as tournament matches.
- Do **not** affect the shuffle bracket (rounds, progression, etc.).
- Still record player stats and ELO changes when ratings are enabled.

## Creating a manual match (UI)

1. Go to the **Matches** page in the admin UI.
2. Click **“Create Manual Match”**.
3. Fill out the steps in the modal:

   - **Basic Info**
     - Match slug (unique identifier).
     - Select a target server.
   - **Teams**
     - Choose existing teams, or create ad‑hoc “Team 1 / Team 2” lineups from registered players.
   - **Maps & Rules**
     - Format: BO1 / BO3 / BO5.
     - Map list / map pool.
     - **Max Rounds** – round limit per map (see below).
     - **Overtime Enabled** – toggle OT on/off.
     - **Overtime Max Rounds** – number of rounds per OT segment (optional).

4. Save the match. The UI will:
   - Persist the config in the `matches` table (`round = 0` for manual).
   - Automatically send `/api/matches/:slug/load` to load the match on the selected server.

## How max rounds & overtime map to CS2 / MatchZy

For manual matches, the UI drives CS2/MatchZy using **standard cvars**, and we also mirror the
effective settings into the JSON config for consistency.

### Cvars we set

In `useCreateManualMatchModal.tsx` we build a `cvars` object for the match config:

- **Max rounds (regulation)**:

  ```ts
  cvars.mp_maxrounds = safeMaxRounds; // derived from the Max Rounds field
  ```

- **Overtime**:

  ```ts
  cvars.mp_overtime_enable = overtimeEnabled ? 1 : 0;
  if (overtimeEnabled && typeof overtimeMaxRounds === 'number' && overtimeMaxRounds > 0) {
    cvars.mp_overtime_maxrounds = overtimeMaxRounds;
  }
  ```

  - `overtimeEnabled = false` → no OT; match can end at `mp_maxrounds`.
  - `overtimeEnabled = true`  → standard CS2 OT, with per‑OT max rounds if provided.

### JSON fields in `MatchConfig`

When we create the manual match row in `api/src/routes/tournament.ts`, we build a `MatchConfig`
that is stored as JSON:

```ts
const config: MatchConfig = {
  matchid: 0,
  skip_veto: true,
  players_per_team: playersPerTeam,
  num_maps: 1,
  maplist: [resolvedMap],
  map_sides: [mapSide],
  spectators: { players: {} },
  expected_players_total: playersPerTeam * 2,
  expected_players_team1: playersPerTeam,
  expected_players_team2: playersPerTeam,
  maxRounds: effectiveMaxRounds, // mirrors mp_maxrounds
  cvars,
  team1: { ... },
  team2: { ... },
};
```

These fields are primarily for MatchZy and tooling that read the config JSON:

- `maxRounds` – regulation length per map (we also set `mp_maxrounds`).
- `cvars.mp_overtime_enable` – OT on/off.
- `cvars.mp_overtime_maxrounds` – OT segment length when OT is enabled.

The plugin can safely rely on `maxRounds` + the `mp_overtime_*` cvars to fully reproduce the
intended manual‑match behavior.

## API overview

Manual matches are exposed via the standard matches API:

- `POST /api/matches` – create a manual match (used by the UI).
- `POST /api/matches/:slug/load` – load a stored match on its assigned server.
- `GET /api/matches` – list matches (both tournament and manual; manual ones have `round = 0`).
- `DELETE /api/matches/:slug` – delete a manual match (does not affect tournament brackets).

You can see the exact `MatchConfig` JSON for a given match via:

- `GET /api/matches/:slug` – returns `{ config, configUrl, ... }` where `config` includes
  `maxRounds`, `cvars`, and the team/player dictionaries that are sent to MatchZy.


