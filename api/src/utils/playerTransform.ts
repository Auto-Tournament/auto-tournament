interface RawPlayer {
  steamid?: string;
  steamId?: string;
  name?: string | { name?: string; steamId?: string };
  avatar?: string;
}

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
  players?: Record<string, unknown> | Array<unknown>
): NormalizedServerPlayer[] {
  if (!players) return [];

  if (Array.isArray(players)) {
    return players.map((player, index) => normalizeSinglePlayer(player, `player_${index}`));
  }

  return Object.entries(players).map(([key, value]) => normalizeSinglePlayer(value, key));
}

function normalizeSinglePlayer(value: unknown, fallbackKey: string): NormalizedServerPlayer {
  if (typeof value === 'string') {
    return { steamid: fallbackKey, name: value };
  }

  if (value && typeof value === 'object') {
    const player = value as RawPlayer;

    if (typeof player.name === 'object' && player.name !== null) {
      const nested = player.name as { name?: string; steamId?: string; avatar?: string };
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

