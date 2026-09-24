/**
 * Auto Tournament CS2 event handling on the CS2 side of the event adapter.
 *
 * `handleMatchEvent` applies what is CS2's own for one Auto Tournament CS2 event: log
 * lines, the live score and per-player stats (`matchLiveStatsService`), who is
 * connected (`playerConnectionService`), the match going live, and the guards
 * for stale or late events (`isStaleMapEvent`, `shouldAcceptPlayEvent`). It
 * returns the event's `normalize()` output for the core's
 * `matchLifecycle.ingest`, which owns results: map results, series end,
 * bracket progression, stats and ratings. An event the adapter drops (a stale
 * map, an unknown match) returns `[]`.
 *
 * Also here, because it reads Auto Tournament CS2 payloads: the per-player stats sources
 * the core asks for at series end (`seriesPlayerStats`, exposed through the
 * integration).
 */

import { db } from '../../../config/database';
import { log } from '../../../utils/logger';
import { emitMatchUpdate, emitBracketUpdate } from '../../../services/socketService';
import { playerConnectionService } from '../../../services/playerConnectionService';
import {
  matchLiveStatsService,
  type MatchLiveStats,
  type MatchPlayerStatsSnapshot,
  type PlayerStatLine,
} from '../../../services/matchLiveStatsService';
import { matchLifecycle } from '../../../core/matchLifecycle';
import { isMatchFinalized } from '../../../utils/matchStatusHelpers';
import type { DbMatchRow } from '../../../types/database.types';
import type { NormalizedEvent } from '../../types';
import type { PluginEvent } from './plugin-events.types';
import { normalize } from './normalize';

/**
 * Apply one Auto Tournament CS2 event: the CS2 side effects here, then the lifecycle
 * events in the core. What the events route does after its own checks, and
 * what replaying a stored event does.
 */
export async function applyMatchEvent(event: PluginEvent, knownSlug?: string): Promise<void> {
  const lifecycleEvents = await handleMatchEvent(event, knownSlug);
  await matchLifecycle.ingest(lifecycleEvents);
}

/**
 * CS2 side effects of one Auto Tournament CS2 event. Returns the normalized events for
 * `matchLifecycle.ingest`, or `[]` when the event must not reach the core.
 *
 * Events that need their match look it up by the payload's `matchid`, as they
 * always have. `knownSlug` (the match the events route already resolved) only
 * labels the events that do not, so they cost no extra query.
 */
