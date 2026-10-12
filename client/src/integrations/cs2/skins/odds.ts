/**
 * The drop odds players can look up (GET /api/skins/odds): per rarity, per
 * exact skin, and when drops happen.
 */
import { useEffect, useState } from 'react';
import { api } from '../../../module-sdk';
import type { Rarity } from './useSkins';

export { formatOdds } from './formatOdds';

export interface RarityOdds {
  rarity: Rarity;
  chance: number;
  skins: number;
  perSkin: number;
}

export interface DropOdds {
  optionsPerDrop: number;
  rarities: RarityOdds[];
  matchmakingDrops: boolean;
  tournamentMatchDrops: boolean;
  levelUpDrops: boolean;
  chances: Record<'5v5' | '2v2' | '1v1', { win: number; play: number }>;
  tournamentRewards: Array<{
    place: 1 | 2 | 3;
    mode: 'random' | 'skin';
    rarity: Rarity | null;
    weapon: string | null;
    name: string | null;
  }>;
}

/** The odds, asked once; null while loading or when skins are off. */
export function useDropOdds(): { odds: DropOdds | null; loaded: boolean } {
  const [odds, setOdds] = useState<DropOdds | null>(null);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let live = true;
    api
      .get<DropOdds & { success: boolean }>('/api/skins/odds')
      .then((res) => live && setOdds(res.success ? res : null))
      .catch(() => live && setOdds(null))
      .finally(() => live && setLoaded(true));
    return () => {
      live = false;
    };
  }, []);
  return { odds, loaded };
}
