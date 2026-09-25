<!--
  GENERATED FILE — DO NOT EDIT BY HAND.

  Produced by scripts/generate-api-reference.ts, which walks the real Express
  routers listed in api/src/routes/routeTable.ts. Regenerate with:

      yarn docs:api

  CI fails if this file does not match the routers (yarn docs:api --check).
-->

# API reference

Every endpoint this API serves — 328 of them, 231 behind auth —
read directly from the routers rather than written down, so it cannot drift.

For *how* to authenticate a bot or script, and a task-oriented tour of the
endpoints worth using, see [API.md](API.md). To generate a client, use
[openapi.json](openapi.json) — same walk, machine-readable.

## Reading the Auth column

| Value | Meaning |
| --- | --- |
| `public` | No credential needed |
| `admin` | An admin session, or a service token (`API_TOKENS`; `API_TOKENS_READONLY` for `GET`) |
| `server token` | `X-Auto-Tournament-Token` — for CS2 game servers, not for bots |

`public` means the middleware requires nothing. A few of these still resolve
the caller's identity from a cookie and change what they return, or reject the
action further in — map veto is the notable one, since actions are attributed
to a player. Read the handler before assuming an endpoint is anonymous.

**shadowed** marks a registration that never runs: the same method and path was
registered earlier, and Express matches in registration order. It is dead code,
and the dangerous kind — it reads as though it were in force. Where a shadowed
row claims different auth from the row above it, the row above is what answers.

## Endpoints

### Health and docs

Served by the app itself rather than a router.

| Method | Path | Auth |
| --- | --- | --- |
| `GET` | `/api-docs.json` | public |
| `GET` | `/` | public |
| `GET` | `/health` | public |
| `GET` | `/api/health/fleet` | public |

### Server bootstrap

Self-registration for a CS2 server coming online.

| Method | Path | Auth |
| --- | --- | --- |
| `GET` | `/api/servers/:id/bootstrap` | server token |

### Update hold

Whether a game host should pause automatic CS2 updates.

| Method | Path | Auth |
| --- | --- | --- |
| `GET` | `/api/servers/update-hold` | server token |

### Servers

The CS2 server fleet — add, edit, enable, remove.

| Method | Path | Auth |
| --- | --- | --- |
| `GET` | `/api/servers` | admin |
| `POST` | `/api/servers/batch` | admin |
| `PATCH` | `/api/servers/batch` | admin |
| `GET` | `/api/servers/:id` | admin |
| `POST` | `/api/servers` | admin |
| `PUT` | `/api/servers/:id` | admin |
| `PATCH` | `/api/servers/:id` | admin |
| `DELETE` | `/api/servers/:id` | admin |
| `POST` | `/api/servers/bulk-delete` | admin |
| `POST` | `/api/servers/:id/enable` | admin |
| `POST` | `/api/servers/:id/disable` | admin |
| `POST` | `/api/servers/:id/reset-initialization` | admin |
| `POST` | `/api/servers/reset-all-initialization` | admin |

### Server status

Liveness, connectivity and CS2 update state per server.

| Method | Path | Auth |
| --- | --- | --- |
| `GET` | `/api/servers/:id/status` | admin |

### RCON

Direct server control — pause, say, end match, raw commands.

