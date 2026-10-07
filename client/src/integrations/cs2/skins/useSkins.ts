import { useCallback, useEffect, useState } from 'react';
import { api, useAuth } from '../../../module-sdk';
import type { AccountMenuItem } from '../../types';
import { skinPaths } from './paths';

export type Rarity = 'common' | 'uncommon' | 'rare' | 'mythical' | 'legendary' | 'ancient' | 'immortal';

export interface OwnedSkin {
  id: number;
  weapon: string;
  weaponName: string;
  name: string;
  rarity: Rarity;
  imageUrl: string;
  slot: string;
  float: number;
  pattern: number;
  source: 'matchmaking' | 'tournament' | 'admin';
  sourceLabel: string | null;
  sourceRef: string | null;
  place: number | null;
  createdAt: number;
  seen: boolean;
  equipped: boolean;
}

export interface ShowcaseItem {
  skinId: number;
  big: boolean;
}

/** The account menu's Inventory link, while skins are on (`accountMenuItems`). */
export async function skinsAccountMenuItems(): Promise<AccountMenuItem[]> {
  const status = await api.get<{ enabled: boolean }>('/api/skins/status');
  return status.enabled ? [{ key: 'inventory', path: skinPaths.inventory, labelKey: 'skins.inventory' }] : [];
}

/** Whether virtual skins are on. Null while unknown. */
export function useSkinsEnabled(): boolean | null {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  useEffect(() => {
    let cancelled = false;
    api
      .get<{ enabled: boolean }>('/api/skins/status')
      .then((r) => !cancelled && setEnabled(Boolean(r.enabled)))
      .catch(() => !cancelled && setEnabled(false));
    return () => {
      cancelled = true;
    };
  }, []);
  return enabled;
}

/** Every skins view reloads after a change made in any of them (the reveal, the grid, the profile). */
const CHANGED = 'skins:changed';
/** Every open skins view reads again (after a change here, or a push from the platform). */
export function announceChange(): void {
  window.dispatchEvent(new Event(CHANGED));
}

/** The signed-in player's inventory, showcase and new skins, with the actions on them. */
export function useMySkins() {
  const { playerUid } = useAuth();
  const [inventory, setInventory] = useState<OwnedSkin[]>([]);
  const [showcase, setShowcase] = useState<ShowcaseItem[]>([]);
  const [unseen, setUnseen] = useState<number[]>([]);
  const [loading, setLoading] = useState(true);
  const [available, setAvailable] = useState(false);

  const reload = useCallback(async () => {
    if (!playerUid) {
      setLoading(false);
      setAvailable(false);
      return;
    }
    try {
      const data = await api.get<{ inventory: OwnedSkin[]; showcase: ShowcaseItem[]; unseen: number[] }>('/api/skins/me');
      setInventory(data.inventory ?? []);
      setShowcase(data.showcase ?? []);
      setUnseen(data.unseen ?? []);
      setAvailable(true);
    } catch {
      setAvailable(false);
    } finally {
      setLoading(false);
    }
  }, [playerUid]);

  useEffect(() => {
    void reload();
    const onChange = () => void reload();
    window.addEventListener(CHANGED, onChange);
    return () => window.removeEventListener(CHANGED, onChange);
  }, [reload]);

  /**
   * Equips at once (the grid shows it before the server answers), or, for
   * the skin already equipped, empties its slot: the game's default is back.
   */
  const equip = useCallback(
    async (skin: OwnedSkin) => {
      const off = skin.equipped;
      setInventory((list) =>
        list.map((s) => (s.slot === skin.slot ? { ...s, equipped: !off && s.id === skin.id } : s))
      );
      try {
        if (off) await api.delete(`/api/skins/me/equip/${encodeURIComponent(skin.slot)}`);
        else await api.post('/api/skins/me/equip', { skinId: skin.id });
      } finally {
        announceChange();
      }
    },
    []
  );

  const markSeen = useCallback(async (ids: number[]) => {
    setUnseen((list) => list.filter((id) => !ids.includes(id)));
    await api.post('/api/skins/me/seen', { ids }).catch(() => undefined);
    announceChange();
  }, []);

  const saveShowcase = useCallback(
    async (items: ShowcaseItem[]) => {
      setShowcase(items);
      await api.put('/api/skins/me/showcase', { items });
      announceChange();
    },
    []
  );

  return { inventory, showcase, unseen, loading, available, reload, equip, markSeen, saveShowcase };
}

/** The slots a loadout shows: knife and gloves always, then each weapon with a skin owned. */
export function loadoutSlots(inventory: OwnedSkin[]): string[] {
  const weapons = [...new Set(inventory.map((s) => s.slot).filter((s) => s !== 'knife' && s !== 'gloves'))];
  return ['knife', 'gloves', ...weapons];
}

/** "Factory New" … "Battle-Scarred" for a float, as CS2 names wear. */
export function wearKey(float: number): 'fn' | 'mw' | 'ft' | 'ww' | 'bs' {
  if (float < 0.07) return 'fn';
  if (float < 0.15) return 'mw';
  if (float < 0.38) return 'ft';
  if (float < 0.45) return 'ww';
  return 'bs';
}
