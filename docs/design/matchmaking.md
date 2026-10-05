# Matchmaking (3.1)

Status: design. Nothing here is built yet except the feature flag.

Goal: a player clicks "Find match", waits in a queue, accepts, and ends up in a
CS2 match on a free server. No admin has to do anything. CS2 comes first.
Other games come later.

## The flag

Matchmaking ships dark behind an experimental feature flag.

- Setting `experimental_matchmaking` in `app_settings`. Off by default.
- Admins turn it on under Settings → Experimental (`PUT /api/experimental/matchmaking`).
- `EXPERIMENTAL_MATCHMAKING=1` turns it on for development. `=0` forces it
  off. The variable wins over the admin toggle.
- While it is off, nothing is reachable. Every `/api/matchmaking` route
  answers 404, even to admins. The client shows no matchmaking UI.
- While it is on, it stays admin only until we open it to players (phase 4).

Code: `api/src/services/experimentalFeatures.ts`, `api/src/routes/experimental.ts`,
`api/src/routes/matchmaking.ts`. New experimental features add one entry to
`EXPERIMENTAL_FEATURES` and one core setting key.

## What exists that we reuse

- **Standalone matches.** A match row with `tournament_id IS NULL`. The
  scheduler already allocates these (`getReadyStandaloneMatchSlugs`, oldest
  first) and keeps polling while no server is free. A matchmaking match is a
  standalone match.
- **Server allocation.** `scheduler.allocateSingleMatch` and the CS2 module's
  allocation. With Ready Up, the platform sends `match.assign` over the fleet
  link. Ready Up loads the config, whitelists the roster and runs ready-up.
  Nothing new is needed on the server side.
- **Match lifecycle.** `core/matchLifecycle.ts` ends the series, releases
  the server and records player stats. Matchmaking hooks in at
  `applySeriesResult`.
- **Ratings.** `ratingService` already keeps an OpenSkill rating (mu, sigma)
  per player and shows it as a display Elo. `teamBalancingService` already
  splits players into balanced teams for shuffle tournaments.
- **Veto.** The CS2 module has a map veto flow (`integrations/cs2/veto`).
- **Realtime.** `socketService` (Socket.IO). It has rooms for admins today.
  Matchmaking adds a room per player.
- **Player sign-in.** Players sign in with Steam (signed `player_steam_id`
  cookie). Other providers are being added in parallel; matchmaking only
  needs "who is this player".

## User flow

1. **Find match.** A signed-in player picks the mode (5v5 or 2v2 wingman) and
   clicks "Find match". They can queue alone or as a party.
2. **Party.** Up to 5 players (2 for wingman). The leader invites friends by
   link. Only the leader can start and stop the search. The whole party is
   always put on the same team.
3. **Queue.** A bar at the top of every page shows the mode, a timer and a
   Cancel button. The player can browse the site while they wait.
4. **Match found.** When 10 players (4 for wingman) fit together, everyone
   gets a modal with a sound: "Match found — Accept". They have 20 seconds.
   The modal shows how many have accepted, not who.
5. **All accept.** The lobby is created. The players go to the match room.
6. **Someone declines or does not answer.**
   - That player (and their whole party) leaves the queue and gets a cooldown.
   - Everyone who accepted goes back into the queue **at the front**. They keep
     their original queue time, so they are matched first.
   - Players who did not answer are treated the same as a decline.
7. **Match room.** Shows the two teams, the map (or the veto), the server
   status and a "Connect" button once the server is ready. Ready Up handles
   ready-up in game.
8. **Match ends.** Result, rating change, and a link back to "Find match".

### Cooldowns

A decline or no-show adds a cooldown. The cooldown grows with repeat
offences inside 24 hours:

| Offence in 24 h | Cooldown |
| --- | --- |
| 1st | 2 min |
| 2nd | 10 min |
| 3rd | 1 h |
| 4th and later | 24 h |

The counter resets after 24 hours without an offence. Admins can clear a
cooldown.

## Matching

### Rating: Glicko-style, using the OpenSkill model we already have

We need a rating with an uncertainty value, not plain Elo.

- **Plain Elo** has one number per player. A new player and a player with
  500 games move by the same amount. New players take many games to reach
  their real level, and those games are unfair for everyone else.
- **Glicko-2** adds an uncertainty (rating deviation). New or returning
  players move fast; settled players move slowly. That is what matchmaking
  needs. But Glicko-2 rates one player against one player. Using it for
  5v5 needs a "team as one player" workaround.
