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

### 2. Overtime Mode: `metric_based` (Spec Only, Implementation Uses Enable/Disable)

- **Current behavior**:
  - The implementation supports **two** overtime options: `'enabled'` and `'disabled'`.
  - The public API, Swagger docs, and UI all expose only these two values.
  - `matchConfigBuilder` sets:
    - `mp_overtime_enable = 1` when `overtimeMode === 'enabled'`.
    - `mp_overtime_enable = 0` when `overtimeMode === 'disabled'`.
- **Spec vs implementation**:
  - Design docs (`shuffle-tournament-complex-solution.md`) still mention a potential `metric_based` mode (e.g. deciding winners based on total damage).
  - That mode is **not implemented** and is intentionally **not** part of the public API today.
- **Resolution**:
  - Treat `metric_based` as a **future idea** only.
  - Keep the public surface restricted to `'enabled' | 'disabled'` to avoid confusing admins or API consumers.

---

### 3. `defaultElo` in Shuffle Config (Removed from API)

- **Previous review finding**:
  - Earlier versions of the design/API mentioned a per-tournament `defaultElo` field for shuffle.
  - Implementation never actually used `config.defaultElo` when creating tournaments or players.
- **Current behavior**:
  - The shuffle tournament API **no longer exposes** a `defaultElo` field.
  - Default player ELO is controlled **globally** via the settings system and `playerService` (e.g. default 3000).
- **Resolution**:
  - All per-tournament `defaultElo` references have been removed from the public API and docs.
  - This keeps behavior unambiguous: the global default ELO setting is the single source of truth.

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
