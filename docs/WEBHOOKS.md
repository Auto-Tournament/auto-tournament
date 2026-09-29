# Integrations: webhooks and the teams API

Two things for a website that works alongside an Auto Tournament event (a LAN
party's own site, a league portal):

- **Webhooks.** Auto Tournament calls your URL when a match changes: the
  players can connect (with the server address, password and a
  `steam://connect` link), it went live, a map started, the score moved, a map
  ended, the match finished, was cancelled or was reset. Every call is signed.
- **The teams API.** You push your teams (name, tag, players' Steam64 ids)
  under your own ids, and Auto Tournament creates or updates its teams to
  match. The webhooks then carry your ids back.

A typical flow: push the teams before the event, an admin builds the
tournament from them, and your site shows each player a "connect now" banner
when `match.ready` arrives for a match their team is in.

- [Setting up an endpoint](#setting-up-an-endpoint)
- [Events](#events)
- [The payload](#the-payload)
- [Verifying the signature](#verifying-the-signature)
- [Delivery, retries and ordering](#delivery-retries-and-ordering)
- [Test events](#test-events)
- [Security](#security)
- [Teams API](#teams-api)
- [Sample payloads](#sample-payloads)

---

## Setting up an endpoint

An admin adds it in **Settings → Webhooks** (or through the API below):

- **URL** — `https://` (or `http://` on a LAN) where you accept `POST`s.
- **Event types** — all of them, or a pick. "All" includes types added later.
- **Teams API source** — the label of the integrator token you push teams
  with (see [Teams API](#teams-api)). Payloads then carry *your* id for each
  team as `external_id`.
- **Signing secret** — `whsec_…`, shown **once** when the endpoint is created
  (and once per rotation). Store it; it is how you know a call came from
  Auto Tournament.

The admin API for the same, all admin-only (`/api/webhooks`):

| Endpoint | What it does |
| --- | --- |
| `GET /api/webhooks` | Endpoints (never their secret), delivery counts, the event types, whether private targets are allowed |
| `POST /api/webhooks` | `{ url, eventTypes?: ["*"] \| [ids], description?, active?, source? }` → `{ endpoint, secret }` |
| `PATCH /api/webhooks/:id` | Any of those fields. Switching off cancels queued deliveries; switching on clears an automatic disable |
| `DELETE /api/webhooks/:id` | Removes it and its delivery log |
| `POST /api/webhooks/:id/rotate-secret` | `{ graceHours?: 0-168 }` (default 24) → `{ secret }`. The old secret keeps signing, alongside the new one, for the grace period |
| `POST /api/webhooks/:id/test` | `{ type?, matchSlug? }` → a test delivery ([Test events](#test-events)) |
| `GET /api/webhooks/:id/deliveries` | The delivery log, newest first (`status`, `limit`, `before`). Connect details are redacted |
| `GET /api/webhooks/deliveries/:deliveryId` | One delivery with every attempt |
| `POST /api/webhooks/deliveries/:deliveryId/resend` | Send it again: a new delivery id, the same event id and body |
| `GET /api/webhooks/event-types` | The event types and when each fires |

## Events

The ids are stable: they never change meaning. A new kind of event gets a new id.

| Event | When it fires | `connect` |
| --- | --- | --- |
| `match.ready` | Players can connect: the match is loaded on a server. **Sent again** whenever the connect details change (the match moved to another server, a restart, a failover) | yes |
| `match.live` | The match went live (the first map is being played) | yes |
| `match.map_started` | A map of the series became the current map while the match is live (map 1 right after `match.live`, then each next map) | yes |
| `match.score_updated` | The round score of the current map changed. At most one per match every 5 seconds; the latest score is always delivered | yes |
| `match.map_ended` | A map finished; `data.map` is its result | yes |
| `match.finished` | The series is over with a result (`data.match.winner`) | no |
| `match.cancelled` | Cancelled, ended by an admin without a result, or deleted (`data.reason`: `cancelled` or `deleted`) | no |
| `match.reset` | The match went back: restarted (`restarted`), taken off its server (`unassigned`), or its result undone (`reopened`, `results_cleared`). A `match.ready` follows when it is loaded again | no |

What "loaded" means for a banner: the server has the match and is waiting for
the players. Show the banner on `match.ready`, keep it through `match.live`
(late joiners and reconnects still need it), and take it down on
`match.finished`, `match.cancelled` or `match.reset`.

## The payload

Every delivery is a `POST` with a JSON body:

```json
{
  "id": "evt_0mg2k1x4a9c1f0e2d4b6a8c0",
  "type": "match.ready",
  "created_at": "2026-10-01T18:00:00.000Z",
  "api_version": "1",
  "test": false,
  "data": { "match": { … }, "sequence": 3 }
}
```

| Field | |
| --- | --- |
| `id` | The event id. The same on every retry and every resend: **deduplicate on it** |
| `type` | One of the [events](#events) |
| `created_at` | When the event happened, ISO 8601 UTC |
| `api_version` | `"1"`. Fields may be **added** within a version; none are removed or renamed. Ignore fields you do not know |
| `test` | `true` for [test events](#test-events): made-up data |
| `data.match` | The match, below |
| `data.sequence` | Per match, raised by every event of that match. Apply an event only if its sequence is higher than the last one you applied for the match |
| `data.previous_status` | The match status before, on events that changed it |
| `data.reason` | `match.cancelled` and `match.reset`: why |
| `data.map` | `match.map_ended`: the map that ended |

`data.match`:

| Field | |
| --- | --- |
| `id`, `slug` | Auto Tournament's match id and slug |
| `status` | `pending`, `ready`, `loaded` (on a server, players can join), `live`, `completed`, `needs_decision` (maps over, an admin decides), `cancelled` |
| `game`, `round`, `match_number`, `bracket`, `best_of` | |
| `tournament` | `{ id, name }`, or `null` for a standalone match |
| `team1`, `team2` | `{ id, external_id, external_ids, name, tag, players: [{ steam_id64, name }] }`. `id` is Auto Tournament's; `external_id` is yours (the endpoint's source), `external_ids` has every source's |
| `score.series` | Maps won: `{ team1, team2 }` |
| `score.map` | The current map (the last one once it is over): `{ number, name, team1, team2 }`, `number` 1-based |
| `maps` | Every map of the series: `{ number, name, team1, team2, status: upcoming \| live \| finished, winner: team1 \| team2 \| draw \| null }` |
| `winner` | `{ side, team_id }` once decided |
| `connect` | While the match is `loaded` or `live`: `{ host, port, password, steam_url, console }`. `password` is `null` for a server without one. `steam_url` is `steam://connect/host:port/password` — a link that opens CS2 and joins. `null` otherwise |

`connect` is in signed deliveries only: no public route has it, and the admin
delivery log shows it redacted. The address is the one players use; on a LAN
that is a LAN address, and it is sent as it is.

All payload fields are `snake_case`. Sample payloads for every event are at the
[end of this page](#sample-payloads).

## Verifying the signature

Each delivery carries:

| Header | |
| --- | --- |
| `X-AT-Signature` | `t=<unix seconds>,v1=<hex>` — the HMAC-SHA256 of `"<t>.<raw body>"` with your secret. During a secret rotation there are two `v1=`: accept the delivery when **either** matches |
| `X-AT-Event` | The event type |
| `X-AT-Event-Id` | The event id (`id` in the body) |
| `X-AT-Delivery` | The delivery id (`dlv_…`): the same on every retry of one delivery, new on a resend |
| `User-Agent` | `AutoTournament-Webhooks/1` |

To verify:

1. Take the **raw** request body, exactly the bytes received. Parsing the JSON
   and serialising it again can change them.
2. Read `t` and every `v1` from `X-AT-Signature`.
3. Refuse it if `t` is more than 5 minutes from your clock (a replay).
4. Compute `HMAC-SHA256(secret, t + "." + rawBody)` as hex and compare it with
   each `v1` in constant time. One match: it is genuine.

**Node.js** (Express):

```js
const crypto = require('crypto');
const express = require('express');

const SECRET = process.env.AT_WEBHOOK_SECRET; // whsec_...

function verify(header, rawBody, toleranceSeconds = 300) {
  if (!header) return false;
  let t = null;
  const sigs = [];
  for (const part of header.split(',')) {
    const [k, v] = part.split('=');
    if (k === 't') t = Number(v);
    if (k === 'v1') sigs.push(v);
  }
  if (!t || Math.abs(Date.now() / 1000 - t) > toleranceSeconds) return false;
  const expected = crypto.createHmac('sha256', SECRET).update(`${t}.${rawBody}`).digest();
  return sigs.some((s) => {
    const got = Buffer.from(s, 'hex');
    return got.length === expected.length && crypto.timingSafeEqual(got, expected);
  });
}

const app = express();
app.post('/hooks/auto-tournament', express.raw({ type: 'application/json' }), (req, res) => {
  const raw = req.body.toString('utf8');
  if (!verify(req.get('X-AT-Signature'), raw)) return res.status(401).end();
  const event = JSON.parse(raw);
  // Deduplicate on event.id, order by event.data.sequence per match, then act.
  res.status(204).end(); // answer fast; do slow work afterwards
});
app.listen(8080);
```

**PHP**:

```php
<?php
$secret = getenv('AT_WEBHOOK_SECRET'); // whsec_...
$raw = file_get_contents('php://input');
$header = $_SERVER['HTTP_X_AT_SIGNATURE'] ?? '';

$t = null;
$sigs = [];
foreach (explode(',', $header) as $part) {
    [$k, $v] = array_pad(explode('=', $part, 2), 2, '');
    if ($k === 't') $t = (int) $v;
    if ($k === 'v1') $sigs[] = $v;
}
$ok = false;
if ($t && abs(time() - $t) <= 300) {
    $expected = hash_hmac('sha256', $t . '.' . $raw, $secret);
    foreach ($sigs as $sig) {
        if (hash_equals($expected, $sig)) { $ok = true; break; }
    }
}
if (!$ok) { http_response_code(401); exit; }

$event = json_decode($raw, true);
// Deduplicate on $event['id'], order by $event['data']['sequence'] per match.
http_response_code(204);
```

**Python** (Flask):

```python
import hashlib, hmac, json, os, time
from flask import Flask, request

SECRET = os.environ["AT_WEBHOOK_SECRET"].encode()  # whsec_...
app = Flask(__name__)

def verify(header: str, raw: bytes, tolerance: int = 300) -> bool:
    t, sigs = None, []
    for part in (header or "").split(","):
        k, _, v = part.partition("=")
        if k == "t" and v.isdigit():
            t = int(v)
        elif k == "v1":
            sigs.append(v)
    if t is None or abs(time.time() - t) > tolerance:
        return False
    expected = hmac.new(SECRET, f"{t}.".encode() + raw, hashlib.sha256).hexdigest()
    return any(hmac.compare_digest(expected, s) for s in sigs)

@app.post("/hooks/auto-tournament")
def hook():
    raw = request.get_data()  # the raw bytes, before any JSON parsing
    if not verify(request.headers.get("X-AT-Signature", ""), raw):
        return "", 401
    event = json.loads(raw)
    # Deduplicate on event["id"], order by event["data"]["sequence"] per match.
    return "", 204
```

## Delivery, retries and ordering

- **At least once.** A delivery counts when your endpoint answers `2xx` within
  10 seconds. Anything else — a timeout, a refused connection, `4xx`, `5xx`, a
  redirect (redirects are not followed) — is retried. So you may get an event
  twice: deduplicate on `id`.
- **Backoff.** Retries after 10 s, 30 s, 2 min, 10 min, 30 min, 1 h, 2 h, 4 h
  and 8 h (±10 % jitter): 10 attempts over about 16 hours, then the delivery
  is marked failed. A `Retry-After` on a `429`/`503` is honoured, up to the
  next step.
- **Persisted.** The queue is in the database: a restart of Auto Tournament
  loses nothing, and a delivery that was in flight is tried again.
- **Order.** Deliveries to one endpoint are sent in order, but a retry can
  land after a newer event. Use `data.sequence` (per match) to ignore stale
  ones: a `match.score_updated` with a lower sequence than the `match.finished`
  you already applied is old news.
- **Answer fast.** Acknowledge with `2xx` straight away and do slow work after.
  At most 64 KB of your answer is read, and the first 2 KB is kept in the log.
- **Automatic disable.** An endpoint whose deliveries keep failing — one
  delivery used all its attempts and nothing succeeded in that time — is
  switched off, its queued deliveries are cancelled, and the admins see a
  notice on Settings → Webhooks. Switching it on again resumes new events;
  failed ones can be resent from the log.
- **Delivery log.** Settings → Webhooks → Delivery log shows each delivery
  with its status, HTTP code, attempts and your answer, and a **Resend**
  button. Finished deliveries are kept 30 days.

## Test events

**Send test event** (Settings → Webhooks, or `POST /api/webhooks/:id/test`)
sends one event of the type you pick. It is shaped exactly like the real one —
both teams with `external_id`s, every player's Steam64, maps and score, and for
the connectable types a `connect` with a `steam://` link — so you can build and
try the whole banner flow before the event. Its data is made up (the server is
`203.0.113.10`, a documentation address), and it says `"test": true`.

With `{ "matchSlug": "r1m2" }` the test event carries that real match instead
(real teams, your external ids, the current score), still with made-up connect
details and `"test": true`.

Test events are signed and retried like any other and show up in the delivery
log. They never switch an endpoint off.

## Security

- **Signatures**: verify every delivery ([above](#verifying-the-signature)).
  Rotate the secret from Settings → Webhooks; the old one keeps signing for
  24 hours (configurable) so you can switch over without dropping anything.
- **Which URLs are allowed** (SSRF protection): Auto Tournament resolves the
  URL's host at delivery time, checks every address it resolves to, and
  connects to the address it checked. Public addresses are always allowed.
  Private ranges (10/8, 172.16/12, 192.168/16, 100.64/10, fc00::/7) and
  loopback need **Allow webhooks to private and local addresses** in Settings
  → Webhooks — turn it on at a LAN event whose website runs on the LAN.
  Link-local (169.254.0.0/16, where cloud metadata lives; fe80::/10),
  multicast and reserved ranges are never allowed. URLs with a user name or
  password are refused.
- **Limits**: 10 s per attempt, no redirects, bodies up to 256 KB sent and
  64 KB read.
- **Connect details** only travel in signed deliveries. They are redacted in
  the delivery log, scrubbed from a stored answer that echoes them, and never
  written to the server log.

## Teams API

Push your teams by **your own ids** (`externalId`); Auto Tournament keeps
its own team for each and tells you its id.

### Token

Ask the admin for an **integrator token**: a line in the instance's `.env`,

```bash
API_TOKENS_INTEGRATOR=ntlan:<openssl rand -hex 32>
```

It works on `/api/integrations/*` and nothing else. The part before the colon
(`ntlan`) is your **source**: every `externalId` you push lives under it, so
two integrators can both have a team `42`. Keep the label stable — a new label
is a new namespace. Send the token as `Authorization: Bearer <token>`.

(An admin token, `API_TOKENS`, works too; it names the source with
`?source=<label>`, and defaults to its own label. An admin's browser session
must pass `?source=`. A read-only token can read.)

### Endpoints

| Endpoint | What it does |
| --- | --- |
| `PUT /api/integrations/teams/:externalId` | Create or update one team. Body `{ name, tag?, players: [{ steamId, name }] }`. `201` created, `200` updated or unchanged |
| `POST /api/integrations/teams/batch` | `{ teams: [{ externalId, name, tag?, players }] }`, at most 500. Each team is applied on its own; `200` when all went through, `207` when some did not |
| `GET /api/integrations/teams/:externalId` | One team |
| `GET /api/integrations/teams` | All your teams |

A team in a response:

```json
{
  "id": "ninjas-in-pyjamas",
  "externalId": "team-4711",
  "source": "ntlan",
  "name": "Ninjas in Pyjamas",
  "tag": "NIP",
  "players": [{ "steamId": "76561198000000001", "name": "alpha" }],
  "createdAt": 1790000000,
  "updatedAt": 1790000000
}
```

An upsert answers `{ success, source, externalId, id, result, team, warnings }`,
`result` being `created`, `updated` or `unchanged`. The batch answers
`{ success, source, stats: { total, created, updated, unchanged, failed },
results: [{ index, ok, externalId, id?, result?, code?, error?, warnings? }] }`.

### Rules

- **Idempotent.** The same input twice changes nothing (`unchanged`, nothing
  written). Player order does not matter. Push your whole list whenever you
  like.
- **The player list replaces the old one.** Players you leave out are off the
  team.
- **Steam64 ids** are strings of 17 digits (`7656119…`). Send them as strings:
  as JSON numbers they lose precision. Invalid ids, duplicates, an empty
  roster, a missing name → `400` with `code: "invalid"` and every problem
  listed. At most 32 players, names up to 64 characters, tags up to 16.
- **Teams that are playing keep their roster.** Changing the players of a
  team with a match on a server (`loaded` or `live`) is refused with `409`,
  `code: "team_in_live_match"`, naming the match. Its name and tag can still
  change. Changing a running match's roster is an admin's job (for a Ready Up
  server the match page's roster editor updates the server); push again when
  the match is over.
- **A tournament that has started**: a roster change applies to the team's
  matches that are not on a server yet, and the answer says so in `warnings`.
- **A player on two teams** of one tournament is allowed, with a warning in
  `warnings` (they cannot take part in both teams' map vetoes).
- **Auto Tournament's team id** is made from the name the first time
  (`ninjas-in-pyjamas`, `-2` on a clash) and never changes after that, even
  when the name does.

```bash
curl -X PUT https://at.example.com/api/integrations/teams/team-4711 \
  -H "Authorization: Bearer $AT_TOKEN" -H "Content-Type: application/json" \
  -d '{"name":"Ninjas in Pyjamas","tag":"NIP","players":[
        {"steamId":"76561198000000001","name":"alpha"},
        {"steamId":"76561198000000002","name":"bravo"}]}'
```

---

## Sample payloads

What each event looks like (made-up data; a real delivery says `"test": false`,
as here, and a test event `"test": true`).

### `match.ready`

Players can connect: the match is loaded on a server. Sent again when the connect details change (the match moved to another server, or a restart).

```json
{
  "id": "evt_0mg2k1x4a9c1f0e2d4b6a8c0",
  "type": "match.ready",
  "created_at": "2026-10-01T18:00:00.000Z",
  "api_version": "1",
  "test": false,
  "data": {
    "match": {
      "id": 42,
      "slug": "r2m1",
      "status": "loaded",
      "game": "cs2",
      "round": 2,
      "match_number": 1,
      "bracket": "WB",
      "best_of": 3,
      "tournament": {"id":7,"name":"Sample LAN 2026"},
      "team1": {
        "id": "sample-ninjas",
        "external_id": "team-4711",
        "external_ids": {"ntlan":"team-4711"},
        "name": "Ninjas in Sample",
        "tag": "NiS",
        "players": [
          {"steam_id64":"76561198000000001","name":"alpha"},
          {"steam_id64":"76561198000000002","name":"bravo"},
          {"steam_id64":"76561198000000003","name":"charlie"},
          {"steam_id64":"76561198000000004","name":"delta"},
          {"steam_id64":"76561198000000005","name":"echo"}
        ]
      },
      "team2": {
        "id": "sample-pirates",
        "external_id": "team-4712",
        "external_ids": {"ntlan":"team-4712"},
        "name": "Sample Pirates",
        "tag": "SPR",
        "players": [
          {"steam_id64":"76561198000000006","name":"foxtrot"},
          {"steam_id64":"76561198000000007","name":"golf"},
          {"steam_id64":"76561198000000008","name":"hotel"},
          {"steam_id64":"76561198000000009","name":"india"},
          {"steam_id64":"76561198000000010","name":"juliett"}
        ]
      },
      "score": {"series":{"team1":0,"team2":0},"map":null},
      "maps": [
        {"number":1,"name":"de_mirage","team1":0,"team2":0,"status":"upcoming","winner":null},
        {"number":2,"name":"de_inferno","team1":0,"team2":0,"status":"upcoming","winner":null},
        {"number":3,"name":"de_nuke","team1":0,"team2":0,"status":"upcoming","winner":null}
      ],
      "winner": null,
      "connect": {
        "host": "203.0.113.10",
        "port": 27015,
        "password": "k3Lp9QzT2w",
        "steam_url": "steam://connect/203.0.113.10:27015/k3Lp9QzT2w",
        "console": "connect 203.0.113.10:27015; password k3Lp9QzT2w"
      }
    },
    "previous_status": "ready",
    "sequence": 1
  }
}
```

### `match.live`

The match went live (the first map started being played).

```json
{
  "id": "evt_0mg2k1x4a9c1f0e2d4b6a8c0",
  "type": "match.live",
  "created_at": "2026-10-01T18:00:00.000Z",
  "api_version": "1",
  "test": false,
  "data": {
    "match": {
      "id": 42,
      "slug": "r2m1",
      "status": "live",
      "game": "cs2",
      "round": 2,
      "match_number": 1,
      "bracket": "WB",
      "best_of": 3,
      "tournament": {"id":7,"name":"Sample LAN 2026"},
      "team1": {
        "id": "sample-ninjas",
        "external_id": "team-4711",
        "external_ids": {"ntlan":"team-4711"},
        "name": "Ninjas in Sample",
        "tag": "NiS",
        "players": [
          {"steam_id64":"76561198000000001","name":"alpha"},
          {"steam_id64":"76561198000000002","name":"bravo"},
          {"steam_id64":"76561198000000003","name":"charlie"},
          {"steam_id64":"76561198000000004","name":"delta"},
          {"steam_id64":"76561198000000005","name":"echo"}
        ]
      },
      "team2": {
        "id": "sample-pirates",
        "external_id": "team-4712",
        "external_ids": {"ntlan":"team-4712"},
        "name": "Sample Pirates",
        "tag": "SPR",
        "players": [
          {"steam_id64":"76561198000000006","name":"foxtrot"},
          {"steam_id64":"76561198000000007","name":"golf"},
          {"steam_id64":"76561198000000008","name":"hotel"},
          {"steam_id64":"76561198000000009","name":"india"},
          {"steam_id64":"76561198000000010","name":"juliett"}
        ]
      },
      "score": {"series":{"team1":0,"team2":0},"map":{"number":1,"name":"de_mirage","team1":0,"team2":0}},
      "maps": [
        {"number":1,"name":"de_mirage","team1":0,"team2":0,"status":"live","winner":null},
        {"number":2,"name":"de_inferno","team1":0,"team2":0,"status":"upcoming","winner":null},
        {"number":3,"name":"de_nuke","team1":0,"team2":0,"status":"upcoming","winner":null}
      ],
      "winner": null,
      "connect": {
        "host": "203.0.113.10",
        "port": 27015,
        "password": "k3Lp9QzT2w",
        "steam_url": "steam://connect/203.0.113.10:27015/k3Lp9QzT2w",
        "console": "connect 203.0.113.10:27015; password k3Lp9QzT2w"
      }
    },
    "previous_status": "loaded",
    "sequence": 1
  }
}
```

### `match.map_started`

A map of the series became the current map while the match is live.

```json
{
  "id": "evt_0mg2k1x4a9c1f0e2d4b6a8c0",
  "type": "match.map_started",
  "created_at": "2026-10-01T18:00:00.000Z",
  "api_version": "1",
  "test": false,
  "data": {
    "match": {
      "id": 42,
      "slug": "r2m1",
      "status": "live",
      "game": "cs2",
      "round": 2,
      "match_number": 1,
      "bracket": "WB",
      "best_of": 3,
      "tournament": {"id":7,"name":"Sample LAN 2026"},
      "team1": {
        "id": "sample-ninjas",
        "external_id": "team-4711",
        "external_ids": {"ntlan":"team-4711"},
        "name": "Ninjas in Sample",
        "tag": "NiS",
        "players": [
          {"steam_id64":"76561198000000001","name":"alpha"},
          {"steam_id64":"76561198000000002","name":"bravo"},
          {"steam_id64":"76561198000000003","name":"charlie"},
          {"steam_id64":"76561198000000004","name":"delta"},
          {"steam_id64":"76561198000000005","name":"echo"}
        ]
      },
      "team2": {
        "id": "sample-pirates",
        "external_id": "team-4712",
        "external_ids": {"ntlan":"team-4712"},
        "name": "Sample Pirates",
        "tag": "SPR",
        "players": [
          {"steam_id64":"76561198000000006","name":"foxtrot"},
          {"steam_id64":"76561198000000007","name":"golf"},
          {"steam_id64":"76561198000000008","name":"hotel"},
          {"steam_id64":"76561198000000009","name":"india"},
          {"steam_id64":"76561198000000010","name":"juliett"}
        ]
      },
      "score": {"series":{"team1":0,"team2":0},"map":{"number":1,"name":"de_mirage","team1":0,"team2":0}},
      "maps": [
        {"number":1,"name":"de_mirage","team1":0,"team2":0,"status":"live","winner":null},
        {"number":2,"name":"de_inferno","team1":0,"team2":0,"status":"upcoming","winner":null},
        {"number":3,"name":"de_nuke","team1":0,"team2":0,"status":"upcoming","winner":null}
      ],
      "winner": null,
      "connect": {
        "host": "203.0.113.10",
        "port": 27015,
        "password": "k3Lp9QzT2w",
        "steam_url": "steam://connect/203.0.113.10:27015/k3Lp9QzT2w",
        "console": "connect 203.0.113.10:27015; password k3Lp9QzT2w"
      }
    },
    "sequence": 1
  }
}
```

### `match.score_updated`

The round score of the current map changed. Throttled: at most one per match every few seconds; the last score is always delivered.

```json
{
  "id": "evt_0mg2k1x4a9c1f0e2d4b6a8c0",
  "type": "match.score_updated",
  "created_at": "2026-10-01T18:00:00.000Z",
  "api_version": "1",
  "test": false,
  "data": {
    "match": {
      "id": 42,
      "slug": "r2m1",
      "status": "live",
      "game": "cs2",
      "round": 2,
      "match_number": 1,
      "bracket": "WB",
      "best_of": 3,
      "tournament": {"id":7,"name":"Sample LAN 2026"},
      "team1": {
        "id": "sample-ninjas",
        "external_id": "team-4711",
        "external_ids": {"ntlan":"team-4711"},
        "name": "Ninjas in Sample",
        "tag": "NiS",
        "players": [
          {"steam_id64":"76561198000000001","name":"alpha"},
          {"steam_id64":"76561198000000002","name":"bravo"},
          {"steam_id64":"76561198000000003","name":"charlie"},
          {"steam_id64":"76561198000000004","name":"delta"},
          {"steam_id64":"76561198000000005","name":"echo"}
        ]
      },
      "team2": {
        "id": "sample-pirates",
        "external_id": "team-4712",
        "external_ids": {"ntlan":"team-4712"},
        "name": "Sample Pirates",
        "tag": "SPR",
        "players": [
          {"steam_id64":"76561198000000006","name":"foxtrot"},
          {"steam_id64":"76561198000000007","name":"golf"},
          {"steam_id64":"76561198000000008","name":"hotel"},
          {"steam_id64":"76561198000000009","name":"india"},
          {"steam_id64":"76561198000000010","name":"juliett"}
        ]
      },
      "score": {"series":{"team1":0,"team2":0},"map":{"number":1,"name":"de_mirage","team1":7,"team2":5}},
      "maps": [
        {"number":1,"name":"de_mirage","team1":7,"team2":5,"status":"live","winner":null},
        {"number":2,"name":"de_inferno","team1":0,"team2":0,"status":"upcoming","winner":null},
        {"number":3,"name":"de_nuke","team1":0,"team2":0,"status":"upcoming","winner":null}
      ],
      "winner": null,
      "connect": {
        "host": "203.0.113.10",
        "port": 27015,
        "password": "k3Lp9QzT2w",
        "steam_url": "steam://connect/203.0.113.10:27015/k3Lp9QzT2w",
        "console": "connect 203.0.113.10:27015; password k3Lp9QzT2w"
      }
    },
    "sequence": 1
  }
}
```

### `match.map_ended`

A map finished; `data.map` holds its result.

```json
{
  "id": "evt_0mg2k1x4a9c1f0e2d4b6a8c0",
  "type": "match.map_ended",
  "created_at": "2026-10-01T18:00:00.000Z",
  "api_version": "1",
  "test": false,
  "data": {
    "match": {
      "id": 42,
      "slug": "r2m1",
      "status": "live",
      "game": "cs2",
      "round": 2,
      "match_number": 1,
      "bracket": "WB",
      "best_of": 3,
      "tournament": {"id":7,"name":"Sample LAN 2026"},
      "team1": {
        "id": "sample-ninjas",
        "external_id": "team-4711",
        "external_ids": {"ntlan":"team-4711"},
        "name": "Ninjas in Sample",
        "tag": "NiS",
        "players": [
          {"steam_id64":"76561198000000001","name":"alpha"},
          {"steam_id64":"76561198000000002","name":"bravo"},
          {"steam_id64":"76561198000000003","name":"charlie"},
          {"steam_id64":"76561198000000004","name":"delta"},
          {"steam_id64":"76561198000000005","name":"echo"}
        ]
      },
      "team2": {
        "id": "sample-pirates",
        "external_id": "team-4712",
        "external_ids": {"ntlan":"team-4712"},
        "name": "Sample Pirates",
        "tag": "SPR",
        "players": [
          {"steam_id64":"76561198000000006","name":"foxtrot"},
          {"steam_id64":"76561198000000007","name":"golf"},
          {"steam_id64":"76561198000000008","name":"hotel"},
          {"steam_id64":"76561198000000009","name":"india"},
          {"steam_id64":"76561198000000010","name":"juliett"}
        ]
      },
      "score": {"series":{"team1":1,"team2":0},"map":{"number":1,"name":"de_mirage","team1":13,"team2":9}},
      "maps": [
        {"number":1,"name":"de_mirage","team1":13,"team2":9,"status":"finished","winner":"team1"},
        {"number":2,"name":"de_inferno","team1":0,"team2":0,"status":"upcoming","winner":null},
        {"number":3,"name":"de_nuke","team1":0,"team2":0,"status":"upcoming","winner":null}
      ],
      "winner": null,
      "connect": {
        "host": "203.0.113.10",
        "port": 27015,
        "password": "k3Lp9QzT2w",
        "steam_url": "steam://connect/203.0.113.10:27015/k3Lp9QzT2w",
        "console": "connect 203.0.113.10:27015; password k3Lp9QzT2w"
      }
    },
    "map": {"number":1,"name":"de_mirage","team1":13,"team2":9,"status":"finished","winner":"team1"},
    "sequence": 1
  }
}
```

### `match.finished`

The series is over and has a result.

```json
{
  "id": "evt_0mg2k1x4a9c1f0e2d4b6a8c0",
  "type": "match.finished",
  "created_at": "2026-10-01T18:00:00.000Z",
  "api_version": "1",
  "test": false,
  "data": {
    "match": {
      "id": 42,
      "slug": "r2m1",
      "status": "completed",
      "game": "cs2",
      "round": 2,
      "match_number": 1,
      "bracket": "WB",
      "best_of": 3,
      "tournament": {"id":7,"name":"Sample LAN 2026"},
      "team1": {
        "id": "sample-ninjas",
        "external_id": "team-4711",
        "external_ids": {"ntlan":"team-4711"},
        "name": "Ninjas in Sample",
        "tag": "NiS",
        "players": [
          {"steam_id64":"76561198000000001","name":"alpha"},
          {"steam_id64":"76561198000000002","name":"bravo"},
          {"steam_id64":"76561198000000003","name":"charlie"},
          {"steam_id64":"76561198000000004","name":"delta"},
          {"steam_id64":"76561198000000005","name":"echo"}
        ]
      },
      "team2": {
        "id": "sample-pirates",
        "external_id": "team-4712",
        "external_ids": {"ntlan":"team-4712"},
        "name": "Sample Pirates",
        "tag": "SPR",
        "players": [
          {"steam_id64":"76561198000000006","name":"foxtrot"},
          {"steam_id64":"76561198000000007","name":"golf"},
          {"steam_id64":"76561198000000008","name":"hotel"},
          {"steam_id64":"76561198000000009","name":"india"},
          {"steam_id64":"76561198000000010","name":"juliett"}
        ]
      },
      "score": {"series":{"team1":2,"team2":1},"map":{"number":3,"name":"de_nuke","team1":13,"team2":6}},
      "maps": [
        {"number":1,"name":"de_mirage","team1":13,"team2":9,"status":"finished","winner":"team1"},
        {"number":2,"name":"de_inferno","team1":11,"team2":13,"status":"finished","winner":"team2"},
        {"number":3,"name":"de_nuke","team1":13,"team2":6,"status":"finished","winner":"team1"}
      ],
      "winner": {"side":"team1","team_id":"sample-ninjas"},
      "connect": null
    },
    "previous_status": "live",
    "sequence": 1
  }
}
```

### `match.cancelled`

The match was cancelled, ended by an admin without a result, or deleted.

```json
{
  "id": "evt_0mg2k1x4a9c1f0e2d4b6a8c0",
  "type": "match.cancelled",
  "created_at": "2026-10-01T18:00:00.000Z",
  "api_version": "1",
  "test": false,
  "data": {
    "match": {
      "id": 42,
      "slug": "r2m1",
      "status": "cancelled",
      "game": "cs2",
      "round": 2,
      "match_number": 1,
      "bracket": "WB",
      "best_of": 3,
      "tournament": {"id":7,"name":"Sample LAN 2026"},
      "team1": {
        "id": "sample-ninjas",
        "external_id": "team-4711",
        "external_ids": {"ntlan":"team-4711"},
        "name": "Ninjas in Sample",
        "tag": "NiS",
        "players": [
          {"steam_id64":"76561198000000001","name":"alpha"},
          {"steam_id64":"76561198000000002","name":"bravo"},
          {"steam_id64":"76561198000000003","name":"charlie"},
          {"steam_id64":"76561198000000004","name":"delta"},
          {"steam_id64":"76561198000000005","name":"echo"}
        ]
      },
      "team2": {
        "id": "sample-pirates",
        "external_id": "team-4712",
        "external_ids": {"ntlan":"team-4712"},
        "name": "Sample Pirates",
        "tag": "SPR",
        "players": [
          {"steam_id64":"76561198000000006","name":"foxtrot"},
          {"steam_id64":"76561198000000007","name":"golf"},
          {"steam_id64":"76561198000000008","name":"hotel"},
          {"steam_id64":"76561198000000009","name":"india"},
          {"steam_id64":"76561198000000010","name":"juliett"}
        ]
      },
      "score": {"series":{"team1":0,"team2":0},"map":null},
      "maps": [
        {"number":1,"name":"de_mirage","team1":0,"team2":0,"status":"upcoming","winner":null},
        {"number":2,"name":"de_inferno","team1":0,"team2":0,"status":"upcoming","winner":null},
        {"number":3,"name":"de_nuke","team1":0,"team2":0,"status":"upcoming","winner":null}
      ],
      "winner": null,
      "connect": null
    },
    "previous_status": "loaded",
    "reason": "cancelled",
    "sequence": 1
  }
}
```

### `match.reset`

The match went back to an earlier state: restarted, unassigned from its server, or its result undone. A match.ready follows when it is loaded again.

```json
{
  "id": "evt_0mg2k1x4a9c1f0e2d4b6a8c0",
  "type": "match.reset",
  "created_at": "2026-10-01T18:00:00.000Z",
  "api_version": "1",
  "test": false,
  "data": {
    "match": {
      "id": 42,
      "slug": "r2m1",
      "status": "ready",
      "game": "cs2",
      "round": 2,
      "match_number": 1,
      "bracket": "WB",
      "best_of": 3,
      "tournament": {"id":7,"name":"Sample LAN 2026"},
      "team1": {
        "id": "sample-ninjas",
        "external_id": "team-4711",
        "external_ids": {"ntlan":"team-4711"},
        "name": "Ninjas in Sample",
        "tag": "NiS",
        "players": [
          {"steam_id64":"76561198000000001","name":"alpha"},
          {"steam_id64":"76561198000000002","name":"bravo"},
          {"steam_id64":"76561198000000003","name":"charlie"},
          {"steam_id64":"76561198000000004","name":"delta"},
          {"steam_id64":"76561198000000005","name":"echo"}
        ]
      },
      "team2": {
        "id": "sample-pirates",
        "external_id": "team-4712",
        "external_ids": {"ntlan":"team-4712"},
        "name": "Sample Pirates",
        "tag": "SPR",
        "players": [
          {"steam_id64":"76561198000000006","name":"foxtrot"},
          {"steam_id64":"76561198000000007","name":"golf"},
          {"steam_id64":"76561198000000008","name":"hotel"},
          {"steam_id64":"76561198000000009","name":"india"},
          {"steam_id64":"76561198000000010","name":"juliett"}
        ]
      },
      "score": {"series":{"team1":0,"team2":0},"map":null},
      "maps": [
        {"number":1,"name":"de_mirage","team1":0,"team2":0,"status":"upcoming","winner":null},
        {"number":2,"name":"de_inferno","team1":0,"team2":0,"status":"upcoming","winner":null},
        {"number":3,"name":"de_nuke","team1":0,"team2":0,"status":"upcoming","winner":null}
      ],
      "winner": null,
      "connect": null
    },
    "previous_status": "loaded",
    "reason": "unassigned",
    "sequence": 1
  }
}
```

