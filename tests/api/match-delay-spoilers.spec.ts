import { test, expect } from '@playwright/test';
import { holdBackResults } from '../../api/src/utils/matchEnrichment';

/**
 * A spectator behind a GOTV delay sees the match page as it stood that long ago, so the
 * delayed stream isn't spoiled (routes/matches.ts, utils/matchEnrichment.ts).
 *
 * @tag api
 * @tag regression
 */

const NOW = 1_800_000_000_000;
const at = (secondsAgo: number) => NOW / 1000 - secondsAgo;
const live = { team1Score: 4, team2Score: 2, team1SeriesScore: 1, team2SeriesScore: 0 };

function bo3(completedSecondsAgo: number | null) {
  return {
    status: completedSecondsAgo === null ? 'live' : 'completed',
    completedAt: completedSecondsAgo === null ? null : at(completedSecondsAgo),
    winner: { id: 'a' } as { id: string } | undefined,
    team1Score: 2,
    team2Score: 0,
    mapResults: [
      { team1Score: 13, team2Score: 7, winnerTeam: 'team1' as const, completedAt: at(1000) },
      {
        team1Score: 13,
        team2Score: 9,
        winnerTeam: 'team1' as const,
        completedAt: at(completedSecondsAgo ?? 30),
      },
    ],
  };
}

test('a match that ended inside the delay still reads as live', () => {
  const match = bo3(20);
  expect(holdBackResults(match, 105, live, NOW)).toBe(at(20) + 105);
  expect(match.status).toBe('live');
  expect(match.winner).toBeUndefined();
  expect(match.completedAt).toBeNull();
  expect(match.mapResults).toHaveLength(1);
  expect([match.team1SeriesScore, match.team2SeriesScore]).toEqual([1, 0]);
  expect([match.team1MapScore, match.team2MapScore]).toEqual([4, 2]);
});

test('a match that ended before the delay shows its result', () => {
  const match = bo3(500);
  expect(holdBackResults(match, 105, live, NOW)).toBeNull();
  expect(match.status).toBe('completed');
  expect(match.winner).toEqual({ id: 'a' });
  expect(match.mapResults).toHaveLength(2);
  expect([match.team1SeriesScore, match.team2SeriesScore]).toEqual([2, 0]);
});

test('with no delayed live stats yet, a live match shows no map score', () => {
  const match = bo3(null);
  holdBackResults(match, 105, null, NOW);
  expect(match.mapResults).toHaveLength(1);
  expect(match.team1MapScore).toBeNull();
  expect([match.team1SeriesScore, match.team2SeriesScore]).toEqual([1, 0]);
});
