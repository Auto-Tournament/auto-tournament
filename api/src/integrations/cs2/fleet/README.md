# Fleet link (Ready Up servers): platform side

The platform end of `readyup.fleet.v1`, the WebSocket link a Ready Up CS2
server keeps open to `/api/fleet/ws`. Design: Ready Up's
[`docs/FLEET.md`](https://github.com/Auto-Tournament/ready-up/blob/master/docs/FLEET.md);
the platform task list for match control is its
[`docs/fleet-step3-platform-notes.md`](https://github.com/Auto-Tournament/ready-up/blob/master/docs/fleet-step3-platform-notes.md)
("the notes" below). Local setup: [`docs/fleet-dev.md`](../../../../../docs/fleet-dev.md).

This file is for whoever builds on it (the fleet `ServerDriver`, allocation,
admin actions): what exists, and the calls to use.

## Files

| File | What |
|---|---|
| `protocol/v1/` | JSON Schemas (normative, D18) + `types.ts` + ajv validators (`index.ts`) |
| `gateway.ts` | the socket: auth, hello/welcome, seq/ack, resume, heartbeat |
| `bus.ts`, `service.ts` | `FleetBus` (`fleetBus()`): the only way to write to a server |
| `registry.ts` | servers, tokens, enrollment, the outbox (`cs2_fleet_*`) |
| `reliable.ts` | **`sendReliable`**: platform → server messages that must arrive |
| `commands.ts` | the answers (`cmd.result`) to those messages |
| `inbound.ts` | server → platform: persist-before-ack, apply, hooks (`fleetInbound`) |
| `state.ts` | **the live match state store** (`liveStateStore`) |
| `mergePatch.ts` | RFC 7386 merge patch, diff for the drift check |
| `normalize.ts` | fleet `event.*` → `NormalizedEvent[]` (pure) |
| `ingest.ts` | normalize → `events/matchEvents.applyNormalizedEvents` → `matchLifecycle.ingest` |
| `link.ts` | which `cs2_servers` row a fleet server plays matches as (`transport = 'fleet'`) |
| `address.ts` | where players connect (pure): admin override, `hello.host.public_addr`, the csm machine's address (`host.inventory.address`), the link's peer address after the trusted proxy hops; never the hello `hostname` |
| `assignConfig.ts` | the served match config → `match.assign.config` (typed `rules`, engine `cvars`), roster diff (pure) |
| `driver.ts` | **the fleet driver**: assign / unassign / update / cmd, link hooks (see below) |
| `backups.ts` | **the round backup store** (`roundBackupStore`): `event.backup` in (checked, parts joined, newest per round), retention |
| `restore.ts` | **"restore to round N"**: `cmd restore_round` with the backup inline (or `css_restore` over RCON), audited; `inlineBackupFor` |
| `demoStream.ts` | **the demo stream receiver**: `demo.begin` / `demo.chunk` / `demo.end` in, `demo.ack` out; stored and linked like an uploaded demo |
| `serverNotices.ts` | `server.cs2_update_required` (logged, kept in `cs2_fleet_events`) and `server.selftest` (stored on `cs2_fleet_servers.selftest`) in |
| `limits.ts` | per-server byte budgets and the demo stream knobs (env) |
| `protocol/host/v1/`, `hosts/` | the host channel for csm (FLEET.md §18), see the last section |
| `push/` | server-level pushes: `admins.set`, `server.config` + `cmd settings.set`, whitelist / practice / plugins, `match.update` roster edits (below) |
| `failover.ts`, `failoverPlan.ts`, `failoverSettings.ts` | **failover** (FLEET.md §11): a server that dies or hangs mid-match, the match resumed from its last round backup, in place or on another server (below) |
| `autoscale/` | automatic scaling of Ready Up servers on csm machines: start ahead of the bracket, stop after a cool-down, create when short (last section) |

Tables (migration `006-fleet-match` in `../migrations.ts`):
`cs2_servers.transport` (`'rcon'` default | `'fleet'`) + `cs2_servers.fleet_server_id`
(→ `cs2_fleet_servers.id`, unique), `cs2_match_live_state`, `cs2_fleet_events`,
`cs2_fleet_commands`. Migration `010-fleet-driver`: `cs2_fleet_assignments`
(epoch, server, connect password, acked config per match) and `cs2_fleet_audit`
(root `exec`). `transport = 'fleet'` is set by linking a server
(`POST /api/fleet/servers/:id/link`, the Servers page's "Use for matches").
Two links happen on a server's first hello instead (`push/controls.ts`,
once each, so an admin's unlink sticks): a server csm created from an admin's
Create server (an existing `cs2_servers` row means it was linked before), and
a server enrolled with a fleet key created with `autoLink: true`
(`cs2_fleet_enrollment_keys.auto_link`, migration `032-fleet-key-auto-link`;
`cs2_fleet_servers.auto_linked_at` marks the link, so deleting the server
sticks too). A revoked or expired key links nothing.
The linked row's `host` / `port` are the connect address (`address.ts`,
FLEET.md §6.1): each hello refreshes them (`syncLinkedAddress`) unless
`cs2_servers.host_override = 1` (an admin set them: `host` / `port` on the
link, `PUT /api/fleet/servers/:id/address`, the server editor, or linking an
existing RCON row). `cs2_fleet_servers.peer_addr` is the client address of the
last hello or enrollment (migration `012-fleet-connect-address`).

## Sending: `sendReliable(serverId, { type, payload, epoch? })`

```ts
import { sendReliable, awaitCommandResult } from './reliable';
import { liveStateStore } from './state';

const { epoch } = await liveStateStore.beginAssignment(slug, serverId, 1);
const sent = await sendReliable(serverId, {
  type: 'match.assign',
  payload: { match_id: slug, epoch, config_rev: 1, config },
});
const answer = await awaitCommandResult(sent.id, 15_000); // null on timeout
if (answer?.status === 'rejected') { /* answer.errorCode: busy | invalid_config | stale_epoch | … */ }
```

- Types: `match.assign`, `match.update`, `match.unassign`, `cmd`,
  `admins.set`, `skins.loadout`, `skins.invalidate`, `server.config`.
- The payload is schema-checked first; an invalid one throws `FleetSendError`
  (it never reaches the outbox).
- Match-scoped messages (`match.*`, `cmd` with `match_id`) need the epoch;
  it is taken from `epoch` or `payload.epoch` and written to the **envelope**
  (Ready Up reads both; they must agree).
- The message is appended to the server's outbox (seq in the same
  transaction), sent now if the server is online, and replayed after every
  reconnect until acked. Result: `{ id, seq, delivered, answered }`.
- `match.*` and `cmd` get exactly one `cmd.result` (envelope `ref` = `id`).
  The row in `cs2_fleet_commands` is written before the send, so the answer
  always finds it. `awaitCommandResult(id, ms)`, `getCommand(id)`,
  `listCommands(slug)`; `fleetInbound.onCommandResult(fn)` for every answer.
- `cmd.expires_at` (unix ms, 0 = never) is also the outbox expiry; the
  server answers an expired command `expired`.
- A `match.update` answer's `rev` (the new config_rev, or the server's on
  `conflict`) is stored as the record's `configRev`: the next
  `base_config_rev`.
