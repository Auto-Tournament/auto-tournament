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

/**
 * The lowest price (USD) of each rarity above common, as the API ranks skins
 * (api skins/skinPrices.ts PRICE_BANDS): common under $1 up to immortal from $1,500.
 */
export const PRICE_BANDS = [1, 5, 25, 100, 400, 1500];

/** The ends of the price scale (USD): about the cheapest and the dearest skins on the market. */
export const PRICE_SCALE = { min: 0.03, max: 10000 };

/** Where a price sits on the price scale, 0 to 1. Log scale: $1 to $5 is as wide as $400 to $2,000. */
export function pricePosition(price: number): number {
  const lo = Math.log10(PRICE_SCALE.min);
  const hi = Math.log10(PRICE_SCALE.max);
  const at = (Math.log10(Math.max(PRICE_SCALE.min, price)) - lo) / (hi - lo);
  return Math.min(1, Math.max(0, at));
}

/** Each rarity's price range on the scale: from (USD, null for the bottom) and to (null for the top). */
export function priceBands(): Array<{ rarity: string; from: number | null; to: number | null }> {
  return RARITY_ORDER.map((rarity, i) => ({
    rarity,
    from: i === 0 ? null : PRICE_BANDS[i - 1],
    to: i < PRICE_BANDS.length ? PRICE_BANDS[i] : null,
  }));
}
