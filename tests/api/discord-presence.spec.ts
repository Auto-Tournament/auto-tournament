import { test, expect } from '@playwright/test';
import { statusText } from '../../api/src/addons/discord/presence';

/**
 * The bot's status in Discord: "Watching 2 matches".
 *
 * @tag api
 */
test('the status counts the live matches', () => {
  expect(statusText(0)).toBe('autotournament.gg');
  expect(statusText(1)).toBe('1 match');
  expect(statusText(3)).toBe('3 matches');
});