- **OpenSkill** (Weng-Lin) is in the same family as Glicko and TrueSkill:
  mu plus sigma (uncertainty). It is built for teams, so each player's
  change depends on their team and the other team. We already use it
  (`ratingService`, `utils/ratingMath.ts`) and already show it as a display
  Elo.

**Decision: use OpenSkill.** It gives us everything Glicko-2 would, it
handles teams natively, and it is already in the codebase and tested. Players
see one number (the display Elo), the same scale as tournaments.

Matchmaking keeps its **own rating per mode** (5v5 and wingman), separate
from the tournament rating. A new player's matchmaking rating starts at their
tournament rating, with a high sigma. So a known strong player does not start
at the bottom, and still settles quickly.

Matching uses the conservative value (`mu - 3 * sigma`, the "ordinal") only
for the leaderboard. For finding fair games, it uses `mu`.

### Parties

A party's rating is the average of its members' mu. To stop a strong player
carrying a weak friend into low games, we use a weighted average that leans
towards the highest member: `0.7 * average + 0.3 * max`.

### Search window

Each queue entry has a window around its rating. Two entries can be in the
same match only if each is inside the other's window.

- Start: ±100 display Elo.
- Every 30 s in queue: +50.
- Cap: ±400. After 5 minutes, no cap (any match is better than no match on a
  small community instance).

These numbers are admin settings (see below). Small instances will mostly
hit "no cap". That is fine: the balancing step still makes the teams fair.

### Region and latency

Optional, later. Most instances run in one region. If an instance has
servers in several regions, a player can pick "any" or a list of regions,
and only servers in a shared region are used. Phase 4.

### The matching loop

A loop runs every 2 seconds:

1. Take all entries in the queue for a mode, oldest first (requeued entries
   keep their old time, so they come first).
2. For the oldest entry, pick other entries whose windows overlap, oldest
   first, until the player count is exactly 10 (or 4). Parties are never
   split.
3. If that works, lock those entries and send "match found". If not, try the
   next oldest entry.

This is greedy, not optimal. It is easy to reason about and fair to people
who waited longest. With hundreds of players we can revisit it.

## Team balancing

Once 10 players are found, split them into two teams of 5:

- Parties stay together.
- Try every split that keeps parties whole (at most 126 splits for 10 solo
  players). Pick the one with the smallest difference in total mu. Break ties
  by the smallest difference in the strongest player per team.
- Reuse the scoring from `teamBalancingService` where it fits.