- `requestSnapshot(serverId, epoch?)` sends an ephemeral `state.request`
  (only when online). The gateway already does this on its own for a rev gap.

## The driver (`driver.ts`, `../driver.ts`)

The CS2 pool (`../allocation.ts`) goes through `driverFor(serverId)`
(`../driver.ts`): `rconDriver` is the MatchZy Enhanced path as it was,
`fleetDriver` this one. A `ServerDriver` has `loadMatch`, `cancelQueuedLoad`,
`checkIdle`, `endMatch`, `resetServer`, `stopForReload`, `releaseForMove`,
`seriesDone`.

| Platform action | Fleet |
|---|---|
| allocate / load | `assignMatch`: config from the served match config (`assignConfig.ts`), new epoch (`beginAssignment`), new password, `match.assign`, wait for `cmd.result` (15 s, `FLEET_ASSIGN_TIMEOUT_MS`). `busy` / `draining` / no answer → the pool tries the next server; no answer is also unassigned so it cannot start later |
| series over (core `release`) | `match.unassign {ended}` (kick after Ready Up's series-end delay) |
| force-cancel | `match.unassign {cancelled}` + kick message |
| tournament restart / reset / delete | `match.unassign {admin}` for every open assignment |
| restart in place | `match.unassign {admin}`, then a new assign (new epoch) |
| move | `match.unassign {moved}` + "Match moved…" kick |
| roster / names | `syncMatch` / `addPlayer` → `match.update` (CAS on config_rev, one retry on `conflict`) |
| admin buttons (`/api/rcon/*`) | `runFleetCommand` → `cmd`, the route answers with the `cmd.result`; raw commands → `exec`, root only (the setup admin, Admin Steam IDs in Settings → Sign-in, or an admin API token), audit row first |

Allocation: a linked server is free when its socket is up, it reports
`available`, the database has no loaded/live match on it, and turnover holds
nothing (`event.series_end`, `event.demo` feed `serverTurnoverTracker`). A
server that announced `demo.stream.v1` is assigned with `rules.demo.upload`
and held until `demoStream.ts` has each recorded map's demo.

Hooks (`startFleetDriver`, from `../startup.ts` before the gateway):
`welcome.assignment` = the open assignment whose epoch the server holds
(reconnect mid-match resumes); a `hello.state` or events with an epoch below
the match's → `match.unassign {superseded}` (once per server/match/epoch);
`event.admin_called` → the core's admin calls; `server.availability
available` → an allocation pass.

The connect password (`connectPasswordFor`) is in
`/api/game/cs2/matches/:slug/connect` for the roster and admins only.

## The live state store: `liveStateStore` (`state.ts`)

One `LiveMatchRecord` per match slug (`= match_id`):
`{ matchSlug, epoch, serverId, liveRev, configRev, state: MatchState | null,
mapStats, mapRounds: { "<map>": RoundSummary[] }, needsSnapshot, updatedAt }`.

| Call | Use |
|---|---|
| `getLiveState(slug)` | the record, or null (also exported as `getLiveState`) |
| `listForServer(serverId)` | matches whose current epoch that server holds |
| `beginAssignment(slug, serverId, configRev = 1)` | **new epoch** (max + 1, ≥ 1) for a (re)assignment; clears the state. Use its `epoch` in `match.assign`. |
| `setConfigRev(slug, rev)` | set the CAS base (done automatically for `match.update` answers) |
| `onLiveStateChange(fn)` | `{ matchSlug, cause: 'assign' \| 'snapshot' \| 'patch' \| 'rounds' \| 'config', type?, record }` after every stored change; returns the unsubscribe |

Rules (the notes §3), applied by the gateway through `inbound.ts`:

- `state.snapshot` replaces the state when its epoch is ≥ the stored one
  (lower = `stale_epoch`, ignored). `periodic` / `hello` at the same
  `live_rev` are a drift check (logged). `state: null` = idle server.
  `map_stats`, when present, seeds that map's round summaries.
- `state.patch` / `event.*`: `rev == liveRev + 1` applied, `rev <= liveRev`
  duplicate, `rev > liveRev + 1` gap → held + `state.request`; the snapshot
  releases the held patches that follow on from it. No state yet for the
  epoch (before the `assign` snapshot) is handled like a gap.
- Epoch fence: an envelope epoch below the match's current one is ignored
  (the event is not ingested either); `fleetInbound.onEvent` still reports
  it with `patch: 'stale_epoch'` so the driver can unassign the zombie.

## Receiving: `inbound.ts`

Reliable server messages (`cmd.result`, `state.patch`, `event.*`,
`server.availability`, `skins.stattrak`) are written to `cs2_fleet_events`
(unique per server + stream id + seq) **in the same transaction as the
stream position**, then acked, then applied; `processed_at` is set after,
`error` when applying failed. Rows a crash left unapplied are applied at the
server's next hello, before its replay.

Hooks on `fleetInbound` (each returns its unsubscribe):

| Hook | When |
|---|---|
| `onEvent({ serverId, envelope, patch, record })` | every `event.*`, after state + ingest. The driver's inputs: `event.backup` (backup store), `event.demo` (turnover), `event.match_restored`, `event.rounds_voided`, `event.forfeit` / `event.gg`, `event.admin_called`, `event.knife_result` / `event.side_picked` (fix `maps[n].sides` for a failover), `event.error` |
| `onCommandResult({ serverId, envelope, result, command })` | every `cmd.result` |
| `onAvailability({ serverId, availability, reason })` | `server.availability` (also stored on `cs2_fleet_servers.availability`) |
| `onSnapshot({ serverId, payload, outcome })` | every `state.snapshot` (`outcome.kind`: `replaced` / `idle` / `stale_epoch`) |
| `onStattrak({ serverId, payload })` | `skins.stattrak` |

## Failover (`failover.ts`, `failoverPlan.ts`, `failoverSettings.ts`)

FLEET.md §11. Automatic by default; an admin can turn it off (then each
recovery waits for "Move match" on the match page). Table (migration
`013-fleet-failover`): `cs2_fleet_failovers`, one row per failover, which is
also its record; settings are the `failover` row of `cs2_fleet_lists`.

- **Detection** (`scanForFailovers`, every `FLEET_FAILOVER_CHECK_MS` = 10 s,
  and after hellos and `host.health`): a match with an acked, open
  assignment that is `loaded` / `live` whose server's link has been down for
  90 s live / 30 s before live (`FLEET_FAILOVER_LIVE_SECONDS`,
  `FLEET_FAILOVER_PRELIVE_SECONDS`; the gateway already closes a socket after
  30 s without a frame), or that csm reports `exited` / `crashed` / `hung`.
  Nothing between maps or after the series. The link's clock starts no
  earlier than the platform's own start.
- **Recovery order**: the server back within the grace period with the match
  = nothing to do; back *without* it (crashed, restarted) = a `restarted`
  failover: `match.assign` + `resume` to the same server (same address);
  else a free fleet server (`pickTarget`: same CS2 build and capabilities
  first; the reserve included); none free = the failover stays open, every
  pass tries again, and the match page shows it.
- **The move** (`acceptFailover`): old epoch fenced first (`fenceEpoch`:
  `match.unassign {superseded}` with the "Match moved" kick into its outbox,
  so a dead server gets it when it comes back; the driver's hello check then
  sends nothing more), `matches.server_id` = the new server, `assignMatch(slug,
  server, { resume })`: new epoch and password, `resume` = the latest round
  backup of the current map that no restore voided (`pickBackup`) inline, or
  `backup_ref` when it is too large for one frame; no backup yet = round 0
  (the map restarts from warmup, a decided knife kept via `sides`), plus the
  series score and earlier maps from the last state (`buildResume`). A live
  match stays `live`. `emitMatchUpdate` + `bracket:update` tell the match
  page; the connect route returns the new address, password and `moved`.
  A refused or unanswered assign puts the failover back to `open` and the
  match back on the old row; auto-failover then skips that server for it.
  `cs2_fleet_audit` gets a line per move.
- **Reserve** (`failoverSettings.ts`): idle fleet servers normal allocation
  leaves alone (`getAvailableServers()` without `includeFleetReserve`):
  the admin's number, else 1 once two linked servers are online; never the
  whole pool. Reserve servers count toward the license like any server.
- Routes (`../routes/failover.ts`): `GET /api/game/cs2/matches/:slug/failover`,
  `POST …/failover/:id/accept`, `…/:id/dismiss`, `…/failover/move` (move a
  fleet match now: another pick, or back), `GET|PUT /api/fleet/failover/settings`.
  Client: `match/FailoverPanel.tsx` (match admin), `servers/FailoverSettingsPanel.tsx`.
- Not built here: asking csm to restart the server first, or to create one
  when none is free.

## Round backups and restore (`backups.ts`, `restore.ts`)

Tables (migration `007-round-backups`): `cs2_match_round_backups` (one row
per match + fleet map number + round, the file base64 in `data`),
`cs2_match_round_backup_parts` (parts until a split file is complete),
`cs2_match_round_restores` (the audit log).

- `startRoundBackups()` (from `../startup.ts`) listens on
  `fleetInbound.onEvent`: `event.backup` is checked (base64, `size`,
  `sha256`) and stored; the same file again changes nothing, another file
  for the round replaces it; a stale-epoch server's backups are ignored.
  `event.rounds_voided` marks the later rounds `supersededAt`. Retention:
  `FLEET_BACKUP_RETENTION_DAYS` (default 14, 0 = forever) after the match
  ended; hourly.
- `roundBackupStore.list(slug)` / `.get(slug, map, round)`;
  `inlineBackupFor(slug, map, round)` is the `InlineBackup` for a failover
  `match.assign.resume.backup` (null when the file is too large for one
  frame: send `backup_ref` to the server that has it).
- `restoreRoundBackup(defaultRestoreDeps(), { matchSlug, mapNumber, round, actor })`
  writes the audit row (its id is `cmd.audit_id`), sends `cmd restore_round`
  with the backup inline to the server of the match's current epoch
  (expires after 2 min), and waits for the `cmd.result`; a late answer
  settles the row (`startRestoreAudit`). A match with no live assignment
  but a `matches.server_id` restores over RCON (`css_restore <round>`).
- Routes (`../routes/roundBackups.ts`, admin):
  `GET /api/game/cs2/matches/:slug/round-backups`,
  `POST /api/game/cs2/matches/:slug/round-backups/restore { mapNumber?, round }`.
  Client: `matchPanels.adminMatchView` (CS2 `RoundBackupsPanel`).

## Demo streaming (`demoStream.ts`)

Ready Up streams the GOTV demo while it records (FLEET.md §12.2, §12.4;
schemas `protocol/v1/messages/demo.*.json`, examples in
`tests/fixtures/fleet/v1/demo.*.json`). The receiver is registered with
`registerInboundHandler` (all three types on the low-priority chain) by
`startDemoStreams()` in `../startup.ts`.

- **Where**: bytes go to `DATA_DIR/demos/.incoming/<demo_id>.part` at the
  chunk offsets (synced before the ack); a verified demo moves to
  `DATA_DIR/demos/<match>/map<N>/<file>` (N 1-based) and
  `utils/demoFiles.ts linkStoredDemo` points `matches.demo_file_path` and
  `match_map_results.demo_file_path` at it: the download, info and status
  routes (`routes/demos.ts`) and the match page see it like an HTTP upload.
- **Table** (migration `008-fleet-demo-streams`): `cs2_fleet_demo_streams`,
  one row per demo_id: server, match, map (platform, 0-based), epoch, part /
  final path, `received_offset` (contiguous bytes = the ack's offset), size,
  sha256, `state` (`receiving` / `complete` / `rejected`), timestamps.
- **Answers**: `offset` = bytes stored contiguously from 0; a chunk past it
  → `gap`; below it overwrites; `demo.end` with size + sha256 matching →
  `complete: true` (again for a repeat); mismatch → copy discarded,
  `checksum` (Ready Up restarts with `restart: true`). `unknown_demo`,
  `not_assigned` (the server never held the match: `cs2_match_live_state` or
  a `match.assign` in `cs2_fleet_commands`), `stale_epoch` (it held another
  epoch), `too_large` (`FLEET_DEMO_MAX_BYTES`, 2 GiB), `storage` (disk / DB).
- **Turnover**: a stored (or refused) demo reports `demo_upload_ended` for
  its map to `serverTurnoverTracker` (as the plugin's upload event does);
  `onFleetDemo(fn)` announces `stored` / `refused` to the driver.
- **Rate**: acks are paced to `FLEET_DEMO_BYTES_PER_MINUTE` (64 MiB) per
  server; a server whose hello lists `demo.stream.v1` gets a socket budget of
  `FLEET_BYTES_PER_MINUTE` (8 MiB) + that + 4 MiB slack (`limits.ts`).
- **Cleanup**: unfinished streams idle for `FLEET_DEMO_STREAM_EXPIRE_DAYS`
  (7) are deleted with their part files, hourly.

## Extension point: more server message types

New server → platform types plug in without touching the gateway (the demo
stream above is built this way):

```ts
import { registerInboundHandler } from './inbound';

registerInboundHandler('demo.chunk', {
  priority: 'low', // ephemeral + low: own per-session chain, never delays event.* / state.patch
  validate: (p) => (isChunk(p) ? null : 'bad chunk'), // only needed when protocol/v1 has no schema for it
  async handle(ctx, env) {
    const offset = await storeChunk(ctx.serverId, env.payload);
    ctx.sendEphemeral('demo.ack', { demo_id: env.payload.demo_id, offset });
  },
});
```

- **Reliable** (with `seq`) extension messages run in stream order on the
  session's main queue and are acked after the handler; `persist: true`
  stores them in `cs2_fleet_events` first (keep it off for bulk data).
- **Ephemeral** ones run on the main queue, or with `priority: 'low'` on a
  separate per-session chain (bulk data with its own application-level acks
  and resume-from-offset, as demo chunks).
- **Schemas**: add `messages/<type>.json` + a `FLEET_MESSAGE_SCHEMAS` /
  `FLEET_MESSAGES` entry (D18). The gateway validates known types itself, and
  it **refuses to send** a type it has no schema for (`frame()` self-check),
  so `demo.ack` needs its schema before `sendEphemeral('demo.ack', …)` works.
- **Framing / limits**: frames are JSON text only (binary frames close the
  session with 4400), at most 1 MiB (`MAX_FRAME_BYTES`): binary data goes
  base64 in the payload (≤ ~700 KiB raw per frame). Every frame counts against
  the per-server `RATE` in `gateway.ts` (50 msg/s, burst 200) and the
  socket's byte budget (`limits.ts`: 8 MiB/min, more for `demo.stream.v1`).
- **Outbound**: the platform's reliable stream (outbox) is one ordered
  stream; bulk platform → server data should be ephemeral with its own acks,
  not `sendReliable`.

## Server-level pushes: `push/`

What the platform sends a server outside the match flow (FLEET.md §7.3-§7.5).
Tables (migration `011-fleet-server-prefs`): `cs2_fleet_lists` (one row per
fleet-wide list: `admins`, `server_config`, with its rev and data) and
`cs2_fleet_server_prefs` (per server: settings override, whitelist /
practice / plugins, and `pushed`: what went out when).

| What | When it is sent |
|---|---|
| `admins.set {rev, admins}` (`push/admins.ts`) | website admins (`players.is_admin`, Steam64 only) + extra in-game admins; rev bumped when the list's hash changes. To every enrolled server on a change (player service signal `services/adminListEvents`, a 60 s re-check, the Servers page); after a hello whose `admins_rev` is not ours, unless that rev is still in the server's outbox; a hello with a higher rev raises ours above it |
| `server.config {rev, settings}` + `cmd settings.set` (`push/settings.ts`) | fleet default + per-server override (nested merge). On save (default: every enrolled server; override: that server); after a hello when the server's last push is not the current rev |
| `cmd whitelist.set / practice.set` (`push/controls.ts`) | from the Servers page only; the route waits 5 s for the `cmd.result` |
| `cmd plugins.set` (`push/controls.ts`, `push/pluginSets.ts`) | a plugin set (preset Tournament / Practice / Fun, or custom; `fleet` always on; Practice turns `match` off and sends `practice.set {on, always}` on Ready Up with `fleet.cmds.v1`, and a server with match off gets no matches) from the Servers page; after the first hello of a server csm created, the set its `server.create` carried (`meta.plugins`: the create's own, else the fleet default `plugins_default` row of `cs2_fleet_lists`); after a hello whose `plugins_state` differs from the stored set, unless that push is still in the outbox. A create whose set needs more than csm's essentials bundle installs the full one (`bundle: skins`) |
| `match.update` (`push/matchUpdate.ts`) | from the match admin page: add / remove / substitute / rename, CAS on the live record's `configRev`; `ok` also updates `matches.config`, a `conflict` moves the base (the admin retries) |

welcome's `admins_rev` / `server_config_rev` are the current revs
(`setFleetWelcomeRevs`); `onFleetServerReady(fn)` (service.ts) gets each
server's hello after welcome. Routes: `push/routes.ts` (`/api/fleet/admins`,
`/settings`, `/plugins`, `/plugins/default`, `/servers/:id/push|settings|whitelist|practice|plugins`,
`/matches/:slug/roster|update`).

## How events reach the core

```
event.* ──> gateway ──> inbound.persistInbound (cs2_fleet_events) ──> ack
                     └> inbound.processInbound
                          ├> liveStateStore.applyPatch / recordRound / voidRounds
                          └> ingest.ingestFleetEvent
                               ├> normalize.normalizeFleetEvent   (pure, 1-based → 0-based maps)
                               └> events/matchEvents.applyNormalizedEvents
                                    (match status, current map, live score / stats, presence,
                                     stale-map + finished-match guards)
                                    └> core/matchLifecycle.ingest  (map.result, series.ended, …)
```

| Fleet | NormalizedEvent |
|---|---|
| `event.phase` → `live` from `loading` / `warmup` / `knife` / `side_pick` | `series.started` (map 1 only), `map.started`, `phase.changed` |
| `event.phase` (other) | `phase.changed` |
| `event.player_connect` / `_disconnect` / `_ready` / `_unready` | `presence.changed` |
| `event.round_start` | `score.updated` |
| `event.round_end` | `score.updated`, `player.stats` (map totals so far, from the stored round summaries) |
| `event.halftime` / `event.overtime` | `score.updated`, `phase.changed` |
| `event.pause` | `phase.changed` (`paused` / `live`) |
| `event.map_result` | `map.result` (with `seriesScore`), `player.stats` from `stats` (MapStats) |
| `event.series_end` | `series.ended` (`releaseAfterSeconds` = `seconds_until_reset`) |
| the rest | nothing; see the hooks |

Map numbers: fleet maps are 1-based (`map_number`, `series.current_map`,
MatchState `series.maps` keys); the platform's are 0-based. Use
`toPlatformMapNumber` / `toFleetMapNumber` (normalize.ts) at every boundary.
Dev-bot ids (`0xB0B0…`, `isDevBotId`) are dropped from stat lines unless the
match's `rules.simulation` is set.

## Host channel (csm): `hosts/`

CS2 Server Manager (csm) runs on each machine as its host agent and keeps one
WebSocket to `/api/fleet/host` (FLEET.md §18, D17). It does what happens to
the **process** (inventory, start/stop/restart, create, update CS2 and Ready
Up, logs); Ready Up's own link stays for the match.

| File | What |
|---|---|
| `protocol/host/v1/` | host JSON Schemas, adopted unchanged from csm's `protocol/host-v1/` (csm PR #66); csm copies them back from here |
| `hosts/gateway.ts` | the socket: same transport as `gateway.ts`; `hostEvents` (`online`, `offline`, `inventory`, `health`, `result`, `progress`) |
| `hosts/registry.ts` | machines, `rhs_` tokens, one-time machine codes, the outbox, commands, health (`cs2_fleet_host*`, migration `009-fleet-hosts`) |
| `hosts/service.ts` | **`sendHostCommand(hostId, type, payload, { issuedBy, force })`**, `awaitHostResult`, the inventory join, rotation, revoke |
| `hosts/join.ts` | pure: inventory ↔ Ready Up join (§18.3), command targets, new servers after a create |
| `hosts/routes.ts` | `/api/fleet/hosts*` (admin) and the `kind: "host"` branch of `POST /api/fleet/enroll` |

- **Enroll**: Servers → Machines → Add machine gives one command,
  `csm link <url> <code>`. csm posts `{kind: "host", code | key, machine_id,
  hostname, os, csm_version}` to `/api/fleet/enroll` and gets `rhs_…`. The
  same `machine_id` gets its record back. A fleet key (`rfk_`) enrolls a
  machine too, except the keys minted for a `server.create`.
- **Commands** (`POST /api/fleet/hosts/:id/commands {type, payload, force?}`)
  are recorded in `cs2_fleet_host_commands` (the audit row, `forced_by` /
  `force_reason` for a forced one), appended to the host's outbox and
  replayed until acked. Each gets one `host.result` (envelope `ref`);
  `host.progress` updates it on the way.
- **Match in progress**: a disruptive command (`server.stop/restart/remove/
  set_launch_args`, `host.update_game/update_plugins`) for a server whose
  inventory says `update_safe: false`, or whose Ready Up server is `busy`, is
  refused with 409 `match_in_progress` unless `force: {reason}` is given;
  csm refuses it too.
- **server.create**: the platform mints a fleet key per command (at most
  `count` servers, 24 h, revoked with the machine) and puts it in `enroll_key`
  when the message is written to the socket (never stored). csm's new servers
  have no Ready Up, so a successful create is followed by `host.update_plugins`
  (`latest`, `default`) for the new servers; they then self-enroll and join
  the machine by `install_id`.
- **Automatic updates** (`hosts/autoUpdate.ts`): every 5 minutes the
  platform checks each online machine. CS2 is behind when Steam's
  UpToDateCheck says `inventory.cs2.master_patch` is old (csm 1.20+), or a
  server printed csm's update marker. Ready Up is behind when a server last
  reported an older version than the newest release on its channel. Either
  sends `host.update_game` / `host.update_plugins` (issued by `platform`,
  `meta.auto`) naming the servers that may update: never one with a match in
  progress, only stopped ones while a tournament runs (hold `auto`), none
  when the machine's hold is `on`. Nothing is resent while one is in flight,
  or for the same target within 6 h (30 min after a failure). csm 1.20+ on an
  enrolled host no longer starts updates itself; its monitor only restarts
  idle servers onto what is installed. The admin page shows the last plan
  per machine (`autoUpdate`).
- **Inventory join** (§18.3): each `server-N` joins its Ready Up server on
  `readyup.install_id`, else `readyup.server_id`.

## Automatic scaling: `autoscale/`

Servers are thin and never deleted between matches: warm (running) or cold
(stopped). The scaler (`autoscale/scaler.ts`, a pass every
`FLEET_AUTOSCALE_INTERVAL_MS`, 15 s; 0 = no timer) keeps as many warm as the
bracket needs, through csm's `server.start` / `server.stop` / `server.create`
(`hosts/service.ts sendHostCommand`, `issued_by = 'autoscale'`).

| File | What |
|---|---|
| `autoscale/plan.ts` | pure: settings, `estimateSecondsLeft` (soonest a series can end), `computeDemand`, `planScaling` |
| `autoscale/settings.ts` | the `'autoscale'` row of `cs2_fleet_lists`; the failover reserve from the `'failover'` row |
| `autoscale/scaler.ts` | inputs (matches, live state, inventories, links, pending host commands), actions, the activity log, linking created servers |
| `autoscale/routes.ts` | `GET /api/fleet/autoscale`, `PUT /api/fleet/autoscale/settings`, `POST /api/fleet/autoscale/run` |

- **Managed**: an inventory `server-N` joined to a Ready Up server that is
  linked to an enabled `cs2_servers` row. Nothing else is touched.
- **Need** = matches on a Ready Up server + matches waiting for one (both
  teams known and free; standalone matches always) + matches that will be
  waiting within the lead time (their feeders, or their teams' current
  matches, can end by then per `estimateSecondsLeft` on the live state),
  for tournaments in progress; plus the failover reserve (failover's
  setting and `effectiveReserve`, over the managed pool) while anything needs
  a server.
  RCON matches are not the fleet's.
- **Warm** = running with Ready Up connected, booting (< 3 min), or a start
  in flight.
- **Short**: start cold servers (most free RAM first); still short, one
  `server.create {count: 1, enroll: true}` on an online machine with
  `servers.create`, fewer than the max servers, 3 GB RAM and 5 GB disk free.
  One create at a time: until its server is linked and in the inventory
  (15 min at most). Its Ready Up (installed by the create's follow-up)
  enrolls with the create's key and is linked by the next pass (once; an
  admin's unlink sticks).
- **Surplus**: stop the servers idle longest, once idle for the cool-down;
  never one that is busy (match loaded / live / being loaded, open
  assignment, turnover, `update_safe: false`), updating (pending
  `host.update_*` / restart), an open failover's target, or the spare
  failover would pick. csm refuses a stop during a match too.
- **Rate limit** (`limitActions`): per pass at most 8 starts and 2 stops,
  per machine at most 6 scaler commands a minute; the rest waits for the
  next pass (noted in the activity).
- **Audit**: every command is a `cs2_fleet_host_commands` row with
  `issued_by = 'autoscale'` and `meta.reason`; never forced.
- **License**: never blocks. Every created server is linked (an enabled
  row) and counts; the license page warns past the pack's server count.
- **Activity**: `cs2_fleet_autoscale_events` (migration `014-fleet-autoscale`,
  newest 500): start / stop / create / link, and a note when the pool is
  short and nothing more can be done. Settings default: on, 2 min lead,
  10 min cool-down, 4 servers per machine.
