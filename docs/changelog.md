# Changelog

All notable changes to MatchZy Auto Tournament are summarized here.

This file is generated from the full git history and groups changes by release.
Each bullet is tagged with a type such as **[Feature]**, **[Fix]**, **[Docs]**, or **[Chore]**.

---

## [Unreleased]

- **[Note]** Ongoing work is tracked in the repository; new entries will appear in the next tagged release.

---

## [1.7.5] – 2025-12-30

### Highlights

- **[Feature]** Massive improvements to **manual match workflows**:
  - Multi-step manual match modal with review step, map pool and template support, deletion, and richer configuration (round limits, overtime, simulation, matchmaking options).
  - Manual match templates, ratings management, and bulk match creation for tournaments.
  - Better normalization of player data, event handling, and status updates for manual matches.
- **[Feature]** Enhanced **server availability and simulation tooling**:
  - Server availability metrics, queue status, warnings before tournament start, and improved caching and connectivity checks.
  - Simulation mode for matches and tournaments, with configurable simulation timescale and spinner timeouts on start.
  - Automated veto simulation for tournament matches and richer server events monitoring.
- **[Feature]** Richer **player and tournament insights**:
  - Improved player statistics (headshots, ADR, highlighting, leaderboard accuracy), match list cards, and recent performance views.
  - Enhanced tournament leaderboard, live stats extraction, and parallel/optimistic match allocation strategies.
  - Queue-aware server status responses and navigation.
- **[Feature]** Expanded **public and auth flows**:
  - Steam OpenID login for players, enhanced Steam API integration, and public pages for easier navigation (player finder, public pages shell, 404 handling).
  - Per-server MatchZy configuration (chat prefixes, knife round toggles, overtime segments, and related plugin settings).
- **[Feature]** Visual and UX improvements:
  - Improved brackets viewer styling and live match highlighting, map thumbnails via `FadeInImage`, and WebP images for maps.
  - Audio notifications for matches, friendlier team names, better theming (scrollbars, colors), and richer settings UI (tabs, reset).
- **[Fix]** Numerous fixes to:
  - Veto UI behavior, match score display, server online status detection, shuffle tournament errors, and E2E test stability.

### Detailed (from commits since 1.2.0)

- **[Feature]** Tournament and match configuration:
  - Added `maxRounds`, `overtimeMode`, and overtime segment configuration to tournament settings.
  - Introduced simulation mode flags and timescale keys in the settings service.
  - Implemented match volume estimation for various tournament formats.
- **[Feature]** Manual matches:
  - Implemented manual match creation, including map and team selection, round limits, overtime, and simulation toggles.
  - Added manual match templates, match deletion, and bulk creation workflows for tournaments.
  - Added ELO template import and built-in templates to standardize rating configs.
- **[Feature]** Server availability and allocation:
  - Enhanced server status endpoint with queued match status and more accurate availability metrics.
  - Implemented bi-directional connectivity checks, allocation tracking, and structural validation for configurations.
  - Added server events monitoring endpoint and UI, plus improved logging around allocation and failures.
- **[Feature]** Player experience:
  - Introduced `PlayerAvatar` and `PlayerName` components and player highlighting in performance views.
  - Improved PlayerProfile with deduplicated match history, better recent-match stats, and error handling.
  - Added public player selection and current-match endpoints for easier access to connect information.
- **[Feature]** Shuffle tournaments and brackets:
  - Enhanced shuffle tournament logic with friendlier team naming, configuration options, and screenshot automation.
  - Added round map labels for shuffle tournaments, improved winner identification, and refined bracket visuals.
- **[Feature]** UI & monitoring:
  - Extended `AdminTools` and `AdminMatchControls` with more resilient match control commands and recovery flow.
  - Added server events monitor, log viewer, live stats clearing, and richer postgame messaging.
  - Introduced NotFound and PublicPages routing, improved Settings tabs, and better Snackbar usage for errors.
- **[Fix]** Reliability and correctness:
  - Fixed numerous edge cases in bracket display, map image URLs, match restart behavior, and shuffle team assignment.
  - Improved log formatting, timestamp handling, and error messages throughout the stack.
- **[Docs]** Documentation and release tooling:
  - Updated guides, quick start, and feature docs for new tournament formats, shuffle tournaments, and server setup.
  - Improved release scripts (Docker, multi-platform, version automation) and added standalone release steps.

---

## [1.2.0] – 2025-11-28

### Highlights