export async function handleMatchEvent(
  event: PluginEvent,
  knownSlug?: string
): Promise<NormalizedEvent[]> {
  const eventData = event as unknown as Record<string, unknown>;

  switch (event.event) {
    // Match Lifecycle Events
    case 'series_start': {
      // Auto Tournament CS2 sends the names nested (team1.name); the flat *_name fields it
      // used to log were always undefined.
      const seriesTeam1 =
        (eventData.team1 as { name?: string } | undefined)?.name ??
        (eventData.team1_name as string | undefined) ??
        'team1';
      const seriesTeam2 =
        (eventData.team2 as { name?: string } | undefined)?.name ??
        (eventData.team2_name as string | undefined) ??
        'team2';
      log.success(`Series started: ${seriesTeam1} vs ${seriesTeam2}`, {
        matchId: event.matchid,
        format: `BO${eventData.num_maps}`,
      });
      return lifecycleEvents(event, null, knownSlug);
    }

    case 'map_picked':
      log.info(`Map picked: ${eventData.map_name} (Map ${eventData.map_number})`, {
        matchId: event.matchid,
        pickedBy: eventData.picked_by,
      });
      return [];

    case 'map_vetoed':
      log.info(`Map vetoed: ${eventData.map_name}`, {
        matchId: event.matchid,
        vetoedBy: eventData.vetoed_by,
      });
      return [];

    case 'side_picked':
      log.info(`${eventData.team} picked side ${eventData.side} for map ${eventData.map_number}`, {
        matchId: event.matchid,
      });
      return [];

    case 'map_result': {
      // Auto Tournament CS2 sends the teams nested: team1: { name, score, series_score },
      // winner: { side, team }. The flat team1_name / team1_score fields this
      // used to read don't exist, so the line logged "undefined undefined-undefined".
      const t1 = (eventData.team1 ?? {}) as { name?: string; score?: number; series_score?: number };
      const t2 = (eventData.team2 ?? {}) as { name?: string; score?: number; series_score?: number };
      log.success(
        `Map ${eventData.map_number} result: ${t1.name ?? eventData.team1_name ?? 'team1'} ${
          t1.score ?? eventData.team1_score ?? '?'
        }-${t2.score ?? eventData.team2_score ?? '?'} ${t2.name ?? eventData.team2_name ?? 'team2'}`,
        {
          matchId: event.matchid,
          map: eventData.map_name,
          winner: (eventData.winner as { team?: string })?.team,
          series: `${t1.series_score ?? '?'}-${t2.series_score ?? '?'}`,
        }
      );
      const match = await resolveMatch(event.matchid);
      if (!match || (await isStaleMapEvent(match, eventData.map_number, 'map_result'))) {
        return [];
      }
      updateLiveStats(match, parseScorePayload(eventData, 'postgame'));
      // The core records the result, moves the series on and, when this map
      // decides it, finishes the series.
      return lifecycleEvents(event, match);
    }

    case 'series_end': {
      const match = await resolveMatch(event.matchid);
      // The core logs a series_end for a match it cannot find.
      return lifecycleEvents(event, match);
    }

    // Map Events
    case 'going_live': {
      log.success(`Going live: Map ${eventData.map_number} - ${eventData.map_name}`, {
        matchId: event.matchid,
        team1: eventData.team1_name,
        team2: eventData.team2_name,
      });
      const liveMatch = await resolveMatch(event.matchid);
      if (!liveMatch) {
        log.warn(`Going live event received for unknown match`, { matchId: event.matchid });
        return [];
      }
      // Ignore late "going_live" events for matches that are already
      // finalized. Some Auto Tournament CS2 setups can emit stray lifecycle events after
      // series_end / restore, and we never want to resurrect a completed
      // match back into the LIVE state.
      if (!shouldAcceptPlayEvent(liveMatch, 'going_live', event.matchid)) {
        return [];
      }
      if (await isStaleMapEvent(liveMatch, eventData.map_number, 'going_live')) {
        return [];
      }
      await updateMatchStatus(liveMatch, 'live');
      playerConnectionService.markAllReady(liveMatch.slug);
      updateLiveStats(liveMatch, parseScorePayload(eventData, 'live'));
      await db.updateAsync(
        'matches',
        { current_map: eventData.map_name, map_number: eventData.map_number },
        'id = ?',
        [liveMatch.id]
      );
      return lifecycleEvents(event, liveMatch);
    }

    // Player connection events
    case 'player_connect': {
      const match = await resolveMatch(event.matchid);
      const playerInfo = eventData.player as { steamid?: string; name?: string; team?: string };
      const steamId = playerInfo?.steamid;
      if (!match || !steamId) {
        log.warn('Player connect event received without match or steamId', {
          matchId: event.matchid,
        });
        return [];
      }
      const team = determinePlayerTeam(match, steamId, playerInfo?.team);
      if (!team) {
        log.warn('Could not determine team for player_connect event', {
          matchId: event.matchid,
          steamId,
        });
        return [];
      }
      playerConnectionService.playerConnected(
        match.slug,
        steamId,
        playerInfo?.name || 'Unknown',
        team
      );
      return lifecycleEvents(event, match);
    }

    case 'player_disconnect': {
      const match = await resolveMatch(event.matchid);
      const steamId = (eventData.player as { steamid?: string })?.steamid;
      if (!match || !steamId) {
        log.warn('Player disconnect event received without match or steamId', {
          matchId: event.matchid,
        });
        return [];
      }
      playerConnectionService.playerDisconnected(match.slug, steamId);
      return lifecycleEvents(event, match);
    }

    case 'player_ready':
    case 'player_unready': {
      const match = await resolveMatch(event.matchid);
      const steamId = (eventData.player as { steamid?: string })?.steamid;
      if (!match || !steamId) {
        return [];
      }
      playerConnectionService.playerReady(match.slug, steamId, event.event === 'player_ready');
      return lifecycleEvents(event, match);
    }

    // Round Events
    case 'round_end': {
      log.debug(`Round ${eventData.round_number} won by ${eventData.winner}`, {
        matchId: event.matchid,
        mapNumber: eventData.map_number,
        score: `${eventData.team1_score}-${eventData.team2_score}`,
        reason: eventData.reason,
      });
      const match = await resolveMatch(event.matchid);
      if (!match || (await isStaleMapEvent(match, eventData.map_number, 'round_end'))) {
        return [];
      }
      const updates: Partial<MatchLiveStats> = parseScorePayload(eventData, 'live');

      // Also capture per‑player stats from this round_end payload if present.
      // Auto Tournament CS2 includes a full "players" array with cumulative stats for each side.
      const snapshot = extractPlayerStatsFromEvent(eventData);
      if (snapshot) {
        updates.playerStats = snapshot;
      }

      const stats = matchLiveStatsService.update(match.slug, updates);
      await db.updateAsync(
        'matches',
        {
          current_map: stats.mapName ?? match.current_map,
          map_number: stats.mapNumber ?? match.map_number,
        },
        'id = ?',
        [match.id]
      );
      emitMatchUpdate({
        slug: match.slug,
        liveStats: stats,
        status: match.status,
      });
      return lifecycleEvents(event, match);
    }

    case 'knife_round_started': {
      log.info(`Knife round started`, { matchId: event.matchid, mapNumber: eventData.map_number });
      const match = await resolveMatch(event.matchid);
      if (!match) return [];
      updateLiveStats(match, { status: 'knife' });
      return lifecycleEvents(event, match);
    }

    case 'knife_round_ended': {
      log.success(`Knife round won by ${eventData.winner}`, {
        matchId: event.matchid,
        mapNumber: eventData.map_number,
      });
      const match = await resolveMatch(event.matchid);
      if (!match) return [];
      // The knife winner still has to pick a side, and Auto Tournament CS2 emits no event
      // for that choice — the next signal is `going_live`. Reporting warmup
      // here dropped the UI out of the knife round for the whole selection
      // window (at_side_selection_time, 60s by default), which is what
      // users saw: "it looks like it goes back to warmup, but they are
      // picking sides". Stay on 'knife' until the match actually starts.
      updateLiveStats(match, { status: 'knife' });
      return lifecycleEvents(event, match);
    }

    case 'round_started': {
      log.debug(`Round ${eventData.round_number} started`, {
        matchId: event.matchid,
        mapNumber: eventData.map_number,
        score: `${eventData.team1_score}-${eventData.team2_score}`,
      });
      const match = await resolveMatch(event.matchid);
      if (!match) return [];
      if (!shouldAcceptPlayEvent(match, 'round_started', event.matchid)) {
        return [];
      }
      if (await isStaleMapEvent(match, eventData.map_number, 'round_started')) {
        return [];
      }
      // Some Auto Tournament CS2 setups are flaky about emitting the "going_live" event,
      // but they will always emit round_started once the pistol actually begins.
      // To avoid matches getting visually "stuck in warmup" on the UI
      // (status=loaded) while rounds are in fact being played, we treat the
      // first round_started we see as authoritative and force the match
      // into the LIVE state as well.
      await updateMatchStatus(match, 'live');
      updateLiveStats(match, parseScorePayload(eventData, 'live'));
      return lifecycleEvents(event, match);
    }

    case 'halftime_started': {
      log.info(`Halftime started`, {
        matchId: event.matchid,
        mapNumber: eventData.map_number,
        score: `${eventData.team1_score}-${eventData.team2_score}`,
      });
      const match = await resolveMatch(event.matchid);
      if (!match) return [];
      updateLiveStats(match, parseScorePayload(eventData, 'halftime'));
      return lifecycleEvents(event, match);
    }

    case 'overtime_started': {
      log.success(`Overtime ${eventData.overtime_number} started!`, {
        matchId: event.matchid,
        mapNumber: eventData.map_number,
      });
      const match = await resolveMatch(event.matchid);
      if (!match) return [];
      await updateMatchStatus(match, 'live');
      updateLiveStats(match, { status: 'live' });
      return lifecycleEvents(event, match);
    }

    // Pause System Events
    case 'match_paused':
      log.warn(`Match paused by ${(eventData.paused_by as { name?: string })?.name}`, {
        matchId: event.matchid,
        mapNumber: eventData.map_number,
        tactical: eventData.is_tactical,
        admin: eventData.is_admin,
      });
      return lifecycleEvents(event, null, knownSlug);

    case 'unpause_requested':
      log.info(`Unpause requested by ${eventData.team}`, {
        matchId: event.matchid,
        teamsReady: eventData.teams_ready,
        teamsNeeded: eventData.teams_needed,
      });
      return lifecycleEvents(event, null, knownSlug);

    case 'match_unpaused':
      log.success(`Match unpaused by ${(eventData.unpaused_by as { name?: string })?.name}`, {
        matchId: event.matchid,
        mapNumber: eventData.map_number,
      });
      return lifecycleEvents(event, null, knownSlug);

    default:
      log.debug(`Event: ${event.event}`, { matchId: eventData.matchid });
      return lifecycleEvents(event, null, knownSlug);
  }
}

