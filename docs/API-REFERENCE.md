<!--
  GENERATED FILE — DO NOT EDIT BY HAND.

  Produced by scripts/generate-api-reference.ts, which walks the real Express
  routers listed in api/src/routes/routeTable.ts. Regenerate with:

      yarn docs:api

  CI fails if this file does not match the routers (yarn docs:api --check).
-->

# API reference

Every endpoint this API serves — 557 of them, 358 behind auth —
read directly from the routers rather than written down, so it cannot drift.

For *how* to authenticate a bot or script, and a task-oriented tour of the
endpoints worth using, see [the API guide](https://docs.autotournament.gg/reference/api).
To generate a client, use [openapi.json](openapi.json) — same walk, machine-readable.

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

### Skins

Virtual CS2 skins: inventories, loadouts, showcases and the admin inventory manager (platform only).

| Method | Path | Auth |
| --- | --- | --- |
| `GET` | `/api/skins/status` | public |
| `GET` | `/api/skins/me` | public |
| `POST` | `/api/skins/me/equip` | public |
| `DELETE` | `/api/skins/me/equip/:slot` | public |
| `POST` | `/api/skins/me/seen` | public |
| `PUT` | `/api/skins/me/showcase` | public |
| `GET` | `/api/skins/players/:steamId` | public |
| `GET` | `/api/skins/skin/:id` | public |
| `GET` | `/api/skins/admin/config` | admin |
| `PUT` | `/api/skins/admin/config` | admin |
| `GET` | `/api/skins/admin/catalog` | admin |
| `GET` | `/api/skins/admin/stats` | admin |
| `GET` | `/api/skins/admin/players` | admin |
| `GET` | `/api/skins/admin/players/:steamId/inventory` | admin |
| `POST` | `/api/skins/admin/players/:steamId/skins` | admin |
| `DELETE` | `/api/skins/admin/skins/:id` | admin |

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
| `POST` | `/api/demos/:matchSlug/upload` | public |
| `GET` | `/api/demos/:matchSlug/download/:mapNumber?` | public |
| `GET` | `/api/demos/:matchSlug/status` | admin |
| `GET` | `/api/demos/:matchSlug/info` | admin |
| `GET` | `/api/demos/archive.tar` | admin |

### MatchZy Enhanced

MatchZy Enhanced version information.

| Method | Path | Auth |
| --- | --- | --- |
| `GET` | `/api/cs2-plugin/latest-version` | public |

### Events

MatchZy Enhanced webhooks in, and the recorded event log out.

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

### Player profile

A player's CS2 totals, everyone's totals to compare with, and their results per map.

| Method | Path | Auth |
| --- | --- | --- |
| `GET` | `/api/game/cs2/players/:playerId/profile` | public |

### Demo analysis

The worker container reads stored demos after the match: its job queue, and each map's rounds, kills and 2D replay.

| Method | Path | Auth |
| --- | --- | --- |
| `POST` | `/api/game/cs2/demo-worker/claim` | admin |
| `PUT` | `/api/game/cs2/demo-worker/jobs/:slug/:map/replay` | admin |
| `POST` | `/api/game/cs2/demo-worker/jobs/:slug/:map/result` | admin |
| `POST` | `/api/game/cs2/demo-worker/jobs/:slug/:map/fail` | admin |
| `GET` | `/api/game/cs2/matches/:slug/maps/:map/analysis` | public |
| `GET` | `/api/game/cs2/matches/:slug/maps/:map/replay` | public |

### Highlights

Each player's best moments, picked from the demo analysis, and the clips the recorder makes of them.

| Method | Path | Auth |
| --- | --- | --- |
| `POST` | `/api/game/cs2/recorder/claim` | admin |
| `PUT` | `/api/game/cs2/recorder/jobs/:id/clip` | admin |
| `PUT` | `/api/game/cs2/recorder/reels/:slug/:map/:player` | admin |
| `PUT` | `/api/game/cs2/recorder/match-reels/:slug/:map` | admin |
| `POST` | `/api/game/cs2/recorder/match-reels/:slug/:map/fail` | admin |
| `GET` | `/api/game/cs2/matches/:slug/reels` | public |
| `POST` | `/api/game/cs2/recorder/fail` | admin |
| `PUT` | `/api/game/cs2/recorder/tournament-reels/:id` | admin |
| `POST` | `/api/game/cs2/recorder/tournament-reels/:id/fail` | admin |
| `PUT` | `/api/game/cs2/players/me/highlights/favourite` | public |
| `GET` | `/api/game/cs2/players/:playerId/highlights` | public |
| `GET` | `/api/game/cs2/tournaments/:id/highlights` | public |
| `GET` | `/api/game/cs2/watch/clip/:id` | public |
| `GET` | `/api/game/cs2/watch/reel/:slug/:map/:player` | public |
| `GET` | `/api/game/cs2/watch/match/:slug/:map` | public |
| `GET` | `/api/game/cs2/watch/tournament/:id` | public |
| `GET` | `/api/game/cs2/highlights/:file` | public |

### Map radars

Map radar images and coordinates for the 2D replay, read from a CS2 install's own files by the worker.

| Method | Path | Auth |
| --- | --- | --- |
| `GET` | `/api/game/cs2/radars` | public |
| `GET` | `/api/game/cs2/radars/:map` | public |
| `GET` | `/api/game/cs2/radars/:map/:file` | public |
| `PUT` | `/api/game/cs2/radars/:map/:level` | admin |

### Team profile

A team's CS2 results per map, and the maps it bans and picks most in the veto.

| Method | Path | Auth |
| --- | --- | --- |
| `GET` | `/api/game/cs2/teams/:teamId/profile` | public |

### Round backups

A CS2 match's round backups (Ready Up servers send them inline) and "restore to round N" over the fleet link or RCON, audited.

| Method | Path | Auth |
| --- | --- | --- |
| `GET` | `/api/game/cs2/matches/:slug/round-backups` | admin |
| `POST` | `/api/game/cs2/matches/:slug/round-backups/restore` | admin |

### Fleet failover

A Ready Up server that died or hung mid-match: the failover proposal (spare server, round backup to resume from), "move match" and dismiss (FLEET.md §11).

| Method | Path | Auth |
| --- | --- | --- |
| `GET` | `/api/game/cs2/matches/:slug/failover` | admin |
| `POST` | `/api/game/cs2/matches/:slug/failover/:id/accept` | admin |
| `POST` | `/api/game/cs2/matches/:slug/failover/move` | admin |
| `POST` | `/api/game/cs2/matches/:slug/failover/:id/dismiss` | admin |

### Fleet enrollment

A Ready Up server trades a one-time code or fleet key for its server token; csm (kind "host") gets its host token the same way.

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
| `POST` | `/api/fleet/servers/:id/link` | admin |
| `PUT` | `/api/fleet/servers/:id/address` | admin |
| `DELETE` | `/api/fleet/servers/:id/link` | admin |
| `GET` | `/api/fleet/matches/:slug` | admin |
| `POST` | `/api/fleet/matches/:slug/sync` | admin |
| `GET` | `/api/fleet/keys` | admin |
| `POST` | `/api/fleet/keys` | admin |
| `DELETE` | `/api/fleet/keys/:id` | admin |

### Fleet machines

Machines running csm as host agent: add (one-time code), inventory, health, create/start/stop/restart servers, update CS2 and Ready Up, revoke and rotate. The host WebSocket is /api/fleet/host.

| Method | Path | Auth |
| --- | --- | --- |
| `GET` | `/api/fleet/hosts` | admin |
| `POST` | `/api/fleet/hosts` | admin |
| `GET` | `/api/fleet/hosts/:id` | admin |
| `PATCH` | `/api/fleet/hosts/:id` | admin |
| `DELETE` | `/api/fleet/hosts/:id` | admin |
| `POST` | `/api/fleet/hosts/:id/code` | admin |
| `POST` | `/api/fleet/hosts/:id/revoke` | admin |
| `POST` | `/api/fleet/hosts/:id/rotate` | admin |
| `POST` | `/api/fleet/hosts/:id/commands` | admin |
| `GET` | `/api/fleet/hosts/:id/commands/:commandId` | admin |

### Fleet pushes

What the platform pushes to Ready Up servers: the admin list (admins.set), server settings (server.config, settings.set), whitelist / practice / plugins, and roster edits of a running match (match.update).

| Method | Path | Auth |
| --- | --- | --- |
| `GET` | `/api/fleet/admins` | admin |
| `PUT` | `/api/fleet/admins/extras` | admin |
| `POST` | `/api/fleet/admins/push` | admin |
| `GET` | `/api/fleet/settings` | admin |
| `PUT` | `/api/fleet/settings` | admin |
| `GET` | `/api/fleet/servers/:id/push` | admin |
| `PUT` | `/api/fleet/servers/:id/settings` | admin |
| `POST` | `/api/fleet/servers/:id/settings/push` | admin |
| `PUT` | `/api/fleet/servers/:id/whitelist` | admin |
| `PUT` | `/api/fleet/servers/:id/practice` | admin |
| `POST` | `/api/fleet/servers/:id/plugins` | admin |
| `GET` | `/api/fleet/plugins` | admin |
| `PUT` | `/api/fleet/plugins/default` | admin |
| `GET` | `/api/fleet/matches/:slug/roster` | admin |
| `POST` | `/api/fleet/matches/:slug/update` | admin |

### Fleet failover settings

Auto-failover (off by default): move a match off a dead Ready Up server without waiting for an admin.

| Method | Path | Auth |
| --- | --- | --- |
| `GET` | `/api/fleet/failover/settings` | admin |
| `PUT` | `/api/fleet/failover/settings` | admin |

### Fleet autoscaling

Automatic server scaling on csm machines: start stopped Ready Up servers ahead of the bracket, stop idle ones after a cool-down, create one when the pool is short. Settings, what the scaler sees, its activity, and a pass on request.

| Method | Path | Auth |
| --- | --- | --- |
| `GET` | `/api/fleet/autoscale` | admin |
| `PUT` | `/api/fleet/autoscale/settings` | admin |
| `POST` | `/api/fleet/autoscale/run` | admin |

### Test helpers (CS2)

E2E helpers that stand in for a CS2 server. Disabled in production unless ENABLE_TEST_ENDPOINTS is set.

| Method | Path | Auth |
| --- | --- | --- |
| `POST` | `/api/test/server-status` | admin |
| `POST` | `/api/test/fleet/reset-enroll-rate-limit` | admin |
| `POST` | `/api/test/fleet/age-token` | admin |
| `POST` | `/api/test/fleet/assign` | admin |
| `POST` | `/api/test/fleet/send` | admin |
| `GET` | `/api/test/fleet/live-state/:slug` | admin |
| `GET` | `/api/test/fleet/events/:serverId` | admin |
| `POST` | `/api/test/fleet/failover/scan` | admin |
| `GET` | `/api/test/fleet/commands/:id` | admin |

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
| `GET` | `/api/matches/played` | admin |
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
| `GET` | `/api/tournament/current-id` | public |
| `POST` | `/api/tournament/archive` | admin |
| `GET` | `/api/tournament/:id/leaderboard` | public |
| `GET` | `/api/tournament/allocation-status` | public |
| `GET` | `/api/tournament/game` | public |
| `GET` | `/api/tournament/:id/bracket` | public |
| `GET` | `/api/tournament/:id/banner` | public |
| `PUT` | `/api/tournament/banner` | admin |
| `DELETE` | `/api/tournament/banner` | admin |
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

### Tournaments

Every tournament: the list, creating another one, which is featured, archiving.

| Method | Path | Auth |
| --- | --- | --- |
| `GET` | `/api/tournaments` | public |
| `POST` | `/api/tournaments` | admin |
| `PUT` | `/api/tournaments/:id/feature` | admin |
| `DELETE` | `/api/tournaments/:id/feature` | admin |
| `POST` | `/api/tournaments/:id/archive` | admin |
| `POST` | `/api/tournaments/:id/teams` | admin |
| `DELETE` | `/api/tournaments/:id/teams/:teamId` | admin |

### Chat

Your match (both teams and the admins), your team and your party.

| Method | Path | Auth |
| --- | --- | --- |
| `GET` | `/api/chat/channels` | public |
| `GET` | `/api/chat/:channel/messages` | public |
| `POST` | `/api/chat/:channel/messages` | public |
| `POST` | `/api/chat/:channel/call-admin` | public |
| `POST` | `/api/chat/:channel/read` | public |

### Tournament sign-up

Teams signing themselves up with a lineup, and check-in on the day.

| Method | Path | Auth |
| --- | --- | --- |
| `GET` | `/api/tournament-signup/:id` | public |
| `GET` | `/api/tournament-signup/:id/me` | public |
| `POST` | `/api/tournament-signup/:id/remind` | public |
| `POST` | `/api/tournament-signup/:id/register` | public |
| `PUT` | `/api/tournament-signup/:id/lineup` | public |
| `DELETE` | `/api/tournament-signup/:id/registration/:teamId` | public |
| `POST` | `/api/tournament-signup/:id/check-in` | public |

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

### Leaderboard

Players ranked by their rating in one game. Public.

| Method | Path | Auth |
| --- | --- | --- |
| `GET` | `/api/leaderboard` | public |

### Team directory

Every team (public), and the signed-in player's own teams: list them, make one (one owned team per account).

| Method | Path | Auth |
| --- | --- | --- |
| `GET` | `/api/team-directory` | public |
| `GET` | `/api/team-directory/mine` | public |
| `POST` | `/api/team-directory/mine` | public |
| `GET` | `/api/team-directory/:teamId` | public |
| `GET` | `/api/team-directory/:teamId/profile` | public |
| `GET` | `/api/team-directory/invite/:code` | public |
| `POST` | `/api/team-directory/invite/:code` | public |
| `GET` | `/api/team-directory/:teamId/logo` | public |
| `GET` | `/api/team-directory/:teamId/manage` | public |
| `PATCH` | `/api/team-directory/:teamId` | public |
| `PUT` | `/api/team-directory/:teamId/logo` | public |
| `DELETE` | `/api/team-directory/:teamId/logo` | public |
| `POST` | `/api/team-directory/:teamId/invite` | public |
| `POST` | `/api/team-directory/:teamId/requests/:uid/accept` | public |
| `POST` | `/api/team-directory/:teamId/requests/:uid/decline` | public |
| `PATCH` | `/api/team-directory/:teamId/members/:uid` | public |
| `DELETE` | `/api/team-directory/:teamId/members/:uid` | public |
| `POST` | `/api/team-directory/:teamId/invites` | public |
| `POST` | `/api/team-directory/:teamId/invites/answer` | public |
| `DELETE` | `/api/team-directory/:teamId/invites/:uid` | public |
| `POST` | `/api/team-directory/:teamId/transfer` | public |
| `DELETE` | `/api/team-directory/:teamId` | public |

### Settings

Instance-wide settings.

| Method | Path | Auth |
| --- | --- | --- |
| `GET` | `/api/settings/version` | public |
| `GET` | `/api/settings` | admin |
| `PUT` | `/api/settings` | admin |

### Sign-in providers

Steam, Discord, Google, GitHub and Twitch sign-in, set up from Settings -> Sign-in. Admin only; secrets are write-only.

| Method | Path | Auth |
| --- | --- | --- |
| `GET` | `/api/sign-in-providers` | admin |
| `GET` | `/api/sign-in-providers/admin-access` | admin |
| `PUT` | `/api/sign-in-providers/admin-access` | admin |
| `PUT` | `/api/sign-in-providers/:provider` | admin |
| `POST` | `/api/sign-in-providers/:provider/test` | admin |

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
| `POST` | `/api/me/connections/steam/merge` | public |
| `POST` | `/api/me/connections/steam/merge/cancel` | public |

### Compatibility

Ready Up compatibility with the latest CS2 build: the runs its CI reports (token-guarded push), and public reads for the /compatibility page and a shields.io badge. 404 unless COMPAT_INGEST_TOKEN or COMPAT_FEED_URL is set.

| Method | Path | Auth |
| --- | --- | --- |
| `POST` | `/api/compat/events` | compat ingest token |
| `GET` | `/api/compat/latest` | public |
| `GET` | `/api/compat/runs` | public |
| `GET` | `/api/compat/badge.json` | public |

### Admin calls

Players calling for an admin from a game server (CS2: `.admin [message]` in Ready Up, sent as the admin_called event): list open and recently resolved calls, resolve one or all. Admin only. Live updates go to signed-in admins as the Socket.IO events admin:call and admin:call:resolved.

| Method | Path | Auth |
| --- | --- | --- |
| `GET` | `/api/admin-calls` | admin |
| `POST` | `/api/admin-calls/resolve-all` | admin |
| `GET` | `/api/admin-calls/:id` | admin |
| `POST` | `/api/admin-calls/:id/resolve` | admin |

### License

The Auto Tournament license key: save, remove and read its status, checked offline; and the one-time acceptance of the license terms (non-commercial or commercial use) that the admin UI waits for. Admin only, except the public badge. Nothing else is ever blocked: a missing or problematic key is a notice for admins.

| Method | Path | Auth |
| --- | --- | --- |
| `GET` | `/api/license/badge` | public |
| `GET` | `/api/license` | admin |
| `PUT` | `/api/license` | admin |
| `DELETE` | `/api/license` | admin |
| `PUT` | `/api/license/public-badge` | admin |
| `POST` | `/api/license/event-prompt` | admin |
| `GET` | `/api/license/consent` | admin |
| `POST` | `/api/license/consent` | admin |

### Webhooks

Integrator webhooks: register endpoints for match events (ready to connect, live, map and score, finished, cancelled, reset), rotate the signing secret, send a test event, read the delivery log (connect details redacted) and resend. Admin only. See docs/WEBHOOKS.md.

| Method | Path | Auth |
| --- | --- | --- |
| `GET` | `/api/webhooks` | admin |
| `GET` | `/api/webhooks/event-types` | admin |
| `POST` | `/api/webhooks` | admin |
| `GET` | `/api/webhooks/deliveries/:deliveryId` | admin |
| `POST` | `/api/webhooks/deliveries/:deliveryId/resend` | admin |
| `GET` | `/api/webhooks/:id` | admin |
| `PATCH` | `/api/webhooks/:id` | admin |
| `DELETE` | `/api/webhooks/:id` | admin |
| `POST` | `/api/webhooks/:id/rotate-secret` | admin |
| `POST` | `/api/webhooks/:id/test` | admin |
| `GET` | `/api/webhooks/:id/deliveries` | admin |

### Integrations: teams

Teams API for integrators: idempotent upsert of teams by the integrator's own externalId (single and batch), and reads by externalId. Integrator token (API_TOKENS_INTEGRATOR), admin token or admin session. See docs/WEBHOOKS.md.

| Method | Path | Auth |
| --- | --- | --- |
| `GET` | `/api/integrations/teams` | integrator token or admin |
| `POST` | `/api/integrations/teams/batch` | integrator token or admin |
| `GET` | `/api/integrations/teams/:externalId` | integrator token or admin |
| `PUT` | `/api/integrations/teams/:externalId` | integrator token or admin |

### Experimental features

Work in progress that ships dark: list the experimental features and turn one on or off. Off by default; an environment variable (e.g. EXPERIMENTAL_MATCHMAKING=1) overrides the admin toggle. Admin only; writes must be same-site JSON.

| Method | Path | Auth |
| --- | --- | --- |
| `GET` | `/api/experimental` | admin |
| `PUT` | `/api/experimental/:id` | admin |

### Matchmaking

Experimental (docs/design/matchmaking.md). 404 unless the matchmaking feature is on; admin only while it is being built.

| Method | Path | Auth |
| --- | --- | --- |
| `GET` | `/api/matchmaking/status` | admin |
| `GET` | `/api/matchmaking/me` | public |
| `POST` | `/api/matchmaking/party` | public |
| `POST` | `/api/matchmaking/party/join` | public |
| `POST` | `/api/matchmaking/party/leave` | public |
| `POST` | `/api/matchmaking/queue` | public |
| `DELETE` | `/api/matchmaking/queue` | public |
| `POST` | `/api/matchmaking/lobbies/:id/accept` | public |
| `POST` | `/api/matchmaking/lobbies/:id/decline` | public |
| `GET` | `/api/matchmaking/lobbies/:id` | public |
| `GET` | `/api/matchmaking/matches/:slug/result` | public |
| `PUT` | `/api/matchmaking/matches/:slug/commends/:playerId` | public |
| `GET` | `/api/matchmaking/players/:id/progress` | public |
| `GET` | `/api/matchmaking/leaderboard` | public |
| `GET` | `/api/matchmaking/players/:id/history` | public |
| `POST` | `/api/matchmaking/admin/players/:id/xp` | admin |
| `PUT` | `/api/matchmaking/admin/settings` | admin |
| `GET` | `/api/matchmaking/admin/queue` | admin |
| `GET` | `/api/matchmaking/admin/commends/review` | admin |
| `DELETE` | `/api/matchmaking/admin/players/:id/cooldown` | admin |

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
| `POST` | `/api/test/steam-link/start` | public |
| `POST` | `/api/test/steam-link/callback` | public |
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
| `POST` | `/api/test/webhook-sink/:bin` | public |
| `GET` | `/api/test/webhook-sink/:bin/url` | admin |
| `POST` | `/api/test/webhook-sink/:bin/behaviour` | admin |
| `GET` | `/api/test/webhook-sink/:bin` | admin |
| `DELETE` | `/api/test/webhook-sink/:bin` | admin |
| `POST` | `/api/test/webhooks/timing` | admin |
| `POST` | `/api/test/webhooks/reconcile` | admin |
| `POST` | `/api/test/license-consent` | admin |
| `POST` | `/api/test/setup-code` | public |
| `POST` | `/api/test/setup-code/expire` | public |
| `POST` | `/api/test/clear-admins` | public |
| `POST` | `/api/test/login-throttle/reset` | public |
| `POST` | `/api/test/env-import` | public |
| `GET` | `/api/test/oidc/.well-known/openid-configuration` | public |

### Setup

First-admin setup and reset-admin recovery with a one-time code. 404 once an admin exists.

| Method | Path | Auth |
| --- | --- | --- |
| `GET` | `/api/setup/status` | public |
| `POST` | `/api/setup/check` | public |
| `POST` | `/api/setup/complete` | public |

### Local admin login

Username + password (+ TOTP) sign-in for local admin accounts, and TOTP enrolment.

| Method | Path | Auth |
| --- | --- | --- |
| `GET` | `/api/auth/local/status` | public |
| `POST` | `/api/auth/local/login` | public |
| `GET` | `/api/auth/local/me` | admin |
| `POST` | `/api/auth/local/totp/start` | admin |
| `POST` | `/api/auth/local/totp/confirm` | admin |
| `POST` | `/api/auth/local/reauth` | public |

### Auth

Sign-in flows, admin identity, impersonation.

| Method | Path | Auth |
| --- | --- | --- |
| `GET` | `/api/auth/steam` | public |
| `GET` | `/api/auth/steam/callback` | public |
| `POST` | `/api/auth/logout` | public |
| `GET` | `/api/auth/oidc` | public |
| `POST` | `/api/auth/oidc/link` | public |
| `GET` | `/api/auth/oidc/callback` | public |
| `GET` | `/api/auth/discord` | public |
| `POST` | `/api/auth/discord/link` | public |
| `GET` | `/api/auth/discord/callback` | public |
| `GET` | `/api/auth/github` | public |
| `POST` | `/api/auth/github/link` | public |
| `GET` | `/api/auth/github/callback` | public |
| `GET` | `/api/auth/google` | public |
| `POST` | `/api/auth/google/link` | public |
| `GET` | `/api/auth/google/callback` | public |
| `GET` | `/api/auth/twitch` | public |
| `POST` | `/api/auth/twitch/link` | public |
| `GET` | `/api/auth/twitch/callback` | public |
| `GET` | `/api/auth/epic` | public |
| `POST` | `/api/auth/epic/link` | public |
| `GET` | `/api/auth/epic/callback` | public |
| `POST` | `/api/auth/steam/link` | public |
| `GET` | `/api/auth/providers` | public |
| `GET` | `/api/auth/me` | public |
| `POST` | `/api/auth/self-register` | public |
| `GET` | `/api/auth/admin-status` | public |
| `GET` | `/api/auth/admin/me` | public |
| `POST` | `/api/auth/admin/logout` | public |
| `GET` | `/api/auth/impersonate` | admin |
| `POST` | `/api/auth/impersonate` | admin |
| `POST` | `/api/auth/impersonate/stop` | admin |
