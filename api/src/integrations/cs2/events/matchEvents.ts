/**
 * Ready Up events on the CS2 side: `applyNormalizedEvents` applies the
 * normalized fleet events (live score, per-player stats, presence, the match
 * going live) and hands them to the core's `matchLifecycle.ingest`, which owns
 * results. Also the per-player stats sources the core asks for at series end
 * (`seriesPlayerStats`).
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
 * A finalized match (see isMatchFinalized) ignores them: some MatchZy Enhanced setups
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
    // Direct key lookup (MatchZy Enhanced format {steamId: name})
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

function parseNumber(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  const num = typeof value === 'string' ? Number(value) : value;
  if (typeof num === 'number' && Number.isFinite(num)) {
    return num;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Neutral events from another source (the Ready Up fleet link)
// ---------------------------------------------------------------------------

export interface ApplyNormalizedOptions {
  /** A player's name for `presence.changed` (the neutral event has none). */
  playerName?: (steamId: string) => string | undefined;
}

/** Live-page status for a phase; undefined = leave it (a pause is still "live"). */
function liveStatusForPhase(phase: string): MatchLiveStats['status'] | undefined {
  switch (phase) {
    case 'loading':
    case 'warmup':
    case 'restoring':
      return 'warmup';
    case 'knife':
    case 'side_pick':
      return 'knife';
    case 'live':
    case 'overtime':
      return 'live';
    case 'halftime':
      return 'halftime';
    case 'map_end':
    case 'series_end':
      return 'postgame';
    default:
      return undefined;
  }
}

/** A `player.stats` line's metrics (normalize.ts keys) as the live-stats line. */
function liveLineFromMetrics(line: ReportedStatLineLike): PlayerStatLine {
  const m = line.metrics;
  const roundsPlayed = m.rounds_played ?? 0;
  return {
    steamId: line.account.externalId,
    name: line.name,
    kills: m.kills ?? 0,
    deaths: m.deaths ?? 0,
    assists: m.assists ?? 0,
    flashAssists: m.flash_assists ?? 0,
    headshotKills: m.headshots ?? 0,
    // ADR is what the metric carries; the live line keeps total damage.
    damage: Math.round((m.adr ?? 0) * roundsPlayed),
    utilityDamage: m.utility_damage ?? 0,
    kast: m.kast ?? 0,
    mvps: m.mvps ?? 0,
    score: m.score ?? 0,
    roundsPlayed,
  };
}

type ReportedStatLineLike = Extract<NormalizedEvent, { type: 'player.stats' }>['lines'][number];

/**
 * Apply neutral events that did not come through the plugin webhook (the
 * Ready Up fleet link: `fleet/ingest.ts`). The same CS2 side effects
 * `handleMatchEvent` applies for the equivalent plugin events (match status,
 * current map, live score and per-player stats, who is connected, the stale
 * map and finished match guards), then `matchLifecycle.ingest` for results,
 * so a fleet match is finished by the same code as a plugin one.
 *
 * Map numbers are the platform's (0-based). Returns the events that reached
 * the core; an event for an unknown match, a stale map or a finished match
 * is dropped here (a `series.ended` for an unknown match still goes on, so
 * the core can log it).
 */
