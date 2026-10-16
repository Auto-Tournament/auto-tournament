/**
 * Skin rarity colours, the ones CS2 players know (consumer grey-blue through
 * contraband gold), for the virtual skins' rarity bars and marks.
 */
export const rarityColor: Record<string, string> = {
  common: '#b0c3d9',
  uncommon: '#5e98d9',
  rare: '#4b69ff',
  mythical: '#8847ff',
  legendary: '#d32ce6',
  ancient: '#eb4b4b',
  immortal: '#e4ae39',
};

/** Rarities from worst to best. */
export const RARITY_ORDER = [
  'common',
  'uncommon',
  'rare',
  'mythical',
  'legendary',
  'ancient',
  'immortal',
];

/** The best rarity among some skins (a pick's three options). */
export function bestRarity(rarities: string[]): string {
  return rarities.reduce(
    (best, r) => (RARITY_ORDER.indexOf(r) > RARITY_ORDER.indexOf(best) ? r : best),
    rarities[0] ?? 'common'
  );
}
