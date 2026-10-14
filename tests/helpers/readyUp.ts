import { expect, type APIRequestContext } from '@playwright/test';
import { getAuthHeader } from './auth';

/**
 * Ready Up's match events, as the server sends them on the fleet link
 * (FLEET.md §8.1, tests/fixtures/fleet/v1), for specs that play a match out.
 *
 * `sendReadyUpEvents` hands them to `POST /api/test/fleet/events`, which
 * applies each one through the same `processInbound` a connected server's
 * messages take. Map numbers here are Ready Up's: 1-based.
 */

export interface ReadyUpEvent {
  type: string;
  map_number?: number;
  round?: number;
  data?: Record<string, unknown>;
  patch?: Record<string, unknown>;
}

export type Side = 'team1' | 'team2';

export interface ReadyUpPlayer {
  steamId: string;
  name: string;
  team: Side;
  kills?: number;
  deaths?: number;
  assists?: number;
  damage?: number;
  headshots?: number;
  roundsPlayed?: number;
  kastRounds?: number;
  mvp?: number;
  bot?: boolean;
}

export async function sendReadyUpEvents(
  request: APIRequestContext,
  matchSlug: string,
  events: ReadyUpEvent[],
  serverId?: string
): Promise<void> {
  const res = await request.post('/api/test/fleet/events', {
    headers: getAuthHeader(),
    data: { matchSlug, events, ...(serverId ? { serverId } : {}) },
  });
  expect(res.ok(), `fleet events for ${matchSlug}: ${await res.text()}`).toBe(true);
}

/** The map goes live (from warmup); map 1 also starts the series. */
export function goingLive(mapNumber = 1, from = 'warmup'): ReadyUpEvent {
  return {
    type: 'phase',
    map_number: mapNumber,
    patch: { phase: 'live' },
    data: { from, to: 'live', reason: 'flow' },
  };
}

export function phase(to: string, from = 'live', mapNumber = 1): ReadyUpEvent {
  return {
    type: 'phase',
    map_number: mapNumber,
    patch: { phase: to },
    data: { from, to, reason: 'flow' },
  };
}

export function roundEnd(
  mapNumber: number,
  roundNumber: number,
  team1: number,
  team2: number,
  players: ReadyUpPlayer[] = []
): ReadyUpEvent {
  return {
    type: 'round_end',
    map_number: mapNumber,
    round: roundNumber,
    data: {
      round: {
        round_number: roundNumber,
        winner_team: team1 >= team2 ? 1 : 2,
        winner_side: 3,
        reason: 8,
        team1_score: team1,
        team2_score: team2,
        team1_was_ct: true,
        players: players.map((p) => ({
          id: p.steamId,
          team: p.team === 'team1' ? 1 : 2,
          side: 3,
          kills: p.kills ?? 0,
          assists: p.assists ?? 0,
          flash_assists: 0,
          damage: p.damage ?? 0,
          utility_damage: 0,
          headshot_kills: p.headshots ?? 0,
          died: (p.deaths ?? 0) > 0,
          survived: (p.deaths ?? 0) === 0,
          traded: false,
          kast: true,
          entry_kill: false,
          entry_death: false,
          mvp: (p.mvp ?? 0) > 0,
          clutch_vs: 0,
          clutch_won: false,
        })),
      },
    },
  };
}

export function halftime(mapNumber: number, team1: number, team2: number): ReadyUpEvent {
  return { type: 'halftime', map_number: mapNumber, data: { score: { team1, team2 } } };
}

export function mapResult(opts: {
  /** Ready Up's map number (1-based). */
  mapNumber?: number;
  mapName?: string;
  team1: number;
  team2: number;
  /** The series score after this map. */
  series: [number, number];
  winner?: Side | 'none';
  players?: ReadyUpPlayer[];
  seriesOver?: boolean;
}): ReadyUpEvent {
  const mapNumber = opts.mapNumber ?? 1;
  const winner =
    opts.winner ??
    (opts.team1 === opts.team2 ? 'none' : opts.team1 > opts.team2 ? 'team1' : 'team2');
  return {
    type: 'map_result',
    map_number: mapNumber,
    data: {
      type: 'map_result',
      winner,
      map_number: mapNumber,
      map_name: opts.mapName ?? 'de_mirage',
      team1_score: opts.team1,
      team2_score: opts.team2,
      team1_series_score: opts.series[0],
      team2_series_score: opts.series[1],
      series_over: opts.seriesOver ?? false,
      next_map: '',
      demo_recorded: false,
      demo_upload_configured: false,
      stats: {
        live: false,
        team1_is_ct: false,
        team1: { score: opts.team1, score_ct: 0, score_t: 0 },
        team2: { score: opts.team2, score_ct: 0, score_t: 0 },
        players: (opts.players ?? []).map((p) => ({
          id: p.steamId,
          name: p.name,
          team: p.team === 'team1' ? 1 : 2,
          last_side: 2,
          bot: p.bot ?? false,
          stats: {
            kills: p.kills ?? 0,
            deaths: p.deaths ?? 0,
            assists: p.assists ?? 0,
            flash_assists: 0,
            team_kills: 0,
            suicides: 0,
            headshot_kills: p.headshots ?? 0,
            knife_kills: 0,
            damage: p.damage ?? 0,
            utility_damage: 0,
            enemies_flashed: 0,
            friendlies_flashed: 0,
            bomb_plants: 0,
            bomb_defuses: 0,
            kast_rounds: p.kastRounds ?? p.roundsPlayed ?? opts.team1 + opts.team2,
            rounds_played: p.roundsPlayed ?? opts.team1 + opts.team2,
            mvp: p.mvp ?? 0,
            score: 0,
            multi_kills: [0, 0, 0, 0, 0],
            clutches_won: [0, 0, 0, 0, 0],
          },
        })),
      },
    },
  };
}

