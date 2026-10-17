# Match lineups: who plays when the roster is bigger than the team size

Status: built (this PR). Tracker: Vikunja #2182.

## The problem

At a LAN on 2026-10-17 a team with five players entered a 2v2 tournament and
could not bring its sub in. Nothing let the team pick who plays a match, and an
admin could not make the sub play either.

## How a roster reaches the server today

1. **Match config** (`api/src/integrations/cs2/matchConfig.ts`,
   `generateMatchConfig`). A bracket match's config is rebuilt on every read
   (`utils/matchIntegration.ts` `currentMatchConfig`), so it follows the teams
   table. Each side's players come from
   `tournamentSignupService.lineupRoster`: a team that signed itself up uses
   its tournament lineup (up to `teamSize` starters plus two subs), a team an
   admin added uses its **whole roster**. Players without a Steam ID are left
   out. Everyone goes into `team.players`; nobody is marked as a substitute.
2. **`match.assign`** (`fleet/assignConfig.ts` `buildAssignConfig`). Every
   entry of `team.players` becomes a roster player with role `player`
   (`substitutes` would get role `sub`, but the builder never sets it).
   `players_per_team` is not sent unless bot fill is on.
3. **Ready Up** turns the assign config into its match context
   (`fleet_state.cpp`). Every roster entry is whitelisted and joins its team's
   side (team lock). Without subs, the ready gate (`min_per_team: 0`, "full
   roster") and the team-ready rule (`rules.ready.team_ready`) count **every
   roster player**.

So for team size vs roster size: **all of them are sent, as players.** A
five-player team in a 2v2 has all five whitelisted onto its side, and the
ready gate waits for five. A signed-up team's two subs are sent as starters
too, with the same effect.

`match.update` (FLEET.md §7.3) already carries roster changes to a match a
server is running: `add_player` / `remove_player`, applied all or none, and
Ready Up rebuilds its match context from them (`fleet_bridge.cpp OnUpdate`),
ready count included. Its team lock puts a roster player on their side, and
anyone not on the roster goes to the spectators until the whitelist removes
them. `syncMatch` (fleet driver)
rebuilds the assign config, diffs it against the acked one and sends the
difference. **Ready Up needs no change.**

## The proposal

**A lineup per match and team.** When a team's pool (its tournament lineup,
else its roster) has more players than the tournament's team size `N` (2 in
wingman), the match uses `N` of them: the lineup. The rest are on the bench.

- Stored in `match_lineups (match_slug, team_id, players, set_by, updated_at)`.
  No row means the default: the team's lineup from its last match in this
  tournament (players who left the pool dropped and refilled in pool order),
  else the first `N` of the pool (signed-up starters come first).
- **Who sets it**: the team's owner or a captain; a team with neither lets any
  of its members. Admins can set either team's lineup (ManageMatch).
- **When**: before the match goes live (pending, veto, loaded / warmup). In a
  series, also between maps: while the match is `live`, the game module says
  whether it is between maps (`betweenMaps`; CS2: Ready Up's phase is
  `map_end`, `warmup` or `loading`). A change then applies from the next map.
  Admins have the same window: changing who is on a team mid-map would swap a
  player out of a live round.
- **Server side**: the config's `team.players` is the lineup. The bench is
  **not on the server at all**: not on a team, not in `spectators`, so the
  whitelist keeps them out. They watch through the delayed GOTV like everyone
  else, so a benched player cannot ghost for their team (owner's decision,
  2026-10-17). A change while the match is on a Ready Up server goes out at
  once (`onLineupChanged` → `syncMatch` → `match.update`: `remove_player` for
  the benched player, `add_player` for the new one). A benched player who is
  still connected goes to the spectators and is then removed by the
  whitelist.
- **Ready and "everyone connected"**: they read the roster, which is now the
  lineup, so a 2v2 waits for two a side, and team ready counts the lineup.
  Nothing else changes for teams whose pool fits the team size.

Not in scope: shuffle tournaments (teams are drawn per match), standalone
matches (their stored roster is what the admin typed), and the RCON transport
(MatchZy reloads the config on its own, so it follows on the next load).

## Open questions

- A team whose pool is bigger than `N` and whose signed-up lineup lists subs:
  the subs are in the pool, so they can be picked. The sign-up's starter/sub
  split only orders the default.
