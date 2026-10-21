import { test, expect } from '@playwright/test';
import { nextMatchCard } from '../../client/src/components/home/nextMatchState';
import type { TeamMatchInfo } from '../../client/src/types';

/**
 * The home page's next-match card: which state it shows, from the team's current match.
 *
 * @tag api
 */
const NOW = 1_800_000_000;
const base = {
  slug: 'm',
  round: 2,
  matchNumber: 1,
  status: 'pending',
  isTeam1: true,
  opponent: { id: 'b', name: 'B' },
  server: null,
  maps: [],
  mapResults: [],
  matchFormat: 'bo3',
} as unknown as TeamMatchInfo;
const card = (m: Partial<TeamMatchInfo>) => nextMatchCard({ ...base, ...m } as TeamMatchInfo, NOW);

test('before the match: opponent, start time, break, veto, server', () => {
  expect(card({ opponent: null }).small.key).toBe('opponent');
  expect(card({ startsAt: NOW + 3600 }).small.key).toBe('startsAt');
  const held = card({ heldUntil: NOW + 120 });
  expect([held.tone, held.countdownTo, held.small.key]).toEqual(['act', NOW + 120, 'untilVeto']);
  const veto = { status: 'in_progress', pickedMaps: [], actions: [] } as const;
  expect(card({ veto: { ...veto, currentTurn: 'team1', currentAction: 'pick' } })).toMatchObject({
    tone: 'act',
    small: { key: 'pick' },
    action: 'veto',
  });
  expect(card({ veto: { ...veto, currentTurn: 'team2', currentAction: 'ban' } }).small.key).toBe(
    'theirTurn'
  );
  const done = { status: 'completed', pickedMaps: [], actions: [] } as const;
  expect(card({ status: 'ready', veto: done })).toMatchObject({
    tone: 'wait',
    small: { key: 'forServer' },
  });
});

test('waiting on another match shows the estimate when there is one', () => {
  const m = { ...base, opponent: null } as TeamMatchInfo;
  expect(nextMatchCard(m, NOW, 12).big).toEqual({ key: 'about', values: { minutes: 12 } });
  expect(nextMatchCard(m, NOW, null).big).toEqual({ text: 'TBD' });
});

test('on the server: join, warmup, live from our side, between maps', () => {
  expect(card({ status: 'loaded' })).toMatchObject({ tone: 'act', action: 'join' });
  const players = [
    { steamId: '1', name: 'a', team: 'team1', connectedAt: 0, isReady: true },
    { steamId: '2', name: 'b', team: 'team2', connectedAt: 0, isReady: false },
  ] as const;
  const warm = card({
    status: 'loaded',
    config: { expected_players_total: 4 },
    connectionStatus: {
      matchSlug: 'm',
      connectedPlayers: [...players],
      team1Connected: 1,
      team2Connected: 1,
      totalConnected: 2,
      lastUpdated: 0,
    },
  });
  expect(warm.big).toEqual({ text: '1/4' });
  const stats = {
    matchSlug: 'm',
    team1Score: 5,
    team2Score: 7,
    roundNumber: 13,
    mapNumber: 0,
    status: 'live',
    lastEventAt: 0,
    team1SeriesScore: 0,
    team2SeriesScore: 1,
    mapName: 'Ancient',
    totalMaps: 3,
  } as const;
  // We are team2 here: our score first.
  expect(card({ status: 'live', isTeam1: false, liveStats: { ...stats } }).big).toEqual({
    text: '7 – 5',
  });
  expect(
    card({
      status: 'live',
      liveStats: { ...stats },
      server: { id: 's', name: 's', host: 'h', port: 1, status: 'paused' },
    })
  ).toMatchObject({ tone: 'wait', small: { key: 'paused' }, big: { text: '5 – 7' } });
  expect(card({ status: 'live', liveStats: { ...stats, status: 'postgame' } })).toMatchObject({
    big: { text: '0 – 1' },
    small: { key: 'nextMap' },
  });
});
