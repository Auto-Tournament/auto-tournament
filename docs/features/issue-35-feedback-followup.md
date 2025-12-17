# Issue #35 – Shuffle Tournament Feedback Follow‑up

> **Context**  
> Follow‑up tracking doc for [Feature #35 – New Tournament Type](https://github.com/sivert-io/matchzy-auto-tournament/issues/35) and the commenter’s latest feedback (biggest concern: ELO system and how it fits the shuffle tournament mode).

---

## 1. What the contributor cares about (from issue + latest comment)

- **Individual‑focused competition**
  - Tournament winner is the **player** with the most match wins; teams are just temporary containers.
- **Fair, transparent rating system**
  - Wants ELO values that feel intuitive, comparable to their existing Excel‑based system.
  - Biggest concern is understanding **how ratings change** and whether that behavior matches expectations for this LAN format.
- **Configurable behavior**
  - Would like to be able to set **starting ELO per player**.
  - Ideally can control **how much stats influence rating changes** (similar to their Excel formulas).
- **Excel sheet as source of truth**
  - Has a complex Excel workbook used today for team balancing + ELO.
  - Is willing to share the sheet and even walk through it in a call so we can mirror the behavior more closely.

---

## 2. Current implementation snapshot (relevant to their concerns)

See also:

- `docs/features/shuffle-tournament-complex-solution.md`
- `docs/features/shuffle-tournament-poc-issue-35.md`
- `docs/features/elo-calculation-templates.md`
- `docs/features/shuffle-tournament-implementation-verification.md`

- **Rating engine**
  - Uses **OpenSkill** internally (mu/sigma) with conversion to a single display ELO (see `api/src/services/ratingService.ts` and [OpenSkill docs](https://openskill.me)).
  - Conversion is FaceIT‑style: admin/player sees a single ELO number; system stores mu/sigma.
- **Default behavior (“Pure Win/Loss”)**
  - Every tournament has an `elo_template_id`; if not set, UI defaults to `'pure-win-loss'`.
  - The **`pure-win-loss`** template is always present and enabled (`api/src/services/eloTemplateService.ts`), with all weights set to `0`.
  - With this template selected:
    - OpenSkill updates ratings purely from **team result (win/loss)**.
    - Individual stats are recorded but **do not affect** ELO changes.
    - History records `base_elo_after` and `stat_adjustment = 0` for transparency.
- **Customizable ELO behavior (templates)**
  - Admins can define **ELO calculation templates** that add a stat‑based adjustment on top of the OpenSkill change (`elo_calculation_templates` table, `eloTemplateService.applyTemplate()`).
  - Per‑stat weights (kills, deaths, ADR, utility damage, MVPs, etc.) and min/max caps are configurable.
  - Tournaments can select a template; only **enabled** templates affect ratings.
- **Shuffle tournament integration**
  - Shuffle tournaments share the same rating engine as other modes; ratings are **global per player**, not per‑tournament.
  - Leaderboard sorting matches the original request: wins → ELO → ADR.
  - Starting ELO per player can already be set on the **Players** page or via bulk import; default comes from global settings.

---

## 3. Open questions to clarify with the contributor

These will be asked in the public reply so we can tighten the design around their expectations:

1. **ELO concern focus**
   - Is the main worry that:
     - (a) The current rating behavior doesn’t match the **Excel formula** they’re used to,
     - (b) The system is not transparent enough about **how ELO is calculated/updated**, or
     - (c) Something else (e.g. volatility, fairness between rounds, global vs event‑only ratings)?
2. **Per‑event vs global rating**
   - For LAN shuffle tournaments, should ratings be:
     - Purely **per‑event** (fresh ladder each time), or
     - **Global** across events (current behavior), or
     - Global internally but with a way to show **“event‑only” deltas**?
3. **Excel parity**
   - How important is it that our stat‑based ELO templates **numerically match** their Excel sheet vs just behave similarly (e.g. “big impact from ADR, smaller from MVPs”)?
   - Which stats are most important to them (ADR, kills, deaths, utility damage, KAST, etc.)?
4. **Admin UX expectations**
   - Would they prefer:
     - A simple mode that **only cares about wins/losses** (current default), and/or
     - A more advanced mode where they can **tune weights** but with presets based on their sheet?
5. **Explanation needs**
   - What level of explanation is most useful: a short “how it works” paragraph in the UI, a more detailed doc, or even a per‑match “rating change breakdown” view?

---

## 4. Action items / TODO (including latest comment)

- [ ] **Review contributor’s Excel sheet**
  - Receive the Excel file via their preferred channel (Discord, email, etc.).
  - Do an initial pass to understand the core ELO formula, inputs, and intended behavior.
  - Optionally schedule a short call to let them walk through edge cases and take structured notes.
- [x] **Document default ELO behavior more clearly**
  - Add a concise “Default ELO mode (Pure Win/Loss)” explanation to `docs/guides/shuffle-tournaments.md` and/or the ELO templates page.
  - Make it explicit that with the default template, **only match result** drives ELO; stats are tracked but not used.
- [x] **Clarify ELO template selection in the UI**
  - In shuffle tournament creation, add helper text/tooltip explaining what the chosen ELO template actually does.
  - Highlight that “Pure Win/Loss” is the safest default and that advanced templates are optional.
- [x] **Decide on per‑event vs global rating story**
  - Based on the contributor’s answer, decide whether to:
  - Keep ratings global but improve documentation, or
  - Add explicit support for per‑event ladders / event‑scoped views.
- [ ] **Design a “Excel‑style” preset template (if desired)**
  - After understanding their Excel, model it as one or more ELO templates (e.g. “LAN – Excel‑style rating”).
  - Validate with them on test data before recommending it as a preset.
- [x] **Explore better transparency around rating changes**

  - Consider adding a UI surface (e.g. on the player page or match details) that shows: base OpenSkill change, stat adjustment, and final ELO delta.
  - Use existing `player_rating_history` fields (`base_elo_after`, `stat_adjustment`, `template_id`) as the backing data.

- [ ] **Add configurable MatchZy server ConVars (per server, surfaced in Settings/Servers UI)**
  - Goal: allow admins to edit core MatchZy settings like:
    - `matchzy_knife_enabled_default`
    - `matchzy_minimum_ready_required`
    - `matchzy_stop_command_available`
    - `matchzy_stop_command_no_damage`
    - `matchzy_pause_after_restore`
    - `matchzy_whitelist_enabled_default`
    - `matchzy_kick_when_no_match_loaded`
    - `matchzy_demo_path`
    - `matchzy_demo_name_format`
    - `matchzy_demo_upload_url` (already partially managed by the app)
    - `matchzy_chat_prefix`
    - `matchzy_admin_chat_prefix`
    - `matchzy_chat_messages_timer_delay`
    - `matchzy_playout_enabled_default`
    - `matchzy_reset_cvars_on_series_end`
    - `matchzy_use_pause_command_for_tactical_pause`
    - `matchzy_autostart_mode`
    - `matchzy_save_nades_as_global_enabled`
    - `matchzy_allow_force_ready`
    - `matchzy_max_saved_last_grenades`
    - `matchzy_smoke_color_enabled`
    - `matchzy_everyone_is_admin`
    - `matchzy_show_credits_on_match_start`
    - `matchzy_hostname_format`
    - `matchzy_match_start_message`
  - Backend:
    - [ ] Extend server persistence to store per‑server MatchZy config (e.g. JSON column on `servers` table in `api/src/config/database.schema.ts` and corresponding mapping in `serverService` + API in `api/src/routes/servers.ts`).
    - [ ] Optionally add global default MatchZy settings in `app_settings` via `settingsService` and `api/src/routes/settings.ts`, used as a fallback when a server has no overrides.
    - [ ] Add helper(s) to materialize a list of `matchzy_*` RCON commands from stored settings (likely in `api/src/utils/matchzyRconCommands.ts`).
    - [ ] Decide when to push these settings:
      - Candidate hooks: when a server is first added/updated; when a tournament is created; or immediately before loading a match in `matchLoadingService` / `matchAllocationService`.
      - Start simple: push config before calling `matchzy_loadmatch_url` for a given server, and optionally provide a “Sync MatchZy settings now” button in admin tools.
  - Frontend:
    - [ ] Add UI for editing these settings:
      - Either as a **global defaults** section on `Settings` (e.g. “MatchZy Server Defaults”) and/or
      - As per‑server overrides in `ServerModal` / `Servers` page (with a compact advanced panel for power users).
    - [ ] Extend `client/src/types/api.types.ts` and related server types to include the new settings shape.
    - [ ] Make sure the UX clearly explains that these are MatchZy ConVars and may require a server restart or `exec MatchZy/config.cfg` on the game side for non‑RCON‑managed changes.

---

### 4.1 Critical bugs from latest POC test

- [ ] **Server/Web state desync when server crashes (warmup / live)**

  - [ ] Reproduce crash scenarios (server killed during warmup and during live) and capture:
    - Match status in `matches` table.
    - Values of `matchzy_tournament_status`, `matchzy_tournament_match`, `matchzy_tournament_updated`.
  - [ ] Update backend status handling so UI can reliably detect a dead server:
    - Review `api/src/services/serverStatusService.ts` and `api/src/services/matchAllocationService.ts` to ensure offline/error states are propagated.
    - Make sure we clear or reset `server_id` on affected matches when the server is confirmed dead (or mark matches as needing reassignment).
  - [x] Update frontend views that show “Server Ready / Waiting for Players” to react to server offline / error:
    - `client/src/components/team/MatchInfoCard.tsx` now treats non-`online` server statuses the same as "no server assigned" when rendering `MatchServerPanel`, so the team view falls back to the “Waiting for Server Assignment” message instead of showing connect/copy actions for an offline server.
    - This keeps the tournament view in a clear waiting state while backend logic (restart/reallocation) handles reassigning a healthy server.

- [ ] **Server recovery: wrong map/settings after restart**

  - [ ] Audit `api/src/services/matchLoadingService.ts` and `api/src/services/matchAllocationService.ts`:
    - Confirm when we call `matchzy_loadmatch_url` for a match and how we deal with an existing `server_id` on restart.
  - [ ] Decide on a consistent recovery strategy:
    - Either automatically re‑send the correct config to the same server on reconnect, or
    - Mark the match as needing reallocation (clearing `server_id`) and let the allocator handle it.
  - [ ] Update admin tools (“Restart Match”) to clearly document what they do vs the automatic behavior.

- [ ] **DB constraint error – duplicate `teams_pkey` after deleting/re‑adding player and resetting tournament**

  - [ ] Reproduce flow:
    - Delete player during tournament → re‑add same player → reset tournament to `setup` → start again.
  - [ ] Inspect how teams are created and reused:
    - `api/src/services/teamService.ts`
    - `api/src/services/tournamentService.ts` and `api/src/services/shuffleTournamentService.ts`
  - [ ] Fix reset logic so it fully cleans up any tournament‑specific teams and associations before recreating them:
    - Consider a dedicated “tournament reset” helper that:
      - Removes tournament‑generated teams / mappings.
      - Clears shuffle tournament player entries if needed.

- [ ] **Admin Tools – Server Events Monitor stuck on “Waiting for events…”**

  - [x] Verify backend events + sockets:
    - `api/src/routes/events.ts` (webhook ingestion).
    - `api/src/utils/matchzyRconCommands.ts` (remote log URL + headers).
    - `api/src/services/socketService.ts` (emitting `server:event`).
  - [x] Ensure at least one event path is wired for the POC:
    - Confirm MatchZy is sending events to `/api/events/:matchSlugOrServerId` with the right header.
    - Confirm `logWebhookEvent` + DB insert are working.
  - [x] Improve frontend feedback in `client/src/components/admin/ServerEventsMonitor.tsx`:
    - Show a clear “No events received yet – check webhook configuration” message if nothing arrives after N seconds.
    - Optionally surface the last error from `/api/events/test` or similar.

- [ ] **ELO calculation anomalies (winners losing ELO, huge swings, negative values)**

  - [x] Add logging around rating updates:
    - In `api/src/services/ratingService.ts` / `updatePlayerRatings`, per-player updates already log `oldElo`, `baseElo`, `statAdjustment`, `finalElo`, `eloChange`, `matchResult`, and `templateId` via `log.debug`, and a `log.success` entry summarizes how many players were updated for a given match.
  - [x] Re‑verify conversion constants and use:
    - `ELO_OFFSET` and `ELO_SCALE` implement the documented direct mapping (3000 display ELO ↔ mu 25) with `eloToOpenSkill` and `openSkillToDisplayElo`, and are only applied once on each conversion (no double offset/scale).
    - Sigma handling uses `DEFAULT_SIGMA` with a monotone decrease by match count and a floor of 2.0, matching the intended “more stable with experience” behavior.
  - [x] Check the currently selected ELO template for shuffle tournaments:
    - `api/src/services/eloTemplateService.ts` ensures `pure-win-loss` exists and stays enabled as the default.
    - `api/src/services/shuffleTournamentService.ts` persists `elo_template_id` from shuffle config, and `client/src/components/tournament/ShuffleTournamentConfigStep.tsx` / `client/src/pages/Tournament.tsx` default to `'pure-win-loss'` and only apply stat adjustments when a non-default enabled template is selected.
  - [x] Verify rating history queries and responses:
    - `api/src/services/ratingService.ts#getRatingHistory` returns `base_elo_after`, `stat_adjustment`, and `template_id` alongside before/after/delta fields.
    - `/api/players/:playerId/rating-history` in `api/src/routes/players.ts` exposes that data as-is.
    - `client/src/pages/PlayerProfile.tsx` consumes those fields in `ratingHistory` and surfaces them in the ELO History table.
  - [ ] Once Excel sheet is available:
    - Run the same sample matches through both the Excel logic and our engine.
    - Adjust template weights / scaling until changes are in a sane range and direction.

- [ ] **Double counting of wins/losses on player profile**

  - [ ] Check where rating history / match history rows are written:
    - `api/src/services/ratingService.ts` (inserts into `player_rating_history`).
    - `api/src/services/matchEventHandler.ts` (ensure `updateRatingsForMatch` is only called once per completed match).
  - [ ] Check `/api/players/:playerId/matches` implementation in `api/src/routes/players.ts` to ensure:
    - We don’t join the same match twice.
    - We don’t combine both team1/team2 records for the same player.
  - [x] Update `client/src/pages/PlayerProfile.tsx` aggregation logic if needed so wins/losses are calculated from unique matches:
    - Player profile now deduplicates match history rows by `slug` before computing wins, losses, win rate, and ADR aggregates, and before rendering the match history table and performance chart, so repeated `player_match_stats` rows for the same match no longer cause visible double counting.

- [ ] **Missing stats (match page, player profile, exports)**
  - [x] Confirm stats ingestion:
    - `api/src/services/matchEventHandler.ts#trackPlayerStatsForMatch` writes per‑player stats (ADR, damage, kills, deaths, assists, utility damage, KAST, MVPs, score, rounds played) into `player_match_stats` based on the latest `player_stats` event for each completed match.
    - `api/src/services/matchLiveStatsService.ts` maintains live match snapshots (including optional `playerStats`) for real‑time views without blocking match completion if stats are missing.
  - [x] Match page:
    - `client/src/components/modals/MatchDetailsModal.tsx` already renders per‑player “Player Leaderboards” when `liveStats.playerStats` is present, showing K/D/A, ADR, KAST, MVPs, damage, and linking to player profiles; when no stats are available it shows clear “No player data available” / “Waiting for stats...” messaging.
    - `client/src/components/team/MatchPlayerPerformance.tsx` uses the same `MatchLiveStats.playerStats` shape and gracefully hides itself when there are no rows.
  - [x] Player profile:
    - `/api/players/:playerId/matches` in `api/src/routes/players.ts` already returns `adr`, `total_damage`, `kills`, `deaths`, and `assists` per match from `player_match_stats`.
    - `client/src/pages/PlayerProfile.tsx` maps those fields into `matchHistory` and feeds them into both the “Match History” table and `PerformanceMetricsChart`, so ADR and damage now populate when stats exist, and display `N/A` when they do not.
  - [x] Tournament leaderboard:
    - Shuffle leaderboard (`getTournamentLeaderboard` in `api/src/services/shuffleTournamentService.ts`, exposed via `api/src/routes/tournament.ts`) computes `averageAdr` per player from `player_match_stats` and returns it on each entry.
    - `client/src/pages/TournamentLeaderboard.tsx` uses `averageAdr` in the “Top Players by ADR” summary, the “Avg ADR” column, and both CSV/JSON exports; when ADR is unavailable it shows `N/A` rather than misleading zeroes.

---

### 4.2 UI / UX improvements from latest POC test

- [ ] **Vanity URL feedback on Players page**

  - [x] In `client/src/components/modals/PlayerModal.tsx` and `/api/players/find`:
    - If the API returns 404 or a clear “Player not found / Steam API unavailable” error:
      - Show an inline error / helper text near the Steam input rather than failing silently.
    - Surface a distinct message when Steam API is not configured (from `api/src/services/steamService.ts#isAvailable`).

- [ ] **Steam API key error messaging**

  - [x] On `client/src/pages/Settings.tsx`:
    - When Steam key is missing or invalid and a Steam‑dependent feature fails:
      - Show a clear error (e.g. “Steam API key not set / invalid”) rather than a generic failure.
  - [x] Consider adding a “Steam connectivity check” button that pings a simple `/api/steam/status` route.

- [ ] **Dashboard “Recent Match Status” raw codes**

  - [ ] Identify where raw numeric codes are being rendered:
    - `client/src/components/dashboard/DashboardStats.tsx` (line charts / recent matches).
  - [x] Map internal status codes to human‑readable labels (Pending / Ready / Loaded / Live / Completed) and use those both for tooltips and any text display.

- [ ] **Tournament map order tile with a single map**

  - [x] In `client/src/pages/Tournament.tsx` / `client/src/components/tournament/TournamentFormSteps.tsx`:
    - Fix layout so the single map appears centered/normal instead of anchored at the bottom.

- [ ] **“Regenerate” button states**

  - [x] In the bracket / tournament creation views (`client/src/pages/Bracket.tsx`, `client/src/components/tournament/TournamentForm.tsx`):
    - Disable the “Regenerate” button until an initial bracket or match set is actually generated.
    - Add hover text when disabled explaining why.

- [ ] **Shuffle‑specific labels (bracket + match views)**

  - [x] Bracket page (`client/src/pages/Bracket.tsx`):
    - For `tournament.type === 'shuffle'`, hide or replace “Finals / Semi‑Finals” labels with something that makes sense for shuffle (e.g. just “Round X”).
  - [x] Match page / cards (`client/src/components/shared/MatchCard.tsx`, `client/src/components/team/MatchInfoCard.tsx`):
    - Hide “Series Maps Won” for shuffle matches where teams change each map.

- [ ] **Player profile – copy console command + ELO graph**
  - [x] Ensure “Copy Console Command” is wired correctly:
    - Reuse `MatchServerPanel` behaviour where `onCopy` populates a `connect` line and updates the `copied` state.
    - Check how `MatchInfoCard` is used in `PlayerProfile` and pass through the appropriate `onCopy` handler.
  - [x] ELO graph flat line:
    - Once rating history anomalies are fixed (see 4.1), confirm `ELOProgressionChart` in `client/src/components/player/ELOProgressionChart.tsx`:
      - Uses the `eloBefore`/`eloAfter` values from rating history correctly.
      - Shows multiple points when multiple matches exist.

---

### 4.3 Missing / useful features

- [ ] **Map selection – clear Active Duty maps when switching to Custom**

  - [x] In the tournament creation flow (`client/src/pages/Tournament.tsx`, `client/src/components/tournament/TournamentFormSteps.tsx`):
    - When the user switches map pool from “Active Duty” to “Custom”:
      - Clear the previously selected Active Duty maps.
      - Optionally show a small hint explaining that selection was reset.

- [x] **Overtime configuration presets**

- [x] Extend match / tournament configuration:
  - Add an OT amount dropdown (1 / 2 / 3 / Custom) where overtime is configured:
    - Implemented in shuffle configuration (`client/src/components/tournament/ShuffleTournamentConfigStep.tsx`) with presets and a custom field.
  - Map that to the right cvars in `api/src/services/matchConfigBuilder.ts` (e.g. number of OT segments).

- [x] **In‑game chat prefix + knife round toggles (tied to MatchZy ConVars)**

- [x] Chat prefix:
  - Surface `matchzy_chat_prefix` and `matchzy_admin_chat_prefix` in the MatchZy settings UI (see 4.0 ConVars section).
- [x] Knife round:
  - Surface `matchzy_knife_enabled_default` as a simple toggle for whether knife rounds are enabled by default.
- [x] Ensure these values are pushed via RCON before loading matches (see ConVars section).

- [ ] **Steam SSO (nice to have)**
  - [ ] Design login flow:
    - Add a Steam login endpoint (`/auth/steam`) on the API, using OpenID / Steam Web API.
    - Non‑admin users should be redirected to their player page (`/player/:steamId`) after login.
    - Keep admin access gated behind existing token flow (or a separate admin login).
  - [ ] Update frontend routing / header:
    - Add a “Login with Steam” entry point for players on public pages.

---

### 4.4 Questions / clarifications to resolve in the issue

- **API security**

  - [x] Double‑check that all admin routes are behind `requireAuth`:
    - Verified `requireAuth` is applied for `api/src/routes/tournament.ts`, `api/src/routes/servers.ts`, `api/src/routes/settings.ts`, `api/src/routes/maps.ts`, `api/src/routes/mapPools.ts`, `api/src/routes/teams.ts`, `api/src/routes/serverStatus.ts`, `api/src/routes/rcon.ts`, `api/src/routes/demos.ts` (except for the public demo upload endpoints which perform their own token validation), `api/src/routes/events.ts` (admin views), `api/src/routes/eloTemplates.ts`, `api/src/routes/templates.ts`, `api/src/routes/recovery.ts`, `api/src/routes/logs.ts`, and Steam admin tools in `api/src/routes/steam.ts`. Player‑facing pages (`/api/players/:id`, `/api/players/:id/matches`, `/api/players/:id/rating-history`, `/api/tournament/:id/leaderboard`, etc.) remain public as intended.
  - [x] Document in the reply (and possibly in `docs/guides/server-setup.md`) that:
    - Admin actions require the API token for all non‑public routes under `/api`.
    - Public endpoints are limited to player pages, standings/leaderboard views, and match/demo upload webhooks secured via per‑server tokens.
  - [x] Ask the reporter if they have any _specific_ concern (e.g. “can someone from the LAN spam X from their browser?”) so we can address real scenarios.

- **Match start logic / required players**
  - [ ] Review how required players is currently implemented:
    - Check if we rely purely on MatchZy ConVars (e.g. `matchzy_minimum_ready_required`) or any additional app‑side logic.
    - Inspect match config builder and any “required players” admin UI.
  - [ ] Try to reproduce their case: 2v2 match configured, only 1v1 actually joined, match not auto‑starting.
  - [ ] Once understood, either:
    - Fix the logic so it behaves as expected, or
    - Document clearly what the current behavior is and what limitations exist (and confirm with them if that’s acceptable).

---

## 5. Notes

- Shuffle tournaments and the ELO engine are already **feature‑complete** and marked as **production ready**; this doc focuses on **clarity, alignment with the original Excel workflow, and admin confidence**, not on core correctness.
- All follow‑up work should be validated with the original issue author, ideally using their real‑world 60‑player LAN scenario.
