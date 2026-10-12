import { test, expect } from '@playwright/test';
import { getAuthHeader, signInViaRequest } from '../helpers/auth';
import {
  dropEligible,
  matchDropChance,
  DEFAULT_CONFIG,
  MIN_DROP_ROUNDS,
} from '../../api/src/integrations/cs2/skins/skinService';

/**
 * Fair matchmaking drops (skins/skinService): the chance per mode, less for
 * repeats against the same opponents, a weekly cap, and nothing for a game
 * someone abandoned or that ended early. The admin settings are clamped.
 *
 * @tag api
 */

test.describe('skin drop rules', () => {
  test('the chance follows the mode and the result', () => {
    expect(matchDropChance(DEFAULT_CONFIG, '5v5', true, 0)).toBe(20);
    expect(matchDropChance(DEFAULT_CONFIG, '5v5', false, 0)).toBe(5);
    expect(matchDropChance(DEFAULT_CONFIG, '2v2', true, 0)).toBe(10);
    expect(matchDropChance(DEFAULT_CONFIG, '2v2', false, 0)).toBe(3);
    expect(matchDropChance(DEFAULT_CONFIG, '1v1', true, 0)).toBe(5);
    expect(matchDropChance(DEFAULT_CONFIG, '1v1', false, 0)).toBe(1);
    // A game with no lobby (an admin's match) counts as 5v5.
    expect(matchDropChance(DEFAULT_CONFIG, null, true, 0)).toBe(20);
  });

  test('repeats against the same opponents within a day drop much less', () => {
    expect(matchDropChance(DEFAULT_CONFIG, '5v5', true, 1)).toBe(5);
    expect(matchDropChance(DEFAULT_CONFIG, '5v5', true, 3)).toBe(20 / 16);
    expect(matchDropChance(DEFAULT_CONFIG, '1v1', true, -2)).toBe(5);
  });

  test('only a full game, for a player who played, under the weekly cap', () => {
    const game = {
      abandoned: false,
      maxRounds: 13,
      playerRounds: 13,
      dropsThisWeek: 0,
      weeklyCap: 3,
    };
    expect(dropEligible(game)).toBe(true);
    expect(dropEligible({ ...game, abandoned: true })).toBe(false);
    expect(dropEligible({ ...game, maxRounds: MIN_DROP_ROUNDS - 1 })).toBe(false);
    expect(dropEligible({ ...game, playerRounds: 0 })).toBe(false);
    expect(dropEligible({ ...game, dropsThisWeek: 3 })).toBe(false);
    expect(dropEligible({ ...game, dropsThisWeek: 99, weeklyCap: 0 })).toBe(true);
  });

  test('the admin settings are clamped', { tag: ['@api'] }, async ({ request }) => {
    await signInViaRequest(request);
    const res = await request.put('/api/skins/admin/config', {
      headers: getAuthHeader(),
      data: { modeChances: { '1v1': { win: 150, play: -3 } }, weeklyCap: -1 },
    });
    expect(res.ok(), await res.text()).toBe(true);
    const { config } = await res.json();
    expect(config.modeChances['1v1']).toEqual({ win: 100, play: 0 });
    expect(config.modeChances['2v2']).toEqual(DEFAULT_CONFIG.modeChances['2v2']);
    expect(config.weeklyCap).toBe(0);
    await request.put('/api/skins/admin/config', {
      headers: getAuthHeader(),
      data: { modeChances: DEFAULT_CONFIG.modeChances, weeklyCap: DEFAULT_CONFIG.weeklyCap },
    });
  });
});
