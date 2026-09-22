export interface NormalizedPlayer {
  steamid: string;
  name: string;
  avatar?: string;
}

/**
 * Normalize player data coming from match configs, MatchZy payloads, or legacy formats.
 */
export function normalizeConfigPlayers(players: unknown): NormalizedPlayer[] {
  if (!players) return [];

  if (Array.isArray(players)) {
    return players.map((player, index) => normalizeSinglePlayer(player, `player_${index}`));
  }

  if (typeof players === 'object') {
    return Object.entries(players).map(([key, value]) => normalizeSinglePlayer(value, key));
  }

  return [];
}

function normalizeSinglePlayer(player: unknown, fallbackKey: string): NormalizedPlayer {
  if (typeof player === 'string') {
    return { steamid: fallbackKey, name: player };
  }

  if (player && typeof player === 'object') {
    const p = player as {
      steamid?: string;
      steamId?: string;
      name?: string | { name?: string; steamId?: string; avatar?: string };
      avatar?: string;
    };

    if (typeof p.name === 'object' && p.name !== null) {
      const nested = p.name as { name?: string; steamId?: string; avatar?: string };
      return {
        steamid: nested.steamId || p.steamid || p.steamId || fallbackKey,
        name: nested.name || fallbackKey,
        avatar: nested.avatar || p.avatar,
      };
    }

    return {
      steamid: p.steamid || p.steamId || fallbackKey,
      name: typeof p.name === 'string' ? p.name : fallbackKey,
      avatar: p.avatar,
    };
  }

  return { steamid: fallbackKey, name: 'Unknown' };
}

