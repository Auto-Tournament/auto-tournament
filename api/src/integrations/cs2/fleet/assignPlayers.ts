/**
 * Per-player parts of match.assign the driver adds after the config is built: each team's captain
 * and each player's teammate colour. Pure; re-exported from assignConfig.ts.
 */
import type { AssignConfig, AssignPlayer, AssignTeam, TeammateColorName } from './protocol/v1';

function roleOf(player: AssignPlayer): string {
  return player.role ?? 'player';
}

/**
 * The team's captain for the server (Ready Up: only the captain picks a side after the knife
 * round): the one the config names (matchmaking), else the first of `platform` on the roster (the
 * team's captains on the platform), else the highest-rated player (`rating`, from withRatings), else
 * the first player. Coaches never; a team with no player gets none.
 */
export function pickTeamCaptain(
  side: AssignTeam,
  platform: readonly string[] = []
): string | undefined {
  const playing = side.players.filter((p) => roleOf(p) !== 'coach');
  const on = (id: string | undefined) => (id ? playing.find((p) => p.steamid64 === id) : undefined);
  if (on(side.captain)) return side.captain;
  for (const id of platform) if (on(id)) return id;
  const players = playing.filter((p) => roleOf(p) === 'player');
  const pool = players.length ? players : playing;
  if (pool.length === 0) return undefined;
  // Highest rated; unrated players count as below every rating; a tie keeps roster order.
  let best = pool[0];
  for (const p of pool) {
    if ((p.rating ?? -1) > (best.rating ?? -1)) best = p;
  }
  return best.steamid64;
}

/** Every team with a player names a captain (pickTeamCaptain). `platform`: each side's captains on the platform. */
export function withCaptains(
  config: AssignConfig,
  platform: { team1?: readonly string[]; team2?: readonly string[] } = {}
): AssignConfig {
  const add = (side: AssignTeam, ids: readonly string[] | undefined): AssignTeam => {
    const captain = pickTeamCaptain(side, ids ?? []);
    if (!captain) {
      const rest = { ...side };
      delete rest.captain;
      return rest;
    }
    return { ...side, captain };
  };
  return {
    ...config,
    team1: add(config.team1, platform.team1),
    team2: add(config.team2, platform.team2),
  };
}

/**
 * Each player's teammate colour. Per team, in this order, a colour already taken on the team is
 * skipped (that player gets CS2's pick): the colours the team's owner or a captain set (`set`,
 * team_members.color), then the players' own (`own`, players.teammate_color), the team's captain
 * first, then roster order. Coaches never get one.
 */
export function withColors(
  config: AssignConfig,
  own: ReadonlyMap<string, TeammateColorName>,
  set: {
    team1?: ReadonlyMap<string, TeammateColorName>;
    team2?: ReadonlyMap<string, TeammateColorName>;
  } = {}
): AssignConfig {
  const add = (
    side: AssignTeam,
    forced: ReadonlyMap<string, TeammateColorName> | undefined
  ): AssignTeam => {
    const playing = side.players.filter((p) => roleOf(p) !== 'coach');
    const order = [
      ...playing.filter((p) => p.steamid64 === side.captain),
      ...playing.filter((p) => p.steamid64 !== side.captain),
    ];
    const given = new Map<string, TeammateColorName>();
    const taken = new Set<TeammateColorName>();
    for (const pass of [forced, own]) {
      for (const p of order) {
        const want = pass?.get(p.steamid64);
        if (!want || given.has(p.steamid64) || taken.has(want)) continue;
        given.set(p.steamid64, want);
        taken.add(want);
      }
    }
    if (given.size === 0) return side;
    return {
      ...side,
      players: side.players.map((p) => {
        const color = given.get(p.steamid64);
        return color ? { ...p, color } : p;
      }),
    };
  };
  return { ...config, team1: add(config.team1, set.team1), team2: add(config.team2, set.team2) };
}
