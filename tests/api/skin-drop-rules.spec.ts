import { test, expect } from '@playwright/test';
import { getAuthHeader, signInViaRequest } from '../helpers/auth';
import { formatOdds } from '../../client/src/integrations/cs2/skins/formatOdds';
import {
  dropEligible,
  dropOdds,
  matchDropChance,
  modeForTeamSize,
  DEFAULT_CONFIG,
  MIN_DROP_ROUNDS,
  minDropRounds,
} from '../../api/src/integrations/cs2/skins/skinService';

/**
 * Fair drops after every matchmaking and tournament game (skins/skinService):
 * the chance per mode, less from the third game against the same opponents
 * in a day (an admin switch), nothing for the player who left or for a game
 * over in under MIN_DROP_ROUNDS rounds. The admin settings are clamped.
 *
 * @tag api
 */

test.describe('skin drop rules', () => {
  test('the chance follows the mode and the result', () => {
    expect(matchDropChance(DEFAULT_CONFIG, '5v5', true, 0)).toBe(50);
    expect(matchDropChance(DEFAULT_CONFIG, '5v5', false, 0)).toBe(20);
    expect(matchDropChance(DEFAULT_CONFIG, '2v2', true, 0)).toBe(30);
    expect(matchDropChance(DEFAULT_CONFIG, '2v2', false, 0)).toBe(10);
    expect(matchDropChance(DEFAULT_CONFIG, '1v1', true, 0)).toBe(20);
    expect(matchDropChance(DEFAULT_CONFIG, '1v1', false, 0)).toBe(5);
    // A game with no lobby (an admin's match) counts as 5v5.
    expect(matchDropChance(DEFAULT_CONFIG, null, true, 0)).toBe(50);
  });

  test('from the third game against the same opponents in a day, much less (unless turned off)', () => {
    // A second game (one earlier) is fine: a small platform plays the same people.
    expect(matchDropChance(DEFAULT_CONFIG, '5v5', true, 1)).toBe(50);
    expect(matchDropChance(DEFAULT_CONFIG, '5v5', true, 2)).toBe(50 / 4);
    expect(matchDropChance(DEFAULT_CONFIG, '5v5', true, 4)).toBe(50 / 16);
    expect(matchDropChance(DEFAULT_CONFIG, '1v1', true, -2)).toBe(20);
    expect(matchDropChance({ ...DEFAULT_CONFIG, repeatOpponentCut: false }, '5v5', true, 4)).toBe(
      50
    );
  });

  test('only a full game, for a player who played and did not leave', () => {
    const game = { left: false, maxRounds: 13, playerRounds: 13 };
    expect(MIN_DROP_ROUNDS).toBe(8);
    expect(dropEligible(game)).toBe(true);
    // Someone left: only they lose their roll.
    expect(dropEligible({ ...game, left: true })).toBe(false);
    expect(dropEligible({ ...game, maxRounds: MIN_DROP_ROUNDS - 1 })).toBe(false);
    expect(dropEligible({ ...game, playerRounds: 0 })).toBe(false);
  });

  test('a short format counts from its win count (MR6: first to 4)', () => {
    expect(minDropRounds(6)).toBe(4);
    expect(minDropRounds(16)).toBe(8);
    expect(minDropRounds(24)).toBe(8);
    expect(minDropRounds(null)).toBe(MIN_DROP_ROUNDS);
    // A 4–0 MR6 game drops; a 3-round walkover does not.
    expect(dropEligible({ left: false, maxRounds: 4, playerRounds: 4, formatMaxRounds: 6 })).toBe(
      true
    );
    expect(dropEligible({ left: false, maxRounds: 3, playerRounds: 3, formatMaxRounds: 6 })).toBe(
      false
    );
  });

  test('a tournament game plays like the mode of its team size', () => {
    expect(modeForTeamSize(1)).toBe('1v1');
    expect(modeForTeamSize(2)).toBe('2v2');
    expect(modeForTeamSize(5)).toBe('5v5');
    expect(modeForTeamSize(undefined)).toBeNull();
    expect(matchDropChance(DEFAULT_CONFIG, modeForTeamSize(2), true, 0)).toBe(30);
  });

  test('the admin settings are clamped', { tag: ['@api'] }, async ({ request }) => {
    await signInViaRequest(request);
    const res = await request.put('/api/skins/admin/config', {
      headers: getAuthHeader(),
      data: { modeChances: { '1v1': { win: 150, play: -3 } }, levelUpDrops: false },
    });
    expect(res.ok(), await res.text()).toBe(true);
    const { config } = await res.json();
    expect(config.modeChances['1v1']).toEqual({ win: 100, play: 0 });
    expect(config.modeChances['2v2']).toEqual(DEFAULT_CONFIG.modeChances['2v2']);
    expect(config.levelUpDrops).toBe(false);
    expect(config.tournamentMatchDrops).toBe(true);
    await request.put('/api/skins/admin/config', {
      headers: getAuthHeader(),
      data: { modeChances: DEFAULT_CONFIG.modeChances, levelUpDrops: true },
    });
  });

  test('odds: a rarity with no skins gives its share away; each skin of a rarity is as likely', () => {
    const weights = {
      common: 40,
      uncommon: 25,
      rare: 18,
      mythical: 10,
      legendary: 5,
      ancient: 2,
      immortal: 0,
    };
    const odds = dropOdds(weights, {
      common: 100,
      uncommon: 50,
      rare: 20,
      mythical: 10,
      legendary: 5,
    });
    const by = Object.fromEntries(odds.map((o) => [o.rarity, o]));
    // ancient has no skins: the 98 left share 100 %.
    expect(by.ancient.chance).toBe(0);
    expect(by.immortal.chance).toBe(0);
    expect(by.common.chance).toBeCloseTo((40 / 98) * 100, 6);
    expect(by.common.perSkin).toBeCloseTo(((40 / 98) * 100) / 100, 6);
    expect(by.legendary.perSkin).toBeCloseTo(((5 / 98) * 100) / 5, 6);
    expect(odds.reduce((sum, o) => sum + o.chance, 0)).toBeCloseTo(100, 6);
  });

  test('odds read like people write them', () => {
    expect(formatOdds(0)).toBe('0 %');
    expect(formatOdds(40.816)).toBe('40.8 %');
    expect(formatOdds(5.1)).toBe('5.1 %');
    expect(formatOdds(0.5)).toBe('0.5 %');
    expect(formatOdds(0.0312)).toBe('0.031 %');
    expect(formatOdds(0.0004)).toBe('< 0.001 %');
  });

  test(
    'the odds are public while skins are on',
    { tag: ['@api'] },
    async ({ request, playwright, baseURL }) => {
      await signInViaRequest(request);
      const anon = await playwright.request.newContext({ baseURL });
      await request.put('/api/skins/admin/config', {
        headers: getAuthHeader(),
        data: { enabled: false },
      });
      expect((await anon.get('/api/skins/odds')).status()).toBe(404);
      await request.put('/api/skins/admin/config', {
        headers: getAuthHeader(),
        data: { enabled: true },
      });
      const res = await anon.get('/api/skins/odds');
      expect(res.ok(), await res.text()).toBe(true);
      const body = await res.json();
      expect(body).toMatchObject({
        optionsPerDrop: 3,
        levelUpDrops: true,
        tournamentMatchDrops: true,
      });
      expect(body.chances['1v1']).toEqual(DEFAULT_CONFIG.modeChances['1v1']);
      expect(body.rarities).toHaveLength(7);
      await request.put('/api/skins/admin/config', {
        headers: getAuthHeader(),
        data: { enabled: false },
      });
      await anon.dispose();
    }
  );
});