| Method | Path | Auth |
| --- | --- | --- |
| `GET` | `/api/rcon/test/:serverId` | admin |
| `GET` | `/api/rcon/test` | admin |
| `POST` | `/api/rcon/test-connection` | admin |
| `POST` | `/api/rcon/practice-mode` | admin |
| `POST` | `/api/rcon/start-match` | admin |
| `POST` | `/api/rcon/change-map` | admin |
| `POST` | `/api/rcon/pause-match` | admin |
| `POST` | `/api/rcon/unpause-match` | admin |
| `POST` | `/api/rcon/force-pause` | admin |
| `POST` | `/api/rcon/force-unpause` | admin |
| `POST` | `/api/rcon/restart-match` | admin |
| `POST` | `/api/rcon/end-warmup` | admin |
| `POST` | `/api/rcon/reload-admins` | admin |
| `POST` | `/api/rcon/say` | admin |
| `POST` | `/api/rcon/broadcast` | admin |
| `POST` | `/api/rcon/swap-teams` | admin |
| `POST` | `/api/rcon/restore-backup` | admin |
| `POST` | `/api/rcon/skip-veto` | admin |
| `POST` | `/api/rcon/restart-round` | admin |
| `POST` | `/api/rcon/add-time` | admin |
| `POST` | `/api/rcon/end-match` | admin |
| `POST` | `/api/rcon/:serverId/add-player` | admin |
| `POST` | `/api/rcon/command` | admin |

### Demos

Demo upload from the game server, and download.

| Method | Path | Auth |
| --- | --- | --- |
| `POST` | `/api/demos/:matchSlug/upload` | server token |
| `GET` | `/api/demos/:matchSlug/download/:mapNumber?` | public |
| `GET` | `/api/demos/:matchSlug/status` | admin |
| `GET` | `/api/demos/:matchSlug/info` | admin |

### Auto Tournament CS2

Auto Tournament CS2 plugin version information.

| Method | Path | Auth |
| --- | --- | --- |
| `GET` | `/api/cs2-plugin/latest-version` | public |

### Events

Auto Tournament CS2 webhooks in, and the recorded event log out.

| Method | Path | Auth |
| --- | --- | --- |
| `GET` | `/api/events/test` | public |
| `POST` | `/api/events` | server token |
| `POST` | `/api/events/report` | server token |
| `POST` | `/api/events/:matchSlugOrServerId` | server token |
| `GET` | `/api/events/connections/:matchSlug` | public |
| `GET` | `/api/events/live/:matchSlug` | public |
| `GET` | `/api/events/server/:serverId` | admin |
| `GET` | `/api/events/:matchSlug` | admin |

### Veto

Map veto state and actions.

| Method | Path | Auth |
| --- | --- | --- |
| `GET` | `/api/veto/:matchSlug` | public |
| `POST` | `/api/veto/:matchSlug/action` | public |
| `POST` | `/api/veto/:matchSlug/reset` | admin |

### Maps

The map catalogue.

| Method | Path | Auth |
| --- | --- | --- |
| `GET` | `/api/maps` | admin |
| `GET` | `/api/maps/:id` | admin |
| `POST` | `/api/maps` | admin |
| `PUT` | `/api/maps/:id` | admin |
| `PATCH` | `/api/maps/:id` | admin |
| `POST` | `/api/maps/:id/upload-image` | admin |
| `POST` | `/api/maps/sync` | admin |
| `DELETE` | `/api/maps/:id` | admin |

### Map pools

Named sets of maps for veto and match config.

| Method | Path | Auth |
| --- | --- | --- |
| `GET` | `/api/map-pools` | admin |
| `GET` | `/api/map-pools/:id` | admin |
| `POST` | `/api/map-pools` | admin |
| `PUT` | `/api/map-pools/:id/enable` | admin |
| `PUT` | `/api/map-pools/:id/disable` | admin |
| `PUT` | `/api/map-pools/:id/set-default` | admin |
| `PUT` | `/api/map-pools/:id` | admin |
| `DELETE` | `/api/map-pools/:id` | admin |

### Match connect

How a player joins a CS2 match: its server, status and current map.

| Method | Path | Auth |
| --- | --- | --- |
| `GET` | `/api/game/cs2/matches/:slug/connect` | public |

### Fleet enrollment

A Ready Up server trades a one-time code or fleet key for its server token.

| Method | Path | Auth |
| --- | --- | --- |
| `POST` | `/api/fleet/enroll` | public |

### Fleet

Ready Up servers on the fleet link: registry, one-time codes, fleet keys, revoke and rotate. The server WebSocket is /api/fleet/ws.

