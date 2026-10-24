import { useCallback, useEffect, useState } from 'react';
import { api, useAuth } from '../../../module-sdk';
import type { AccountMenuItem } from '../../types';
import { skinPaths } from './paths';
import { applyStep, equipOnStep, equipStep, type LoadoutTeam } from './loadoutSides';

export type Rarity =
  'common' | 'uncommon' | 'rare' | 'mythical' | 'legendary' | 'ancient' | 'immortal';

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
  source: 'matchmaking' | 'tournament' | 'admin' | 'level' | 'tradeup' | 'catalog';
  sourceLabel: string | null;
  sourceRef: string | null;
  place: number | null;
  createdAt: number;
  seen: boolean;
  equipped: boolean;
  /** Where it is equipped: 0 both sides, 2 T, 3 CT. */
  equippedSides: LoadoutTeam[];
  /** The one side that buys this weapon (2 T, 3 CT), or null when both do. */
  side: 2 | 3 | null;
  /** A StatTrak skin's kill count; null for a plain one. */
  stattrak: number | null;
}

/** A drop waiting for the player to keep one of its options (api: skinService.openChoices). */
export interface SkinChoice {
  id: number;
  source: OwnedSkin['source'];
  sourceLabel: string | null;
  /** The match slug for a match drop, `level:<n>`, or `tournament:<id>:…` for a prize. */
  sourceRef: string | null;
  place: number | null;
  createdAt: number;
  options: Array<{
    weapon: string;
    weaponName: string;
    name: string;
    rarity: Rarity;
    image: string;
    float: number;
    pattern: number;
    stattrak?: boolean;
  }>;
}

/** A catalogue skin a player can pick while the catalogue is unlocked (api: GET /api/skins/catalog/search). */
export interface CatalogSkin {
  weapon: string;
  weaponName: string;
  paintKit: number;
  name: string;
  rarity: Rarity;
  variant: string | null;
  slot: string;
  side: 2 | 3 | null;
  imageUrl: string;
}

/** One loadout slot of the catalogue (api: GET /api/skins/catalog/weapons). */
export interface CatalogWeapon {
  weapon: string;
  weaponName: string;
  slot: string;
  category: 'knives' | 'gloves' | 'pistols' | 'smgs' | 'rifles' | 'heavy';
  side: 2 | 3 | null;
}

export interface PickInput {
  weapon: string;
  paintKit: number;
  float: number;
  seed: number;
  team: LoadoutTeam;
}

export interface ShowcaseItem {
  skinId: number;
  big: boolean;
}

/** The account menu's Inventory link, while skins are on (`accountMenuItems`). */
export async function skinsAccountMenuItems(): Promise<AccountMenuItem[]> {
  const status = await api.get<{ enabled: boolean }>('/api/skins/status');
  return status.enabled
    ? [{ key: 'inventory', path: skinPaths.inventory, labelKey: 'skins.inventory' }]
    : [];
}

/** Whether virtual skins are on, and whether players may pick any catalogue skin. Null while unknown. */
export function useSkinsStatus(): { enabled: boolean; catalogUnlocked: boolean } | null {
  const [status, setStatus] = useState<{ enabled: boolean; catalogUnlocked: boolean } | null>(null);
  useEffect(() => {
    let cancelled = false;
    api
      .get<{ enabled: boolean; catalogUnlocked?: boolean }>('/api/skins/status')
      .then(
        (r) =>
          !cancelled &&
          setStatus({ enabled: Boolean(r.enabled), catalogUnlocked: Boolean(r.catalogUnlocked) })
      )
      .catch(() => !cancelled && setStatus({ enabled: false, catalogUnlocked: false }));
    return () => {
      cancelled = true;
    };
  }, []);
  return status;
}

/** Whether virtual skins are on. Null while unknown. */
export function useSkinsEnabled(): boolean | null {
  return useSkinsStatus()?.enabled ?? null;
}

/** Every loadout slot of the catalogue; empty until loaded or while it is locked. */
export function useCatalogWeapons(active: boolean): CatalogWeapon[] {
  const [weapons, setWeapons] = useState<CatalogWeapon[]>([]);
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    api
      .get<{ weapons: CatalogWeapon[] }>('/api/skins/catalog/weapons')
      .then((r) => !cancelled && setWeapons(r.weapons ?? []))
      .catch(() => !cancelled && setWeapons([]));
    return () => {
      cancelled = true;
    };
  }, [active]);
  return active ? weapons : [];
}

/** Every skins view reloads after a change made in any of them (the reveal, the grid, the profile). */
const CHANGED = 'skins:changed';
/** Every open skins view reads again (after a change here, or a push from the platform). */
export function announceChange(): void {
  window.dispatchEvent(new Event(CHANGED));
}

const PICK = 'skins:pick';

/** Open the picker for one choice (the bell's pinned row, a page's Pick row). */
export function openSkinPick(choiceId: number): void {
  window.dispatchEvent(new CustomEvent<number>(PICK, { detail: choiceId }));
}

/** Listen for `openSkinPick`. */
export function onSkinPick(handler: (choiceId: number) => void): () => void {
  const listener = (e: Event) => handler((e as CustomEvent<number>).detail);
  window.addEventListener(PICK, listener);
  return () => window.removeEventListener(PICK, listener);
}

/** Whether a choice came from this match or this tournament. */
export function choiceFrom(
  choice: SkinChoice,
  where: { matchSlug?: string; tournamentId?: number | null }
): boolean {
  if (!choice.sourceRef) return false;
  if (where.matchSlug && choice.sourceRef === where.matchSlug) return true;
  return !!where.tournamentId && choice.sourceRef.startsWith(`tournament:${where.tournamentId}:`);
}