/**
 * The neutral events for `matchLifecycle.ingest`, keyed to the match the
 * handler resolved (by the payload's `matchid`, as it always has been), else
 * `knownSlug`, else the payload's id: a `series_end` for a match that cannot
 * be found keeps it, so the core can say so.
 *
 * `map.result` also carries the series score Auto Tournament CS2 reports with it (the core
 * finishes a series on it); a `map_result` without a usable map number is
 * taken as the match's current map, as before.
 */
function lifecycleEvents(
  event: PluginEvent,
  match: DbMatchRow | null,
  knownSlug?: string
): NormalizedEvent[] {
  const eventData = event as unknown as Record<string, unknown>;
  const slug = match?.slug ?? knownSlug;
  let normalized = normalize(event, slug ? { slug } : {});

  if (match && event.event === 'map_result' && !normalized.some((e) => e.type === 'map.result')) {
    normalized = normalize(
      { ...eventData, map_number: parseNumber(eventData.map_number) ?? match.map_number ?? 0 },
      { slug: match.slug }
    );
  }

  const withSeriesScore = normalized.map((e): NormalizedEvent => {
    if (e.type !== 'map.result') return e;
    return {
      ...e,
      seriesScore: {
        team1:
          extractNestedNumber(eventData, ['team1', 'series_score']) ??
          extractNestedNumber(eventData, ['team1_series_score']) ??
          0,
        team2:
          extractNestedNumber(eventData, ['team2', 'series_score']) ??
          extractNestedNumber(eventData, ['team2_series_score']) ??
          0,
      },
    };
  });

  if (withSeriesScore.length) {
    log.debug('[EVENTS] Normalized', {
      event: event.event,
      matchSlug: slug ?? String(eventData.matchid),
      normalized: withSeriesScore.map((n) => `${n.type} ${n.eventId}`),
    });
  }
  return withSeriesScore;
}

