import { test, expect } from '@playwright/test';
import {
  serverLogLine,
  type ServerLogEvent,
} from '../../api/src/integrations/cs2/fleet/serverLogLine';
import type { MatchState } from '../../api/src/integrations/cs2/fleet/protocol/v1';

/** Ready Up events as lines of the admin match page's server log (unit). */
test.describe('Server log lines', () => {
  const state = {
    teams: {
      team1: {
        name: 'A',
        score: 0,
        players: { '7656': { name: 'Simpert', connected: true, ready: true } },
      },
      team2: { name: 'B', score: 0, players: {} },
    },
  } as unknown as MatchState;
  /** A test event: only the fields the line reads. */
  const ev = (type: string, data: object) => ({ type, payload: { data } }) as ServerLogEvent;

  test('levels and names', { tag: ['@api', '@manage'] }, () => {
    expect(serverLogLine(ev('event.error', { code: 'demo', message: 'no ack' }), state)).toEqual({
      level: 'error',
      text: 'demo: no ack',
    });
    expect(
      serverLogLine(
        ev('event.player_disconnect', { steamid64: '7656', reason: 'timed out' }),
        state
      )
    ).toEqual({
      level: 'warn',
      text: 'Simpert disconnected (timed out)',
    });
    expect(serverLogLine(ev('event.player_connect', { steamid64: '7656' }), state)?.text).toBe(
      'Simpert connected'
    );
    expect(
      serverLogLine(ev('event.pause', { type: 'technical', by: 'team1' }), state, 2, 8)
    ).toEqual({
      level: 'warn',
      text: 'paused (technical) by team1, map 2, round 8',
    });
  });

  test('quiet events make no line', { tag: ['@api', '@manage'] }, () => {
    expect(serverLogLine(ev('event.round_start', {}), state)).toBeNull();
    expect(serverLogLine(ev('event.backup', {}), state)).toBeNull();
  });
});
