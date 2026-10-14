import { test, expect } from '@playwright/test';
import { rememberWearLooks, skinImageUrl } from '../../api/src/integrations/cs2/skins/skinService';

/**
 * A skin's picture follows its wear: CS2's light look up to Minimal Wear,
 * medium for Field-Tested, heavy for Well-Worn and Battle-Scarred; the light
 * one when the catalogue has no worn look.
 *
 * @tag api
 */
test('the picture follows the float', { tag: ['@api'] }, () => {
  rememberWearLooks([
    {
      weapon: 'weapon_ak47',
      weaponName: 'AK-47',
      paintKit: 801,
      name: 'Asiimov',
      rarity: 'legendary',
      image: 'ak_asiimov.webp',
      imageMedium: 'ak_asiimov_medium.webp',
      imageHeavy: 'ak_asiimov_heavy.webp',
    },
  ]);
  const file = (f: number | null) => skinImageUrl('ak_asiimov.webp', f).split('/').pop();
  expect(file(0.01)).toBe('ak_asiimov.webp'); // Factory New
  expect(file(0.14)).toBe('ak_asiimov.webp'); // Minimal Wear
  expect(file(0.15)).toBe('ak_asiimov_medium.webp'); // Field-Tested
  expect(file(0.4)).toBe('ak_asiimov_heavy.webp'); // Well-Worn
  expect(file(0.9)).toBe('ak_asiimov_heavy.webp'); // Battle-Scarred
  expect(file(null)).toBe('ak_asiimov.webp');
  // A skin the catalogue has no worn look for keeps its one picture.
  expect(skinImageUrl('other.webp', 0.9).split('/').pop()).toBe('other.webp');
});
