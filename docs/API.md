# Using the MAT API from a bot or script

MAT's dashboard is a normal client of its own HTTP API. Anything the dashboard
can do, another program can do — run a tournament from Discord, post scoreboards
to a channel, wire match results into something else.

This document covers how a machine authenticates, and a task-oriented tour of
the endpoints worth using.

Three other things, all generated from the routers themselves so none of them
can drift from the code:

| | What it is |
| --- | --- |
| [API-REFERENCE.md](API-REFERENCE.md) | Every endpoint and what guards it, to read |
| [openapi.json](openapi.json) | The same, machine-readable — generate a client from it |
| `/api-docs` on a running instance | Swagger UI over that spec, with a Try-it button |
| [examples/discord-bot](../examples/discord-bot/README.md) | A working bot, under 800 lines, to copy and extend |

## Generating a client

`docs/openapi.json` is a complete OpenAPI 3.0 document. Point any generator at
it and get a typed client, without needing a MAT instance running:

```bash
# TypeScript types only — no runtime, no dependencies in your bot
npx openapi-typescript docs/openapi.json -o src/mat-api.d.ts
```

```bash
# A full client, in whatever language
npx @openapitools/openapi-generator-cli generate \
  -i docs/openapi.json -g typescript-fetch -o src/generated
```

A live instance serves the identical document at `/api-docs.json`, so a bot can
also regenerate against the deployment it actually talks to:

```bash
curl -s https://mat.example.com/api-docs.json -o openapi.json
```

**What the spec does and does not carry.** Paths, methods, path parameters and
`security` come from the routers, so they are complete and correct for every
endpoint. Request and response *schemas* only exist where someone wrote an
`@openapi` block — around a third of the surface. The rest are marked as
generated and say to read the handler. That is worth knowing before you trust a
generated response type: the endpoint list is authoritative, the response bodies
are not, yet.

---

## Authentication

There are two ways in, and which one you want depends on whether there is a
person involved.

**People** sign in through Steam or an SSO provider and get a session cookie.
Admin rights are always resolved from the Steam ID: `players.is_admin` has to be
`1` for that Steam ID, whichever provider they came in through.

**Machines** present a *service token*. There is no Steam ID behind a token and
no session — a bot has no browser to run an OAuth redirect in.

### Creating a token

Generate a secret:

```bash
openssl rand -hex 32
```

Put it in one of two variables in your `.env`, depending on how much the
integration needs to do:

| Variable | Scope | Use it for |
| --- | --- | --- |
| `API_TOKENS` | Full admin — every route an admin can reach | Creating matches, starting tournaments, RCON |
| `API_TOKENS_READONLY` | `GET`, `HEAD`, `OPTIONS` only | Scoreboards, brackets, match state |

```bash
API_TOKENS=discord-bot:8f3c...secret
API_TOKENS_READONLY=scoreboard:2a91...secret
```

Both take comma-, semicolon- or whitespace-separated entries. Each entry is
`label:secret` or a bare `secret`. The label only ever shows up in logs, so you
can tell which integration made a call — the secret itself is never logged, only
an eight-character fingerprint of its hash.

Restart the API. It says what it found at boot:

```
[Startup] 2 API token(s) active: discord-bot (admin, 1f2a3b4c), scoreboard (readonly, 9d8e7f60)
```

A secret shorter than 16 characters is refused with a warning rather than
accepted, so a typo'd variable is visible at startup instead of showing up later
as a mysterious 401.

**Reach for `API_TOKENS_READONLY` first.** Most bots only ever read. A token in
`API_TOKENS` is a full admin credential for your instance — it can wipe the
database. Treat it like the RCON password it can reach.

### Using a token

Either header works:

```bash
curl -H "Authorization: Bearer $TOKEN" https://mat.example.com/api/matches
curl -H "X-API-Token: $TOKEN"          https://mat.example.com/api/matches
```

Check that a token is accepted, and what it may do:

```bash
curl -H "Authorization: Bearer $TOKEN" https://mat.example.com/api/auth/admin/me
```

```json
{
  "authenticated": true,
  "provider": "service-token",
  "steamId": null,
  "serviceToken": { "label": "discord-bot", "scope": "admin", "fingerprint": "1f2a3b4c" }
}
```

