/**
 * Ready Up fleet `event.*` -> NormalizedEvent[] (FLEET.md §8.1, §19.1; Ready
 * Up's docs/fleet-step3-platform-notes.md §5).
 *
 * The fleet twin of `../events/normalize.ts`: the same neutral event types
 * and the same metric keys, so `events/matchEvents.ts` and
 * `core/matchLifecycle.ts` treat a fleet match exactly like a plugin one.
 *
 * Pure: no database, no clock, no I/O. Event ids are deterministic
 * (`fleet:map_result:<map>`, `fleet:round_end:<map>:<round>`, and the rev for
 * events without a natural key), so a replay gives the same ids.
 *
 * Map numbers: the fleet counts maps from 1 (`map_number`,
 * `series.current_map`); the platform from 0 (`matches.map_number`,
 * `match_map_results.map_number`, NormalizedEvent.mapNumber). Every map
 * number that leaves this file went through `toPlatformMapNumber`.
 *
 * | fleet                                   | NormalizedEvent                                   |
 * |-----------------------------------------|---------------------------------------------------|
 * | event.phase to `live` from a pre-live phase | series.started (map 1 only), map.started, phase.changed |
 * | event.phase (any other)                 | phase.changed                                     |
 * | event.player_connect / _disconnect / _ready / _unready | presence.changed                     |
 * | event.round_start {score}               | score.updated                                     |
 * | event.round_end {round}                 | score.updated, player.stats (map totals so far)   |
 * | event.halftime / event.overtime         | score.updated, phase.changed                      |
 * | event.pause                             | phase.changed (`paused` / `live`)                 |
 * | event.match_restored                    | score.updated (the restored map score, from state) |
 * | event.map_result                        | map.result (with the series score), player.stats  |
 * | event.series_end                        | series.ended                                      |
 * | everything else                         | [] (live page / driver hooks, see ./inbound.ts)   |
 *
 * Bots: ids in Ready Up's dev-bot range (`0xB0B0…`, `PlayerLine.bot`) are
 * dropped from stat lines unless `includeBots` (a simulation, §13).
 */

import type { LinkedAccountRef, NormalizedEvent, PlayerStatLine, TeamSide } from '../../types';
import type {
  Envelope,
  FleetEventData,
  FleetEventPayload,
  FleetPlayerStats,
  MatchPhase,
  MatchState,
  RoundSummary,
} from './protocol/v1';

export interface FleetNormalizeContext {
  /** The platform match slug. Defaults to the payload's `match_id` (they are the same). */
  slug?: string;
  /** MatchState after this message's patch: player names, `num_maps`, map names. */
  state?: MatchState | null;
  /**
   * `event.round_end`: this map's round summaries so far, this round
   * included (the state store's `recordRound`). Without them the stat lines
   * cover this round only.
   */
  mapRounds?: RoundSummary[];
  /** Keep dev-bot players in stat lines (a simulation match). */
  includeBots?: boolean;
}

/** Phases a map goes live from the first time (not after a pause, halftime or overtime). */
const PRE_LIVE: ReadonlySet<MatchPhase> = new Set(['loading', 'warmup', 'knife', 'side_pick']);

/** Fleet map numbers are 1-based; the platform's are 0-based. */
export function toPlatformMapNumber(fleetMapNumber: number): number {
  return Math.max(0, Math.trunc(fleetMapNumber) - 1);
}

/** The platform's 0-based map number as the fleet's 1-based one. */
export function toFleetMapNumber(platformMapNumber: number): number {
  return Math.max(0, Math.trunc(platformMapNumber)) + 1;
}

/** Ready Up's dev-bot pseudo SteamIDs: the top 16 bits are 0xB0B0 (players.h `IsDevBotId`). */
export function isDevBotId(id: string): boolean {
  if (!/^[0-9]{1,20}$/.test(id)) return false;
  try {
    return BigInt(id) >> BigInt(48) === BigInt(0xb0b0);
  } catch {
    return false;
  }
}

function steam(steamId: string): LinkedAccountRef {
  return { provider: 'steam', externalId: steamId };
}

function teamOf(value: unknown): TeamSide | undefined {
  if (value === 'team1' || value === 1) return 'team1';
  if (value === 'team2' || value === 2) return 'team2';
  return undefined;
}

function playerName(state: MatchState | null | undefined, id: string): string {
  const fromTeam =
    state?.teams?.team1?.players?.[id]?.name ?? state?.teams?.team2?.players?.[id]?.name;
  return fromTeam && fromTeam !== '' ? fromTeam : 'Unknown';
}

/** Metrics in `statsSchema` keys, the way `events/normalize.ts` derives them (ADR = damage / rounds). */
export function metricsFromFleetStats(stats: FleetPlayerStats): Record<string, number> {
  const roundsPlayed = stats.rounds_played ?? 0;
  const damage = stats.damage ?? 0;
  const adr = roundsPlayed > 0 ? Math.round((damage / roundsPlayed) * 100) / 100 : 0;
  return {
    kills: stats.kills ?? 0,
    deaths: stats.deaths ?? 0,
    assists: stats.assists ?? 0,
    adr,
    kast: stats.kast_rounds ?? 0,
    headshots: stats.headshot_kills ?? 0,
    flash_assists: stats.flash_assists ?? 0,
    utility_damage: stats.utility_damage ?? 0,
    mvps: stats.mvp ?? 0,
    score: stats.score ?? 0,
    rounds_played: roundsPlayed,
  };
}