export function seriesEnd(opts: {
  winner: Side | 'none';
  team1: number;
  team2: number;
  mapNumber?: number;
  reason?: string;
  forced?: boolean;
  secondsUntilReset?: number;
}): ReadyUpEvent {
  return {
    type: 'series_end',
    map_number: opts.mapNumber ?? 1,
    patch: { phase: 'series_end' },
    data: {
      type: 'series_end',
      winner: opts.winner,
      reason: opts.reason ?? 'complete',
      forced: opts.forced ?? false,
      team1_series_score: opts.team1,
      team2_series_score: opts.team2,
      seconds_until_reset: opts.secondsUntilReset ?? 0,
    },
  };
}

/**
 * A whole series in one call: each map goes live and ends with its score,
 * then the series ends. `maps`: [team1, team2] rounds per map.
 */
export function series(
  maps: Array<
    [number, number] | { score: [number, number]; mapName?: string; players?: ReadyUpPlayer[] }
  >,
  opts: { winner?: Side | 'none' } = {}
): ReadyUpEvent[] {
  const out: ReadyUpEvent[] = [];
  const seriesScore: [number, number] = [0, 0];
  maps.forEach((m, i) => {
    const map = Array.isArray(m) ? { score: m } : m;
    const [t1, t2] = map.score;
    if (t1 > t2) seriesScore[0] += 1;
    else if (t2 > t1) seriesScore[1] += 1;
    out.push(goingLive(i + 1));
    out.push(
      mapResult({
        mapNumber: i + 1,
        mapName: map.mapName,
        team1: t1,
        team2: t2,
        series: [seriesScore[0], seriesScore[1]],
        players: map.players,
        seriesOver: i === maps.length - 1,
      })
    );
  });
  const winner =
    opts.winner ??
    (seriesScore[0] === seriesScore[1]
      ? 'none'
      : seriesScore[0] > seriesScore[1]
        ? 'team1'
        : 'team2');
  out.push(
    seriesEnd({ winner, team1: seriesScore[0], team2: seriesScore[1], mapNumber: maps.length })
  );
  return out;
}

export function adminCalled(opts: {
  callId: string;
  steamId: string;
  name: string;
  team?: Side;
  message: string;
  mapNumber?: number;
  calledAt?: string;
}): ReadyUpEvent {
  return {
    type: 'admin_called',
    map_number: opts.mapNumber ?? 1,
    data: {
      call_id: opts.callId,
      player: { steamid64: opts.steamId, name: opts.name, team: opts.team ?? 'team1', side: 'ct' },
      message: opts.message,
      called_at: opts.calledAt ?? new Date().toISOString(),
    },
  };
}

export function playerPresence(
  kind: 'player_connect' | 'player_disconnect' | 'player_ready' | 'player_unready',
  steamId: string,
  team: Side,
  name = 'Player'
): ReadyUpEvent {
  return { type: kind, data: { steamid64: steamId, team, name } };
}

export function pause(
  action: 'paused' | 'unpaused',
  type = 'tactical',
  by = 'team1'
): ReadyUpEvent {
  return {
    type: 'pause',
    patch: {
      phase: action === 'paused' ? 'paused' : 'live',
      pause: { active: action === 'paused', type, by },
    },
    data: { action, type, by },
  };
}

/**
 * A Ready Up server in the match pool: enrolled, then linked to its own
 * `cs2_servers` row. No socket is opened; events from it go through
 * `sendReadyUpEvents(..., fleetId)`.
 */
export async function createReadyUpServer(
  request: APIRequestContext,
  name: string
): Promise<{ id: string; fleetId: string; name: string }> {
  const keyRes = await request.post('/api/fleet/keys', {
    headers: getAuthHeader(),
    data: { name: `${name}-key-${Date.now()}`, namePrefix: name, autoLink: true },
  });
  expect(keyRes.status(), await keyRes.text()).toBe(201);
  const key = (await keyRes.json()).value as string;
  await request.post('/api/test/fleet/reset-enroll-rate-limit', { headers: getAuthHeader() });
  const installId = `test-${name}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const res = await request.post('/api/fleet/enroll', {
    data: {
      key,
      install_id: installId,
      host: { hostname: `${name}-host`, game_port: 27015 },
      versions: { core: '0.4.0', plugin_api: '1.1', plugins: { fleet: '0.4.0' }, cs2_build: 14032 },
    },
  });
  expect(res.status(), await res.text()).toBe(201);
  const body = (await res.json()) as { server_id: string; name?: string };
  // Into the match pool: its own cs2_servers row (an auto-link key links on the first hello).
  const linked = await request.post(`/api/fleet/servers/${body.server_id}/link`, {
    headers: getAuthHeader(),
    data: { name },
  });
  expect(linked.ok(), await linked.text()).toBe(true);
  const link = (await linked.json()) as { cs2ServerId: string };
  const row = await request.get(`/api/servers/${link.cs2ServerId}`, { headers: getAuthHeader() });
  const rowName = row.ok() ? ((await row.json()).server?.name as string | undefined) : undefined;
  return { id: link.cs2ServerId, fleetId: body.server_id, name: rowName ?? name };
}