### What the status codes mean

| Status | Meaning |
| --- | --- |
| `401` | The token is not one of the configured ones — or none are configured at all |
| `403` | The token is fine, but it is read-only and you tried to write |
| `200`/`2xx` | Through |

A token that is presented but wrong is rejected outright; it never falls back to
session auth. If it did, a bot holding a stale cookie would keep working after
its secret was rotated out, and the error for a bad token would read "you are not
signed in" — the wrong thing to hand whoever is debugging the bot.

Service tokens also skip the direct-access restriction that applies to browsers
(see `utils/canonicalOrigin`). A bot calling the container directly on a Docker
network is the normal case, not a suspicious one.

### Rotating and revoking

Tokens live only in the environment; there is no database table and no admin UI.
To revoke one, remove it from the variable and restart the API. To rotate,
add the new secret alongside the old, move the integration over, then drop the
old one.

---

## What you can drive

Grouped by what you would actually want a bot to do. Everything below is under
`/api`. **Auth** is what the route needs: *public*, *token (read)* — any token,
or *token (admin)* — `API_TOKENS` or an admin session.

### Reading match state and scoreboards

| Endpoint | Auth | Notes |
| --- | --- | --- |
| `GET /matches` | public | All matches with team names, scores and server. `?serverId=` filters |
| `GET /matches/:slug` | public | One match in detail |
| `GET /team/:teamId/match` | public | A team's current match, scores oriented to that team |
| `GET /team/:teamId/history`, `GET /team/:teamId/stats` | public | Past results and aggregates |
| `GET /players/:playerId/current-match` | public | What a player is in right now |
| `GET /players/:playerId/summary` | public | Profile, rating, recent form |
| `GET /tournament/bracket` | public | Bracket structure |
| `GET /tournament/:id/leaderboard` | public | Standings |
| `GET /health`, `GET /health/fleet` | public | Uptime; per-server CS2 update state |

Live scores come from an in-memory service, so a match in progress reports
current rounds rather than only the final result.

### Teams and players

| Endpoint | Auth | Notes |
| --- | --- | --- |
| `GET /teams`, `GET /teams/:id` | token (read) | |
| `POST /teams` | token (admin) | Body `{ id, name, tag?, discordRoleId?, players[] }`. Pass an array to batch. `?upsert=true` to create-or-update |
| `PUT /teams/:id`, `PATCH /teams/batch` | token (admin) | |
| `DELETE /teams/:id`, `POST /teams/bulk-delete` | token (admin) | |
| `GET /players`, `POST /players`, `POST /players/bulk-import` | token (admin) | |
| `GET /players/by-discord-id/:discordId` | token (read) | Every player with that Discord ID, as a list; `[]` if none |

Teams carry a `discordRoleId` field. It is stored and returned but MAT does
nothing with it — it is there for exactly this: a bot mapping a MAT team to a
Discord role.

Players carry a `discordId`, and `GET /players/by-discord-id/:discordId` is how
a bot maps the Discord user running a command to their MAT player.

### Running matches

| Endpoint | Auth | Notes |
| --- | --- | --- |
| `POST /matches` | token (admin) | `{ slug, config, serverId? }`. Omit `serverId` and a server is auto-allocated |
| `POST /matches/:slug/load` | token (admin) | Push to the server via RCON; webhooks configured automatically |
| `POST /matches/:slug/restart` | token (admin) | |
| `POST /matches/:slug/reallocate` | token (admin) | Move to another server |
| `PATCH /matches/:slug/status` | token (admin) | |
| `POST /matches/:slug/force-cancel` | token (admin) | |
| `GET /matches/:slug.json` | public | The Auto Tournament CS2 config. This is what the game server fetches |

`config` is a full Auto Tournament CS2 match config (`matchid`, `team1`, `team2`, `num_maps`,
`maplist`, …) — see `api/src/types/match.types.ts`. For a shuffle tournament,
`POST /tournament/:id/manual-matches` is the friendlier door: it takes player IDs
and builds the config for you.

### Tournaments