/** The signed-in player's inventory, showcase and new skins, with the actions on them. */
export function useMySkins() {
  const { playerUid } = useAuth();
  const [inventory, setInventory] = useState<OwnedSkin[]>([]);
  const [picks, setPicks] = useState<OwnedSkin[]>([]);
  const [showcase, setShowcase] = useState<ShowcaseItem[]>([]);
  const [unseen, setUnseen] = useState<number[]>([]);
  const [choices, setChoices] = useState<SkinChoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [available, setAvailable] = useState(false);

  const reload = useCallback(async () => {
    if (!playerUid) {
      setLoading(false);
      setAvailable(false);
      return;
    }
    try {
      const data = await api.get<{
        inventory: OwnedSkin[];
        picks?: OwnedSkin[];
        showcase: ShowcaseItem[];
        unseen: number[];
        choices?: SkinChoice[];
      }>('/api/skins/me');
      setInventory(data.inventory ?? []);
      setPicks(data.picks ?? []);
      setShowcase(data.showcase ?? []);
      setUnseen(data.unseen ?? []);
      setChoices(data.choices ?? []);
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
   * Equips for a side (0 both, 2 T, 3 CT) at once (the grid shows it before
   * the server answers), or, for a skin already on that side, takes it off
   * that side: the game's default is back there.
   */
  const equip = useCallback(async (skin: OwnedSkin, wanted: LoadoutTeam = 0) => {
    const step = equipStep(skin, wanted);
    const off = (team: LoadoutTeam) =>
      api.delete(`/api/skins/me/equip/${encodeURIComponent(skin.slot)}?team=${team}`);
    let before: OwnedSkin[] = [];
    setInventory((list) => {
      before = list;
      return applyStep(list, skin, step);
    });
    try {
      if (step.kind === 'unequip') await off(step.team);
      else if (step.kind === 'equip')
        await api.post('/api/skins/me/equip', { skinId: skin.id, team: step.team });
      else {
        await off(0);
        await api.post('/api/skins/me/equip', { skinId: skin.id, team: step.keep });
      }
    } catch (error) {
      // A refused equip used to vanish (the grid showed it equipped, the
      // server never stored it): put the grid back and tell the caller.
      setInventory(before);
      throw error;
    } finally {
      announceChange();
    }
  }, []);

  /** Put a skin on a side (0 both, 2 T, 3 CT); nothing when it is already there. */
  const equipOn = useCallback(async (skin: OwnedSkin, wanted: LoadoutTeam = 0) => {
    const step = equipOnStep(skin, wanted);
    if (!step) return;
    let before: OwnedSkin[] = [];
    setInventory((list) => {
      before = list;
      return applyStep(list, skin, step);
    });
    try {
      if (step.kind === 'equip')
        await api.post('/api/skins/me/equip', { skinId: skin.id, team: step.team });
      else if (step.kind === 'split') {
        // Off both sides, then on the one asked for.
        await api.delete(`/api/skins/me/equip/${encodeURIComponent(skin.slot)}?team=0`);
        await api.post('/api/skins/me/equip', { skinId: skin.id, team: step.keep });
      }
    } catch (error) {
      setInventory(before);
      throw error;
    } finally {
      announceChange();
    }
  }, []);

  /** Equip any catalogue skin with a float and seed for a side; the server answers with the new picks. */
  const pick = useCallback(async (input: PickInput) => {
    try {
      await api.put('/api/skins/me/picks', input);
    } finally {
      announceChange();
    }
  }, []);

  /** Take a pick off one side (every side with no team); the server drops the pick with it. */
  const unequipPick = useCallback(async (skin: OwnedSkin, team?: LoadoutTeam) => {
    try {
      await api.delete(
        `/api/skins/me/equip/${encodeURIComponent(skin.slot)}${team === undefined ? '' : `?team=${team}`}`
      );
    } finally {
      announceChange();
    }
  }, []);

  /** Keep option `index` of a choice; the kept skin then shows as new. */
  const choose = useCallback(async (choiceId: number, index: number) => {
    await api.post<{ skinId: number }>(`/api/skins/me/choices/${choiceId}`, { index });
    setChoices((list) => list.filter((c) => c.id !== choiceId));
    announceChange();
  }, []);

  const markSeen = useCallback(async (ids: number[]) => {
    setUnseen((list) => list.filter((id) => !ids.includes(id)));
    await api.post('/api/skins/me/seen', { ids }).catch(() => undefined);
    announceChange();
  }, []);

  const saveShowcase = useCallback(async (items: ShowcaseItem[]) => {
    setShowcase(items);
    await api.put('/api/skins/me/showcase', { items });
    announceChange();
  }, []);

  return {
    inventory,
    picks,
    pick,
    unequipPick,
    showcase,
    unseen,
    choices,
    choose,
    loading,
    available,
    reload,
    equip,
    equipOn,
    markSeen,
    saveShowcase,
  };
}

/**
 * The slots a loadout shows: knife and gloves always, then each weapon with a
 * skin owned or picked, and every weapon of the catalogue while it is unlocked.
 */
export function loadoutSlots(
  inventory: OwnedSkin[],
  picks: OwnedSkin[] = [],
  catalogWeapons: CatalogWeapon[] = []
): string[] {
  const weapons = [
    ...new Set(
      [...catalogWeapons, ...inventory, ...picks]
        .map((s) => s.slot)
        .filter((s) => s !== 'knife' && s !== 'gloves')
    ),
  ];
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
