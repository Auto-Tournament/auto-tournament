import fs from 'fs';
import path from 'path';
import { test, expect } from '@playwright/test';
import { normalize } from '../../api/src/integrations/cs2/events/normalize';
import type { NormalizedEvent } from '../../api/src/integrations/types';

/**
 * The CS2 adapter's Auto Tournament CS2 -> NormalizedEvent mapping (pure, no API).
 *
 * Feeds the captured Bo3 (tests/fixtures/plugin-bo3-sequence.json, the same
 * sequence event-replay-golden.spec.ts replays against the API) through
 * `normalize()` and checks the neutral sequence the core will ingest in PR 6b:
 * one series start and end, a start and a result per map, score updates from
 * the round and halftime events, and per-map player stats.
 *
 * @tag api
 */

const FIXTURE_PATH = path.resolve(__dirname, '../fixtures/plugin-bo3-sequence.json');
const fixture = JSON.parse(fs.readFileSync(FIXTURE_PATH, 'utf8')) as {
  maps: string[];
  events: Array<Record<string, unknown>>;
};

const SLUG = 'golden-bo3';
const MATCH_ID = 4242;

function replay(): NormalizedEvent[] {
  return fixture.events.flatMap((evt) => normalize({ ...evt, matchid: MATCH_ID }, { slug: SLUG }));
}

function ofType<T extends NormalizedEvent['type']>(
  events: NormalizedEvent[],
  type: T
): Array<Extract<NormalizedEvent, { type: T }>> {
  return events.filter((e): e is Extract<NormalizedEvent, { type: T }> => e.type === type);
}

