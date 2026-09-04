# Using the MAT API from a bot or script

MAT's dashboard is a normal client of its own HTTP API. Anything the dashboard
can do, another program can do — run a tournament from Discord, post scoreboards
to a channel, wire match results into something else.

This document covers how a machine authenticates, and what is on the other side
once it does. The generated endpoint reference lives at `/api-docs` on a running
instance (`/api-docs.json` for the raw OpenAPI spec).

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

Teams carry a `discordRoleId` field. It is stored and returned but MAT does
nothing with it — it is there for exactly this: a bot mapping a MAT team to a
Discord role.

### Running matches

| Endpoint | Auth | Notes |
| --- | --- | --- |
| `POST /matches` | token (admin) | `{ slug, config, serverId? }`. Omit `serverId` and a server is auto-allocated |
| `POST /matches/:slug/load` | token (admin) | Push to the server via RCON; webhooks configured automatically |
| `POST /matches/:slug/restart` | token (admin) | |
| `POST /matches/:slug/reallocate` | token (admin) | Move to another server |
| `PATCH /matches/:slug/status` | token (admin) | |
| `POST /matches/:slug/force-cancel` | token (admin) | |
| `GET /matches/:slug.json` | public | The MatchZy config. This is what the game server fetches |

`config` is a full MatchZy match config (`matchid`, `team1`, `team2`, `num_maps`,
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

For a bot that keeps a live scoreboard message in a channel, `match:update:<slug>`
is what you want — edit the message on each event rather than polling.

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

const render = (m) =>
  `**${m.team1?.name ?? 'Team 1'}** ${m.team1Score ?? 0} – ` +
  `${m.team2Score ?? 0} **${m.team2?.name ?? 'Team 2'}**  ·  ${m.status}`;

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
| `SERVER_TOKEN` | Game-server credential for MatchZy webhooks (`X-MatchZy-Token`). Unrelated to service tokens — it only gates `POST /api/events` |
| `ADMIN_STEAM_IDS` | Steam IDs always granted admin, for human sign-in |
| `SESSION_SECRET` | Signs admin session cookies |

See `example.env` for the full annotated list.