| Method | Path | Auth |
| --- | --- | --- |
| `GET` | `/api/fleet/servers` | admin |
| `POST` | `/api/fleet/servers` | admin |
| `PATCH` | `/api/fleet/servers/:id` | admin |
| `DELETE` | `/api/fleet/servers/:id` | admin |
| `POST` | `/api/fleet/servers/:id/code` | admin |
| `POST` | `/api/fleet/servers/:id/revoke` | admin |
| `POST` | `/api/fleet/servers/:id/rotate` | admin |
| `GET` | `/api/fleet/keys` | admin |
| `POST` | `/api/fleet/keys` | admin |
| `DELETE` | `/api/fleet/keys/:id` | admin |

### Test helpers (CS2)

E2E helpers that stand in for a CS2 server. Disabled in production unless ENABLE_TEST_ENDPOINTS is set.

| Method | Path | Auth |
| --- | --- | --- |
| `POST` | `/api/test/server-status` | admin |
| `POST` | `/api/test/fleet/reset-enroll-rate-limit` | admin |
| `POST` | `/api/test/fleet/age-token` | admin |

### Manual reporting — captains

Report a result, and confirm, dispute or withdraw one, for a game MAT cannot watch. A captain of one of the two teams only; answering names the revision it answers (3.0 phase D, PR D4).

| Method | Path | Auth |
| --- | --- | --- |
| `GET` | `/api/game/manual/matches/:slug` | public |
| `POST` | `/api/game/manual/matches/:slug/report` | public |
| `POST` | `/api/game/manual/matches/:slug/confirm` | public |
| `POST` | `/api/game/manual/matches/:slug/dispute` | public |
| `POST` | `/api/game/manual/matches/:slug/withdraw` | public |
| `GET` | `/api/game/manual/tournaments/:tournamentId/stats` | public |

### Manual reporting — admin

The dispute queue, resolving and reopening a reported match, the extra stat fields a tournament asks reporters for, and who captains a team (3.0 phase D, PR D5).

| Method | Path | Auth |
| --- | --- | --- |
| `GET` | `/api/game/manual/disputes` | admin |
| `POST` | `/api/game/manual/matches/:slug/resolve` | admin |
| `POST` | `/api/game/manual/matches/:slug/reopen` | admin |
| `GET` | `/api/game/manual/tournaments/:tournamentId/fields` | admin |
| `PUT` | `/api/game/manual/tournaments/:tournamentId/fields` | admin |
| `POST` | `/api/game/manual/teams/:teamId/captain` | admin |
| `GET` | `/api/game/manual/teams/:teamId/members` | admin |

### Teams

Team roster CRUD, including batch create and delete.

| Method | Path | Auth |
| --- | --- | --- |
| `GET` | `/api/teams` | admin |
| `GET` | `/api/teams/:id` | admin |
| `POST` | `/api/teams` | admin |
| `PUT` | `/api/teams/:id` | admin |
| `PATCH` | `/api/teams/batch` | admin |
| `DELETE` | `/api/teams/:id` | admin |
| `POST` | `/api/teams/bulk-delete` | admin |

### Matches

Create, load, restart and cancel matches; read match state.

| Method | Path | Auth |
| --- | --- | --- |
| `GET` | `/api/matches/:slug.json` | server token or admin |
| `DELETE` | `/api/matches/:slug` | admin |
| `POST` | `/api/matches/bulk-delete` | admin |
| `GET` | `/api/matches` | public |
| `GET` | `/api/matches/:slug` | public |
| `POST` | `/api/matches` | admin |
| `POST` | `/api/matches/:slug/load` | admin |
| `POST` | `/api/matches/:slug/restart` | admin |
| `POST` | `/api/matches/:slug/reallocate` | admin |
| `PATCH` | `/api/matches/:slug/status` | admin |
| `POST` | `/api/matches/:slug/winner` | admin |
| `POST` | `/api/matches/:slug/force-cancel` | admin |

