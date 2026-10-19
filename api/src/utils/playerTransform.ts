/** One player as configs have stored them over time. */
export interface StoredConfigPlayer {
  steamid?: string;
  steamId?: string;
  name?: string | { name?: string; steamId?: string; avatar?: string };
  avatar?: string;
}

/**
 * A config's roster: MatchZy's `{ "<steamid>": "<name>" }`, or a list (or
 * keyed object) of player objects.
 */
export type StoredConfigPlayers =
  Record<string, string | StoredConfigPlayer> | Array<string | StoredConfigPlayer>;

export interface NormalizedServerPlayer {
  steamid: string;
  name: string;
  avatar?: string;
}

/**
 * Normalize player objects stored in match configs (arrays or dictionaries) into
 * a consistent `{ steamid, name }` array for API responses.
 */
export function normalizeConfigPlayers(
  players?: StoredConfigPlayers | null
): NormalizedServerPlayer[] {
  if (!players) return [];

  if (Array.isArray(players)) {
    return players.map((player, index) => normalizeSinglePlayer(player, `player_${index}`));
  }

  return Object.entries(players).map(([key, value]) => normalizeSinglePlayer(value, key));
}

function normalizeSinglePlayer(
  value: string | StoredConfigPlayer | null | undefined,
  fallbackKey: string
): NormalizedServerPlayer {
  if (typeof value === 'string') {
    return { steamid: fallbackKey, name: value };
  }

  if (value) {
    const player = value;

    if (typeof player.name === 'object') {
      const nested = player.name;
      return {
        steamid: nested.steamId || player.steamid || player.steamId || fallbackKey,
        name: nested.name || fallbackKey,
        avatar: nested.avatar || player.avatar,
      };
    }

    return {
      steamid: player.steamid || player.steamId || fallbackKey,
      name: typeof player.name === 'string' ? player.name : fallbackKey,
      avatar: player.avatar,
    };
  }

  return { steamid: fallbackKey, name: 'Unknown' };
}
