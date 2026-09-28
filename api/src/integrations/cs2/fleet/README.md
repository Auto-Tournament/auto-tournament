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
| `assignConfig.ts` | the served match config → `match.assign.config` (typed `rules`, engine `cvars`), roster diff (pure) |
| `driver.ts` | **the fleet driver**: assign / unassign / update / cmd, link hooks (see below) |
| `backups.ts` | **the round backup store** (`roundBackupStore`): `event.backup` in (checked, parts joined, newest per round), retention |
| `restore.ts` | **"restore to round N"**: `cmd restore_round` with the backup inline (or `css_restore` over RCON), audited; `inlineBackupFor` |
| `demoStream.ts` | **the demo stream receiver**: `demo.begin` / `demo.chunk` / `demo.end` in, `demo.ack` out; stored and linked like an uploaded demo |
| `limits.ts` | per-server byte budgets and the demo stream knobs (env) |

Tables (migration `006-fleet-match` in `../migrations.ts`):
`cs2_servers.transport` (`'rcon'` default | `'fleet'`) + `cs2_servers.fleet_server_id`
(→ `cs2_fleet_servers.id`, unique), `cs2_match_live_state`, `cs2_fleet_events`,
`cs2_fleet_commands`. Migration `009-fleet-driver`: `cs2_fleet_assignments`
(epoch, server, connect password, acked config per match) and `cs2_fleet_audit`
(root `exec`). `transport = 'fleet'` is set by linking a server
(`POST /api/fleet/servers/:id/link`, the Servers page's "Use for matches").

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
(`../driver.ts`): `rconDriver` is the Auto Tournament CS2 path as it was,
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
| admin buttons (`/api/rcon/*`) | `runFleetCommand` → `cmd`, the route answers with the `cmd.result`; raw commands → `exec`, root only (`ADMIN_STEAM_IDS` or an admin API token), audit row first |

Allocation: a linked server is free when its socket is up, it reports
`available`, the database has no loaded/live match on it, and turnover holds
nothing (`event.series_end`, `event.demo` feed `serverTurnoverTracker`).

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