### Steam

Steam Web API lookups (profiles, avatars, key health).

| Method | Path | Auth |
| --- | --- | --- |
| `GET` | `/api/steam/status` | admin |
| `POST` | `/api/steam/resolve` | admin |
| `GET` | `/api/steam/player/:steamId` | admin |
| `GET` | `/api/steam/workshop-map` | admin |

### Tournament

The tournament itself — setup, bracket, rounds, standings.

| Method | Path | Auth |
| --- | --- | --- |
| `GET` | `/api/tournament/:id/leaderboard` | public |
| `GET` | `/api/tournament/allocation-status` | public |
| `GET` | `/api/tournament/game` | public |
| `GET` | `/api/tournament/:id/bracket` | public |
| `GET` | `/api/tournament` | admin |
| `POST` | `/api/tournament` | admin |
| `PUT` | `/api/tournament` | admin |
| `DELETE` | `/api/tournament` | admin |
| `GET` | `/api/tournament/bracket` | admin |
| `POST` | `/api/tournament/bracket/regenerate` | admin |
| `POST` | `/api/tournament/reset` | admin |
| `GET` | `/api/tournament/server-availability` | admin |
| `POST` | `/api/tournament/start` | admin |
| `POST` | `/api/tournament/restart` | admin |
| `POST` | `/api/tournament/wipe-database` | admin |
| `POST` | `/api/tournament/wipe-table/:table` | admin |
| `POST` | `/api/tournament/dev/reset-simulation-state` | admin |
| `POST` | `/api/tournament/shuffle` | admin |
| `POST` | `/api/tournament/:id/manual-matches` | admin |
| `POST` | `/api/tournament/:id/register-players` | admin |
| `PUT` | `/api/tournament/:id/set-players` | admin |
| `GET` | `/api/tournament/:id/players` | admin |
| `GET` | `/api/tournament/:id/round-status` | admin |
| `POST` | `/api/tournament/:id/generate-round` | admin |
| `GET` | `/api/tournament/:id/elo-template` | admin |
| `PUT` | `/api/tournament/:id/elo-template` | admin |
| `POST` | `/api/tournament/:id/check-completion` | admin |

### Logs

Server-side event logs.

| Method | Path | Auth |
| --- | --- | --- |
| `GET` | `/api/logs` | admin |

### Team match view

A team's current match, oriented to that team. Public.

| Method | Path | Auth |
| --- | --- | --- |
| `GET` | `/api/team/:teamId/match` | public |

### Team stats

Past results and aggregates for a team. Public.

| Method | Path | Auth |
| --- | --- | --- |
| `GET` | `/api/team/:teamId/history` | public |
| `GET` | `/api/team/:teamId/stats` | public |

### Settings

Instance-wide settings.

| Method | Path | Auth |
| --- | --- | --- |
| `GET` | `/api/settings/version` | public |
| `GET` | `/api/settings` | admin |
| `PUT` | `/api/settings` | admin |

### Tournament templates

Saved tournament configurations.

| Method | Path | Auth |
| --- | --- | --- |
| `GET` | `/api/templates` | admin |
| `POST` | `/api/templates` | admin |
| `GET` | `/api/templates/:id` | admin |
| `PUT` | `/api/templates/:id` | admin |
| `DELETE` | `/api/templates/:id` | admin |

### Manual match templates

Saved configurations for one-off matches.

| Method | Path | Auth |
| --- | --- | --- |
| `GET` | `/api/manual-match-templates` | admin |
| `POST` | `/api/manual-match-templates` | admin |

### Recovery

Reconcile matches after an API restart or a server going away.

| Method | Path | Auth |
| --- | --- | --- |
| `POST` | `/api/recovery/recover` | admin |
| `POST` | `/api/recovery/replay/:matchSlug` | admin |

### Players

Player records, ratings, match history and profiles.

