import { test, expect } from '@playwright/test';
import {
  bandOf,
  finishPrice,
  parseMarketName,
  priceFor,
  priceKey,
  pricesFromItems,
  wearOf,
} from '../../api/src/integrations/cs2/skins/skinPrices';
import { variantOf } from '../../api/src/integrations/cs2/skins/skinService';

/**
 * Skin rarity by market price (Skinport), per finish and wear: names, wears,
 * phases and the price bands. No network: the Skinport rows are written out here.
 *
 * @tag api
 */

const row = (
  market_hash_name: string,
  median_price: number | null,
  version: string | null = null
) => ({
  market_hash_name,
  version,
  median_price,
  suggested_price: null,
  min_price: null,
});

test.describe('Skin prices', () => {
  test(
    'reads every skin with its wear, and skips StatTrak, Souvenir and items without a wear',
    { tag: ['@api'] },
    () => {
      expect(parseMarketName('★ Karambit | Doppler (Factory New)')).toEqual({
        weaponName: 'Karambit',
        finish: 'Doppler',
        wear: 'fn',
      });
      expect(parseMarketName("★ Sport Gloves | Pandora's Box (Field-Tested)")).toEqual({
        weaponName: 'Sport Gloves',
        finish: "Pandora's Box",
        wear: 'ft',
      });
      expect(parseMarketName('AK-47 | Redline (Battle-Scarred)')).toEqual({
        weaponName: 'AK-47',
        finish: 'Redline',
        wear: 'bs',
      });
      expect(parseMarketName('★ StatTrak™ Karambit | Doppler (Factory New)')).toBeNull();
      expect(parseMarketName('Souvenir AWP | Dragon Lore (Factory New)')).toBeNull();
      expect(parseMarketName('Sticker | Titan (Holo) | Katowice 2014')).toBeNull();
      expect(parseMarketName('★ Karambit')).toBeNull();
    }
  );

  test('each wear keeps its own price, per phase', { tag: ['@api'] }, () => {
    const prices = pricesFromItems([
      row('★ Sport Gloves | Vice (Factory New)', 5993),
      row('★ Sport Gloves | Vice (Battle-Scarred)', 262),
      row('★ Karambit | Doppler (Factory New)', 6800, 'Sapphire'),
      row('★ Karambit | Doppler (Minimal Wear)', 5100, 'Sapphire'),
      row('★ Karambit | Doppler (Factory New)', 1400, 'Phase 2'),
      row('★ Karambit | Doppler (Factory New)', null, 'Phase 3'),
    ]);
    expect(prices[priceKey('Sport Gloves', 'Vice', null)]).toEqual({ fn: 5993, bs: 262 });
    expect(prices[priceKey('Karambit', 'Doppler', 'Sapphire')]).toEqual({ fn: 6800, mw: 5100 });
    expect(prices[priceKey('Karambit', 'Doppler', 'Phase 3')]).toBeUndefined();
    // A phase nobody sells right now takes the dearest listed phase, per wear.
    expect(priceFor(prices, priceKey('Karambit', 'Doppler', 'Black Pearl'))).toEqual({
      fn: 6800,
      mw: 5100,
    });
    expect(priceFor(prices, priceKey('Karambit', 'Fade', null))).toBeUndefined();
    expect(finishPrice({ fn: 5993, mw: 1478, ft: 481, ww: 330, bs: 262 })).toBe(481);
  });

  test('prices fall in the bands, floats in the wears', { tag: ['@api'] }, () => {
    expect([0.03, 1, 4.99, 5, 25, 100, 399, 400, 1500, 8713].map(bandOf)).toEqual([
      0, 1, 1, 2, 3, 4, 4, 5, 6, 6,
    ]);
    expect([0, 0.069999, 0.07, 0.15, 0.38, 0.45, 1].map(wearOf)).toEqual([
      'fn',
      'fn',
      'mw',
      'ft',
      'ww',
      'bs',
      'bs',
    ]);
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