- **[Feature]** Introduced **maps and map pool management**:
  - Full CRUD for maps and map pools, including enable/disable, CS2 map imports, default pools, and synchronization from GitHub/wiki sources.
  - Map pool-aware veto and tournament configuration, with dynamic loading and fallback display handling.
- **[Feature]** Expanded **CS Major veto support**:
  - CS Major-compliant veto orders for BO1/BO3/BO5 with custom orders support and enhanced tests and manual testing guides.
  - Improved VetoInterface UX, including correct starting sides, dynamic map lists, and simulation-aware logic.
- **[Feature]** Improved **demo, match recovery, and server integration**:
  - Match report upload endpoints, enhanced demo upload logging, and better match recovery routines.
  - Integration with CS2 Server Manager and documentation to streamline server and plugin setup.
- **[Feature]** Better **observability and admin tools**:
  - Dedicated event log file, match log viewer, and Admin Tools improvements for server control.
  - Version display and automated release workflow, with Discord webhook announcements for releases.
- **[Feature]** Test and infra upgrades:
  - Full Playwright E2E suite with tags, HTML reporting, and improved selectors.
  - Migration to PostgreSQL with a database abstraction layer and updated Docker-based dev workflow.

### Detailed (from commits between 1.1.1 and 1.7.5)

- **[Feature]** Maps & veto:
  - Added Map and MapPool components with modals, map synchronization, and defaults for CS2 maps.
  - Documented map and map pool workflows, added comprehensive tests, and refined map selection UIs.
- **[Feature]** CS Major veto enhancements:
  - Updated veto orders to CS Major rules, improved tests for those formats and custom orders.
  - Refined veto logic, polling, and UI error handling.
- **[Feature]** Demo & recovery:
  - Introduced match report upload via plugin endpoint and richer demo configuration.
  - Added explicit match recovery flows for desynced states, including reconnect and webhook reconfiguration.
- **[Feature]** Observability & docs:
  - Added event logging to a dedicated file, improved match connection event logs, and better status messages.
  - Expanded documentation for CS2 server setup, tournament quick start, and plugin requirements.
- **[Feature]** Infra & testing:
  - Added PostgreSQL support with updated Docker configuration and `.env` loading.
  - Implemented comprehensive Playwright E2E coverage, including selectors and CI configuration.
- **[Docs]**:
  - Restructured index and guides, added screenshots, and clarified installation prerequisites.

---

## [1.1.1] – 2025-11-26

### Highlights

- **[Feature]** Quality-of-life improvements for admins and players:
  - Steam avatar integration for team players and improved match displays.
  - Additional testing and CI refinements for veto flows and quick-start documentation.
- **[Fix]** Yarn lockfile synchronization and build reliability fixes.

---

## [1.1.0] – 2025-11-23

### Highlights

- **[Feature]** Advanced **map veto and CS Major support**:
  - Customizable veto formats and extended CS Major testing scenarios.
- **[Feature]** Improved **testing and reliability**:
  - New API tests, better tournament setup flows in tests, and more robust polling and error handling.
- **[Docs]** Updated manual testing and roadmap docs for CS Major formats.

---

## [1.0.0] – 2025-11-10

### Highlights (initial public release)

- **[Feature]** Core **tournament management platform**:
  - Tournament page, bracket visualization (Single/Double Elim, Round Robin, Swiss), matches page, and automatic bracket generation.
  - Server management with status checks, multi-server support, and basic allocation.
- **[Feature]** **Map veto system** and **team management**:
  - CS2 Major-style map veto workflows, player management, and team CRUD.
- **[Feature]** **Real-time updates**:
  - WebSocket-based updates for tournaments, matches, and veto.
- **[Feature]** **Admin tools and demo management**:
  - Admin match controls, application logs, and demo recording/upload support.
- **[Feature]** **Public pages**:
  - Public team pages with match info, server connection details, veto interface, and statistics.

---

[Unreleased]: https://github.com/sivert-io/matchzy-auto-tournament/compare/v1.7.5...HEAD
[1.7.5]: https://github.com/sivert-io/matchzy-auto-tournament/releases/tag/v1.7.5
[1.2.0]: https://github.com/sivert-io/matchzy-auto-tournament/releases/tag/v1.2.0
[1.1.1]: https://github.com/sivert-io/matchzy-auto-tournament/releases/tag/v1.1.1
[1.1.0]: https://github.com/sivert-io/matchzy-auto-tournament/releases/tag/v1.1.0
[1.0.0]: https://github.com/sivert-io/matchzy-auto-tournament/releases/tag/v1.0.0
