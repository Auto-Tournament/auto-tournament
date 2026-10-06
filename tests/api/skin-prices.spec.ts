import { test, expect } from '@playwright/test';
import {
  parseMarketName,
  priceFor,
  priceKey,
  pricesFromItems,
  rarityIndexByPrice,
} from '../../api/src/integrations/cs2/skins/skinPrices';
import { variantOf } from '../../api/src/integrations/cs2/skins/skinService';

/**
 * Knife and glove rarity by market price (Skinport): names, phases, medians
 * and the price bands. No network: the Skinport rows are written out here.
 *
 * @tag api
 */

const row = (market_hash_name: string, median_price: number | null, version: string | null = null) => ({
  market_hash_name,
  version,
  median_price,
  suggested_price: null,
  min_price: null,
});

test.describe('Skin prices', () => {
  test('reads knife and glove names, and skips StatTrak and plain weapons', { tag: ['@api'] }, () => {
    expect(parseMarketName('★ Karambit | Doppler (Factory New)')).toEqual({ weaponName: 'Karambit', finish: 'Doppler' });
    expect(parseMarketName("★ Sport Gloves | Pandora's Box (Field-Tested)")).toEqual({
      weaponName: 'Sport Gloves',
      finish: "Pandora's Box",
    });
    expect(parseMarketName('★ StatTrak™ Karambit | Doppler (Factory New)')).toBeNull();
    expect(parseMarketName('AK-47 | Redline (Field-Tested)')).toBeNull();
    expect(parseMarketName('★ Karambit')).toBeNull();
  });

  test('a finish costs the median of its wears, per phase', { tag: ['@api'] }, () => {
    const prices = pricesFromItems([
      row('★ Navaja Knife | Safari Mesh (Field-Tested)', 50),
      row('★ Navaja Knife | Safari Mesh (Well-Worn)', 40),
      row('★ Navaja Knife | Safari Mesh (Factory New)', 200),
      row('★ Karambit | Doppler (Factory New)', 6800, 'Sapphire'),
      row('★ Karambit | Doppler (Factory New)', 1400, 'Phase 2'),
      row('★ Karambit | Doppler (Factory New)', null, 'Phase 3'),
    ]);
    expect(prices[priceKey('Navaja Knife', 'Safari Mesh', null)]).toBe(50);
    expect(prices[priceKey('Karambit', 'Doppler', 'Sapphire')]).toBe(6800);
    expect(prices[priceKey('Karambit', 'Doppler', 'Phase 3')]).toBeUndefined();
    // A phase nobody sells right now takes the dearest listed phase.
    expect(priceFor(prices, priceKey('Karambit', 'Doppler', 'Black Pearl'))).toBe(6800);
    expect(priceFor(prices, priceKey('Karambit', 'Fade', null))).toBeUndefined();
  });

  test('cheap finishes land in the low bands, dear ones in the top', { tag: ['@api'] }, () => {
    const prices = { a: 40, b: 80, c: 150, d: 300, e: 700, f: 5000 };
    const bands = rarityIndexByPrice(prices, ['f', 'a', 'c', 'b', 'e', 'd', 'missing'], 6);
    expect([...'abcdef'].map((k) => bands.get(k))).toEqual([0, 1, 2, 3, 4, 5]);
    expect(bands.has('missing')).toBe(false);
  });

  test('phases come from Doppler paint kits only', { tag: ['@api'] }, () => {
    expect(variantOf('am_sapphire_marbleized')).toBe('Sapphire');
    expect(variantOf('am_blackpearl_marbleized_b')).toBe('Black Pearl');
    expect(variantOf('am_gamma_doppler_phase1_glock')).toBe('Phase 1');
    expect(variantOf('am_doppler_phase2_widow')).toBe('Phase 2');
    expect(variantOf('specialist_emerald_web')).toBeNull();
    expect(variantOf('an_emerald')).toBeNull();
    expect(variantOf('gs_mother_of_pearl_elite')).toBeNull();
  });
});