async function resolveMatch(identifier: string | number): Promise<DbMatchRow | null> {
  const identifierStr = String(identifier);
  const numericId = Number(identifierStr);

  if (!Number.isNaN(numericId)) {
    const byId = await db.queryOneAsync<DbMatchRow>('SELECT * FROM matches WHERE id = ?', [
      numericId,
    ]);
    if (byId) {
      return byId;
    }
  }

  return (
    (await db.queryOneAsync<DbMatchRow>('SELECT * FROM matches WHERE slug = ?', [identifierStr])) ??
    null
  );
}

/**
 * Is this event about a map the series has already moved past?
 *
 * After map N's result is stored, `matches.map_number` points at map N+1. An
 * event for a lower map number that already has a result is stale: a retried
 * delivery, or a second server playing the same match from the start. Applying
 * it rolled `map_number` back and let a duplicate map_result overwrite the real
 * result for that map, so it is dropped.
 */
async function isStaleMapEvent(
  match: DbMatchRow,
  rawMapNumber: unknown,
  eventName: string
): Promise<boolean> {
  const mapNumber = parseNumber(rawMapNumber);
  const current = parseNumber(match.map_number);
  if (mapNumber === undefined || current === undefined || mapNumber >= current) {
    return false;
  }
  const existing = await db.queryOneAsync<{ map_number: number }>(
    'SELECT map_number FROM match_map_results WHERE match_slug = ? AND map_number = ?',
    [match.slug, mapNumber]
  );
  if (!existing) {
    return false;
  }
  log.warn(`Ignoring ${eventName} for map ${mapNumber}: match is already on map ${current}`, {
    matchId: match.id,
    slug: match.slug,
  });
  return true;
}