| Endpoint | Auth | Notes |
| --- | --- | --- |
| `GET /tournament` | token (read) | Current tournament and status |
| `POST /tournament`, `PUT /tournament` | token (admin) | Create / update |
| `POST /tournament/start` | token (admin) | |
| `POST /tournament/restart`, `POST /tournament/reset` | token (admin) | |
| `POST /tournament/bracket/regenerate` | token (admin) | |
| `POST /tournament/shuffle` | token (admin) | Balance players into teams |
| `POST /tournament/:id/manual-matches` | token (admin) | `{ matches: [{ team1PlayerIds, team2PlayerIds, map?, maxRounds? }], map?, maxRounds? }` |
| `POST /tournament/:id/register-players`, `PUT /tournament/:id/set-players` | token (admin) | |
| `POST /tournament/:id/generate-round` | token (admin) | Next Swiss round |
| `GET /tournament/allocation-status`, `GET /tournament/server-availability` | mixed | Whether there are servers free |

### Map veto

| Endpoint | Auth | Notes |
| --- | --- | --- |
| `GET /veto/:matchSlug` | public | Current veto state |
| `POST /veto/:matchSlug/action` | player identity | Ban/pick. Acts as the signed-in player, so a service token is not the right credential here |
| `POST /veto/:matchSlug/reset` | token (admin) | |

Veto actions are attributed to a *player*, not an admin. A bot cannot ban on a
player's behalf with a service token; that flow needs the player's own session.

### Servers and RCON

Everything under `/servers` and `/rcon` needs an admin token.

`/rcon` covers `pause-match`, `unpause-match`, `say`, `broadcast`, `end-match`,
`add-time`, `restart-round`, `swap-teams`, `restore-backup`, `:serverId/add-player`
and a raw `command` escape hatch. Useful for a bot: `say` and `broadcast` put a
message in-game, which is a decent way to echo a Discord message onto the server.

### Live updates over Socket.IO

Polling `GET /matches` works, but the API already pushes. Connect a Socket.IO
client to the same origin and listen:

| Event | Payload |
| --- | --- |
| `match:update` | The match that changed |
| `match:update:<slug>` | Same, scoped to one match |
| `match:event` / `match:event:<slug>` | Round ends, kills, map results |
| `veto:update` / `veto:update:<slug>` | Veto state changed |
| `bracket:update` | Bracket regenerated or advanced |
| `tournament:update` | Tournament status changed |
| `server:status`, `server:event:<serverId>` | Server came up, went down, updated |
| `compat:update` | A Ready Up compatibility run changed. Only sent to sockets that emitted `compat:subscribe` (see below) |

For a bot that keeps a live scoreboard message in a channel, `match:update:<slug>`
is what you want — edit the message on each event rather than polling.

### Ready Up compatibility

An instance can publish whether the Ready Up plugin suite works on the latest
CS2 build, as a public page at `/compatibility`. It is off unless one of the two
variables below is set, and then everything under `/api/compat` answers 404.

The Ready Up CI reports each run as a `compat.json` (schema 1), in one of two ways:

- **Push:** `POST /api/compat/events` with `Authorization: Bearer <COMPAT_INGEST_TOKEN>`
  and the document as the JSON body. The token is compared in constant time, the
  body is capped at 256 KB, and the document is validated strictly: unknown fields,
  unknown enum values, non-http(s) `run.url` and `passed > total` are rejected with
  `400` and a `details` list naming each bad field. A run is upserted by `run.id`;
  an identical copy answers `unchanged`, and a copy whose `checked_at` is older than
  the stored one answers `stale` and changes nothing.
- **Pull:** with `COMPAT_FEED_URL` set, the instance fetches that file every 5
  minutes (10 s timeout, same size cap and validation, `If-None-Match` when the
  server sends an ETag). A failed fetch logs once and keeps the last good run.

Public reads (no auth, rate limited per IP):

