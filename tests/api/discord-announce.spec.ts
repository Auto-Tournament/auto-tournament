import { test, expect } from '@playwright/test';
import { announceText, dueEvents } from '../../api/src/addons/discord/announceText';

/**
 * Match announcements: which posts a match is due, and what they say.
 *
 * @tag api
 */
test.describe('Discord match announcements', () => {
  test('ready, live and result, in order', () => {
    expect(dueEvents('pending', false)).toEqual([]);
    expect(dueEvents('loaded', false)).toEqual(['ready']);
    // Live without a ready post (a fast start) still gets both.
    expect(dueEvents('live', false)).toEqual(['ready', 'live']);
    expect(dueEvents('completed', true)).toEqual(['result']);
    // Cancelled, or over without a winner: nothing.
    expect(dueEvents('completed', false)).toEqual([]);
    expect(dueEvents('cancelled', false)).toEqual([]);
  });

  test('says who won, from the winner’s side', () => {
    expect(announceText('ready', 'A', 'B', null, null)).toBe(
      '**A** vs **B** is ready: the server is up.'
    );
    expect(announceText('live', 'A', 'B', null, 'https://x/match/m')).toBe(
      '**A** vs **B** is live. https://x/match/m'
    );
    expect(announceText('result', 'A', 'B', { winner: 1, score: [2, 1] }, null)).toBe(
      '**A** beat **B** 2–1.'
    );
    expect(announceText('result', 'A', 'B', { winner: 2, score: [0, 2] }, null)).toBe(
      '**B** beat **A** 2–0.'
    );
  });
});
