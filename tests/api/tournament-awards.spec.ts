import { test, expect } from '@playwright/test';
import { tournamentAwards } from '../../client/src/utils/tournamentAwards';
import type { OverviewPlayer } from '../../client/src/hooks/usePublicTournamentOverview';

/**
 * The results page's awards (client/src/utils/tournamentAwards.ts): each goes
 * to the best player for it, and an award nobody earned is left out.
 *
 * @tag api
 */

const player = (playerId: string, over: Partial<OverviewPlayer> = {}): OverviewPlayer => ({
  playerId,
  name: playerId,
  eloChange: 0,
  ...over,
});

test.describe('tournament awards (rules)', () => {
  test('most money spent: the biggest spender, shown in dollars; none when nobody recorded any', () => {
    const awards = tournamentAwards([
      player('a', { moneySpent: 41_250, kills: 10 }),
      player('b', { moneySpent: 58_900, kills: 5 }),
    ]);
    expect(awards.find((x) => x.key === 'mostMoney')).toMatchObject({
      player: { playerId: 'b' },
      value: '$58,900',
    });
    // Only some games (CS2 on Ready Up servers) record spending.
    const none = tournamentAwards([
      player('a', { kills: 3 }),
      player('b', { kills: 2, moneySpent: 0 }),
    ]);
    expect(none.some((x) => x.key === 'mostMoney')).toBe(false);
  });
});
