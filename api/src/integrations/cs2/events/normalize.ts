/**
 * MatchZy event -> NormalizedEvent[].
 *
 * Pure: no database, no clock, no I/O. The same payload always gives the same
 * events with the same `eventId`s, which is what makes ingest idempotent when
 * the plugin retries a webhook. Results and lifecycle events have a natural
 * key (`map_result:<map>`, `series_end`, `round_end:<map>:<round>`); presence,
 * pause and stat updates do not, so theirs ends in a hash of the payload. Those
 * are state rather than increments: a player who reconnects sends the same
 * `player_connect` again, so ingest should apply them last-write-wins and use
 * the id only to drop retries.
 *
 * Payloads are read the way the event handler reads them today: MatchZy sends
 * scores and players nested per team (`team1: { score, series_score,
 * players }`) and the winner as `{ side, team }`, and the flat Get5-style
 * fields (`team1_score`, `winner: 'team1'`) are accepted as a fallback.
 *
 * What stays CS2-only (not normalised): the veto (`map_picked`, `map_vetoed`,
 * `side_picked`), server-level signals (`server_configured`, `server_health`,
 * `cs2_update_required`, the connectivity probe), `backup_loaded`, per-round
 * detail (`round_mvp`, `player_death`, bomb events) and the ready counters
 * (`team_ready`, `all_players_ready`). Those return `[]`.
 *
 * The core ingests these through `MatchLifecycleApi.ingest` (see
 * `./matchEvents`, which adds the reported series score to `map.result`).
 */

import type { LinkedAccountRef, NormalizedEvent, PlayerStatLine, TeamSide } from '../../types';

/** Where the events are for. `slug` defaults to the event's `matchid`. */
export interface NormalizeContext {
  slug?: string;
}

type Payload = Record<string, unknown>;

function num(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const n = typeof value === 'string' ? Number(value) : value;
  return typeof n === 'number' && Number.isFinite(n) ? n : undefined;
}

function obj(value: unknown): Payload | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Payload)
    : undefined;
}

function side(value: unknown): TeamSide | undefined {
  return value === 'team1' || value === 'team2' ? value : undefined;
}

/** `winner: { team }` (MatchZy) or `winner: 'team1'` (Get5 / synthesized). */
function winnerTeam(evt: Payload): string | undefined {
  const raw = evt.winner;
  if (typeof raw === 'string') return raw;
  const team = obj(raw)?.team;
  return typeof team === 'string' ? team : undefined;
}

/** `team1.<key>` first (what MatchZy sends), then the flat `team1_<key>`. */
function teamNumber(evt: Payload, team: TeamSide, key: 'score' | 'series_score'): number | undefined {
  return num(obj(evt[team])?.[key]) ?? num(evt[`${team}_${key}`]);
}

function mapNumberOf(evt: Payload): number | undefined {
  return num(evt.map_number);
}

function mapNameOf(evt: Payload): string | undefined {
  return typeof evt.map_name === 'string' && evt.map_name !== '' ? evt.map_name : undefined;
}

/**
 * A short deterministic hash of the payload, for events that carry no natural
 * key (presence, pauses, stat updates). FNV-1a over the JSON text.
 */
