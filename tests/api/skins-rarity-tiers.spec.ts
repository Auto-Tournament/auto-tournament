import { test, expect } from '@playwright/test';
import {
  dropEntries,
  floatRange,
  normalizeConfig,
  rarityAt,
  withPrices,
  type CatalogSkin,
} from '../../api/src/integrations/cs2/skins/skinService';
import {
  priceKey,
  PRICE_BANDS as API_BANDS,
} from '../../api/src/integrations/cs2/skins/skinPrices';
import {
  PRICE_BANDS,
  RARITY_ORDER,
  priceBands,
  pricePosition,
} from '../../client/src/integrations/cs2/skins/rarity';

/**
 * A skin's rarity is the price band of its finish and wear: a Factory New
 * glove can be immortal and the same glove Battle-Scarred legendary. Drops
 * come per finish and wear; a granted skin's rarity follows its float.
 *
 * @tag api
 */

const vice: CatalogSkin = {
  weapon: 'sporty_gloves',
  weaponName: 'Sport Gloves',
  paintKit: 10048,
  name: 'Vice',
  rarity: 'ancient',
  image: '',
};
const unpriced: CatalogSkin = { ...vice, weaponName: 'Hand Wraps', name: 'Nobody Sells' };
const prices = {
  [priceKey('Sport Gloves', 'Vice', null)]: { fn: 5993, mw: 1478, ft: 481, ww: 330, bs: 262 },
};

test.describe('skin rarity by price per wear', () => {
  const [priced, plain] = withPrices([vice, unpriced], prices);

  test('the finish takes its median wear; one Skinport does not price keeps its grade', () => {
    expect(priced.rarity).toBe('ancient');
    expect(priced.price).toBe(481);
    expect(plain).toEqual(unpriced);
  });

  test('each wear is its own drop, with its own rarity', () => {
    const entries = dropEntries([priced, plain]);
    expect(entries.map((e) => [e.wear ?? null, e.rarity])).toEqual([
      ['fn', 'immortal'],
      ['mw', 'ancient'],
      ['ft', 'ancient'],
      ['ww', 'legendary'],
      ['bs', 'legendary'],
      [null, 'ancient'],
    ]);
  });

  test('a granted skin is the rarity of the wear its float is in', () => {
    expect(rarityAt(priced, 0.01)).toBe('immortal');
    expect(rarityAt(priced, 0.5)).toBe('legendary');
    expect(rarityAt(plain, 0.01)).toBe('ancient');
  });

  test('an entry rolls inside its wear, and inside a reward range that reaches it', () => {
    const mw = dropEntries([priced]).find((e) => e.wear === 'mw')!;
    const [lo, hi] = floatRange(mw, {});
    expect(lo).toBe(0.07);
    expect(hi).toBeLessThan(0.15);
    expect(floatRange(mw, { floatMin: 0.1, floatMax: 0.5 })).toEqual([0.1, hi]);
    // A range that misses the wear does not move it out of its wear.
    expect(floatRange(mw, { floatMin: 0.5, floatMax: 1 })).toEqual([0.07, hi]);
    expect(floatRange(plain, { floatMin: 0.2, floatMax: 0.3 })).toEqual([0.2, 0.3]);
  });

  test('a config saved before tiers 2 with immortal at 0 gets the default weight', () => {
    const old = normalizeConfig({ rarityWeights: { immortal: 0 } as never });
    expect(old.rarityWeights.immortal).toBe(1);
    expect(old.tiers).toBe(2);
    const saved = normalizeConfig({ tiers: 2, rarityWeights: { immortal: 0 } as never });
    expect(saved.rarityWeights.immortal).toBe(0);
  });
});

test.describe('the price scale (client)', () => {
  test('prices sit on a log scale, each rarity its own range', () => {
    expect(pricePosition(0.03)).toBe(0);
    expect(pricePosition(0.001)).toBe(0);
    expect(pricePosition(10000)).toBe(1);
    // Log scale: $1 to $5 is as wide as $100 to $500.
    expect(pricePosition(5) - pricePosition(1)).toBeCloseTo(
      pricePosition(500) - pricePosition(100),
      9
    );
    const bands = priceBands();
    expect(bands.map((b) => b.rarity)).toEqual(RARITY_ORDER);
    expect(bands[0]).toEqual({ rarity: 'common', from: null, to: 1 });
    expect(bands[6]).toEqual({ rarity: 'immortal', from: 1500, to: null });
    // The bands meet with no gap, in the API's order (PRICE_BANDS).
    expect(bands.slice(1).map((b) => b.from)).toEqual([...PRICE_BANDS]);
    expect(PRICE_BANDS).toEqual([...API_BANDS]);
  });
});
