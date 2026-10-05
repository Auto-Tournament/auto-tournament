import fs from 'fs';
import path from 'path';
import { test, expect } from '@playwright/test';
import {
  isDevBotId,
  metricsFromFleetStats,
  normalizeFleetEvent,
  toFleetMapNumber,
  toPlatformMapNumber,
  totalsFromRounds,
} from '../../api/src/integrations/cs2/fleet/normalize';
import { normalize as normalizePlugin } from '../../api/src/integrations/cs2/events/normalize';
import type {
  Envelope,
  MatchState,
  RoundSummary,
} from '../../api/src/integrations/cs2/fleet/protocol/v1';
import type { NormalizedEvent } from '../../api/src/integrations/types';

/**
 * Fleet `event.*` -> NormalizedEvent (FLEET.md §8.1; Ready Up's
 * docs/fleet-step3-platform-notes.md §5): the same neutral events and metric
 * keys the plugin path (`events/normalize.ts`) produces, with the fleet's
 * 1-based map numbers turned into the platform's 0-based ones. Pure; driven
 * with Ready Up's real frames from tests/fixtures/fleet/v1.
 *
 * @tag api
 */

const EXAMPLES = path.resolve(__dirname, '../fixtures/fleet/v1');
const load = (file: string): Envelope =>
  JSON.parse(fs.readFileSync(path.join(EXAMPLES, file), 'utf8')) as Envelope;

const HUMAN_1 = '76561198000000001';
const HUMAN_2 = '76561198000000002';

function stateFor(slug: string): MatchState {
  return {
    match_id: slug,
    epoch: 2,
    config_rev: 1,
    live_rev: 10,
    phase: 'live',
    series: {
      num_maps: 3,
      current_map: 1,
      score: { team1: 0, team2: 0 },
      maps: {
        '1': { name: 'de_dust2', sides: 'knife', status: 'live' },
        '2': { name: 'de_mirage', sides: 'team1_ct', status: 'pending' },
      },
    },
    teams: {
      team1: {
        name: 'A',
        score: 0,
        players: { [HUMAN_1]: { name: 'alice', connected: true, ready: true } },
      },
      team2: {
        name: 'B',
        score: 0,
        players: { [HUMAN_2]: { name: 'bob', connected: true, ready: true } },
      },
    },
  };
}

function eventFrame(
  type: string,
  data: Record<string, unknown>,
  extra: { map?: number; rev?: number; slug?: string } = {}
): Envelope {
  return {
    v: 1,
    type,
    id: '01M3BAZAGR50AY86C0444RSBPR',
    seq: 5,
    ts: 1,
    epoch: 2,
    payload: {
      match_id: extra.slug ?? 'm-norm',
      map_number: extra.map ?? 1,
      rev: extra.rev ?? 7,
      patch: { live_rev: extra.rev ?? 7 },
      data,
    },
  };
}

function round(
  n: number,
  lines: Array<Partial<RoundSummary['players'][number]> & { id: string; team: 0 | 1 | 2 }>
): RoundSummary {
  return {
    round_number: n,
    winner_side: 3,
    winner_team: 1,
    reason: 7,
    team1_score: n,
    team2_score: 0,
    team1_was_ct: true,
    players: lines.map((l) => ({ side: 3, kills: 0, damage: 0, died: false, ...l })),
  };
}