/** Per-player map totals from round summaries (what a MapStats would say, as far as rounds tell). */
export function totalsFromRounds(
  rounds: RoundSummary[]
): Map<string, { team: TeamSide | undefined; stats: FleetPlayerStats }> {
  const totals = new Map<string, { team: TeamSide | undefined; stats: FleetPlayerStats }>();
  for (const round of rounds) {
    for (const p of round.players ?? []) {
      const entry = totals.get(p.id) ?? {
        team: undefined,
        stats: {
          kills: 0,
          deaths: 0,
          assists: 0,
          flash_assists: 0,
          headshot_kills: 0,
          damage: 0,
          utility_damage: 0,
          kast_rounds: 0,
          mvp: 0,
          rounds_played: 0,
        },
      };
      const s = entry.stats;
      s.kills += p.kills ?? 0;
      s.deaths += p.died ? 1 : 0;
      s.assists += p.assists ?? 0;
      s.flash_assists = (s.flash_assists ?? 0) + (p.flash_assists ?? 0);
      s.headshot_kills = (s.headshot_kills ?? 0) + (p.headshot_kills ?? 0);
      s.damage += p.damage ?? 0;
      s.utility_damage = (s.utility_damage ?? 0) + (p.utility_damage ?? 0);
      s.kast_rounds = (s.kast_rounds ?? 0) + (p.kast ? 1 : 0);
      s.mvp = (s.mvp ?? 0) + (p.mvp ? 1 : 0);
      s.rounds_played += 1;
      entry.team = teamOf(p.team) ?? entry.team;
      totals.set(p.id, entry);
    }
  }
  return totals;
}

function roundLines(rounds: RoundSummary[], ctx: FleetNormalizeContext): PlayerStatLine[] {
  const lines: PlayerStatLine[] = [];
  for (const [id, total] of totalsFromRounds(rounds)) {
    if (!total.team) continue;
    if (!ctx.includeBots && isDevBotId(id)) continue;
    lines.push({
      account: steam(id),
      name: playerName(ctx.state, id),
      team: total.team,
      won: false,
      metrics: metricsFromFleetStats(total.stats),
    });
  }
  return lines;
}

function phaseChanged(slug: string, eventId: string, phase: string): NormalizedEvent {
  return { type: 'phase.changed', slug, eventId, phase };
}

function scoreUpdated(
  slug: string,
  eventId: string,
  mapNumber: number,
  score: { team1: number; team2: number } | undefined,
  phase: string
): NormalizedEvent[] {
  if (!score) return [];
  return [
    {
      type: 'score.updated',
      slug,
      eventId,
      mapNumber,
      team1: score.team1,
      team2: score.team2,
      phase,
    },
  ];
}

const PRESENCE = {
  'event.player_connect': 'connected',
  'event.player_disconnect': 'disconnected',
  'event.player_ready': 'ready',
  'event.player_unready': 'unready',
} as const;

/**
 * One fleet message -> the neutral events the core consumes. Anything that
 * is not an `event.*` with a `match_id`, and the events that stay
 * fleet-only, give `[]`.
 */
