/**
 * Trade-up picking on the Inventory page (pure: tested on its own). The
 * server checks the same rules (api skins/skinService.ts tradeUpRule): weapon
 * skins only (no knives or gloves), all of one grade below ancient, exactly
 * the site's count.
 */
import type { OwnedSkin, Rarity } from './useSkins';

const TRADEABLE: Rarity[] = ['common', 'uncommon', 'rare', 'mythical', 'legendary'];
const NEXT: Partial<Record<Rarity, Rarity>> = {
  common: 'uncommon',
  uncommon: 'rare',
  rare: 'mythical',
  mythical: 'legendary',
  legendary: 'ancient',
};

/** The grade a trade-up of `rarity` gives, or null. */
export function tradeUpTarget(rarity: Rarity): Rarity | null {
  return NEXT[rarity] ?? null;
}

/** Whether `skin` can join the picked ones: tradeable, the same grade, and room left. */
export function canPick(
  skin: Pick<OwnedSkin, 'id' | 'slot' | 'rarity'>,
  picked: ReadonlyArray<Pick<OwnedSkin, 'id' | 'rarity'>>,
  count: number
): boolean {
  if (picked.some((p) => p.id === skin.id)) return true;
  if (skin.slot === 'knife' || skin.slot === 'gloves') return false;
  if (!TRADEABLE.includes(skin.rarity)) return false;
  if (picked.length >= count) return false;
  return picked.length === 0 || picked[0].rarity === skin.rarity;
}

/** Pick or unpick `skin`. */
export function togglePick<T extends Pick<OwnedSkin, 'id' | 'slot' | 'rarity'>>(
  skin: T,
  picked: readonly T[],
  count: number
): T[] {
  if (picked.some((p) => p.id === skin.id)) return picked.filter((p) => p.id !== skin.id);
  return canPick(skin, picked, count) ? [...picked, skin] : [...picked];
}