| Method | Path | Auth |
| --- | --- | --- |
| `GET` | `/api/players/find` | public |
| `GET` | `/api/players/public-selection` | public |
| `GET` | `/api/players/selection` | admin |
| `GET` | `/api/players/:playerId/team` | public |
| `GET` | `/api/players/me/match-status` | public |
| `GET` | `/api/players/me/discord-id` | public |
| `PUT` | `/api/players/me/discord-id` | public |
| `GET` | `/api/players/:playerId/current-match` | public |
| `GET` | `/api/players/:playerId/summary` | public |
| `GET` | `/api/players/:playerId/avatar.svg` | public |
| `GET` | `/api/players/:playerId` | public |
| `GET` | `/api/players/:playerId/rating-history` | public |
| `GET` | `/api/players/:playerId/matches` | public |
| `GET` | `/api/players` | admin |
| `GET` | `/api/players/by-discord-id/:discordId` | admin |
| `POST` | `/api/players` | admin |
| `POST` | `/api/players/bulk-import` | admin |
| `POST` | `/api/players/bulk-delete` | admin |
| `PUT` | `/api/players/:playerId` | admin |
| `DELETE` | `/api/players/:playerId` | admin |

### ELO templates

Rating calculation presets.

| Method | Path | Auth |
| --- | --- | --- |
| `GET` | `/api/elo-templates` | admin |
| `GET` | `/api/elo-templates/:id` | admin |
| `POST` | `/api/elo-templates` | admin |
| `PUT` | `/api/elo-templates/:id` | admin |
| `DELETE` | `/api/elo-templates/:id` | admin |

### Generation

Shared generators, e.g. random team names.

| Method | Path | Auth |
| --- | --- | --- |
| `GET` | `/api/generation/team-name` | admin |

### Games

The game catalogue players pick from (Wikidata-backed search, the built-in games). Public.

| Method | Path | Auth |
| --- | --- | --- |
| `GET` | `/api/games/search` | public |
| `GET` | `/api/games/popular` | public |
| `GET` | `/api/games/playable` | public |
| `GET` | `/api/games/icons/:file` | public |

### Game packs

Games an admin imported as a pack file: list, import, remove, and the pack tile. Admin only, except the tile.

| Method | Path | Auth |
| --- | --- | --- |
| `GET` | `/api/packs/:slug/icon.svg` | public |
| `GET` | `/api/packs/:slug/app-icon` | public |
| `GET` | `/api/packs` | admin |
| `POST` | `/api/packs` | admin |
| `GET` | `/api/packs/index` | admin |
| `GET` | `/api/packs/index/:slug/icon.svg` | admin |
| `POST` | `/api/packs/index/:slug` | admin |
| `DELETE` | `/api/packs/:slug` | admin |

### Modules

Code modules: list built-in and on-disk modules, enable or disable one from the next restart, and serve its client files. Admin only, except the client files and the public manifest of modules to load. Modules are installed from the signed catalog (/api/catalog) or on disk, never uploaded.

| Method | Path | Auth |
| --- | --- | --- |
| `GET` | `/api/modules/public` | public |
| `GET` | `/api/modules/:id/client/*` | public |
| `GET` | `/api/modules` | admin |
| `POST` | `/api/modules/:id/enable` | admin |
| `POST` | `/api/modules/:id/disable` | admin |

### Catalog

The game catalog: every pack and code module this instance has or can install, from the feed, its cache and the offline snapshot, with install, update, enable, disable, uninstall and purge. Code modules install only from signed releases. Admin only; writes must be same-site JSON.

