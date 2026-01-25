# Changelog

All notable changes to MatchZy Auto Tournament are summarized here.

This file is generated from the full git history and groups changes by release.
Each bullet is tagged with a type such as **[Feature]**, **[Fix]**, **[Docs]**, or **[Chore]**.

---

## [Unreleased]

- _No unreleased changes._

---

## [2.0.6] - 2026-01-25

### Added
- Release v2.0.6

---

## [2.0.5] - 2026-01-25

### Added
- Release v2.0.5

---

## [2.0.4] - 2026-01-24

### Auth, Security & Reverse Proxy

- **[Feature]** Implemented **signed `player_steam_id` cookie** (HMAC-SHA256) to prevent admin impersonation; all cookie reads verify the signature.
- **[Feature]** Enhanced **session management for reverse proxy setups**: `trust proxy`, configurable session `cookie.domain` from `FRONTEND_BASE_URL`, and Steam OAuth callback via 200 + HTML meta-refresh so `Set-Cookie` is respected behind Cloudflare Tunnel / nginx.
- **[Docs]** Added **reverse proxy guide** (nginx + HTTPS, Cloudflare Tunnel) with `X-Forwarded-*`, `FRONTEND_BASE_URL`, and OAuth callback tips.

### Release & Tooling

- **[Feature]** Release script: **optional test run** with skip-by-default prompt (`y/N`).
- **[Chore]** Release script: use predefined `SCRIPT_DIR` and general cleanup.

---

## [2.0.3] - 2026-01-24

### Servers & MatchZy

- **[Feature]** Integrated **MatchZy version fetching** (GitHub) and environment configuration; Servers UI shows latest version and outdated indicators.
- **[Feature]** **Server initialization** optimized with concurrent checks and improved logging; webhook, demo upload, auth, and core config steps clarified.
- **[Fix]** Improved error handling and logging in **server heartbeat** updates and server tracking.

### Release & Tooling

- **[Chore]** Release script: handle uncommitted changes (stash/restore) and improve reliability.

---

## [2.0.2] - 2026-01-24

### Servers & Auth

- **[Feature]** **Admin status endpoint** (`/api/auth/admin-status`) and richer Steam callback logging.
- **[Feature]** Server modal and batch server modal: improved **ID handling** and **connectivity checks**; server initialization and webhook configuration logging enhanced.
- **[Feature]** Server log checking improvements and translation updates.

### Docs & Docker

- **[Docs]** Docker: **getting started**, **environment variable** instructions, and setup steps updated.
- **[Chore]** Database logging and configuration tweaks; release script: remove `--no-cache-filter` from Docker build.

---

## [2.0.1] - 2026-01-22

### Docker & Configuration

- **[Chore]** Docker Compose: **`.env`-based configuration**, refined `docker-compose` / `docker-compose.local` options, and `STEAM_API_KEY` support.
- **[Chore]** Environment variable documentation and session handling improvements.

### Docs & Troubleshooting

- **[Docs]** **Troubleshooting**: admin access recovery, expanded admin access guidance, and reverse-proxy–related tips.

---

## [2.0.0] - 2026-01-22

### Added
- Release v2.0.0

---

## [1.7.6] - 2026-01-01

### Added
- Release v1.7.6

---

## [1.7.5] – 2025-12-30

### Tournament & Match Management

- **[Feature]** Deep overhaul of **manual match workflows** with a multi-step modal, review step, map pool and template support, match deletion, and richer configuration (round limits, overtime modes, simulation flags, and matchmaking options).
- **[Feature]** Added manual match templates, ratings management, and bulk match creation for tournaments, plus better validation and error handling for bracket matches.
- **[Feature]** Refined shuffle tournament handling with friendlier team names, draw handling, improved match allocation logic (including optimistic parallel allocation), and better bracket visuals.

### Servers, Allocation & Simulation

- **[Feature]** Expanded **server availability tooling** with accurate status metrics, queue awareness, warnings before tournament start, bi-directional connectivity checks, and improved caching.
- **[Feature]** Introduced **simulation mode** for matches and tournaments, including timescale configuration, simulation settings in the UI, and simulation-aware veto/match logic.
- **[Feature]** Added automated veto simulation for tournament matches and richer server events monitoring (dedicated endpoint, UI monitor, and enhanced logging).

### Players, Stats & Insights

- **[Feature]** Enhanced player insights with headshot tracking, improved ADR and performance metrics, highlighting for key players, and more accurate leaderboards via deduplicated stats.
- **[Feature]** Upgraded PlayerProfile with recent-match performance summaries, better match history handling, and robust error states.
- **[Feature]** Introduced public player selection and current-match endpoints so players can easily find connect info from public pages.