test.describe('cs2 normalize()', () => {
  test('the Bo3 fixture normalizes to the expected sequence', () => {
    const events = replay();

    const counts: Record<string, number> = {};
    for (const e of events) counts[e.type] = (counts[e.type] ?? 0) + 1;
    expect(counts).toEqual({
      'series.started': 1,
      'map.started': 3,
      // 4 round_end samples + halftime per map; side_swap carries no scores.
      'score.updated': 15,
      'phase.changed': 3,
      'map.result': 3,
      // map_result's nested players, plus one player_stats_update per map.
      'player.stats': 6,
      'series.ended': 1,
    });

    expect(events.every((e) => e.slug === SLUG)).toBe(true);
    expect(events[0]).toEqual({
      type: 'series.started',
      slug: SLUG,
      eventId: 'series_start',
      seriesLength: 3,
    });
    expect(events[events.length - 1]).toEqual({
      type: 'series.ended',
      slug: SLUG,
      eventId: 'series_end',
      team1SeriesScore: 2,
      team2SeriesScore: 1,
      winner: 'team1',
      releaseAfterSeconds: 10,
    });

    expect(ofType(events, 'map.started').map((e) => e.mapNumber)).toEqual([0, 1, 2]);

    expect(ofType(events, 'map.result')).toEqual([
      {
        type: 'map.result',
        slug: SLUG,
        eventId: 'map_result:0',
        mapNumber: 0,
        mapName: 'de_ancient',
        team1Score: 13,
        team2Score: 9,
        winner: 'team1',
      },
      {
        type: 'map.result',
        slug: SLUG,
        eventId: 'map_result:1',
        mapNumber: 1,
        mapName: 'de_anubis',
        team1Score: 11,
        team2Score: 13,
        winner: 'team2',
      },
      {
        type: 'map.result',
        slug: SLUG,
        eventId: 'map_result:2',
        mapNumber: 2,
        mapName: 'de_nuke',
        team1Score: 13,
        team2Score: 7,
        winner: 'team1',
      },
    ]);
    expect(ofType(events, 'map.result').map((e) => e.mapName)).toEqual(fixture.maps);

    expect(ofType(events, 'phase.changed').map((e) => e.phase)).toEqual([
      'halftime',
      'halftime',
      'halftime',
    ]);

    // The last score update of each map is its final score.
    const finalScores = [0, 1, 2].map((map) => {
      const updates = ofType(events, 'score.updated').filter((e) => e.mapNumber === map);
      const last = updates[updates.length - 1];
      return [last.team1, last.team2];
    });
    expect(finalScores).toEqual([
      [13, 9],
      [11, 13],
      [13, 7],
    ]);
  });

  test('per-map player stats carry all 10 players, the result and steam accounts', () => {
    const mapStats = ofType(replay(), 'player.stats').filter((e) =>
      e.eventId.startsWith('map_result:')
    );
    expect(mapStats.map((e) => [e.scope, e.mapNumber, e.lines.length])).toEqual([
      ['map', 0, 10],
      ['map', 1, 10],
      ['map', 2, 10],
    ]);

    // Map 2 (de_anubis) went to team2.
    const anubis = mapStats[1];
    expect(anubis.lines.filter((l) => l.won).every((l) => l.team === 'team2')).toBe(true);
    expect(anubis.lines.filter((l) => l.won)).toHaveLength(5);

    const alpha1 = mapStats[0].lines.find((l) => l.account.externalId === '76561199000070001');
    expect(alpha1).toEqual({
      account: { provider: 'steam', externalId: '76561199000070001' },
      name: 'Alpha 1',
      team: 'team1',
      won: true,
      metrics: {
        kills: 10,
        deaths: 14,
        assists: 4,
        adr: 61.14,
        kast: 15,
        headshots: 5,
        flash_assists: 2,
        utility_damage: 179,
        mvps: 2,
        score: 28,
        rounds_played: 22,
      },
    });
  });

  test('eventIds are unique within the replay and stable across runs', () => {
    const ids = replay().map((e) => e.eventId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(replay().map((e) => e.eventId)).toEqual(ids);
  });

  test('presence, phases and CS2-only events', () => {
    const player = { steamid: '76561199000070001', name: 'Alpha 1', team: 'team1' };
    expect(normalize({ event: 'player_connect', matchid: 7, player }, { slug: 's' })).toEqual([
      {
        type: 'presence.changed',
        slug: 's',
        eventId: expect.stringMatching(/^player_connect:76561199000070001#/),
        account: { provider: 'steam', externalId: '76561199000070001' },
        team: 'team1',
        state: 'connected',
      },
    ]);
    expect(
      normalize({ event: 'player_unready', matchid: 7, player: { steamid: '1' } }, { slug: 's' })
    ).toMatchObject([{ type: 'presence.changed', state: 'unready' }]);

    expect(
      normalize({ event: 'knife_round_started', matchid: 7, map_number: 0 }, { slug: 's' })
    ).toMatchObject([{ type: 'phase.changed', phase: 'knife' }]);
    expect(normalize({ event: 'match_paused', matchid: 7, map_number: 0 }, { slug: 's' })).toMatchObject(
      [{ type: 'phase.changed', phase: 'paused' }]
    );

    for (const event of [
      'map_picked',
      'map_vetoed',
      'side_picked',
      'server_configured',
      'server_health',
      'cs2_update_required',
      'test_event',
      'backup_loaded',
      'round_mvp',
    ]) {
      expect(normalize({ event, matchid: 7 }, { slug: 's' }), event).toEqual([]);
    }
    expect(normalize(null)).toEqual([]);
    expect(normalize({ matchid: 7 })).toEqual([]);
  });

  test('slug falls back to matchid; server-level events without a match give nothing', () => {
    expect(normalize({ event: 'series_start', matchid: 12, num_maps: 1 })).toEqual([
      { type: 'series.started', slug: '12', eventId: 'series_start', seriesLength: 1 },
    ]);
    expect(normalize({ event: 'going_live', matchid: -1, map_number: 0 })).toEqual([]);
  });

  test('series_end winner: plugin winner first, then series score, else none', () => {
    const end = (extra: Record<string, unknown>) =>
      normalize({ event: 'series_end', matchid: 1, ...extra }, { slug: 's' })[0];

    // Synthesized events send the bare side.
    expect(end({ team1_series_score: 1, team2_series_score: 1, winner: 'team2' })).toMatchObject({
      winner: 'team2',
    });
    expect(end({ team1_series_score: 0, team2_series_score: 2, winner: { team: 'none' } })).toMatchObject(
      { winner: 'team2' }
    );
    expect(end({ team1_series_score: 1, team2_series_score: 1 })).toMatchObject({ winner: 'none' });
    expect(end({ team1_series_score: 1, team2_series_score: 1 })).not.toHaveProperty(
      'releaseAfterSeconds'
    );
  });

  test('map_result: flat Get5 fields and a draw', () => {
    expect(
      normalize(
        { event: 'map_result', matchid: 1, map_number: 0, team1_score: 12, team2_score: 12 },
        { slug: 's' }
      )
    ).toEqual([
      {
        type: 'map.result',
        slug: 's',
        eventId: 'map_result:0',
        mapNumber: 0,
        team1Score: 12,
        team2Score: 12,
        winner: 'draw',
      },
    ]);
  });
});
