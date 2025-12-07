## Shuffle Tournament Flow Review – Findings _(Historical)_

**Date**: 2025-12-07  
**Branch**: `35-feature-new-tournament-type`  
**Scope**: End-to-end shuffle tournament flow (creation → registration → matches → progression → standings), checked against `shuffle-tournament-complex-solution.md` and current implementation at the time.

> **Note**  
> All issues identified in this document have since been addressed in code and documentation.  
> For the up-to-date status, see `shuffle-tournament-implementation-verification.md` and the admin guide `guides/shuffle-tournaments.md`.

---

### 1. Tournament Standings Status & Progress Display

- **Issue**: The public standings page misinterprets tournament status and may hide round progress.
  - File: `client/src/pages/TournamentStandings.tsx`
  - Logic defines:
    - `isComplete = tournament.status === 'completed'`
    - `isActive = tournament.status === 'live' || tournament.status === 'started'`
  - Backend only uses `status` values: `'setup'`, `'in_progress'`, `'completed'` (no `'live'` or `'started'`).
- **Impact**:
  - In-progress shuffle tournaments are treated as **“Setup”** in the chip label.
  - Round progress bar and “in progress” indicators on the standings page never show for status `'in_progress'`.
- **Suggested fix**:
  - Treat `'in_progress'` as the “active” state:
    - `isActive = tournament.status === 'in_progress'`
    - Chip label color logic should also include `'in_progress'` as active, not “Setup”.

---

### 2. Overtime Mode: `metric_based` Incomplete / Not Exposed

- **Issue**: Spec and API advertise a `metric_based` overtime mode, but it is neither configurable in the UI nor fully implemented in match config.
  - Spec: `shuffle-tournament-complex-solution.md` and `docs/guides/shuffle-tournaments.md` describe three options:
    - Enable Overtime
    - Stop at Max Rounds
    - Stop Based on Metric (total damage)
  - Backend types:
    - `ShuffleTournamentConfig.overtimeMode: 'enabled' | 'disabled' | 'metric_based'`
    - DB column `overtime_mode TEXT DEFAULT 'enabled'`
  - UI (`ShuffleTournamentConfigStep.tsx`):
    - `overtimeMode` is typed as `'enabled' | 'disabled'` only.
    - Select options only expose **Enable Overtime** and **No Overtime (Tie at 12-12)**.
  - Match config (`generateShuffleMatchConfig`):
    - For `roundLimitType === 'first_to_13'`:
      - Always sets `mp_maxrounds = 24`.
      - Sets `mp_overtime_enable = 1` only when `overtimeMode === 'enabled'`.
      - For `overtimeMode === 'metric_based'`, it falls through and behaves like “disabled” (no overtime, no metric logic).
    - For `roundLimitType === 'max_rounds'`, `mp_overtime_enable` is always `0`.
- **Impact**:
  - API and docs claim support for `metric_based`, but:
    - UI cannot select it.
    - No tie-break implementation based on total damage exists.
  - This is a **spec vs implementation mismatch** and could confuse API consumers relying on `metric_based`.
- **Suggested options**:
  - Either fully implement metric-based tie-breaking (including cvar/logic and UI option), **or**:
    - Remove/undocument `metric_based` from the public API and docs for now.
    - Restrict `ShuffleTournamentConfig.overtimeMode` to `'enabled' | 'disabled'` until metric-based behavior is implemented.

---

### 3. `defaultElo` in Shuffle Config Is Currently Unused

- **Issue**: The shuffle tournament API accepts `defaultElo`, but it is not wired into tournament behavior.
  - Helper/test code (`tests/helpers/shuffleTournament.ts`) passes `defaultElo` into `createShuffleTournament`.
  - Route `/api/tournament/shuffle` forwards it via `ShuffleTournamentConfig`.
  - `createShuffleTournament` in `src/services/shuffleTournamentService.ts` **does not use** `config.defaultElo` when inserting the tournament row or configuring anything else.
  - Database schema (`tournament` table) has no field for a per-tournament default ELO (only global player defaults are in `players`).
  - Actual default ELO behavior is controlled globally via `playerService`:
    - New players default to 3000 regardless of tournament.
- **Impact**:
  - API and tests may give the impression that `defaultElo` affects player ratings for a specific tournament, but it has no effect today.
  - Potential source of confusion for callers expecting tournament-level default ELO control.
- **Suggested fix**:
  - Either:
    - Implement per-tournament default ELO (add field to `tournament`, use it when creating players for that tournament), **or**
    - Remove `defaultElo` from the shuffle tournament API and related docs/tests so behavior is unambiguous.

---

### 4. Shuffle Match Card Player Display vs Stored Config Format

- **Issue**: Shuffle match cards attempt to render player lists as an **array**, but shuffle match configs store players as a **map** (`{ steamId: name }`).
  - Match config generation (`generateShuffleMatchConfig` in `matchConfigBuilder.ts`):
    - Reads `teams.players` JSON (stored as `Player[]`), then converts it into a MatchZy-style map: `{ [steamId]: name }`.
    - Resulting `config.team1.players` / `config.team2.players` are objects, **not arrays**.
  - Match card UI (`client/src/components/shared/MatchCard.tsx`):
    - Treats `configTeam.players` as an array:
      - Checks `configTeam.players.length`.
      - Calls `.slice(0, 3).map(...)` and expects elements with `{ name, elo? }`.
  - Because `configTeam.players` is actually an object, the array-based code path never executes; it falls back to showing `Team Name (N players)` using `expected_players_*`.
- **Impact**:
  - Shuffle matches **do not** show the intended “first few player names (+ELO)” line on the match cards.
  - This contradicts the intended UX described in the shuffle docs/verification (player-centric match display).
- **Suggested fix**:
  - In `MatchCard`, branch explicitly for shuffle matches:
    - Handle `configTeam.players` as either an object (`Record<steamId, name>`) or array.
    - Normalize to an array of `{ steamId, name, elo? }` before slicing/mapping, so names (and ELO when available) are shown as designed.

---

### 5. Minor Notes & Observations (Non-blocking)

- **Odd-player rotation fairness is limited**:
  - `shuffleTournamentService.generateRoundMatches` implements a rotation mechanism when an odd number of teams exists.
  - It correctly identifies players who played last round and tries to swap one of them out with someone from the “extra” team who did not play.
  - However, only **one swap per round** is attempted, and rotation is driven purely by the last unpaired team; players on that team who are never swapped may still sit out multiple rounds.
  - This is more of a **fairness/optimization limitation** than a direct bug, but it’s looser than the ideal “no one sits out twice in a row” goal in the complex spec.

---

### Summary

Overall, the shuffle tournament flow (creation, registration, automatic team balancing, match generation, round progression, and public standings/leaderboard) is implemented and largely consistent with the complex solution design.  
The main concrete issues found are **status handling on the public standings page**, **incomplete/hidden `metric_based` overtime mode**, the **unused `defaultElo` field**, and the **match card’s incorrect assumption about shuffle player list format**. These are all fixable in isolation and do not break the core shuffle flow, but they are worth addressing for correctness and to keep implementation fully aligned with the documented behavior.


