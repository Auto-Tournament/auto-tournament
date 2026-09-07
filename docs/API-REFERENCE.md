<!--
  GENERATED FILE — DO NOT EDIT BY HAND.

  Produced by scripts/generate-api-reference.ts, which walks the real Express
  routers listed in api/src/routes/routeTable.ts. Regenerate with:

      yarn docs:api

  CI fails if this file does not match the routers (yarn docs:api --check).
-->

# API reference

Every endpoint this API serves — 187 of them, 140 behind auth —
read directly from the routers rather than written down, so it cannot drift.

For *how* to authenticate a bot or script, and a task-oriented tour of the
endpoints worth using, see [API.md](API.md). This file is the index.

## Reading the Auth column

| Value | Meaning |
| --- | --- |
| `public` | No credential needed |
| `admin` | An admin session, or a service token (`API_TOKENS`; `API_TOKENS_READONLY` for `GET`) |
| `server token` | `X-MatchZy-Token` — for CS2 game servers, not for bots |

`public` means the middleware requires nothing. A few of these still resolve
the caller's identity from a cookie and change what they return, or reject the
action further in — map veto is the notable one, since actions are attributed
to a player. Read the handler before assuming an endpoint is anonymous.

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

### Matches

Create, load, restart and cancel matches; read match state.

| Method | Path | Auth |
| --- | --- | --- |
| `GET` | `/api/matches/:slug.json` | public |
| `DELETE` | `/api/matches/:slug` | admin |
| `POST` | `/api/matches/bulk-delete` | admin |
| `GET` | `/api/matches` | public |
| `GET` | `/api/matches/:slug` | public |
| `POST` | `/api/matches` | admin |
| `POST` | `/api/matches/:slug/load` | admin |
| `POST` | `/api/matches/:slug/restart` | admin |
| `POST` | `/api/matches/:slug/reallocate` | admin |
| `PATCH` | `/api/matches/:slug/status` | admin |
| `POST` | `/api/matches/:slug/force-cancel` | admin |
| `DELETE` | `/api/matches/:slug` | admin |

### Events

MatchZy webhooks in, and the recorded event log out.

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
| `GET` | `/api/tournament/:id/leaderboard` | admin |
| `GET` | `/api/tournament/:id/round-status` | admin |
| `POST` | `/api/tournament/:id/generate-round` | admin |
| `GET` | `/api/tournament/:id/elo-template` | admin |
| `PUT` | `/api/tournament/:id/elo-template` | admin |
| `POST` | `/api/tournament/:id/check-completion` | admin |

### Demos

Demo upload from the game server, and download.

| Method | Path | Auth |
| --- | --- | --- |
| `POST` | `/api/demos/:matchSlug/upload` | server token |
| `GET` | `/api/demos/:matchSlug/download/:mapNumber?` | public |
| `GET` | `/api/demos/:matchSlug/status` | admin |
| `GET` | `/api/demos/:matchSlug/info` | admin |

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

### Veto

Map veto state and actions.

| Method | Path | Auth |
| --- | --- | --- |
| `GET` | `/api/veto/:matchSlug` | public |
| `POST` | `/api/veto/:matchSlug/action` | public |
| `POST` | `/api/veto/:matchSlug/reset` | admin |

### Settings

Instance-wide settings.

| Method | Path | Auth |
| --- | --- | --- |
| `GET` | `/api/settings/version` | public |
| `GET` | `/api/settings` | admin |
| `PUT` | `/api/settings` | admin |

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
| `GET` | `/api/players/:playerId/current-match` | public |
| `GET` | `/api/players/:playerId/summary` | public |
| `GET` | `/api/players/:playerId/avatar.svg` | public |
| `GET` | `/api/players/:playerId` | public |
| `GET` | `/api/players/:playerId/rating-history` | public |
| `GET` | `/api/players/:playerId/matches` | public |
| `GET` | `/api/players` | admin |
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

### Test helpers

E2E helpers. Disabled in production unless ENABLE_TEST_ENDPOINTS is set.

| Method | Path | Auth |
| --- | --- | --- |
| `POST` | `/api/test/marker` | admin |
| `POST` | `/api/test/reset-database` | admin |
| `POST` | `/api/test/server-status` | admin |
| `POST` | `/api/test/match-state` | admin |
| `POST` | `/api/test/match-report` | admin |
| `POST` | `/api/test/login-admin` | public |
| `POST` | `/api/test/login-player` | public |

### Auth

Sign-in flows, admin identity, impersonation.

| Method | Path | Auth |
| --- | --- | --- |
| `GET` | `/api/auth/steam` | public |
| `GET` | `/api/auth/steam/callback` | public |
| `POST` | `/api/auth/logout` | public |
| `GET` | `/api/auth/keycloak` | public |
| `GET` | `/api/auth/keycloak/callback` | public |
| `GET` | `/api/auth/discord` | public |
| `GET` | `/api/auth/discord/callback` | public |
| `GET` | `/api/auth/github` | public |
| `GET` | `/api/auth/github/callback` | public |
| `GET` | `/api/auth/providers` | public |
| `GET` | `/api/auth/me` | public |
| `POST` | `/api/auth/self-register` | public |
| `GET` | `/api/auth/admin-status` | public |
| `GET` | `/api/auth/admin/me` | public |
| `POST` | `/api/auth/admin/logout` | public |
| `GET` | `/api/auth/impersonate` | admin |
| `POST` | `/api/auth/impersonate` | admin |
| `POST` | `/api/auth/impersonate/stop` | admin |

### MatchZy

MatchZy Enhanced version information.

| Method | Path | Auth |
| --- | --- | --- |
| `GET` | `/api/matchzy/latest-version` | public |
