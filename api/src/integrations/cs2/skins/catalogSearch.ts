/**
 * Catalogue search for the skins routes: the admin reward picker and the
 * players' catalogue picks share one filter.
 */

import type { Untrusted } from '../../../utils/untrusted';
import { SKIN_IMAGES_BASE, sideOf, slotOf, variantOf, type CatalogSkin } from './skinService';

const PISTOLS = [
  'glock',
  'hkp2000',
  'usp_silencer',
  'p250',
  'fiveseven',
  'tec9',
  'cz75a',
  'deagle',
  'revolver',
  'taser',
  'elite',
];
const SMGS = ['mac10', 'mp9', 'mp7', 'mp5sd', 'ump45', 'p90', 'bizon'];
const HEAVY = ['nova', 'xm1014', 'sawedoff', 'mag7', 'm249', 'negev'];

export const CATEGORIES = ['knives', 'gloves', 'pistols', 'smgs', 'rifles', 'heavy'] as const;
export type Category = (typeof CATEGORIES)[number];

/** The weapon group a catalogue chip filters on. */
export function categoryOf(weapon: string): Category {
  const slot = slotOf(weapon);
  if (slot === 'knife') return 'knives';
  if (slot === 'gloves') return 'gloves';
  const w = weapon.replace('weapon_', '');
  if (PISTOLS.includes(w)) return 'pistols';
  if (SMGS.includes(w)) return 'smgs';
  if (HEAVY.includes(w)) return 'heavy';
  return 'rifles';
}

export interface CatalogQuery {
  q?: Untrusted;
  weapon?: Untrusted;
  /** A loadout slot: every knife, every glove. */
  slot?: Untrusted;
  category?: Untrusted;
  /** One row per paint kit (each Doppler phase) instead of one per name. */
  all?: boolean;
}

/** Catalogue skins matching the query, with their variant and images. */
export function searchCatalog(catalog: CatalogSkin[], query: CatalogQuery) {
  const words = String(query.q ?? '')
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  const weapon = typeof query.weapon === 'string' ? query.weapon : '';
  const slot = typeof query.slot === 'string' ? query.slot : '';
  const category = typeof query.category === 'string' ? query.category : '';
  const seen = new Set<string>();
  return catalog
    .filter(
      (s) =>
        (!weapon || s.weapon === weapon) &&
        (!slot || slotOf(s.weapon) === slot) &&
        (!category || categoryOf(s.weapon) === category)
    )
    .map((s) => ({
      ...s,
      variant: variantOf(s.paintKitName),
      imageUrl: `${SKIN_IMAGES_BASE}/${s.image}`,
    }))
    .filter((s) => {
      const text = `${s.weaponName} ${s.name} ${s.variant ?? ''}`.toLowerCase();
      return words.every((w) => text.includes(w));
    })
    .filter((s) => {
      const key = query.all ? `${s.weapon}|${s.paintKit}` : `${s.weapon}|${s.name}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

/** What a player sees of a catalogue skin when picking. */
export function pickableSkin(s: ReturnType<typeof searchCatalog>[number]) {
  return {
    weapon: s.weapon,
    weaponName: s.weaponName,
    paintKit: s.paintKit,
    name: s.name,
    rarity: s.rarity,
    variant: s.variant,
    slot: slotOf(s.weapon),
    side: sideOf(s.weapon),
    imageUrl: s.imageUrl,
  };
}

/** Every loadout slot of the catalogue, knife and gloves first, with the side that buys it. */
export function catalogWeapons(catalog: CatalogSkin[]) {
  const bySlot = new Map<
    string,
    { weapon: string; weaponName: string; slot: string; category: Category; side: 2 | 3 | null }
  >();
  const knife = catalog.find((s) => slotOf(s.weapon) === 'knife');
  const gloves = catalog.find((s) => slotOf(s.weapon) === 'gloves');
  if (knife)
    bySlot.set('knife', {
      weapon: knife.weapon,
      weaponName: 'Knife',
      slot: 'knife',
      category: 'knives',
      side: null,
    });
  if (gloves)
    bySlot.set('gloves', {
      weapon: gloves.weapon,
      weaponName: 'Gloves',
      slot: 'gloves',
      category: 'gloves',
      side: null,
    });
  for (const s of catalog) {
    const slot = slotOf(s.weapon);
    if (!bySlot.has(slot))
      bySlot.set(slot, {
        weapon: s.weapon,
        weaponName: s.weaponName,
        slot,
        category: categoryOf(s.weapon),
        side: sideOf(s.weapon),
      });
  }
  return [...bySlot.values()].sort(
    (a, b) =>
      CATEGORIES.indexOf(a.category) - CATEGORIES.indexOf(b.category) ||
      a.weaponName.localeCompare(b.weaponName)
  );
}
