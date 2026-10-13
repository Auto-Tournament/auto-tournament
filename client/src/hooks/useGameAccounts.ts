import { useEffect, useState } from 'react';
import { api } from '../utils/api';

/** An account an installed game needs (GET /api/games/accounts): CS2 → Steam, Rocket League → Epic Games. */
export interface GameAccount {
  provider: string;
  label: string;
  games: { id: string; name: string }[];
}

let cached: Promise<GameAccount[]> | null = null;

function load(): Promise<GameAccount[]> {
  if (!cached) {
    cached = api
      .get<{ accounts?: GameAccount[] }>('/api/games/accounts')
      .then((r) => r.accounts ?? [])
      .catch(() => {
        cached = null;
        return [];
      });
  }
  return cached;
}

/**
 * The accounts the installed games need, for the admin's player and team
 * forms (Vikunja 1771): ask for these, not a Steam ID everywhere. `null`
 * while loading. `steam`: some installed game identifies players by Steam.
 */
export function useGameAccounts(): {
  accounts: GameAccount[] | null;
  steam: boolean;
  others: GameAccount[];
} {
  const [accounts, setAccounts] = useState<GameAccount[] | null>(null);
  useEffect(() => {
    let alive = true;
    void load().then((a) => alive && setAccounts(a));
    return () => {
      alive = false;
    };
  }, []);
  return {
    accounts,
    steam: (accounts ?? []).some((a) => a.provider === 'steam'),
    others: (accounts ?? []).filter((a) => a.provider !== 'steam'),
  };
}

/** A Steam ID64: 17 digits starting 7656. */
export const isSteamId64 = (id: string | null | undefined) => !!id && /^7656\d{13}$/.test(id);