test.describe('Fleet normalizer', () => {
  test('map numbers: 1-based fleet <-> 0-based platform; dev-bot ids', () => {
    expect(toPlatformMapNumber(1)).toBe(0);
    expect(toPlatformMapNumber(3)).toBe(2);
    expect(toPlatformMapNumber(0)).toBe(0);
    expect(toFleetMapNumber(0)).toBe(1);
    expect(toFleetMapNumber(2)).toBe(3);
    expect(isDevBotId('12731676150871359538')).toBe(true);
    expect(isDevBotId(HUMAN_1)).toBe(false);
    expect(isDevBotId('nope')).toBe(false);
  });

  test('event.phase: going live from warmup on map 1 starts the series and the map', () => {
    const slug = 'm-norm';
    const out = normalizeFleetEvent(
      eventFrame('event.phase', { from: 'warmup', to: 'live', reason: 'flow' }),
      {
        state: stateFor(slug),
      }
    );
    expect(out).toEqual([
      { type: 'series.started', slug, eventId: 'fleet:series_start', seriesLength: 3 },
      {
        type: 'map.started',
        slug,
        eventId: 'fleet:going_live:0',
        mapNumber: 0,
        mapName: 'de_dust2',
      },
      { type: 'phase.changed', slug, eventId: 'fleet:phase:e2:r7', phase: 'live' },
    ]);

    // Map 2 goes live: map.started for platform map 1, no second series.started.
    const map2 = normalizeFleetEvent(
      eventFrame('event.phase', { from: 'knife', to: 'live', reason: 'flow' }, { map: 2 }),
      {
        state: stateFor(slug),
      }
    );
    expect(map2.map((e) => e.type)).toEqual(['map.started', 'phase.changed']);
    expect(map2[0]).toMatchObject({ mapNumber: 1, mapName: 'de_mirage' });

    // Back from a pause / halftime is not a map start.
    for (const from of ['paused', 'halftime', 'overtime', 'restoring'] as const) {
      const again = normalizeFleetEvent(
        eventFrame('event.phase', { from, to: 'live', reason: 'flow' })
      );
      expect(
        again.map((e) => e.type),
        from
      ).toEqual(['phase.changed']);
    }

    // Ready Up's live frame: loading -> knife.
    const live = normalizeFleetEvent(load('live.event.phase.json'));
    expect(live).toEqual([
      {
        type: 'phase.changed',
        slug: 'lt-1790308176',
        eventId: 'fleet:phase:e2:r4',
        phase: 'knife',
      },
    ]);
  });

  test('presence: connect / disconnect / ready / unready', () => {
    const connect = normalizeFleetEvent(
      eventFrame('event.player_connect', { steamid64: HUMAN_1, name: 'alice', team: 'team1' })
    );
    expect(connect).toEqual([
      {
        type: 'presence.changed',
        slug: 'm-norm',
        eventId: `fleet:player_connect:${HUMAN_1}:e2:r7`,
        account: { provider: 'steam', externalId: HUMAN_1 },
        team: 'team1',
        state: 'connected',
      },
    ]);
    const spectator = normalizeFleetEvent(
      eventFrame('event.player_disconnect', { steamid64: HUMAN_2, name: 'bob', team: 'spectator' })
    );
    expect(spectator[0]).toMatchObject({ state: 'disconnected' });
    expect(spectator[0]).not.toHaveProperty('team');
    const ready = normalizeFleetEvent(
      eventFrame('event.player_ready', {
        steamid64: HUMAN_2,
        team: 'team2',
        ready_team1: 0,
        ready_team2: 1,
        required: 5,
      })
    );
    expect(ready[0]).toMatchObject({ state: 'ready', team: 'team2' });
    const unready = normalizeFleetEvent(
      eventFrame('event.player_unready', {
        steamid64: HUMAN_2,
        team: 'team2',
        ready_team1: 0,
        ready_team2: 0,
        required: 5,
      })
    );
    expect(unready[0]).toMatchObject({ state: 'unready' });
  });

  test('round_start / round_end: score on the 0-based map; stat lines are map totals so far', () => {
    const start = normalizeFleetEvent(load('live.event.round_start.json'));
    expect(start).toEqual([
      {
        type: 'score.updated',
        slug: 'lt-1790308176',
        eventId: 'fleet:round_start:0:1',
        mapNumber: 0,
        team1: 0,
        team2: 0,
        phase: 'live',
      },
    ]);

    // The live frame's players are all dev bots: no stat lines unless a simulation.
    const liveEnd = load('live.event.round_end.json');
    const botsDropped = normalizeFleetEvent(liveEnd);
    expect(botsDropped).toEqual([
      {
        type: 'score.updated',
        slug: 'lt-1790308176',
        eventId: 'fleet:round_end:0:1',
        mapNumber: 0,
        team1: 1,
        team2: 0,
        phase: 'live',
      },
    ]);
    const withBots = normalizeFleetEvent(liveEnd, { includeBots: true });
    expect(withBots[1]).toMatchObject({ type: 'player.stats', scope: 'map', mapNumber: 0 });
    expect((withBots[1] as Extract<NormalizedEvent, { type: 'player.stats' }>).lines).toHaveLength(
      8
    );

    // Humans, two rounds: totals over the rounds the store has for the map.
    const r1 = round(1, [
      { id: HUMAN_1, team: 1, kills: 2, damage: 150, headshot_kills: 1, kast: true, mvp: true },
      { id: HUMAN_2, team: 2, kills: 0, damage: 40, died: true, kast: false },
    ]);
    const r2 = round(2, [
      { id: HUMAN_1, team: 1, kills: 1, damage: 50, assists: 1, died: true, kast: true },
      { id: HUMAN_2, team: 2, kills: 1, damage: 100, kast: true },
    ]);
    const end = normalizeFleetEvent(eventFrame('event.round_end', { round: r2 }, { map: 2 }), {
      state: stateFor('m-norm'),
      mapRounds: [r1, r2],
    });
    expect(end[0]).toMatchObject({ type: 'score.updated', mapNumber: 1, team1: 2, team2: 0 });
    const stats = end[1] as Extract<NormalizedEvent, { type: 'player.stats' }>;
    expect(stats).toMatchObject({
      type: 'player.stats',
      eventId: 'fleet:round_end:1:2/player.stats',
      scope: 'map',
      mapNumber: 1,
    });
    const alice = stats.lines.find((l) => l.account.externalId === HUMAN_1)!;
    expect(alice).toMatchObject({ name: 'alice', team: 'team1', won: false });
    expect(alice.metrics).toEqual({
      kills: 3,
      deaths: 1,
      assists: 1,
      adr: 100,
      kast: 2,
      headshots: 1,
      flash_assists: 0,
      utility_damage: 0,
      mvps: 1,
      score: 0,
      rounds_played: 2,
    });
    const bob = stats.lines.find((l) => l.account.externalId === HUMAN_2)!;
    expect(bob.metrics).toMatchObject({ kills: 1, deaths: 1, adr: 70, kast: 1, rounds_played: 2 });

    // Without the stored rounds, the event's own round is used.
    const alone = normalizeFleetEvent(eventFrame('event.round_end', { round: r2 }), {
      state: stateFor('m-norm'),
    });
    const aloneLines = (alone[1] as Extract<NormalizedEvent, { type: 'player.stats' }>).lines;
    expect(aloneLines.find((l) => l.account.externalId === HUMAN_1)!.metrics.rounds_played).toBe(1);
  });

  test('match_restored -> the restored map score from state', () => {
    const state = stateFor('m-norm');
    state.series.maps['1'] = { ...state.series.maps['1'], score: { team1: 1, team2: 1 } };
    const restored = normalizeFleetEvent(
      eventFrame('event.match_restored', { map_number: 1, round: 3, backup_sha256: 'ab' }),
      { state }
    );
    expect(restored).toEqual([
      {
        type: 'score.updated',
        slug: 'm-norm',
        eventId: 'fleet:match_restored:0:01M3BAZAGR50AY86C0444RSBPR',
        mapNumber: 0,
        team1: 1,
        team2: 1,
        phase: 'live',
      },
    ]);
    // No state yet: nothing to set.
    expect(
      normalizeFleetEvent(
        eventFrame('event.match_restored', { map_number: 1, round: 3, backup_sha256: 'ab' })
      )
    ).toEqual([]);
  });

  test('halftime / overtime / pause -> score + phase', () => {
    const half = normalizeFleetEvent(load('live.event.halftime.json'));
    expect(half).toEqual([
      {
        type: 'score.updated',
        slug: 'lt-1790308176',
        eventId: 'fleet:halftime:0',
        mapNumber: 0,
        team1: 2,
        team2: 0,
        phase: 'halftime',
      },
      {
        type: 'phase.changed',
        slug: 'lt-1790308176',
        eventId: 'fleet:halftime:0/phase',
        phase: 'halftime',
      },
    ]);
    const ot = normalizeFleetEvent(
      eventFrame('event.overtime', { score: { team1: 12, team2: 12 }, overtime_number: 1 })
    );
    expect(ot.map((e) => e.type)).toEqual(['score.updated', 'phase.changed']);
    expect(ot[1]).toMatchObject({ phase: 'overtime' });
    expect(normalizeFleetEvent(load('live.event.pause.json'))).toEqual([
      {
        type: 'phase.changed',
        slug: 'lt-1790308176',
        eventId: 'fleet:pause:e2:r17',
        phase: 'paused',
      },
    ]);
    expect(
      normalizeFleetEvent(
        eventFrame('event.pause', { action: 'unpaused', type: 'admin', by: 'x' })
      )[0]
    ).toMatchObject({ phase: 'live' });
  });

  test('map_result: 0-based map, series score, draw, MapStats stat lines', () => {
    const frame = load('live.event.map_result.json');
    const out = normalizeFleetEvent(frame);
    // 2-2 with winner "none": a drawn map. Every player is a dev bot: no lines.
    expect(out).toEqual([
      {
        type: 'map.result',
        slug: 'lt-1790306893',
        eventId: 'fleet:map_result:0',
        mapNumber: 0,
        mapName: 'de_dust2',
        team1Score: 2,
        team2Score: 2,
        winner: 'draw',
        seriesScore: { team1: 0, team2: 0 },
      },
    ]);
    const sim = normalizeFleetEvent(frame, { includeBots: true });
    const lines = (sim[1] as Extract<NormalizedEvent, { type: 'player.stats' }>).lines;
    expect(lines).toHaveLength(8);
    expect(lines.every((l) => l.won === false)).toBe(true);

    // A won map 2 of a BO3 with a human line.
    const data = frame.payload.data as Record<string, unknown>;
    const stats = data.stats as { players: Array<Record<string, unknown>> };
    const won = eventFrame(
      'event.map_result',
      {
        ...data,
        map_number: 2,
        map_name: 'de_mirage',
        winner: 'team2',
        team1_score: 9,
        team2_score: 13,
        team1_series_score: 1,
        team2_series_score: 1,
        stats: {
          ...stats,
          players: [
            {
              id: HUMAN_2,
              name: 'bob',
              team: 2,
              bot: false,
              stats: {
                kills: 20,
                deaths: 10,
                assists: 3,
                damage: 2200,
                rounds_played: 22,
                kast_rounds: 17,
                mvp: 4,
                headshot_kills: 9,
              },
            },
          ],
        },
      },
      { map: 2 }
    );
    const res = normalizeFleetEvent(won);
    expect(res[0]).toMatchObject({
      type: 'map.result',
      mapNumber: 1,
      winner: 'team2',
      seriesScore: { team1: 1, team2: 1 },
    });
    const line = (res[1] as Extract<NormalizedEvent, { type: 'player.stats' }>).lines[0];
    expect(line).toMatchObject({ name: 'bob', team: 'team2', won: true });
    expect(line.metrics).toMatchObject({
      kills: 20,
      deaths: 10,
      adr: 100,
      kast: 17,
      mvps: 4,
      headshots: 9,
      rounds_played: 22,
    });
  });

  test('series_end: forced and natural; winner from the score when the server says none', () => {
    expect(normalizeFleetEvent(load('live.event.series_end.json'))).toEqual([
      {
        type: 'series.ended',
        slug: 'lt-1790308176',
        eventId: 'fleet:series_end',
        team1SeriesScore: 0,
        team2SeriesScore: 0,
        winner: 'none',
        releaseAfterSeconds: 0,
      },
    ]);
    expect(normalizeFleetEvent(load('live.event.series_end.natural.json'))[0]).toMatchObject({
      releaseAfterSeconds: 44,
    });
    const decided = normalizeFleetEvent(
      eventFrame('event.series_end', {
        type: 'series_end',
        winner: 'none',
        team1_series_score: 2,
        team2_series_score: 1,
      })
    );
    expect(decided[0]).toMatchObject({ winner: 'team1', team1SeriesScore: 2, team2SeriesScore: 1 });
  });

  test('fleet-only events and non-events give nothing', () => {
    for (const file of [
      'live.event.backup.json',
      'live.event.demo.json',
      'live.event.knife_result.json',
      'live.event.side_picked.json',
      'live.event.rounds_voided.json',
      'live.event.match_restored.json',
      'event.admin_called.json',
      'live.state.patch.json',
      'live.cmd.result.json',
      'live.server.availability.json',
    ]) {
      expect(normalizeFleetEvent(load(file)), file).toEqual([]);
    }
  });

  test('same event types and metric keys as the plugin path', () => {
    // The plugin's map_result for the same numbers: identical neutral shape
    // apart from the event id prefix (the plugin adds the series score in
    // matchEvents; the fleet event carries it).
    const plugin = normalizePlugin({
      event: 'map_result',
      matchid: 'm-norm',
      map_number: 1,
      map_name: 'de_mirage',
      winner: { team: 'team2' },
      team1: { score: 9, players: [] },
      team2: {
        score: 13,
        players: [
          {
            steamid: HUMAN_2,
            name: 'bob',
            stats: {
              kills: 20,
              deaths: 10,
              assists: 3,
              damage: 2200,
              rounds_played: 22,
              kast: 17,
              mvp: 4,
              headshot_kills: 9,
            },
          },
        ],
      },
    });
    const fleet = normalizeFleetEvent(
      eventFrame(
        'event.map_result',
        {
          type: 'map_result',
          winner: 'team2',
          team1_series_score: 1,
          team2_series_score: 1,
          map_number: 2,
          map_name: 'de_mirage',
          team1_score: 9,
          team2_score: 13,
          series_over: false,
          stats: {
            live: false,
            team1_is_ct: true,
            team1: { score: 9, score_ct: 5, score_t: 4 },
            team2: { score: 13, score_ct: 7, score_t: 6 },
            players: [
              {
                id: HUMAN_2,
                name: 'bob',
                team: 2,
                bot: false,
                stats: {
                  kills: 20,
                  deaths: 10,
                  assists: 3,
                  damage: 2200,
                  rounds_played: 22,
                  kast_rounds: 17,
                  mvp: 4,
                  headshot_kills: 9,
                },
              },
            ],
            rounds: [],
          },
        },
        { map: 2 }
      )
    );
    const strip = (events: NormalizedEvent[]) =>
      events.map((e) => {
        const { eventId: _id, ...rest } = e as NormalizedEvent & { seriesScore?: unknown };
        delete (rest as { seriesScore?: unknown }).seriesScore;
        return rest;
      });
    expect(strip(fleet)).toEqual(strip(plugin));
    expect(
      Object.keys(
        metricsFromFleetStats({ kills: 0, deaths: 0, assists: 0, damage: 0, rounds_played: 0 })
      )
    ).toEqual(
      Object.keys(
        (plugin[1] as Extract<NormalizedEvent, { type: 'player.stats' }>).lines[0].metrics
      )
    );
  });

  test('totalsFromRounds sums per player and keeps the last team', () => {
    const totals = totalsFromRounds([
      round(1, [{ id: HUMAN_1, team: 1, kills: 1, damage: 10, died: true }]),
      round(2, [{ id: HUMAN_1, team: 1, kills: 2, damage: 20, kast: true }]),
    ]);
    expect(totals.get(HUMAN_1)).toMatchObject({
      team: 'team1',
      stats: { kills: 3, deaths: 1, damage: 30, kast_rounds: 1, rounds_played: 2 },
    });
  });
});