### Auth, Public Pages & MatchZy Settings

- **[Feature]** Added **Steam OpenID login** for players, plus improved Steam API integration and error handling.
- **[Feature]** Implemented per-server **MatchZy configuration management** (chat prefixes, knife round toggles, overtime segments, and related plugin settings).
- **[Feature]** Added `PublicPages` shell and 404 routing to ensure a smoother public navigation experience.

### Admin Tools, Monitoring & UX

- **[Feature]** Extended `AdminTools` and `AdminMatchControls` with more resilient match control commands, match recovery tools, and clearer confirmation flows.
- **[Feature]** Added a **Server Events Monitor**, application **LogViewer**, live stats clearing, and clearer postgame status messaging.
- **[Feature]** Delivered a large round of UX polish: improved brackets viewer styling and live match highlighting, `FadeInImage` for map thumbnails with WebP assets, audio notifications, better theming (scrollbars, colors), and tabbed Settings with reset controls.

### Reliability, Tooling & Docs

- **[Fix]** Addressed many edge cases in veto UI behavior, match score display, server online detection, shuffle tournament flows, and E2E test reliability.
- **[Docs]** Updated guides, quick start, and feature docs to cover new tournament formats, shuffle tournaments, and server setup.
- **[Chore]** Hardened release scripts for Docker and multi-platform builds, and added standalone steps for repeatable releases.

---

## [1.2.0] – 2025-11-28

### Maps, Pools & Veto

- **[Feature]** Added full **maps and map pool management** (CRUD, enable/disable, CS2 imports, default pools, and synchronization from GitHub/wiki sources).
- **[Feature]** Tightened integration between map pools, tournaments, and veto (pool-aware configuration, dynamic loading, and robust fallback display handling).
- **[Feature]** Expanded **CS Major veto support** with compliant BO1/BO3/BO5 orders, custom orders, and a more polished VetoInterface UX.

### Demo Management, Recovery & Server Integration

- **[Feature]** Introduced match report upload endpoints, enhanced demo upload logging, and more reliable recovery routines for desynced match state.
- **[Feature]** Integrated with **CS2 Server Manager**, with docs to streamline plugin and server setup across environments.

### Observability, Admin Tools & Release Flow

- **[Feature]** Added dedicated event log files, a match log viewer, and more capable Admin Tools for server-level operations.
- **[Feature]** Introduced version display and automated release workflows, including Discord webhook announcements.

### Infrastructure, Testing & Docs

- **[Feature]** Migrated to **PostgreSQL** with an abstraction layer and updated Docker-based development environment.
- **[Feature]** Added a comprehensive **Playwright E2E** suite (tags, HTML reporting, and selector improvements).
- **[Docs]** Restructured and expanded docs (index, quick start, CS2 server setup, screenshots, and prerequisites) for clearer onboarding.

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

[Unreleased]: https://github.com/sivert-io/matchzy-auto-tournament/compare/v2.0.6...HEAD
[2.0.6]: https://github.com/sivert-io/matchzy-auto-tournament/releases/tag/v2.0.6
[2.0.5]: https://github.com/sivert-io/matchzy-auto-tournament/releases/tag/v2.0.5
[2.0.4]: https://github.com/sivert-io/matchzy-auto-tournament/releases/tag/v2.0.4
[2.0.3]: https://github.com/sivert-io/matchzy-auto-tournament/releases/tag/v2.0.3
[2.0.2]: https://github.com/sivert-io/matchzy-auto-tournament/releases/tag/v2.0.2
[2.0.1]: https://github.com/sivert-io/matchzy-auto-tournament/releases/tag/v2.0.1
[2.0.0]: https://github.com/sivert-io/matchzy-auto-tournament/releases/tag/v2.0.0
[1.7.6]: https://github.com/sivert-io/matchzy-auto-tournament/releases/tag/v1.7.6
[1.7.5]: https://github.com/sivert-io/matchzy-auto-tournament/releases/tag/v1.7.5
[1.2.0]: https://github.com/sivert-io/matchzy-auto-tournament/releases/tag/v1.2.0
[1.1.1]: https://github.com/sivert-io/matchzy-auto-tournament/releases/tag/v1.1.1
[1.1.0]: https://github.com/sivert-io/matchzy-auto-tournament/releases/tag/v1.1.0
[1.0.0]: https://github.com/sivert-io/matchzy-auto-tournament/releases/tag/v1.0.0
