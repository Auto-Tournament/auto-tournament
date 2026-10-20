import { test, expect } from '@playwright/test';
import {
  announceMessage,
  announceText,
  dueEvents,
} from '../../api/src/addons/discord/announceText';

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

  test('a card with a button; ready and live ping both teams, a result nobody', () => {
    const roles = { team1: '11', team2: '22' };
    const live = announceMessage('live', 'A', 'B', null, 'https://x/match/m', roles);
    expect(live.content).toBe('<@&11> vs <@&22>');
    expect(live.allowed_mentions.roles).toEqual(['11', '22']);
    expect(live.embeds[0].title).toBe('A vs B');
    expect(live.components?.[0].components[0]).toMatchObject({
      label: 'Go to match',
      url: 'https://x/match/m',
    });
    const result = announceMessage('result', 'A', 'B', { winner: 1, score: [2, 0] }, null, roles);
    expect(result.content).toBeUndefined();
    expect(result.allowed_mentions.roles).toEqual([]);
    expect(result.components).toBeUndefined();
    // No roles yet: no ping.
    expect(
      announceMessage('ready', 'A', 'B', null, null, { team1: null, team2: '22' }).content
    ).toBeUndefined();
  });
});