export function normalizeFleetEvent(
  env: Envelope,
  ctx: FleetNormalizeContext = {}
): NormalizedEvent[] {
  if (!env || typeof env.type !== 'string' || !env.type.startsWith('event.')) return [];
  const payload = env.payload as unknown as FleetEventPayload;
  if (!payload || typeof payload.match_id !== 'string') return [];
  const slug = ctx.slug ?? payload.match_id;
  if (!slug) return [];
  const fleetMap = typeof payload.map_number === 'number' ? payload.map_number : 1;
  const map = toPlatformMapNumber(fleetMap);
  const epochKey = `e${env.epoch ?? 0}:r${payload.rev}`;

  switch (env.type) {
    case 'event.phase': {
      const data = payload.data as FleetEventData['phase'];
      const out: NormalizedEvent[] = [];
      if (data.to === 'live' && PRE_LIVE.has(data.from)) {
        if (fleetMap === 1) {
          out.push({
            type: 'series.started',
            slug,
            eventId: 'fleet:series_start',
            seriesLength: ctx.state?.series?.num_maps ?? 1,
          });
        }
        const mapName = ctx.state?.series?.maps?.[String(fleetMap)]?.name;
        out.push({
          type: 'map.started',
          slug,
          eventId: `fleet:going_live:${map}`,
          mapNumber: map,
          ...(mapName ? { mapName } : {}),
        });
      }
      out.push(phaseChanged(slug, `fleet:phase:${epochKey}`, data.to));
      return out;
    }

    case 'event.player_connect':
    case 'event.player_disconnect':
    case 'event.player_ready':
    case 'event.player_unready': {
      const data = payload.data as { steamid64?: string; team?: string };
      if (typeof data.steamid64 !== 'string' || data.steamid64 === '') return [];
      const team = teamOf(data.team);
      return [
        {
          type: 'presence.changed',
          slug,
          eventId: `fleet:${env.type.slice(6)}:${data.steamid64}:${epochKey}`,
          account: steam(data.steamid64),
          ...(team ? { team } : {}),
          state: PRESENCE[env.type],
        },
      ];
    }

    case 'event.round_start': {
      const data = payload.data as FleetEventData['round_start'];
      return scoreUpdated(slug, `fleet:round_start:${map}:${data.round}`, map, data.score, 'live');
    }

    case 'event.round_end': {
      const round = (payload.data as FleetEventData['round_end']).round;
      const eventId = `fleet:round_end:${map}:${round.round_number}`;
      const out = scoreUpdated(
        slug,
        eventId,
        map,
        { team1: round.team1_score, team2: round.team2_score },
        'live'
      );
      const rounds = ctx.mapRounds?.some((r) => r.round_number === round.round_number)
        ? ctx.mapRounds
        : [...(ctx.mapRounds ?? []), round];
      const lines = roundLines(rounds, ctx);
      if (lines.length) {
        out.push({
          type: 'player.stats',
          slug,
          eventId: `${eventId}/player.stats`,
          scope: 'map',
          mapNumber: map,
          lines,
        });
      }
      return out;
    }

    case 'event.halftime': {
      const data = payload.data as FleetEventData['halftime'];
      const key = `fleet:halftime:${map}`;
      return [
        ...scoreUpdated(slug, key, map, data.score, 'halftime'),
        phaseChanged(slug, `${key}/phase`, 'halftime'),
      ];
    }

    case 'event.overtime': {
      const data = payload.data as FleetEventData['overtime'];
      const key = `fleet:overtime:${map}:${data.overtime_number}`;
      return [
        ...scoreUpdated(slug, key, map, data.score, 'overtime'),
        phaseChanged(slug, `${key}/phase`, 'overtime'),
      ];
    }

    case 'event.match_restored': {
      // A restore (admin, vote, failover resume) goes back to an earlier
      // score; without this the live score keeps the abandoned timeline's
      // until the next round ends (seen in the NTLAN trial run).
      const score = ctx.state?.series?.maps?.[String(fleetMap)]?.score;
      return scoreUpdated(slug, `fleet:match_restored:${map}:${env.id}`, map, score, 'live');
    }

    case 'event.pause': {
      const data = payload.data as FleetEventData['pause'];
      return [
        phaseChanged(
          slug,
          `fleet:pause:${epochKey}`,
          data.action === 'unpaused' ? 'live' : 'paused'
        ),
      ];
    }

    case 'event.map_result': {
      const data = payload.data as FleetEventData['map_result'];
      const resultMap = toPlatformMapNumber(data.map_number ?? fleetMap);
      const winner: TeamSide | 'draw' =
        teamOf(data.winner) ??
        (data.team1_score === data.team2_score
          ? 'draw'
          : data.team1_score > data.team2_score
            ? 'team1'
            : 'team2');
      const eventId = `fleet:map_result:${resultMap}`;
      const out: NormalizedEvent[] = [
        {
          type: 'map.result',
          slug,
          eventId,
          mapNumber: resultMap,
          ...(data.map_name ? { mapName: data.map_name } : {}),
          team1Score: data.team1_score,
          team2Score: data.team2_score,
          winner,
          seriesScore: { team1: data.team1_series_score, team2: data.team2_series_score },
        },
      ];
      const lines: PlayerStatLine[] = [];
      for (const p of data.stats?.players ?? []) {
        const team = teamOf(p.team);
        if (!team) continue;
        if (!ctx.includeBots && (p.bot || isDevBotId(p.id))) continue;
        lines.push({
          account: steam(p.id),
          name: p.name || playerName(ctx.state, p.id),
          team,
          won: winner === team,
          metrics: metricsFromFleetStats(p.stats),
        });
      }
      if (lines.length) {
        out.push({
          type: 'player.stats',
          slug,
          eventId: `${eventId}/player.stats`,
          scope: 'map',
          mapNumber: resultMap,
          lines,
        });
      }
      return out;
    }

    case 'event.series_end': {
      const data = payload.data as FleetEventData['series_end'];
      const t1 = data.team1_series_score ?? 0;
      const t2 = data.team2_series_score ?? 0;
      const winner: TeamSide | 'none' =
        teamOf(data.winner) ?? (t1 === t2 ? 'none' : t1 > t2 ? 'team1' : 'team2');
      return [
        {
          type: 'series.ended',
          slug,
          eventId: 'fleet:series_end',
          team1SeriesScore: t1,
          team2SeriesScore: t2,
          winner,
          ...(data.seconds_until_reset !== undefined
            ? { releaseAfterSeconds: data.seconds_until_reset }
            : {}),
        },
      ];
    }

    default:
      return [];
  }
}