| Endpoint | What it returns |
| --- | --- |
| `GET /api/compat/latest` | `{ latest }`: the newest run (by `run.started_at`) with every check, plus `source`, `received_at`, `updated_at`; `null` before the first run |
| `GET /api/compat/runs?limit=20` | `{ runs }`: newest first (1-200), each component's status without its checks. The newest 200 runs are kept |
| `GET /api/compat/badge.json` | A [shields.io endpoint badge](https://shields.io/badges/endpoint-badge): `https://img.shields.io/endpoint?url=<instance>/api/compat/badge.json` |

Live updates: connect a Socket.IO client, emit `compat:subscribe` (again after
every reconnect), and listen for `compat:update`, whose payload is
`{ latest, run }` — the newest run now, and the run that changed.

The full request schema is `CompatDocument` in `docs/openapi.json`.

---

## A worked example

Posting a scoreboard to Discord, with a read-only token:

```js
import { Client, GatewayIntentBits } from 'discord.js';
import { io } from 'socket.io-client';

const MAT_URL = process.env.MAT_URL;          // https://mat.example.com
const MAT_TOKEN = process.env.MAT_API_TOKEN;  // from API_TOKENS_READONLY

const mat = (path) =>
  fetch(`${MAT_URL}/api${path}`, {
    headers: { Authorization: `Bearer ${MAT_TOKEN}` },
  }).then((r) => {
    if (!r.ok) throw new Error(`MAT ${path} → ${r.status}`);
    return r.json();
  });

const discord = new Client({ intents: [GatewayIntentBits.Guilds] });
await discord.login(process.env.DISCORD_TOKEN);
const channel = await discord.channels.fetch(process.env.CHANNEL_ID);

// One message per match, edited in place as the game runs.
const messages = new Map();

// team1SeriesScore/team2SeriesScore are maps won; team1MapScore/team2MapScore
// are rounds on the map being played (null once the match is over).
// team1Score/team2Score is the headline: rounds while live, maps when completed.
const render = (m) => {
  const maps = `${m.team1SeriesScore ?? 0} – ${m.team2SeriesScore ?? 0}`;
  const rounds =
    typeof m.team1MapScore === 'number' ? ` (${m.team1MapScore} – ${m.team2MapScore})` : '';
  return (
    `**${m.team1?.name ?? 'Team 1'}** ${maps}${rounds} ` +
    `**${m.team2?.name ?? 'Team 2'}**  ·  ${m.status}`
  );
};

async function upsert(match) {
  const existing = messages.get(match.slug);
  if (existing) return existing.edit(render(match));
  messages.set(match.slug, await channel.send(render(match)));
}

// Seed from current state, then follow the socket.
for (const match of (await mat('/matches')).matches ?? []) {
  if (match.status === 'live') await upsert(match);
}

io(MAT_URL).on('match:update', upsert);
```

A read-only token is enough for all of this. Reach for `API_TOKENS` only when the
bot needs to *change* something — create a match, start a tournament, pause a
server.

---

## Security notes

- **A token in `API_TOKENS` is a full admin credential.** It can reach
  `POST /tournament/wipe-database` and every RCON command. Scope down to
  `API_TOKENS_READONLY` wherever the integration allows it.
- **Tokens are compared in constant time**, against SHA-256 digests rather than
  the secrets, so neither the value nor its length leaks through timing.
- **Secrets are never logged.** Startup and auth-failure logs carry the label and
  an eight-character fingerprint, which is enough to tell two integrations apart
  without putting a credential in your log aggregator.
- **Give each integration its own token.** That is what the labels are for, and
  it means revoking one does not take the others down.
- **Serve over HTTPS.** A bearer token in a header over plain HTTP is a bearer
  token on the wire.
- **Tokens do not expire.** There is no issuance or refresh; rotate them by hand.

## Related configuration

| Variable | What it is |
| --- | --- |
| `API_TOKENS` | Full-admin service tokens |
| `API_TOKENS_READONLY` | Read-only service tokens |
| `SERVER_TOKEN` | Game-server credential for Auto Tournament CS2 webhooks and demo uploads (`X-Auto-Tournament-Token`). Unrelated to service tokens — it gates the ingest endpoints only, never the admin API |
| `ALLOW_UNAUTHENTICATED_EVENTS` | Migration shim: accept game events with no token. Off by default; see `example.env` |
| `ADMIN_STEAM_IDS` | Steam IDs always granted admin, for human sign-in |
| `SESSION_SECRET` | Signs admin session cookies |
| `COMPAT_INGEST_TOKEN` | Ready Up compatibility: the CI's token for `POST /api/compat/events` (at least 16 characters). Grants nothing else |
| `COMPAT_FEED_URL` | Ready Up compatibility: a `compat.json` to poll every 5 minutes as a fallback to the push |

See `example.env` for the full annotated list.