/**
 * Gate for events that mean "a map is being played" (going_live, round_started),
 * which would otherwise move the match back to live.
 *
 * A finalized match (see isMatchFinalized) ignores them: some Auto Tournament CS2 setups
 * emit stray lifecycle events after series_end / restore, and a finished match
 * must never be resurrected. A match that only *says* completed — no winner,
 * no completed_at — was flipped without a series result, so play events for it
 * are accepted and the rest of the series is tracked.
 */
function shouldAcceptPlayEvent(
  match: DbMatchRow,
  eventName: string,
  matchId: string | number
): boolean {
  if (match.status !== 'completed') return true;
  if (isMatchFinalized(match)) {
    log.warn(`Ignoring ${eventName} for already completed match`, {
      matchId,
      slug: match.slug,
    });
    return false;
  }
  log.warn(`Re-opening match marked completed without a series result (${eventName})`, {
    matchId,
    slug: match.slug,
  });
  return true;
}

async function updateMatchStatus(match: DbMatchRow, status: DbMatchRow['status']): Promise<void> {
  if (match.status === status) {
    return;
  }

  await db.updateAsync('matches', { status }, 'id = ?', [match.id]);
  const updatedMatch = await db.queryOneAsync<DbMatchRow>('SELECT * FROM matches WHERE id = ?', [
    match.id,
  ]);
  if (updatedMatch) {
    emitMatchUpdate(updatedMatch);
    emitBracketUpdate({
      action: 'match_status',
      matchSlug: updatedMatch.slug,
      status: updatedMatch.status,
    });
  }
}

function determinePlayerTeam(
  match: DbMatchRow,
  steamId: string,
  fallbackTeam?: string
): 'team1' | 'team2' | null {
  if (fallbackTeam === 'team1' || fallbackTeam === 'team2') {
    return fallbackTeam;
  }

  if (!match.config) {
    return null;
  }

  try {
    const config = typeof match.config === 'string' ? JSON.parse(match.config) : match.config;
    const team1Players = config?.team1?.players;
    const team2Players = config?.team2?.players;

    if (playerMatchesCollection(team1Players, steamId)) {
      return 'team1';
    }
    if (playerMatchesCollection(team2Players, steamId)) {
      return 'team2';
    }
  } catch (error) {
    log.warn('Failed to parse match config when determining player team', {
      error,
      matchId: match.id,
    });
  }

  return null;
}

function playerMatchesCollection(collection: unknown, steamId: string): boolean {
  if (!collection) return false;

  // Handle array of players [{ steamid, name }, ...]
  if (Array.isArray(collection)) {
    return collection.some((player) => getSteamIdFromUnknown(player) === steamId);
  }

  if (typeof collection === 'object') {
    // Direct key lookup (Auto Tournament CS2 format {steamId: name})
    if (Object.prototype.hasOwnProperty.call(collection, steamId)) {
      return true;
    }

    // Iterate over values (legacy format {0: {steamId, name}})
    return Object.values(collection).some((value) => getSteamIdFromUnknown(value) === steamId);
  }

  return false;
}

function getSteamIdFromUnknown(value: unknown): string | null {
  if (!value) return null;

  if (typeof value === 'string') {
    // Some older configs stored steamId directly as a string entry
    return /^7656\d{13}$/.test(value) ? value : null;
  }

  if (typeof value === 'object') {
    const candidate =
      (value as { steamId?: string; steamid?: string }).steamId ||
      (value as { steamId?: string; steamid?: string }).steamid;
    return typeof candidate === 'string' ? candidate : null;
  }

  return null;
}

function updateLiveStats(match: DbMatchRow, updates: Partial<MatchLiveStats>): void {
  const stats = matchLiveStatsService.update(match.slug, updates);
  emitMatchUpdate({
    slug: match.slug,
    liveStats: stats,
  });
}