function payloadHash(evt: Payload): string {
  const text = JSON.stringify(evt);
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function steam(steamId: string): LinkedAccountRef {
  return { provider: 'steam', externalId: steamId };
}

function pick(stats: Payload, keys: string[]): number {
  for (const key of keys) {
    const value = num(stats[key]);
    if (value !== undefined) return value;
  }
  return 0;
}

/**
 * MatchZy's per-player stats as `statsSchema` metrics. ADR is derived the way
 * `persistPlayerMatchStats` stores it (damage / rounds, two decimals).
 */
function metricsFrom(stats: Payload): Record<string, number> {
  const roundsPlayed = pick(stats, ['rounds_played', 'roundsPlayed']);
  const damage = pick(stats, ['damage']);
  const adr = roundsPlayed > 0 ? Math.round((damage / roundsPlayed) * 100) / 100 : 0;
  return {
    kills: pick(stats, ['kills']),
    deaths: pick(stats, ['deaths']),
    assists: pick(stats, ['assists']),
    adr,
    kast: pick(stats, ['kast']),
    headshots: pick(stats, ['headshot_kills', 'headshotKills']),
    flash_assists: pick(stats, ['flash_assists', 'flashAssists']),
    utility_damage: pick(stats, ['utility_damage', 'utilityDamage']),
    mvps: pick(stats, ['mvp', 'mvps']),
    score: pick(stats, ['score']),
    rounds_played: roundsPlayed,
  };
}

/** Stat lines from the nested `team1.players` / `team2.players` blocks. */
function teamStatLines(evt: Payload, winner: TeamSide | 'draw'): PlayerStatLine[] {
  const lines: PlayerStatLine[] = [];
  for (const team of ['team1', 'team2'] as const) {
    const players = obj(evt[team])?.players;
    if (!Array.isArray(players)) continue;
    for (const raw of players) {
      const player = obj(raw);
      const steamId = player?.steamid ?? player?.steamId;
      if (!player || typeof steamId !== 'string' || steamId === '') continue;
      lines.push({
        account: steam(steamId),
        name: typeof player.name === 'string' && player.name ? player.name : 'Unknown',
        team,
        won: winner === team,
        metrics: metricsFrom(obj(player.stats) ?? {}),
      });
    }
  }
  return lines;
}

/** `score.updated` when the event carries both map scores, else nothing. */
function scoreUpdate(
  evt: Payload,
  slug: string,
  eventId: string,
  phase: string
): NormalizedEvent[] {
  const mapNumber = mapNumberOf(evt);
  const team1 = teamNumber(evt, 'team1', 'score');
  const team2 = teamNumber(evt, 'team2', 'score');
  if (mapNumber === undefined || team1 === undefined || team2 === undefined) return [];
  return [{ type: 'score.updated', slug, eventId, mapNumber, team1, team2, phase }];
}

function phaseChange(slug: string, eventId: string, phase: string): NormalizedEvent {
  return { type: 'phase.changed', slug, eventId, phase };
}

const PRESENCE_STATE = {
  player_connect: 'connected',
  player_disconnect: 'disconnected',
  player_ready: 'ready',
  player_unready: 'unready',
} as const;

/** Phases for the events that only move the match between phases. */
const PHASE_ONLY: Record<string, string> = {
  warmup_ended: 'live',
  knife_round_started: 'knife',
  // The knife winner picks a side next and MatchZy sends nothing for that
  // choice, so the match stays in the knife phase until going_live.
  knife_round_ended: 'knife',
  match_paused: 'paused',
  unpause_requested: 'paused',
  match_unpaused: 'live',
};

/**
 * Map one MatchZy event to the neutral events the core consumes. Unknown and
 * CS2-only events give `[]`; so does anything that is not an object with an
 * `event` name.
 */
export function normalize(event: unknown, ctx: NormalizeContext = {}): NormalizedEvent[] {
  const evt = obj(event);
  const name = evt?.event;
  if (!evt || typeof name !== 'string') return [];

  const slug = ctx.slug ?? (evt.matchid === undefined ? '' : String(evt.matchid));
  if (!slug || slug === '-1') return [];

  const map = mapNumberOf(evt);
  const mapKey = map === undefined ? '' : `:${map}`;

  switch (name) {
    case 'series_start':
      return [
        {
          type: 'series.started',
          slug,
          eventId: 'series_start',
          seriesLength: num(evt.num_maps) ?? 1,
        },
      ];

    case 'going_live': {
      if (map === undefined) return [];
      const mapName = mapNameOf(evt);
      return [
        {
          type: 'map.started',
          slug,
          eventId: `going_live${mapKey}`,
          mapNumber: map,
          ...(mapName ? { mapName } : {}),
        },
      ];
    }

    case 'round_end':
    case 'round_started':
      return scoreUpdate(evt, slug, `${name}${mapKey}:${num(evt.round_number) ?? '?'}`, 'live');

    case 'side_swap':
      return scoreUpdate(evt, slug, `side_swap${mapKey}`, 'live');

    case 'halftime_started':
      return [
        ...scoreUpdate(evt, slug, `halftime_started${mapKey}`, 'halftime'),
        phaseChange(slug, `halftime_started${mapKey}/phase`, 'halftime'),
      ];

    case 'overtime_started': {
      const key = `overtime_started${mapKey}:${num(evt.overtime_number) ?? '?'}`;
      return [
        ...scoreUpdate(evt, slug, key, 'overtime'),
        phaseChange(slug, `${key}/phase`, 'overtime'),
      ];
    }

    case 'map_result': {
      if (map === undefined) return [];
      const team1Score = teamNumber(evt, 'team1', 'score') ?? 0;
      const team2Score = teamNumber(evt, 'team2', 'score') ?? 0;
      const winner: TeamSide | 'draw' =
        side(winnerTeam(evt)) ??
        (team1Score === team2Score ? 'draw' : team1Score > team2Score ? 'team1' : 'team2');
      const mapName = mapNameOf(evt);
      const eventId = `map_result${mapKey}`;
      const out: NormalizedEvent[] = [
        {
          type: 'map.result',
          slug,
          eventId,
          mapNumber: map,
          ...(mapName ? { mapName } : {}),
          team1Score,
          team2Score,
          winner,
        },
      ];
      const lines = teamStatLines(evt, winner);
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

    case 'series_end': {
      const team1SeriesScore = num(evt.team1_series_score) ?? 0;
      const team2SeriesScore = num(evt.team2_series_score) ?? 0;
      // As processSeriesEnd decides it: the plugin's winner first, then the
      // series score; a tie with no winner is 'none' (needs a decision).
      const winner: TeamSide | 'none' =
        side(winnerTeam(evt)) ??
        (team1SeriesScore === team2SeriesScore
          ? 'none'
          : team1SeriesScore > team2SeriesScore
            ? 'team1'
            : 'team2');
      const restore = num(evt.time_until_restore);
      return [
        {
          type: 'series.ended',
          slug,
          eventId: 'series_end',
          team1SeriesScore,
          team2SeriesScore,
          winner,
          ...(restore !== undefined ? { releaseAfterSeconds: restore } : {}),
        },
      ];
    }

    case 'player_stats_update': {
      // One player's running totals, with no map number and no result.
      const player = obj(evt.player);
      const steamId = player?.steamid ?? player?.steamId;
      const team = side(player?.team);
      if (!player || typeof steamId !== 'string' || steamId === '' || !team) return [];
      return [
        {
          type: 'player.stats',
          slug,
          eventId: `player_stats_update:${steamId}#${payloadHash(evt)}`,
          scope: 'map',
          ...(map !== undefined ? { mapNumber: map } : {}),
          lines: [
            {
              account: steam(steamId),
              name: typeof player.name === 'string' && player.name ? player.name : 'Unknown',
              team,
              won: false,
              metrics: metricsFrom(obj(evt.stats) ?? {}),
            },
          ],
        },
      ];
    }

    case 'player_connect':
    case 'player_disconnect':
    case 'player_ready':
    case 'player_unready': {
      const player = obj(evt.player);
      const steamId = player?.steamid ?? player?.steamId;
      if (typeof steamId !== 'string' || steamId === '') return [];
      const team = side(player?.team) ?? side(evt.team);
      return [
        {
          type: 'presence.changed',
          slug,
          eventId: `${name}:${steamId}#${payloadHash(evt)}`,
          account: steam(steamId),
          ...(team ? { team } : {}),
          state: PRESENCE_STATE[name],
        },
      ];
    }

    default: {
      const phase = PHASE_ONLY[name];
      return phase ? [phaseChange(slug, `${name}${mapKey}#${payloadHash(evt)}`, phase)] : [];
    }
  }
}