| Method | Path | Auth |
| --- | --- | --- |
| `GET` | `/api/catalog` | admin |
| `GET` | `/api/catalog/packs/:slug/icon.svg` | admin |
| `GET` | `/api/catalog/packs/:slug/app-icon` | admin |
| `GET` | `/api/catalog/modules/:id/icon.svg` | admin |
| `POST` | `/api/catalog/packs/:slug/install` | admin |
| `DELETE` | `/api/catalog/packs/:slug` | admin |
| `POST` | `/api/catalog/modules/:id/install` | admin |
| `POST` | `/api/catalog/modules/:id/update` | admin |
| `POST` | `/api/catalog/update-all` | admin |
| `POST` | `/api/catalog/modules/:id/enable` | admin |
| `POST` | `/api/catalog/modules/:id/disable` | admin |
| `DELETE` | `/api/catalog/modules/:id` | admin |
| `POST` | `/api/catalog/modules/:id/purge` | admin |

### System

The platform process: whether it can restart itself, and a restart (so a module update that waits for one can finish). Admin only; writes must be same-site JSON.

| Method | Path | Auth |
| --- | --- | --- |
| `GET` | `/api/system/restart` | admin |
| `POST` | `/api/system/restart` | admin |

### Me

The signed-in player's own data, e.g. the games they play.

| Method | Path | Auth |
| --- | --- | --- |
| `GET` | `/api/me/games` | public |
| `PUT` | `/api/me/games` | public |
| `POST` | `/api/me/games/prompt/dismiss` | public |
| `GET` | `/api/me/connections` | public |
| `POST` | `/api/me/connections/:provider/remove` | public |

### Compatibility

Ready Up compatibility with the latest CS2 build: the runs its CI reports (token-guarded push), and public reads for the /compatibility page and a shields.io badge. 404 unless COMPAT_INGEST_TOKEN or COMPAT_FEED_URL is set.

| Method | Path | Auth |
| --- | --- | --- |
| `POST` | `/api/compat/events` | compat ingest token |
| `GET` | `/api/compat/latest` | public |
| `GET` | `/api/compat/runs` | public |
| `GET` | `/api/compat/badge.json` | public |

### Test helpers

E2E helpers. Disabled in production unless ENABLE_TEST_ENDPOINTS is set.