The expected win chance for each team is shown in the match room (from
OpenSkill's `predictWin`).

## Map selection

Admin setting, one of:

- **Random** (default, phase 1). A random map from the matchmaking map pool.
  Avoid the map each player played in their last matchmaking game where we
  can.
- **Captain veto** (phase 4). The highest-rated player per team is captain.
  Captains ban in turn until one map is left. Reuses the CS2 veto flow. A
  captain who does not pick in 20 s gets a random ban.

The map pool is its own admin setting. It defaults to the CS2 Active Duty
pool from `maps.json`.

## Server allocation

1. When everyone has accepted, create a standalone match row
   (`tournament_id NULL`, `source = 'matchmaking'`, teams created on the fly,
   best of 1, map chosen).
2. Hand it to `scheduler.allocateSingleMatch`, like a manual match. The CS2
   module sends `match.assign` over the Ready Up fleet link. Ready Up loads
   the match, whitelists the ten players and runs ready-up.
3. The match room shows "Connect" when the server reports the match loaded.

### Tournaments come first

Tournament and matchmaking matches share the same servers.

- A tournament match always wins a free server over a matchmaking match.
- Admin setting: "Servers kept free for tournaments" (default 0). While a
  tournament is running, matchmaking never takes the last N free servers.
- Matchmaking never ends or moves a running match.

### No free server

- The lobby shows "Waiting for a server" with its place in line.
- If the fleet can autoscale, allocation already asks for a new server.
- After 5 minutes without a server, the lobby is cancelled. Nobody gets a
  cooldown. Everyone goes back into the queue at the front.
- If no CS2 server exists at all, "Find match" is disabled with the reason.

## Match result and ratings

- On `applySeriesResult` for a match with `source = 'matchmaking'`, update
  each player's matchmaking rating with OpenSkill (two teams, one result).
- A draw counts as a draw.
- A match cancelled by an admin or by the server changes no ratings.
- Players who left early (see AFK below) still lose rating if their team
  loses. Their teammates lose less: we scale the loss by
  `players present / 5`.
- Ratings can be turned off for matchmaking (admin setting). Matches still
  run; no rating changes are stored.

## Leaderboard

- Per mode. Ordered by ordinal (`mu - 3 * sigma`), shown as display Elo.
- Only players with at least 10 matchmaking games in the last 30 days.
- Shows rank, player, rating, games, win rate.
- Public if the admin allows it, otherwise signed-in players only.

## Match history

- On each player's profile: a "Matchmaking" tab.
- Each row: date, map, score, result, rating change, link to the match page.
- The match page is the existing one; it already has stats and demos.

## Anti-abuse

- **Dodging** (decline or no-show on accept): cooldowns above.
- **Leaving a lobby** after accepting but before the match loads: same as a
  decline.
- **AFK / leaving in game**: Ready Up reports player presence. A player who
  is disconnected for more than 5 minutes of a live match, or never connects
  within 5 minutes of the server being ready, gets an "abandon". An abandon is
  a 1 h cooldown, doubling each time within 7 days (cap 7 days).
- **Match that never starts**: if fewer than 8 of 10 connect within 10
  minutes, cancel the match without rating changes. The ones who did not
  connect get an abandon.
- **Smurfing / account sharing**: out of scope. A player is one Steam
  account.
- Admins see a player's offences and can clear them.

## Admin settings

Under Settings → Matchmaking (only when the flag is on):

| Setting | Default |
| --- | --- |
| Matchmaking open to players | Off (admins only) |
| Modes | 5v5 on, wingman off |
| Map pool (per mode) | Active Duty (5v5), wingman pool |
| Map selection | Random |
| Accept timeout | 20 s |
| Ratings on | On |
| Search window: start / step / cap | 100 / 50 per 30 s / 400 |
| Servers kept free for tournaments | 0 |
| Cooldown ladder | 2 min, 10 min, 1 h, 24 h |
| Leaderboard public | Off |

These are stored in `app_settings` with an `mm_` prefix.

## Data model

New tables. All in core (not in the CS2 module), because "find opponents"
will reuse them for other games.

- `mm_parties`: `id`, `leader_player_id`, `game`, `mode`, `invite_code`,
  `created_at`.
- `mm_party_members`: `party_id`, `player_id`, `joined_at`.
- `mm_queue_entries`: `id`, `party_id` (a solo player gets a party of one),
  `game`, `mode`, `rating` (party rating at queue time), `queued_at`
  (kept on requeue), `status` (`searching` / `found` / `left`),
  `lobby_id`.
- `mm_lobbies`: `id`, `game`, `mode`, `status` (`accepting` / `waiting_server`
  / `live` / `finished` / `cancelled`), `accept_deadline`, `map`,
  `match_slug`, `created_at`.
- `mm_lobby_players`: `lobby_id`, `player_id`, `party_id`, `team` (1 or 2),
  `accepted_at`, `declined_at`.
- `mm_ratings`: `player_id`, `game`, `mode`, `mu`, `sigma`, `games`, `wins`,
  `updated_at`. Primary key `(player_id, game, mode)`.
- `mm_rating_history`: `player_id`, `game`, `mode`, `match_slug`,
  `mu_before`, `sigma_before`, `mu_after`, `sigma_after`, `created_at`.
- `mm_penalties`: `id`, `player_id`, `kind` (`decline` / `no_show` /
  `abandon`), `lobby_id`, `created_at`, `cooldown_until`, `cleared_by`.

Plus one column on `matches`: `source` (`tournament` / `manual` /
`matchmaking`), nullable for old rows.

The queue state is in the database, so a restart does not lose it. The
matching loop and accept timers run in memory and rebuild from the tables on
start. On restart, lobbies in `accepting` are cancelled without penalty and
their entries go back to `searching`.

## API

All under `/api/matchmaking`, all 404 while the flag is off.

| Method | Path | What |
| --- | --- | --- |
| GET | `/status` | Is matchmaking on, which modes, why "Find match" is disabled (no server, cooldown). Exists now. |
| GET | `/me` | My party, queue entry, lobby and cooldown. |
| POST | `/party` | Create a party. Returns the invite link. |
| POST | `/party/join` | Join by invite code. |
| POST | `/party/leave` | Leave (the leader leaving disbands it). |
| POST | `/queue` | Start searching (leader only). Body: `{ mode }`. |
| DELETE | `/queue` | Stop searching. |
| POST | `/lobbies/:id/accept` | Accept. |
| POST | `/lobbies/:id/decline` | Decline. |
| GET | `/lobbies/:id` | The match room: teams, map, server, connect info (only for its players). |
| GET | `/leaderboard?mode=` | Leaderboard. |
| GET | `/players/:steamId/history` | A player's matchmaking games. |
| GET/PUT | `/admin/settings` | Admin settings. |
| GET | `/admin/queue` | Live queue and lobbies for admins. |
| POST | `/admin/penalties/:id/clear` | Clear a cooldown. |

Writes are same-site JSON. Every call is by the signed-in player; no player
ids in bodies.

### Realtime events

Each signed-in player joins a room `player:<id>`. Events go only to the
players concerned.

| Event | Payload |
| --- | --- |
| `mm:queue` | Searching, time in queue, current window. |
| `mm:found` | Lobby id, accept deadline. |
| `mm:accept` | Accepted count out of total. |
| `mm:cancelled` | Reason (`declined`, `no_server`), requeued at front or not. |
| `mm:lobby` | The lobby changed (teams, map, veto step, server status). |
| `mm:party` | Party members changed. |
| `mm:cooldown` | Cooldown until. |

Admins get `mm:admin` in the existing admin room.

## UI

- **Find match button**: on the player home and the top bar. Disabled with a
  reason when no server, on cooldown, or not the party leader.
- **Queue bar**: a slim bar under the top bar on every page while searching.
  Mode, timer, Cancel.
- **Accept modal**: full-screen dim, big Accept button, 20 s countdown ring,
  "7 / 10 accepted". Plays a sound. Works in a background tab (title flash
  and a browser notification if allowed).
- **Match room** (`/play/:lobbyId`): two team cards with ratings, map (or
  veto), server status, a Connect button and the `connect` command to copy.
  After the match: score and rating change.
- **Party panel**: members, invite link, Leave.
- **Leaderboard** (`/play/leaderboard`) and **history tab** on the player
  profile.
- **Admin**: Settings → Matchmaking, and a live Queue view under Manage.

## Other games

Games without a server integration (manual-report games) cannot be put on a
server. For them, matchmaking becomes "find opponents": the same queue and
accept, then a lobby that shows who you play and a way to report the result
(the existing manual report flow). Later, after CS2 works.

## After the match: score, XP, levels and commends

Added 2026-10-05 (Vikunja 1811, 1812). Servers start in about 10 seconds now,
so a match is cheap to spin up; what keeps people coming back is what they
see after it.

### Post-match screen

The match room (`/play/:lobbyId`) turns into the result when the series ends:

- Final score, and per map for a Bo3.
- Scoreboard for both teams from the match stats: K / D / A, ADR, HS %, MVPs.
  Your own row is highlighted.
- Rating change (matchmaking rating, display Elo).
- XP gained, as a short breakdown (completed, win, performance, first win of
  the day) and a level bar that fills up. A level-up gets its own moment.
- Commend panel: every other player in the match, with thumbs up and thumbs
  down (below).
- The demo, once its upload has finished (the server is stopped right after
  that; Vikunja 1810).
- "Find another match", which queues the same party again.

The same screen is reachable later from the match page and the player's
history.

### XP and levels

XP measures how experienced you are on this platform: how much you play and
finish, not how good you are. The rating is for skill. A level can also gate
things, for example a tournament that only takes players from level 5 up, so
people have to play on the platform before they enter. Keeping them apart means a weaker player who plays a lot still
levels up, and levels can't be farmed to fake skill.

XP per finished match (the match ran to its end; you were present):

| Part | XP |
| --- | --- |
| Completed | 100 |
| Win / draw | +50 / +25 |
| Performance | 0 to +50: your rank in the lobby by match rating (top player +50, last 0) |
| First win of the day | +100 |

- No XP for a cancelled match, an abandon, or a match you left early.
- XP never goes down. Penalties are cooldowns, not lost XP.
- Only matchmaking gives XP (decided 2026-10-05). Tournament matches don't.

Levels: going from level *n* to *n + 1* takes `400 + 50 × (n − 1)` XP. A
match is worth about 200 XP on average, so the curve reads as "matches played"
early on and slows down later:

| Level | Total XP | About this many matches |
| --- | --- | --- |
| 5 | 1,900 | 10 |
| 10 | 5,400 | 27 |
| 20 | 16,150 | 80 |
| 50 | 78,400 | 390 |

No cap. Every 10 levels changes the badge colour, so veterans are visible at a
glance in lobbies, scoreboards and on profiles. The curve is a setting
(`mm_level_base`, `mm_level_step`), so it can be tuned once real numbers come
in.

**Level requirement on tournaments.** A tournament can set a minimum level to
register (default none). Later phase; it only needs `player_progress.level`.

Stored as a ledger, so an admin can see and correct where XP came from:

- `xp_events`: `id`, `player_id`, `match_slug`, `amount`, `reason`
  (`completed` / `win` / `draw` / `performance` / `first_win` / `admin`),
  `created_at`.
- `player_progress`: `player_id`, `total_xp`, `level`, `updated_at`. The level
  is derived from `total_xp`; the row is a cache rebuilt from the ledger.

Hooks in at `applySeriesResult`, next to the rating update. An admin can
grant or remove XP (`reason = admin`, with a note).

### Commends

After a match, each player can rate every other player from that match once:

- **Thumbs up**, with an optional tag: Friendly, Team player, Leader, Good comms.
- **Thumbs down**, with a required reason: Toxic, Griefing, AFK / left, Other.

Rules:

- Only players who were in that match, only about the others in it, only
  within 24 hours of the end. One vote per player per other player per match;
  it can be changed inside the window.
- Never shown who voted.
- Thumbs up: the profile shows the total and the most given tags.
- Thumbs down: the profile shows the total next to the thumbs up (decided
  2026-10-05), never who gave them. Admins also see the reasons. A player who
  gets thumbs down from 5 or more different players in 30 days is listed for
  review under Manage. A whole party voting someone down counts as one voter.
- No effect on rating or XP. (Later, matchmaking could avoid pairing players
  who downvoted each other; not now.)

Data: `commends`: `match_slug`, `from_player_id`, `to_player_id`, `value`
(+1 / −1), `tag`, `created_at`, primary key
`(match_slug, from_player_id, to_player_id)`.

API (same flag and rules as the rest):

| Method | Path | What |
| --- | --- | --- |
| GET | `/matches/:slug/result` | The post-match screen: score, scoreboard, my rating change, my XP breakdown, my commends given. |
| PUT | `/matches/:slug/commends/:playerId` | Body `{ value: 1 \| -1, tag }`. Same-site JSON, signed-in player only. |
| GET | `/players/:id/progress` | Level, XP, progress to next level, thumbs up and down, top tags. |
| GET | `/admin/commends/review` | Players over the thumbs-down threshold. |

### Phases

XP, levels and the post-match screen go into phase 3 (with the leaderboard
and history). Commends go into phase 3 too. Nothing here needs phase 2's
balancing, so the post-match screen can be built as soon as phase 1 has a
match room.

### Decisions (Sivert, 2026-10-05)

- XP from matchmaking only.
- Thumbs down shown as a count on profiles.
- Levels show how experienced a player is on the platform; the curve above is
  a starting point and a setting. Levels may gate tournaments later.
- First win of the day (+100) stays.

## Phases

| Phase | Scope | Size |
| --- | --- | --- |
| 0 | This PR: design doc and the experimental flag. | S (done) |
| 1 | Queue + accept, no ratings. Solo and parties, 5v5 only. Random teams (parties together), random map, standalone match, allocation, match room, cooldowns for declines, requeue at front. Admin queue view. | L (2–3 weeks) |
| 2 | Ratings and balancing. `mm_ratings`, seeding from the tournament rating, search window, balanced split, rating update on result, abandon detection from Ready Up presence. | M (1–2 weeks) |
| 3 | Leaderboard and history. Leaderboard page, profile tab, rating history, public/private setting. | S–M (1 week) |
| 4 | Polish. Captain veto, wingman 2v2, servers kept free for tournaments, regions, notifications, open to players (leave admin only), then drop the experimental flag. | M (1–2 weeks) |

"Find opponents" for manual-report games is after phase 4.

## Open questions for Sivert

1. **Who can play?** Only players already on the instance, or any Steam
   login once self-registration is on?
2. **Separate rating?** This design keeps a matchmaking rating apart from the
   tournament rating (seeded from it). Or one shared rating?
3. **Full parties**: may a party of 5 play against 5 solo players, or only
   against another party?
4. **Server priority**: is "tournament first, plus N kept free" enough, or
   should an admin mark servers as matchmaking-only?
5. **Map selection default**: random from the pool (fast) or captain veto
   (what players expect from FACEIT-style services)?
6. **Cooldown ladder**: are 2 min / 10 min / 1 h / 24 h right for a small
   community?
7. **Wingman in 3.1** or later?
8. **Licensing**: is matchmaking part of the free non-commercial tier, or a
   paid feature?
