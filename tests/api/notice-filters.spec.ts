import { test, expect } from '@playwright/test';
import { NOTICE_FILTERS, matchesFilter } from '../../client/src/components/social/noticeFilters';
import type { Notice } from '../../client/src/components/social/socialStore';

/**
 * The notification center's filters (client/src/components/social/NotificationBell.tsx):
 * your match, tournaments, skins and clips each have their own.
 *
 * @tag api
 */

const notice = (kind: Notice['kind'], data: Record<string, unknown> = {}): Notice =>
  ({ id: 1, kind, data, createdAt: 0, readAt: null }) as unknown as Notice;

test.describe('Notification filters', () => {
  test('clips and skins are apart; your match is under Matches and Needs you', () => {
    const clip = notice('highlight');
    const skin = notice('skin');
    const ready = notice('tournament', { event: 'match_ready' });
    const veto = notice('tournament', { event: 'veto_turn' });
    const started = notice('tournament', { event: 'started' });
    const invite = notice('party_invite');
    const news = notice('news');

    expect(NOTICE_FILTERS).toEqual([
      'all',
      'you',
      'matches',
      'tournaments',
      'skins',
      'clips',
      'other',
    ]);
    const all = [clip, skin, ready, veto, started, invite, news];
    const of = (f: (typeof NOTICE_FILTERS)[number]) => all.filter((n) => matchesFilter(n, f));

    expect(of('all')).toHaveLength(all.length);
    expect(of('clips')).toEqual([clip]);
    expect(of('skins')).toEqual([skin]);
    expect(of('matches')).toEqual([ready, veto]);
    expect(of('tournaments')).toEqual([started]);
    expect(of('you')).toEqual([ready, veto, invite]);
    expect(of('other')).toEqual([news]);
  });
});
