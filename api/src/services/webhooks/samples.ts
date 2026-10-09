/**
 * Sample payloads: what "Send test event" delivers, and what the docs show.
 *
 * A test event is shaped exactly like the real one of its type — two teams
 * with their external ids, every player's Steam64, the maps and score, and
 * connect details with a steam:// link — so an integrator can build and try
 * the whole flow (a "connect now" banner, a live score) before the event day.
 * The data is made up (the server is 203.0.113.10, a documentation address)
 * and the envelope says `test: true`. Pure.
 */

import {
  connectLinks,
  WEBHOOK_API_VERSION,
  type WebhookEnvelope,
  type WebhookEventType,
  type WebhookMapScore,
  type WebhookMatch,
} from './events';

const SAMPLE_CONNECT = { host: '203.0.113.10', port: 27015, password: 'k3Lp9QzT2w' };

function player(n: number, name: string) {
  return { steam_id64: `765611980000000${String(n).padStart(2, '0')}`, name };
}

/** The sample match in the state `type` describes. */
export function sampleMatch(type: WebhookEventType, externalIds: { team1?: string; team2?: string; source?: string } = {}): WebhookMatch {
  const source = externalIds.source ?? 'ntlan';
  const t1 = externalIds.team1 ?? 'team-4711';
  const t2 = externalIds.team2 ?? 'team-4712';

  const status: Record<WebhookEventType, string> = {
    'match.ready': 'loaded',
    'match.live': 'live',
    'match.map_started': 'live',
    'match.score_updated': 'live',
    'match.map_ended': 'live',
    'match.finished': 'completed',
    'match.cancelled': 'cancelled',
    'match.reset': 'ready',
    'admin.called': 'live',
    'admin.call_resolved': 'live',
  };

  let maps: WebhookMapScore[];
  let series = { team1: 0, team2: 0 };
  switch (type) {
    case 'match.ready':
    case 'match.reset':
    case 'match.cancelled':
      maps = [
        { number: 1, name: 'de_mirage', team1: 0, team2: 0, status: 'upcoming', winner: null },
        { number: 2, name: 'de_inferno', team1: 0, team2: 0, status: 'upcoming', winner: null },
        { number: 3, name: 'de_nuke', team1: 0, team2: 0, status: 'upcoming', winner: null },
      ];
      break;
    case 'match.live':
    case 'match.map_started':
      maps = [
        { number: 1, name: 'de_mirage', team1: 0, team2: 0, status: 'live', winner: null },
        { number: 2, name: 'de_inferno', team1: 0, team2: 0, status: 'upcoming', winner: null },
        { number: 3, name: 'de_nuke', team1: 0, team2: 0, status: 'upcoming', winner: null },
      ];
      break;
    case 'match.score_updated':
    case 'admin.called':
    case 'admin.call_resolved':
      maps = [
        { number: 1, name: 'de_mirage', team1: 7, team2: 5, status: 'live', winner: null },
        { number: 2, name: 'de_inferno', team1: 0, team2: 0, status: 'upcoming', winner: null },
        { number: 3, name: 'de_nuke', team1: 0, team2: 0, status: 'upcoming', winner: null },
      ];
      break;
    case 'match.map_ended':
      maps = [
        { number: 1, name: 'de_mirage', team1: 13, team2: 9, status: 'finished', winner: 'team1' },
        { number: 2, name: 'de_inferno', team1: 0, team2: 0, status: 'upcoming', winner: null },
        { number: 3, name: 'de_nuke', team1: 0, team2: 0, status: 'upcoming', winner: null },
      ];
      series = { team1: 1, team2: 0 };
      break;
    case 'match.finished':
      maps = [
        { number: 1, name: 'de_mirage', team1: 13, team2: 9, status: 'finished', winner: 'team1' },
        { number: 2, name: 'de_inferno', team1: 11, team2: 13, status: 'finished', winner: 'team2' },
        { number: 3, name: 'de_nuke', team1: 13, team2: 6, status: 'finished', winner: 'team1' },
      ];
      series = { team1: 2, team2: 1 };
      break;
  }
  const current = maps.find((m) => m.status === 'live') ?? [...maps].reverse().find((m) => m.status === 'finished') ?? null;
  const connectable = (status[type] === 'loaded' || status[type] === 'live') && type !== 'admin.call_resolved';

  return {
    id: 42,
    slug: 'r2m1',
    status: status[type],
    game: 'cs2',
    round: 2,
    match_number: 1,
    bracket: 'WB',
    best_of: 3,
    tournament: { id: 7, name: 'Sample LAN 2026' },
    team1: {
      id: 'sample-ninjas',
      external_id: t1,
      external_ids: { [source]: t1 },
      name: 'Ninjas in Sample',
      tag: 'NiS',
      players: [player(1, 'alpha'), player(2, 'bravo'), player(3, 'charlie'), player(4, 'delta'), player(5, 'echo')],
    },
    team2: {
      id: 'sample-pirates',
      external_id: t2,
      external_ids: { [source]: t2 },
      name: 'Sample Pirates',
      tag: 'SPR',
      players: [player(6, 'foxtrot'), player(7, 'golf'), player(8, 'hotel'), player(9, 'india'), player(10, 'juliett')],
    },
    score: {
      series,
      map: current ? { number: current.number, name: current.name, team1: current.team1, team2: current.team2 } : null,
    },
    maps,
    winner: type === 'match.finished' ? { side: 'team1', team_id: 'sample-ninjas' } : null,
    connect: connectable
      ? { ...SAMPLE_CONNECT, ...connectLinks(SAMPLE_CONNECT.host, SAMPLE_CONNECT.port, SAMPLE_CONNECT.password) }
      : null,
  };
}

/** A whole envelope for `type` (docs and test deliveries). */
export function sampleEnvelope(
  type: WebhookEventType,
  opts: { id?: string; createdAt?: Date; test?: boolean; source?: string } = {}
): WebhookEnvelope {
  const match = sampleMatch(type, { source: opts.source });
  const previous: Partial<Record<WebhookEventType, string>> = {
    'match.ready': 'ready',
    'match.live': 'loaded',
    'match.finished': 'live',
    'match.cancelled': 'loaded',
    'match.reset': 'loaded',
  };
  return {
    id: opts.id ?? 'evt_sample0000000000000000',
    type,
    created_at: (opts.createdAt ?? new Date('2026-10-01T18:00:00.000Z')).toISOString(),
    api_version: WEBHOOK_API_VERSION,
    test: opts.test ?? true,
    data: {
      match,
      ...(type === 'match.map_ended' ? { map: match.maps[0] } : {}),
      ...(previous[type] ? { previous_status: previous[type] } : {}),
      ...(type === 'match.cancelled' ? { reason: 'cancelled' } : {}),
      ...(type === 'match.reset' ? { reason: 'unassigned' } : {}),
      ...(type === 'admin.called' || type === 'admin.call_resolved'
        ? {
            admin_call: {
              id: 'call_sample000000',
              player: { steam_id64: '76561198000000001', name: 'Sample Player', team: 'team1' as const, team_name: match.team1?.name ?? null },
              message: 'my game crashed',
              map_number: 1,
              server: { id: 'srv-sample', name: 'Sample server #1' },
              match_url: 'https://tournament.example.com/manage/matches?match=sample-match',
              called_at: (opts.createdAt ?? new Date('2026-10-01T18:00:00.000Z')).toISOString(),
            },
          }
        : {}),
      ...(type === 'admin.call_resolved' ? { resolved_by: 'Sample Admin', resolution_note: 'restarted the round' } : {}),
      sequence: 1,
    },
  };
}
