import { test, expect } from '@playwright/test';
import {
  BO1_VETO_ORDER,
  standardVetoOrder,
  validateVetoOrder,
} from '../../api/src/integrations/cs2/veto/config';

/** The standard veto order for any pool size (veto/config.ts standardVetoOrder). */
test.describe('Standard veto order by pool size', () => {
  test('7 maps: Valve Major order', () => {
    expect(standardVetoOrder('bo1', 7)).toBe(BO1_VETO_ORDER);
  });

  test('every format leaves the right maps and passes validation', () => {
    for (const n of [3, 4, 5, 6, 7, 8, 9, 10]) {
      for (const format of ['bo1', 'bo3', 'bo5'] as const) {
        if (format === 'bo5' && n < 5) continue;
        const order = standardVetoOrder(format, n);
        const v = validateVetoOrder(order, format, n);
        expect(v, `${format} with ${n} maps: ${v.error}`).toEqual({ valid: true });
      }
    }
  });

  test('a 6-map wingman BO1: five bans in turns, then the side', () => {
    expect(standardVetoOrder('bo1', 6).map((s) => `${s.team}:${s.action}`)).toEqual([
      'team1:ban',
      'team2:ban',
      'team1:ban',
      'team2:ban',
      'team1:ban',
      'team2:side_pick',
    ]);
  });
});
