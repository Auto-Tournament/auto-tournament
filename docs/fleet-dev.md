# Fleet link: local development

How to run the platform locally and connect a Ready Up server (or a test
client) to it over the fleet link. The design is
[`docs/FLEET.md` in Ready Up](https://github.com/Auto-Tournament/ready-up/blob/master/docs/FLEET.md);
this covers what the platform implements today (build step 1): enrollment,
server tokens, and the WebSocket handshake (`hello` / `welcome`, ping/pong,
seq/ack, token rotation).

## Where things are

| What | Where |
|---|---|
| JSON Schemas (normative, draft 2020-12) | `api/src/integrations/cs2/fleet/protocol/v1/` |
| TypeScript types for them | `api/src/integrations/cs2/fleet/protocol/v1/types.ts` |
| Enrollment + admin routes | `api/src/integrations/cs2/fleet/routes.ts` |
| WebSocket gateway, `FleetBus` | `api/src/integrations/cs2/fleet/gateway.ts`, `bus.ts` |
| Tables (`cs2_fleet_*`) | migration `003-fleet` in `api/src/integrations/cs2/migrations.ts` |
| Tests | `tests/api/fleet-*.spec.ts`, test client in `tests/helpers/fleet.ts` |

The schemas are plain JSON files. Ready Up's and csm's CI copy the folder
(`protocol/v1/**/*.json`) and validate the messages their serializers
produce. `$id`s are `https://auto-tournament.dev/fleet/v1/<path>`; message
schemas reference `../defs.json`, so load `defs.json` first.

| File | Validates |
|---|---|
| `envelope.json` | every frame |
| `messages/<type>.json` | the `payload` of that type: `hello`, `welcome`, `ping`, `pong`, `ack`, `error`, `auth.rotate`, `auth.rotated`, `server.config` (placeholder) |
| `http/enroll.request.json`, `http/enroll.response.json` | `POST /api/fleet/enroll` |

## Run the platform

You need Node 20+, Yarn 1 and a PostgreSQL 16.

```bash
git clone https://github.com/Auto-Tournament/auto-tournament.git
cd auto-tournament
yarn install
yarn db                 # PostgreSQL in Docker on :5432 (or point DB_* at your own)
cp example.env .env
```

Add these to `.env` for a dev instance you can drive from scripts:

```bash
PORT=3069
ENABLE_TEST_ENDPOINTS=true      # /api/test/* helpers (admin login, token ageing)
API_TOKENS=dev-admin:dev-admin-token-0123456789abcdef
STEAM_API_KEY=
```

Start the API from source (CS2, and so the fleet, is compiled in when run
this way):

```bash
yarn dev:server         # or: NODE_ENV=development npx tsx api/src/index.ts
curl http://localhost:3069/health
```

The log says `[FLEET] gateway listening on /api/fleet/ws` once it is up.

## Enroll a test server

All admin calls below use the service token from `API_TOKENS`:

```bash
API=http://localhost:3069
ADMIN='Authorization: Bearer dev-admin-token-0123456789abcdef'
```

### A. With a fleet key (what csm and CI use)

```bash
# 1. Create a key. The value is shown once.
curl -s -X POST $API/api/fleet/keys -H "$ADMIN" -H 'Content-Type: application/json' \
  -d '{"name":"ready-up-ci","namePrefix":"ci-"}'
# → {"success":true,"key":{...},"value":"rfk_xxxxxxxxxxxx_<43 chars>"}

# 2. Enroll (no admin auth: the key is the credential).
curl -s -X POST $API/api/fleet/enroll -H 'Content-Type: application/json' -d '{
  "key": "rfk_…",
  "install_id": "ci-0123456789abcdef",
  "name": "server-1",
  "host": { "hostname": "ci-host", "game_port": 27015 },
  "versions": { "core": "0.4.0", "plugin_api": "1.1", "plugins": { "fleet": "0.4.0" }, "cs2_build": 14032 }
}'
# → 201 {"success":true,"server_id":"fs_…","tenant_id":"default","name":"ci-server-1",
#        "token":"rus_…","ws_url":"ws://localhost:3069/api/fleet/ws","reenrolled":false}
```

Enrolling again with the same `install_id` returns the same `server_id` with
`reenrolled: true` and a new token; the old token stops working (4403).

### B. With a one-time code (what an admin does in the UI)

In the UI: **Servers → Ready Up fleet → Add server**. Or:

```bash
curl -s -X POST $API/api/fleet/servers -H "$ADMIN" -H 'Content-Type: application/json' -d '{"name":"lan-1"}'
# → 201 {"server":{"id":"fs_…","status":"pending",...},"code":"RUE-XXXX-XXXX-XXXX-XXXX","expiresAt":…}

curl -s -X POST $API/api/fleet/enroll -H 'Content-Type: application/json' \
  -d '{"code":"RUE-XXXX-XXXX-XXXX-XXXX","install_id":"lan-0123456789abcdef","host":{"hostname":"lan","game_port":27015}}'
```

Codes are single use, valid 15 minutes, and case/dash-insensitive
(`O`→`0`, `I`/`L`→`1`).

### Enrollment errors

| Status | `code` | Meaning |
|---|---|---|
| 400 | `invalid_request` | body fails `enroll.request.json` (`details` lists why) |
| 401 | `invalid_code` / `invalid_key` | unknown, used or expired code; wrong key |
| 403 | `key_revoked` / `key_expired` / `key_locked` | key unusable (locked after 5 wrong secrets) |
| 403 | `server_revoked` | this `install_id` was revoked; an admin must remove it first |
| 409 | `key_limit` | the key's `maxServers` is reached |
| 429 | `rate_limited` | more than 10 attempts per minute from this IP |

## Connect

```
GET /api/fleet/ws
Upgrade: websocket
Authorization: Bearer rus_…
```

The handshake always completes; a bad token is answered with a **close
code**, so it lands in the same place as every other close in FLEET.md §6.3:

| Close | When |
|---|---|
| 4401 | no/malformed `Authorization`, unknown token, wrong secret |
| 4403 | revoked or expired token, revoked server, `hello.server_id`/`install_id` not the enrolled ones |
| 4400 | first frame is not `hello`, invalid JSON/envelope/hello, `seq` gap, no `hello` within 10 s |
| 4409 | a newer session for the same server connected |
| 4426 | `hello.protocol` range does not include 1 |
| 4429 | more than 50 msg/s (burst 200) or 8 MiB/min; reason is `{"retry_after_ms":N}` |
| 4503 | the platform is shutting down |

Frames are JSON text, max 1 MiB. Send `hello` first:

```json
{ "v": 1, "type": "hello", "id": "01J8ZQ4T8W6N3X0F2R5K7M9P1C", "ts": 1790340012345, "payload": {
  "server_id": "fs_…", "install_id": "ci-0123456789abcdef", "tenant_id": "default",
  "protocol": { "min": 1, "max": 1 },
  "versions": { "core": "0.4.0", "plugin_api": "1.1", "plugins": { "match": "0.4.0", "fleet": "0.4.0" }, "cs2_build": 14032 },
  "capabilities": ["match.v1"],
  "host": { "hostname": "ci-host", "game_port": 27015 },
  "boot_id": "01J8ZQ4T8W6N3X0F2R5K7M9P1D",
  "stream": { "id": "any-stable-id", "last_tx_seq": 0, "last_rx_seq": 0 },
  "state": null,
  "availability": "available"
} }
```

The answer is `welcome` (`ref` = your hello's `id`) with `heartbeat
{interval_ms: 10000, timeout_ms: 30000}` and `resume {result, platform_last_rx_seq}`.
After that:

- The platform sends `ping {t}` every 10 s; answer `pong {t}` with `ref` set.
  Your own `ping {t, health?}` gets a `pong`; `health` shows on the Servers page.
  30 s without any frame from you and the platform drops the link.
- Reliable messages carry `seq` (per direction, from 1). The platform acks
  yours in the `ack` field of any frame, or a standalone `ack` within 1 s /
  32 messages. Duplicates (seq ≤ acked) are re-acked; a gap closes 4400.
  In step 1 the only reliable server → platform type it processes is
  `auth.rotated`; any other reliable type gets `error {code:"unknown_type"}`
  and is acked (dropped).
- Put the highest platform seq you have processed in `ack` (or in
  `hello.stream.last_rx_seq` on reconnect); the platform replays anything
  after it.
- `resume.result` is `resumed` when `hello.stream.id` is the stream the
  platform knows; otherwise `reset`, and the platform takes your next seq as
  the new base.

### Token rotation

Tokens rotate after 90 days, or when an admin clicks rotate. The platform
sends reliable `auth.rotate {token, old_valid_until}` right after `welcome`
(or immediately, if you are connected). Write the new token (temp file +
rename), ack the seq, and send `auth.rotated {}` (reliable). The old token
keeps working until `old_valid_until` (24 h).

To exercise it in a test without waiting 90 days, age the token (test
endpoints on, admin auth) and reconnect:

```bash
curl -s -X POST $API/api/test/fleet/age-token -H "$ADMIN" -H 'Content-Type: application/json' \
  -d '{"serverId":"fs_…","days":91}'
```

`POST /api/test/fleet/reset-enroll-rate-limit` clears the 10/min enrollment
limit between test cases.

## Admin endpoints

All `requireAuth` (admin session or `API_TOKENS` bearer):

| Method | Path | |
|---|---|---|
| GET | `/api/fleet/servers` | registry: status, online, versions, capabilities, host, health, token id + rotation due |
| POST | `/api/fleet/servers` | `{name?}` → pending server + one-time code (shown once) |
| PATCH | `/api/fleet/servers/:id` | `{name}` |
| DELETE | `/api/fleet/servers/:id` | forget it (closes its socket; it may enroll again) |
| POST | `/api/fleet/servers/:id/code` | new code for a pending server |
| POST | `/api/fleet/servers/:id/revoke` | revoke tokens, close 4403, block key re-enrollment |
| POST | `/api/fleet/servers/:id/rotate` | 200 `sent`, or 202 `on_next_connect` when offline |
| GET / POST | `/api/fleet/keys` | list; `{name, namePrefix?, maxServers?, expiresInDays?}` → key (shown once) |
| DELETE | `/api/fleet/keys/:id` | revoke (servers it enrolled keep working) |

## Run the fleet tests

With the API running on :3069 as above:

```bash
SKIP_WEBSERVER=1 npx playwright test -c tests/playwright.config.ts tests/api/fleet-*.spec.ts
```

`tests/helpers/fleet.ts` has `FleetTestClient`, a minimal client in
TypeScript (`ws`) that is a good reference for the handshake and seq/ack
handling.