function extractPlayerStatsFromEvent(
  eventData: Record<string, unknown>
): MatchPlayerStatsSnapshot | null {
  const team1 = eventData.team1 as { players?: unknown[] } | undefined;
  const team2 = eventData.team2 as { players?: unknown[] } | undefined;

  const buildTeam = (team?: { players?: unknown[] }): PlayerStatLine[] => {
    if (!team?.players || !Array.isArray(team.players)) return [];

    return team.players
      .map((raw) => {
        const player = raw as {
          steamId?: string;
          steamid?: string;
          name?: string;
          stats?: Record<string, unknown>;
        };
        const steamId = player.steamId || player.steamid;
        if (!steamId) return null;

        const stats = player.stats ?? {};

        const pick = (keys: string[], defaultValue = 0): number => {
          for (const key of keys) {
            const value = stats[key];
            if (typeof value === 'number' && Number.isFinite(value)) return value;
            if (typeof value === 'string' && value.trim() !== '' && !Number.isNaN(Number(value))) {
              return Number(value);
            }
          }
          return defaultValue;
        };

        const roundsPlayed = pick(['rounds_played', 'roundsPlayed']);

        return {
          steamId,
          name: player.name || 'Unknown',
          kills: pick(['kills']),
          deaths: pick(['deaths']),
          assists: pick(['assists']),
          flashAssists: pick(['flash_assists', 'flashAssists']),
          headshotKills: pick(['headshot_kills', 'headshotKills']),
          damage: pick(['damage']),
          utilityDamage: pick(['utility_damage', 'utilityDamage']),
          kast: pick(['kast']),
          mvps: pick(['mvp', 'mvps']),
          score: pick(['score']),
          roundsPlayed,
        } satisfies PlayerStatLine;
      })
      .filter((p): p is PlayerStatLine => Boolean(p));
  };

  const team1Stats = buildTeam(team1);
  const team2Stats = buildTeam(team2);

  if (!team1Stats.length && !team2Stats.length) {
    return null;
  }

  return {
    team1: team1Stats,
    team2: team2Stats,
  };
}

function parseScorePayload(
  eventData: Record<string, unknown>,
  status: MatchLiveStats['status']
): Partial<MatchLiveStats> {
  const updates: Partial<MatchLiveStats> = { status };
  const mapNumber = parseNumber(eventData.map_number);
  const roundNumber = parseNumber(eventData.round_number);
  const team1Score =
    parseNumber(eventData.team1_score) ??
    parseNumber((eventData.team1 as Record<string, unknown> | undefined)?.score);
  const team2Score =
    parseNumber(eventData.team2_score) ??
    parseNumber((eventData.team2 as Record<string, unknown> | undefined)?.score);
  const team1SeriesScore =
    parseNumber(eventData.team1_series_score) ??
    parseNumber((eventData.team1 as Record<string, unknown> | undefined)?.series_score);
  const team2SeriesScore =
    parseNumber(eventData.team2_series_score) ??
    parseNumber((eventData.team2 as Record<string, unknown> | undefined)?.series_score);
  const mapName = (eventData.map_name as string) ?? undefined;

  if (mapNumber !== undefined) updates.mapNumber = mapNumber;
  if (roundNumber !== undefined) updates.roundNumber = roundNumber;
  if (team1Score !== undefined) updates.team1Score = team1Score;
  if (team2Score !== undefined) updates.team2Score = team2Score;
  // Only update series scores when we have a positive value; this prevents
  // resetting an already-correct series score (e.g., 1‑0 after Map 1) back
  // to 0 when round events on the next map report series_score: 0.
  if (team1SeriesScore !== undefined && team1SeriesScore > 0) {
    updates.team1SeriesScore = team1SeriesScore;
  }
  if (team2SeriesScore !== undefined && team2SeriesScore > 0) {
    updates.team2SeriesScore = team2SeriesScore;
  }
  if (mapName !== undefined) updates.mapName = mapName;

  return updates;
}

function parseNumber(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  const num = typeof value === 'string' ? Number(value) : value;
  if (typeof num === 'number' && Number.isFinite(num)) {
    return num;
  }
  return undefined;
}