export async function applyNormalizedEvents(
  events: NormalizedEvent[],
  options: ApplyNormalizedOptions = {}
): Promise<NormalizedEvent[]> {
  const accepted: NormalizedEvent[] = [];
  const bySlug = new Map<string, DbMatchRow | null>();
  const matchFor = async (slug: string): Promise<DbMatchRow | null> => {
    if (!bySlug.has(slug)) {
      bySlug.set(
        slug,
        (await db.queryOneAsync<DbMatchRow>('SELECT * FROM matches WHERE slug = ?', [slug])) ?? null
      );
    }
    return bySlug.get(slug) ?? null;
  };

  for (const event of events) {
    let match = await matchFor(event.slug);
    if (!match) {
      if (event.type === 'series.ended') accepted.push(event);
      else log.debug(`[FLEET] ${event.type} for unknown match ${event.slug}; dropped`);
      continue;
    }

    switch (event.type) {
      case 'series.started':
        log.success(`Series started (fleet): ${match.slug}`, { format: `BO${event.seriesLength}` });
        accepted.push(event);
        break;

      case 'map.started': {
        if (!shouldAcceptPlayEvent(match, 'map.started', match.slug)) break;
        if (await isStaleMapEvent(match, event.mapNumber, 'map.started')) break;
        log.success(`Going live (fleet): map ${event.mapNumber} ${event.mapName ?? ''}`.trim(), {
          matchSlug: match.slug,
        });
        await updateMatchStatus(match, 'live');
        playerConnectionService.markAllReady(match.slug);
        updateLiveStats(match, {
          status: 'live',
          mapNumber: event.mapNumber,
          ...(event.mapName ? { mapName: event.mapName } : {}),
          team1Score: 0,
          team2Score: 0,
          roundNumber: 0,
        });
        await db.updateAsync(
          'matches',
          { current_map: event.mapName ?? match.current_map, map_number: event.mapNumber },
          'id = ?',
          [match.id]
        );
        match = {
          ...match,
          status: 'live',
          map_number: event.mapNumber,
          current_map: event.mapName ?? match.current_map,
        };
        bySlug.set(match.slug, match);
        accepted.push(event);
        break;
      }

      case 'score.updated': {
        if (await isStaleMapEvent(match, event.mapNumber, 'score.updated')) break;
        const status = event.phase ? liveStatusForPhase(event.phase) : undefined;
        const stats = matchLiveStatsService.update(match.slug, {
          mapNumber: event.mapNumber,
          team1Score: event.team1,
          team2Score: event.team2,
          ...(status ? { status } : {}),
        });
        if (match.map_number !== event.mapNumber) {
          await db.updateAsync('matches', { map_number: event.mapNumber }, 'id = ?', [match.id]);
          match = { ...match, map_number: event.mapNumber };
          bySlug.set(match.slug, match);
        }
        emitMatchUpdate({ slug: match.slug, liveStats: stats, status: match.status });
        accepted.push(event);
        break;
      }

      case 'phase.changed': {
        const status = liveStatusForPhase(event.phase);
        if (status) updateLiveStats(match, { status });
        accepted.push(event);
        break;
      }

      case 'presence.changed': {
        const steamId = event.account.externalId;
        if (event.state === 'connected') {
          const team = determinePlayerTeam(match, steamId, event.team);
          if (team) {
            playerConnectionService.playerConnected(
              match.slug,
              steamId,
              options.playerName?.(steamId) ?? 'Unknown',
              team
            );
          }
        } else if (event.state === 'disconnected') {
          playerConnectionService.playerDisconnected(match.slug, steamId);
        } else {
          playerConnectionService.playerReady(match.slug, steamId, event.state === 'ready');
        }
        accepted.push(event);
        break;
      }

      case 'player.stats': {
        if (event.scope === 'map' && event.mapNumber !== undefined) {
          if (await isStaleMapEvent(match, event.mapNumber, 'player.stats')) break;
          const snapshot: MatchPlayerStatsSnapshot = {
            team1: event.lines.filter((l) => l.team === 'team1').map(liveLineFromMetrics),
            team2: event.lines.filter((l) => l.team === 'team2').map(liveLineFromMetrics),
          };
          updateLiveStats(match, { mapNumber: event.mapNumber, playerStats: snapshot });
        }
        accepted.push(event);
        break;
      }

      case 'map.result': {
        if (await isStaleMapEvent(match, event.mapNumber, 'map.result')) break;
        updateLiveStats(match, {
          status: 'postgame',
          mapNumber: event.mapNumber,
          team1Score: event.team1Score,
          team2Score: event.team2Score,
          ...(event.seriesScore
            ? {
                team1SeriesScore: event.seriesScore.team1,
                team2SeriesScore: event.seriesScore.team2,
              }
            : {}),
          ...(event.mapName ? { mapName: event.mapName } : {}),
        });
        accepted.push(event);
        break;
      }

      case 'series.ended':
        accepted.push(event);
        break;
    }
  }

  if (accepted.length) {
    log.debug('[FLEET] Normalized', { normalized: accepted.map((n) => `${n.type} ${n.eventId}`) });
    await matchLifecycle.ingest(accepted);
  }
  return accepted;
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
 * Per-player stats for a finished series, per side as MatchZy Enhanced filed them.
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
      // MatchZy Enhanced format: {steamId: {kills, deaths, assists, damage, ...}}
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
