import { test, expect } from '@playwright/test';
import { WEAPON_DEFINDEX } from '../../api/src/integrations/cs2/skins/skinDefindex';

/**
 * Skins on servers: the defindexes Ready Up gets in `skins.loadout` for the
 * weapon classes csm's skin catalogue uses.
 *
 * @tag api
 */
test.describe('Skin defindexes', () => {
  test('cover rifles, pistols, knives and gloves with their CS2 numbers', { tag: ['@api'] }, () => {
    expect(WEAPON_DEFINDEX.weapon_ak47).toBe(7);
    expect(WEAPON_DEFINDEX.weapon_awp).toBe(9);
    expect(WEAPON_DEFINDEX.weapon_m4a1).toBe(16);
    expect(WEAPON_DEFINDEX.weapon_m4a1_silencer).toBe(60);
    expect(WEAPON_DEFINDEX.weapon_usp_silencer).toBe(61);
    expect(WEAPON_DEFINDEX.weapon_knife_karambit).toBe(507);
    expect(WEAPON_DEFINDEX.sporty_gloves).toBe(5030);
    const values = Object.values(WEAPON_DEFINDEX);
    expect(new Set(values).size).toBe(values.length);
  });
});