function extractNestedNumber(
  source: Record<string, unknown>,
  path: Array<string>
): number | undefined {
  let cursor: unknown = source;
  for (const key of path) {
    if (cursor && typeof cursor === 'object' && key in (cursor as Record<string, unknown>)) {
      cursor = (cursor as Record<string, unknown>)[key];
    } else {
      return undefined;
    }
  }
  if (typeof cursor === 'number') {
    return cursor;
  }
  if (typeof cursor === 'string') {
    const parsed = Number(cursor);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Series results: what the core asks the integration for
// ---------------------------------------------------------------------------

type StatsBySteamId = Record<string, Record<string, unknown>>;

function statsFromLines(lines: PlayerStatLine[]): StatsBySteamId {
  const map: StatsBySteamId = {};
  for (const line of lines) {
    map[line.steamId] = {
      rounds_played: line.roundsPlayed,
      damage: line.damage,
      kills: line.kills,
      deaths: line.deaths,
      assists: line.assists,
      headshot_kills: line.headshotKills,
      flash_assists: line.flashAssists,
      utility_damage: line.utilityDamage,
      kast: line.kast,
      mvps: line.mvps,
      score: line.score,
    };
  }
  return map;
}

/**
 * Per-player stats for a finished series, per side as Auto Tournament CS2 filed them.
 * `GameIntegration.seriesPlayerStats` turns them into stat lines (../stats).
 *
 * Preferred source: the series totals built from `round_end` events (see
 * `matchLiveStatsService.getSeriesPlayerStats`). `round_end` reports stats
 * cumulative within the current map, so reading only the latest snapshot
 * recorded the final map of a BO3/BO5 for the whole series. Fallbacks for
 * older setups, or a lost in-memory cache: the latest stored `player_stats`
 * event, then the latest stored `round_end`.
 */
export async function seriesPlayerStats(
  matchSlug: string
): Promise<{ team1: StatsBySteamId; team2: StatsBySteamId }> {
  let team1PlayerStats: StatsBySteamId = {};
  let team2PlayerStats: StatsBySteamId = {};

  const seriesStats = matchLiveStatsService.getSeriesPlayerStats(matchSlug);
  if (seriesStats) {
    return { team1: statsFromLines(seriesStats.team1), team2: statsFromLines(seriesStats.team2) };
  }

  // Fallback for older/alternate setups: look for a dedicated "player_stats"
  // match event if present and parse its per-player dictionaries.
  const playerStatsEvent = await db.queryOneAsync<{
    event_data: string;
  }>(
    `SELECT event_data FROM match_events
     WHERE match_slug = ? AND event_type = 'player_stats'
     ORDER BY received_at DESC, id DESC LIMIT 1`,
    [matchSlug]
  );

  if (playerStatsEvent) {
    try {
      const eventData = JSON.parse(playerStatsEvent.event_data) as {
        team1_players?: StatsBySteamId;
        team2_players?: StatsBySteamId;
      };
      // Auto Tournament CS2 format: {steamId: {kills, deaths, assists, damage, ...}}
      if (eventData.team1_players) {
        team1PlayerStats = eventData.team1_players;
      }
      if (eventData.team2_players) {
        team2PlayerStats = eventData.team2_players;
      }
    } catch (error) {
      log.warn('Failed to parse player stats from event', { error, matchSlug });
    }
  }

  // Last-resort fallback: derive the final per-player snapshot directly from
  // the last round_end event we recorded for this match. This is the same
  // payload shape used to build liveStats during the match, so parsing it
  // here guarantees stats even if the in-memory cache was lost or never
  // populated for some reason.
  if (!Object.keys(team1PlayerStats).length && !Object.keys(team2PlayerStats).length) {
    const lastRoundEndEvent = await db.queryOneAsync<{
      event_data: string;
    }>(
      `SELECT event_data FROM match_events
       WHERE match_slug = ? AND event_type = 'round_end'
       ORDER BY received_at DESC, id DESC LIMIT 1`,
      [matchSlug]
    );

    if (lastRoundEndEvent) {
      try {
        const roundEndData = JSON.parse(lastRoundEndEvent.event_data) as Record<string, unknown>;
        const snapshot = extractPlayerStatsFromEvent(roundEndData);
        if (snapshot) {
          team1PlayerStats = statsFromLines(snapshot.team1);
          team2PlayerStats = statsFromLines(snapshot.team2);
        }
      } catch (error) {
        log.warn('Failed to parse player stats from round_end event', { error, matchSlug });
      }
    }
  }

  return { team1: team1PlayerStats, team2: team2PlayerStats };
}