| Method | Path | Auth |
| --- | --- | --- |
| `POST` | `/api/test/marker` | admin |
| `POST` | `/api/test/reset-database` | admin |
| `POST` | `/api/test/match-state` | admin |
| `POST` | `/api/test/match-report` | admin |
| `POST` | `/api/test/series-result` | admin |
| `POST` | `/api/test/login-admin` | public |
| `POST` | `/api/test/login-player` | public |
| `POST` | `/api/test/pending-steam-link` | admin |
| `POST` | `/api/test/complete-steam-link` | admin |
| `GET` | `/api/test/auth-identities` | admin |
| `GET` | `/api/test/raw-team-roster/:teamId` | admin |
| `POST` | `/api/test/auth-identities` | admin |
| `GET` | `/api/test/linked-accounts` | admin |
| `POST` | `/api/test/linked-accounts/backfill` | admin |
| `GET` | `/api/test/schema-migrations` | admin |
| `POST` | `/api/test/schema-migrations/run` | admin |
| `GET` | `/api/test/module-migrations` | admin |
| `POST` | `/api/test/module-migrations/run` | admin |
| `POST` | `/api/test/module-migrations/reset` | admin |
| `GET` | `/api/test/cs2-tables` | admin |
| `POST` | `/api/test/cs2-tables/handover` | admin |
| `POST` | `/api/test/cs2-tables/foreign-keys` | admin |
| `POST` | `/api/test/cs2-tables/handover-probe` | admin |
| `POST` | `/api/test/cs2-settings-fold/probe` | admin |
| `GET` | `/api/test/cs2-settings-fold/columns` | admin |
| `GET` | `/api/test/player-identity/resolve` | admin |
| `GET` | `/api/test/oauth/:provider` | public |
| `POST` | `/api/test/oauth/:provider/link` | public |
| `GET` | `/api/test/oauth/:provider/callback` | public |
| `GET` | `/api/test/fake-oauth/:provider/authorize` | public |
| `POST` | `/api/test/fake-oauth/:provider/token` | public |
| `GET` | `/api/test/fake-oauth/:provider/userinfo` | public |
| `POST` | `/api/test/wikidata` | admin |
| `GET` | `/api/test/wikidata` | admin |
| `GET` | `/api/test/fake-wikidata` | public |
| `POST` | `/api/test/game-icons` | admin |
| `POST` | `/api/test/game-icons/run` | admin |
| `GET` | `/api/test/fake-steam/info/:appId` | public |
| `GET` | `/api/test/fake-steam/icons-new/:appId/:file` | public |
| `GET` | `/api/test/fake-steam/icons-old/:appId/:file` | public |
| `GET` | `/api/test/team-members` | admin |
| `POST` | `/api/test/team-members/backfill` | admin |
| `POST` | `/api/test/team-members` | admin |
| `GET` | `/api/test/phase-d-schema` | admin |
| `GET` | `/api/test/match-reports` | admin |
| `POST` | `/api/test/match-reports` | admin |
| `POST` | `/api/test/packs/reseed` | admin |
| `POST` | `/api/test/pack-index` | admin |
| `GET` | `/api/test/fake-pack-index/index.json` | public |
| `GET` | `/api/test/fake-pack-index/packs/:file` | public |
| `GET` | `/api/test/fake-pack-index/icons/:file` | public |
| `POST` | `/api/test/modules/fixture` | admin |
| `GET` | `/api/test/modules/:id/migrations` | admin |
| `POST` | `/api/test/modules/rescan` | admin |
| `DELETE` | `/api/test/modules/fixtures` | admin |
| `POST` | `/api/test/catalog` | admin |
| `POST` | `/api/test/modules/:id/purge-probe` | admin |
| `POST` | `/api/test/modules/:id/ledger` | admin |
| `GET` | `/api/test/modules/:id/max-version` | admin |
| `POST` | `/api/test/modules/:id/max-version` | admin |
| `POST` | `/api/test/modules/:id/interrupt-swap` | admin |
| `POST` | `/api/test/modules/restore-swaps` | admin |
| `POST` | `/api/test/modules/:id/seed-installed` | admin |
| `POST` | `/api/test/modules/auto-update` | admin |
| `GET` | `/api/test/fake-catalog/catalog.json` | public |
| `GET` | `/api/test/fake-catalog/releases/:file` | public |
| `GET` | `/api/test/fake-catalog/packs/:file` | public |
| `GET` | `/api/test/fake-catalog/icons/:file` | public |

### Auth

Sign-in flows, admin identity, impersonation.

| Method | Path | Auth |
| --- | --- | --- |
| `GET` | `/api/auth/steam` | public |
| `GET` | `/api/auth/steam/callback` | public |
| `POST` | `/api/auth/logout` | public |
| `GET` | `/api/auth/keycloak` | public |
| `POST` | `/api/auth/keycloak/link` | public |
| `GET` | `/api/auth/keycloak/callback` | public |
| `GET` | `/api/auth/discord` | public |
| `POST` | `/api/auth/discord/link` | public |
| `GET` | `/api/auth/discord/callback` | public |
| `GET` | `/api/auth/github` | public |
| `POST` | `/api/auth/github/link` | public |
| `GET` | `/api/auth/github/callback` | public |
| `GET` | `/api/auth/google` | public |
| `POST` | `/api/auth/google/link` | public |
| `GET` | `/api/auth/google/callback` | public |
| `GET` | `/api/auth/providers` | public |
| `GET` | `/api/auth/me` | public |
| `POST` | `/api/auth/self-register` | public |
| `GET` | `/api/auth/admin-status` | public |
| `GET` | `/api/auth/admin/me` | public |
| `POST` | `/api/auth/admin/logout` | public |
| `GET` | `/api/auth/impersonate` | admin |
| `POST` | `/api/auth/impersonate` | admin |
| `POST` | `/api/auth/impersonate/stop` | admin |
