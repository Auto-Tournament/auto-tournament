import { test, expect } from '@playwright/test';
import { stepTimes } from '../../client/src/utils/roundTimes';

/**
 * Manage › Schedule, "first round at …, then every … minutes".
 *
 * @tag api
 */
test('fills the rounds a step apart, within the day', () => {
  expect(stepTimes('12:00', 60, 3)).toEqual(['12:00', '13:00', '14:00']);
  expect(stepTimes('9:30', 45, 3)).toEqual(['09:30', '10:15', '11:00']);
  expect(stepTimes('22:30', 60, 4)).toEqual(['22:30', '23:30']);
  expect(stepTimes('nope', 60, 3)).toEqual([]);
  expect(stepTimes('12:00', 0, 3)).toEqual([]);
});
