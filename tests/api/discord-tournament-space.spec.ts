import { test, expect } from '@playwright/test';
import {
  KEEP_AFTER_S,
  categoryWithRoom,
  spacePlan,
  welcomeText,
} from '../../api/src/addons/discord/tournamentSpacePlan';

/**
 * A tournament's own category on the Discord server: made when it starts,
 * kept a few days after it ends, then removed.
 *
 * @tag api
 */
test('spaces are made for running tournaments and removed days after they end', () => {
  const now = 1_800_000_000;
  const plan = spacePlan(
    [
      { id: 1, status: 'in_progress', completedAt: null },
      { id: 2, status: 'completed', completedAt: now - 60 },
      { id: 3, status: 'completed', completedAt: now - KEEP_AFTER_S - 60 },
      { id: 4, status: 'setup', completedAt: null },
    ],
    [2, 3, 5],
    now
  );
  // 1 runs and has none yet; 2 ended a minute ago (kept); 3 ended days ago and 5 is gone (removed).
  expect(plan.make).toEqual([1]);
  expect(plan.remove).toEqual([3, 5]);
});

test('the welcome DM links the tournament channels and says when the bot writes', () => {
  const text = welcomeText('Winter LAN', { chatId: '1', lobbyId: null }, 'https://example.com');
  expect(text).toContain('**Winter LAN**');
  expect(text).toContain("<#1> is the tournament's channel");
  expect(text).toContain('The Lobby: wait there');
  expect(text).toContain('https://example.com/me/connections');
  expect(welcomeText('W', { chatId: null, lobbyId: null }, null)).not.toContain(
    'Change what you get'
  );
});

test('a full "Your team" category (50 channels) is passed over for one with room', () => {
  const full = Array.from({ length: 49 }, () => ({ parentId: 'a' }));
  expect(categoryWithRoom(['a', 'b'], [...full, { parentId: 'b' }], 2)).toBe('b');
  expect(categoryWithRoom(['a'], full, 2)).toBeNull();
  expect(categoryWithRoom(['a'], full.slice(1), 2)).toBe('a');
  expect(categoryWithRoom([], [], 2)).toBeNull();
});
