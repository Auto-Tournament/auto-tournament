/**
 * Match lifecycle: map results and series results, for every game.
 *
 * Integrations hand the core their events as `NormalizedEvent`s through
 * `matchLifecycle.ingest` (CS2: the `/api/events` adapter, after `normalize()`
 * and its own CS2-only side effects). The core acts on:
 *
 * - `map.result`: store the map result, move the series to the next map, and
 *   finish the series when this map decides it (a BO1, a drawn decider with
 *   overtime off, or a series that has run out of maps);
 * - `series.ended`: finish the series.
 *
 * The other event types (live score, phase, presence) are still applied by the
 * integration's adapter. The core only resolves a presence event's account to
 * its player (`playerIdentity`) and otherwise ignores them.
 *
 * Every way a series can end goes through `applySeriesResult`: the game's
 * `series.ended`, the series this module finishes itself, and the admin "set
 * winner" action (`setSeriesWinnerByAdmin`). It marks the match completed,
 * releases the match's resource through the integration (`release`), runs
 * bracket progression, records player stats and ratings, and checks round and
 * tournament completion. The tournament is always the match row's own
 * (`tournamentIdForMatch`).
 */

import { db } from '../config/database';
import { log } from '../utils/logger';
import { emitMatchUpdate, emitBracketUpdate } from '../services/socketService';
import {
  matchLiveStatsService,
  type PlayerStatLine as LivePlayerStatLine,
} from '../services/matchLiveStatsService';
import type { DbMatchRow } from '../types/database.types';
import {
  advanceWinnerToNextMatch,
  advanceLoserToLosersBracket,
  checkTournamentCompletion,
  reconcileDoubleElimination8Bracket,
  propagateMatchBySlotSources,
} from '../utils/matchProgression';
import { recordMapResult, getMapResults } from '../services/matchMapResultService';
import { advanceToNextRound } from '../services/shuffleTournamentService';
import { scheduler } from './scheduler';
import { playerIdentity } from '../services/playerIdentity';
import { tournamentIdForMatch } from '../utils/tournamentRow';
import { formatSeriesEndSummary } from '../utils/seriesEndSummary';
import { decideExhaustedSeries, isSeriesOutOfMaps } from '../utils/exhaustedSeries';
import { isEliminationTournamentType, NEEDS_DECISION_STATUS } from '../utils/matchStatusHelpers';
import { describeMatch, matchContextFor } from '../utils/matchIntegration';
import { integrationForMatch } from '../integrations/registry';
import type {
  ApplySeriesResultOutcome,
  GameResult,
  MatchDescription,
  MatchLifecycleApi,
  NormalizedEvent,
  ResultMeta,
  SeriesResult,
  TeamSide,
} from '../integrations/types';
import {
  trackPlayerStatsForManualMatch,
  trackPlayerStatsForMatch,
  updateRatingsForMatch,
} from './playerResults';

type MapResultEvent = Extract<NormalizedEvent, { type: 'map.result' }>;

const INTEGRATION_RESULT: ResultMeta = { source: 'integration', actorId: null };

// ---------------------------------------------------------------------------
// Ingest
// ---------------------------------------------------------------------------

/**
 * Apply an integration's normalized events, in order. Types the core does not
 * act on yet are ignored (see the module comment).
 */
async function ingest(events: NormalizedEvent[]): Promise<void> {
  for (const event of events) {
    switch (event.type) {
      case 'map.result': {
        const match = await matchBySlug(event.slug);
        if (match) {
          await handleMapCompletion(match, event);
        }
        break;
      }
      case 'series.ended':
        await applySeriesResult(
          event.slug,
          {
            games: [],
            team1Score: event.team1SeriesScore,
            team2Score: event.team2SeriesScore,
            winner: event.winner,
          },
          INTEGRATION_RESULT
        );
        break;
      case 'presence.changed': {
        // No core state for presence yet (the integration's adapter shows it);
        // resolving the account here is the seam the identity step builds on.
        // A failed lookup must not fail the event, which did not need it.
        try {
          const playerId = await playerIdentity.resolve(event.account);
          log.debug('Presence changed', { matchSlug: event.slug, state: event.state, playerId });
        } catch (err) {
          log.warn('Presence changed: could not resolve the account', {
            matchSlug: event.slug,
            error: (err as Error).message,
          });
        }
        break;
      }
      default:
        break;
    }
  }
}

async function matchBySlug(slug: string): Promise<DbMatchRow | null> {
  return (
    (await db.queryOneAsync<DbMatchRow>('SELECT * FROM matches WHERE slug = ?', [slug])) ?? null
  );
}

/** A match by `matches.id` (numeric) or slug, the way admin routes name matches. */
async function matchByIdOrSlug(identifier: string): Promise<DbMatchRow | null> {
  const numericId = Number(identifier);
  if (!Number.isNaN(numericId)) {
    const byId = await db.queryOneAsync<DbMatchRow>('SELECT * FROM matches WHERE id = ?', [
      numericId,
    ]);
    if (byId) {
      return byId;
    }
  }
  return matchBySlug(identifier);
}

/** Free the match's resource (CS2: its server) through its integration. */
async function releaseMatch(match: DbMatchRow): Promise<void> {
  const integration = integrationForMatch(match);
  if (!integration.release) return;
  await integration.release(await matchContextFor(match));
}

// ---------------------------------------------------------------------------
// Map results
// ---------------------------------------------------------------------------

async function handleMapCompletion(match: DbMatchRow, event: MapResultEvent): Promise<void> {
  const description = describeMatch(match);
  const totalMaps = description.seriesLength;
  const requiredWins = Math.max(1, Math.ceil(totalMaps / 2));
  const completedMapNumber = event.mapNumber;
  const mapName = event.mapName ?? match.current_map ?? null;
  const team1ScoreFinal = event.team1Score;
  const team2ScoreFinal = event.team2Score;
  const winnerTeam = event.winner === 'draw' ? 'none' : event.winner;

  await recordMapResult({
    matchSlug: match.slug,
    mapNumber: completedMapNumber,
    mapName,
    team1Score: team1ScoreFinal,
    team2Score: team2ScoreFinal,
    winnerTeam,
  });

  const team1SeriesScore = event.seriesScore?.team1 ?? 0;
  const team2SeriesScore = event.seriesScore?.team2 ?? 0;

  const seriesFinished = team1SeriesScore >= requiredWins || team2SeriesScore >= requiredWins;

  // For BO1 / last‑map scenarios where a map can end level (CS2: overtime
  // disabled), regulation may end in a true draw and the game simply restores
  // the server after a delay without ever sending a series end. That leaves
  // the match stuck in "live" and risks wiping live stats when the server
  // resets. Treat that case as a completed drawn series on our side.
  const isFinalMap = completedMapNumber >= Math.max(0, totalMaps - 1);
  const isDrawOnMap = team1ScoreFinal === team2ScoreFinal;
  const shouldForceDrawSeries =
    !seriesFinished && isFinalMap && isDrawOnMap && description.gamesCanDraw === true;

  // For BO1 matches, treat the first and only map result as a definitive
  // series end when the game doesn't send a separate series end or provide
  // non-zero series scores. This prevents bracket/tournament matches (not just
  // manual ones) from getting stuck in LIVE/POSTGAME with no progression.
  const isBo1 = totalMaps === 1;
  const shouldForceBo1SeriesEnd = !seriesFinished && isBo1 && isFinalMap;

  // A multi-map series that has run out of maps without a series winner (a
  // recorded draw on an earlier map, or the game never sending a series end)
  // would otherwise sit live on a map that does not exist. Decide it here.
  // Draw-friendly formats (swiss, round robin) keep the drawn-series path.
  if (!seriesFinished && !shouldForceBo1SeriesEnd && totalMaps > 1) {
    const results = await getMapResults(match.slug);
    if (isFinalMap || isSeriesOutOfMaps(results, totalMaps)) {
      const keepDraw = shouldForceDrawSeries && !(await isEliminationMatch(match));
      if (!keepDraw) {
        await finishExhaustedSeries(match, results, totalMaps);
        return;
      }
    }
  }

  const maxMapIndex = Math.max(0, totalMaps - 1);
  const upcomingIndex = Math.min(completedMapNumber + 1, maxMapIndex);
  const targetMapNumber =
    seriesFinished || shouldForceDrawSeries || shouldForceBo1SeriesEnd
      ? completedMapNumber
      : upcomingIndex;
  await db.updateAsync(
    'matches',
    {
      current_map: null,
      map_number: targetMapNumber,
    },
    'id = ?',
    [match.id]
  );

  // Only finish the series from here when we **must**:
  //  - true draws where the game will never send a decisive series end, or
  //  - BO1 matches that rely solely on the map result.
  //
  // When the game sends its own series end, that is the single source of
  // truth for winners/losers and bracket progression. This avoids
  // double-processing a series end with conflicting winners (map result vs
  // series end), which can corrupt the bracket (losers advancing into the
  // winners bracket, etc.).
  if (shouldForceDrawSeries || shouldForceBo1SeriesEnd) {
    await applySeriesResult(
      match.slug,
      {
        games: [],
        team1Score: team1SeriesScore,
        team2Score: team2SeriesScore,
        winner: event.winner === 'draw' ? 'none' : event.winner,
      },
      INTEGRATION_RESULT
    );
    return;
  }

  // If the series is finished normally (the game will send a real series end),
  // stop here and let that event finish it.
  if (seriesFinished) {
    return;
  }

  // Keep the previous map's final round score visible during the short
  // "between maps" window. We'll reset map rounds to 0 when the next map
  // actually goes live (via going_live / round_started events).
  const nextStats = matchLiveStatsService.update(match.slug, {
    status: 'warmup',
    mapNumber: upcomingIndex,
    mapName: null,
  });

  const mapResults = await getMapResults(match.slug);
  emitMatchUpdate({
    slug: match.slug,
    // Update live series score on all clients (including bracket view) as soon
    // as a map ends, so BO3s show 1‑0 / 1‑1 / 2‑1 in real time.
    team1Score: team1SeriesScore,
    team2Score: team2SeriesScore,
    liveStats: nextStats,
    mapResults,
  });
}

async function isEliminationMatch(match: DbMatchRow): Promise<boolean> {
  if (!match.round || match.round < 1) return false;
  const tournament = await db.queryOneAsync<{ type: string }>(
    'SELECT type FROM tournament WHERE id = ?',
    [tournamentIdForMatch(match)]
  );
  return isEliminationTournamentType(tournament?.type);
}

function teamDamage(lines: LivePlayerStatLine[] | undefined): number {
  return (lines ?? []).reduce((sum, line) => sum + (Number(line.damage) || 0), 0);
}

/**
 * Finish a series whose maps are all played but that has no series winner
 * (see utils/exhaustedSeries). Picks the winner by maps, then total rounds,
 * then map-0 damage; if still level, parks the match for an admin decision.
 */
async function finishExhaustedSeries(
  match: DbMatchRow,
  results: Awaited<ReturnType<typeof getMapResults>>,
  totalMaps: number
): Promise<void> {
  const inSeries = results.filter((r) => r.mapNumber >= 0 && r.mapNumber < totalMaps);
  const map0 = matchLiveStatsService.getStats(match.slug)?.playerStatsByMap?.[0];
  const map0Damage = map0
    ? { team1: teamDamage(map0.team1), team2: teamDamage(map0.team2) }
    : null;
  const decision = decideExhaustedSeries(inSeries, map0Damage);
  const summary = {
    slug: match.slug,
    mapsPlayed: inSeries.length,
    numMaps: totalMaps,
    maps: `${decision.team1Maps}-${decision.team2Maps}`,
    rounds: `${decision.team1Rounds}-${decision.team2Rounds}`,
    map0Damage,
    mapWinners: inSeries.map((r) => `${r.mapNumber}:${r.winnerTeam ?? 'none'}`).join(','),
  };

  if (decision.winner) {
    log.warn(
      `[SERIES GUARD] ${match.slug} ran out of maps without series_end; finishing it for ${decision.winner} (decided by ${decision.decidedBy})`,
      summary
    );
    await applySeriesResult(
      match.slug,
      {
        games: [],
        team1Score: decision.team1Maps,
        team2Score: decision.team2Maps,
        winner: decision.winner,
      },
      INTEGRATION_RESULT
    );
    return;
  }

  const lastMapIndex = Math.min(
    totalMaps - 1,
    inSeries.reduce((max, r) => Math.max(max, r.mapNumber), 0)
  );
  log.warn(
    `[SERIES GUARD] ${match.slug} ran out of maps level on maps, rounds and map-0 damage; waiting for an admin to set the winner`,
    summary
  );
  await db.updateAsync(
    'matches',
    { status: NEEDS_DECISION_STATUS, current_map: null, map_number: lastMapIndex },
    'id = ?',
    [match.id]
  );
  await releaseMatch(match);
  emitMatchUpdate({
    id: match.id,
    slug: match.slug,
    status: NEEDS_DECISION_STATUS,
    team1Score: decision.team1Maps,
    team2Score: decision.team2Maps,
    mapResults: results,
  });
  emitBracketUpdate({ action: 'match_status', matchSlug: match.slug, status: NEEDS_DECISION_STATUS });
}

// ---------------------------------------------------------------------------
// Series results
// ---------------------------------------------------------------------------

/**
 * Admin decision for a series MAT could not decide (or one stuck live because
 * the game never ended it): finish it for `winner` through `applySeriesResult`,
 * so bracket progression, stats and ratings all run. The series score is the
 * maps already recorded.
 */
export async function setSeriesWinnerByAdmin(
  slug: string,
  winner: TeamSide,
  actorId: string | null = null
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const match = await matchByIdOrSlug(slug);
  if (!match) return { ok: false, status: 404, error: 'Match not found' };
  const status = match.status as string;
  if (status === 'completed' && match.winner_id) {
    return { ok: false, status: 409, error: 'Match already has a winner' };
  }
  if (!['live', 'loaded', NEEDS_DECISION_STATUS, 'completed'].includes(status)) {
    return {
      ok: false,
      status: 409,
      error: `Match is ${status}; only a live, loaded or undecided match can be given a winner`,
    };
  }
  const winnerTeamId = winner === 'team1' ? match.team1_id : match.team2_id;
  if (!winnerTeamId) {
    return { ok: false, status: 409, error: `Match has no ${winner}` };
  }

  const results = await getMapResults(match.slug);
  const decision = decideExhaustedSeries(results);
  log.warn(`[SERIES GUARD] Admin set winner of ${match.slug} to ${winner}`, {
    slug: match.slug,
    previousStatus: status,
    maps: `${decision.team1Maps}-${decision.team2Maps}`,
    actorId,
  });
  // The maps played are already recorded; the admin only decides the series.
  await applySeriesResult(
    match.slug,
    { games: [], team1Score: decision.team1Maps, team2Score: decision.team2Maps, winner },
    { source: 'admin', actorId }
  );
  return { ok: true };
}

/** Slugs whose series result is being applied right now. */
const seriesEndInFlight = new Set<string>();

/**
 * Finish a series (see `MatchLifecycleApi` for the contract). The match is
 * read fresh by slug, so a result the core synthesises after writing the map
 * result sees that write.
 */
async function applySeriesResult(
  slug: string,
  result: SeriesResult,
  meta: ResultMeta
): Promise<ApplySeriesResultOutcome> {
  const match = await matchBySlug(slug);
  if (!match) {
    log.error(`Match not found for series_end event: ${slug}`);
    return { applied: false, reason: 'match_not_found' };
  }

  // Idempotency guard: if this match has already been finalized with a winner
  // and marked as completed, skip re-processing duplicate results.
  if (match.status === 'completed' && match.winner_id) {
    log.warn('Ignoring duplicate series_end for already completed match', {
      slug: match.slug,
      source: meta.source,
    });
    return { applied: false, reason: 'already_completed' };
  }
  // A result the core synthesises (see finishExhaustedSeries) can race the
  // game's own; only one may run the progression.
  if (seriesEndInFlight.has(match.slug)) {
    log.warn('Ignoring series_end while another is being processed for this match', {
      slug: match.slug,
      source: meta.source,
    });
    return { applied: false, reason: 'in_progress' };
  }
  seriesEndInFlight.add(match.slug);
  try {
    await recordGames(match.slug, result.games);
    const applied = await processSeriesEnd(match, result, meta);
    if (applied && meta.source !== 'integration') {
      await recordResultSource(match.slug, result, meta);
    }
    return applied ? { applied: true } : { applied: false, reason: 'no_winner' };
  } finally {
    seriesEndInFlight.delete(match.slug);
  }
}

/** Write the series' games to `match_map_results`, skipping those already stored as given. */
async function recordGames(matchSlug: string, games: GameResult[]): Promise<void> {
  if (!games.length) return;
  const stored = await getMapResults(matchSlug);
  for (const game of games) {
    const mapNumber = game.gameNumber - 1;
    const winnerTeam = game.winner === 'draw' ? 'none' : game.winner;
    const existing = stored.find((r) => r.mapNumber === mapNumber);
    const mapName = game.mapName ?? existing?.mapName ?? null;
    if (
      existing &&
      existing.team1Score === game.team1Score &&
      existing.team2Score === game.team2Score &&
      existing.winnerTeam === winnerTeam &&
      existing.mapName === mapName
    ) {
      continue;
    }
    await recordMapResult({
      matchSlug,
      mapNumber,
      mapName,
      team1Score: game.team1Score,
      team2Score: game.team2Score,
      winnerTeam,
    });
  }
}

/** Who decided a result that did not come from the game: a `series_result` row in `match_events`. */
async function recordResultSource(
  matchSlug: string,
  result: SeriesResult,
  meta: ResultMeta
): Promise<void> {
  const eventData = {
    event: 'series_result',
    source: meta.source,
    actorId: meta.actorId,
    winner: result.winner,
    team1_series_score: result.team1Score,
    team2_series_score: result.team2Score,
  };
  try {
    await db.insertAsync('match_events', {
      match_slug: matchSlug,
      event_type: 'series_result',
      event_data: JSON.stringify(eventData),
      received_at: Math.floor(Date.now() / 1000),
    });
  } catch (error) {
    log.error('Failed to record the source of a series result', { error, matchSlug });
  }
}

/** Team names MAT has for a match, for log lines the game sends without names. */
async function knownTeamNames(
  match: DbMatchRow,
  description: MatchDescription
): Promise<{
  team1Name?: string | null;
  team2Name?: string | null;
  configTeam1Name?: string | null;
  configTeam2Name?: string | null;
}> {
  const names: {
    team1Name?: string | null;
    team2Name?: string | null;
    configTeam1Name?: string | null;
    configTeam2Name?: string | null;
  } = {
    configTeam1Name: description.team1.name || null,
    configTeam2Name: description.team2.name || null,
  };
  try {
    const ids = [match.team1_id, match.team2_id].filter((id): id is string => Boolean(id));
    if (ids.length > 0) {
      const rows = await db.queryAsync<{ id: string; name: string }>(
        `SELECT id, name FROM teams WHERE id IN (${ids.map(() => '?').join(',')})`,
        ids
      );
      names.team1Name = rows.find((r) => r.id === match.team1_id)?.name ?? null;
      names.team2Name = rows.find((r) => r.id === match.team2_id)?.name ?? null;
    }
  } catch {
    // Names are only for the log line.
  }
  return names;
}

/** Index of the last map with a result, capped to the series length, for finished matches. */
async function lastPlayedMapIndex(
  match: DbMatchRow,
  description: MatchDescription
): Promise<number | null> {
  const row = await db.queryOneAsync<{ max: number | string | null }>(
    'SELECT MAX(map_number) as max FROM match_map_results WHERE match_slug = ?',
    [match.slug]
  );
  const max = row?.max === null || row?.max === undefined ? null : Number(row.max);
  if (max === null || !Number.isFinite(max)) return null;
  const numMaps = description.seriesLength;
  return numMaps > 0 ? Math.min(max, numMaps - 1) : max;
}

/**
 * Mark the match completed, release its resource, run bracket progression,
 * stats and ratings. Returns false when the result names no winner the match
 * can take and is not a draw (nothing is applied).
 */
async function processSeriesEnd(
  match: DbMatchRow,
  result: SeriesResult,
  meta: ResultMeta
): Promise<boolean> {
  const matchSlug = match.slug;
  const description = describeMatch(match);
  const team1Score = Number(result.team1Score) || 0;
  const team2Score = Number(result.team2Score) || 0;
  log.success(
    `[SERIES END] ${formatSeriesEndSummary(
      { team1_series_score: team1Score, team2_series_score: team2Score },
      await knownTeamNames(match, description)
    )}`,
    {
      slug: matchSlug,
      winner: result.winner,
      source: meta.source,
    }
  );

  // Prefer the explicit winner, even when scores are tied (e.g.
  // performance-based tiebreaks). Fall back to score comparison only if the
  // winner is "none".
  const winnerSide = result.winner;
  const isDrawFromScores = winnerSide === 'none' && team1Score === team2Score;

  let winnerId: string | null = null;
  if (winnerSide === 'team1') {
    winnerId = match.team1_id ?? null;
  } else if (winnerSide === 'team2') {
    winnerId = match.team2_id ?? null;
  } else if (team1Score !== team2Score) {
    // Legacy fallback: derive winner from series score when the result doesn't
    // provide a decisive winner.
    winnerId = team1Score > team2Score ? match.team1_id ?? null : match.team2_id ?? null;
  } else {
    winnerId = null;
  }
  const completedAt = Math.floor(Date.now() / 1000);
  // Finished matches point at the last map played, whatever the game reported since.
  const lastMap = await lastPlayedMapIndex(match, description);
  const finalMapNumber = lastMap === null ? {} : { map_number: lastMap };

  if (!winnerId) {
    // For manual matches (round = 0) or other ad‑hoc configs where team1_id /
    // team2_id are null, we still want to mark the match as completed so that
    // UIs and stats behave correctly, but we intentionally leave winner_id
    // null and skip any bracket progression logic.
    if (match.round === 0) {
      log.warn(
        `Could not determine winner team_id for manual match ${matchSlug}; marking completed without winner_id`
      );

      await db.updateAsync(
        'matches',
        {
          status: 'completed',
          completed_at: completedAt,
          ...finalMapNumber,
        },
        'id = ?',
        [match.id]
      );

      // Even though manual matches don't have bracket progression or a
      // persistent tournament association, we still want them to appear in
      // player match history. Track per‑player stats using the ad‑hoc team
      // rosters from the stored match config.
      await trackPlayerStatsForManualMatch(match, matchSlug, team1Score, team2Score);

      // Now that stats have been recorded, emit a match update so that any
      // listening UIs (including the public player page) can immediately
      // reload and see a fully populated match history row.
      emitMatchUpdate({
        id: match.id,
        slug: match.slug,
        status: 'completed',
        team1Score,
        team2Score,
      });

      return true;
    }

    // For non-manual matches, treat a true series draw (no winner and equal
    // series scores) as a completed match with no winner_id. This ensures that
    // tie games no longer appear as "live" forever and that player stats are
    // still recorded for history, while ratings remain unchanged.
    if (isDrawFromScores) {
      await db.updateAsync(
        'matches',
        {
          status: 'completed',
          winner_id: null,
          completed_at: completedAt,
          ...finalMapNumber,
        },
        'id = ?',
        [match.id]
      );

      log.warn(`Match ${matchSlug} ended in a draw; marking completed without winner_id`);

      // Track per-player stats treating the result as a draw (no winners).
      await trackPlayerStatsForMatch(match, null, matchSlug);

      const updatedMatch = await db.queryOneAsync<DbMatchRow>(
        'SELECT * FROM matches WHERE id = ?',
        [match.id]
      );
      if (updatedMatch) {
        emitMatchUpdate({
          id: updatedMatch.id,
          slug: updatedMatch.slug,
          status: updatedMatch.status,
          team1Score,
          team2Score,
          winnerId: null,
        });
        emitBracketUpdate({
          action: 'match_status',
          matchSlug: updatedMatch.slug,
          status: updatedMatch.status,
        });
      }

      // Drawn matches should still count as finished when considering round
      // advancement and tournament completion.
      const tournament = await db.queryOneAsync<{ type: string }>(
        'SELECT type FROM tournament WHERE id = ?',
        [tournamentIdForMatch(match)]
      );
      if (tournament?.type === 'shuffle') {
        await checkAndAdvanceShuffleRound(tournamentIdForMatch(match), match.round);
      }
      await checkTournamentCompletion(tournamentIdForMatch(match));

      // Free the resource for drawn matches too
      await releaseMatch(match);

      return true;
    }

    log.error(`Could not determine winner for match ${matchSlug}`);
    return false;
  }

  // Update match status to completed
  await db.updateAsync(
    'matches',
    {
      status: 'completed',
      winner_id: winnerId,
      completed_at: completedAt,
      ...finalMapNumber,
    },
    'id = ?',
    [match.id]
  );

  log.success(`Match ${matchSlug} marked as completed with winner ${winnerId}`);

  // The series is over, so the match's resource (CS2: its server) is free for
  // new work; the integration also starts allocating waiting matches to it.
  await releaseMatch(match);

  // Progression / bracket wiring
  const tournament = await db.queryOneAsync<{ type: string; team_ids: string | null }>(
    'SELECT type, team_ids FROM tournament WHERE id = ?',
    [tournamentIdForMatch(match)]
  );

  let teamCount: number | undefined;
  if (tournament?.team_ids) {
    try {
      const parsed = JSON.parse(tournament.team_ids) as unknown;
      if (Array.isArray(parsed)) {
        teamCount = parsed.length;
      }
    } catch {
      // Ignore JSON parse errors; fall back to generic behaviour
    }
  }

  // Detect whether this tournament uses explicit slot wiring. When present,
  // we prefer generic slot-based propagation and avoid any slug/round
  // inference entirely.
  let usesSlotWiring = false;
  if (tournament) {
    const wiringRow = await db.queryOneAsync<{ count: number | string }>(
      `SELECT COUNT(*) as count
       FROM matches
       WHERE tournament_id = ?
         AND (team1_from_match_id IS NOT NULL OR team2_from_match_id IS NOT NULL)`,
      [tournamentIdForMatch(match)]
    );
    usesSlotWiring = wiringRow ? Number(wiringRow.count) > 0 : false;
  }

  const isDoubleElim8 =
    tournament?.type === 'double_elimination' && typeof teamCount === 'number' && teamCount === 8;

  if (usesSlotWiring) {
    await propagateMatchBySlotSources(match.id);
  } else if (isDoubleElim8) {
    // For the canonical 8‑team double‑elimination bracket generated by
    // brackets‑manager, keep the fixed progression map based on slug
    // conventions for backward compatibility.
    await reconcileDoubleElimination8Bracket(tournamentIdForMatch(match));
  } else {
    // Generic behaviour for other tournament types / sizes:
    // advance winners via next_match_id and losers via slug mapping.
    if (match.next_match_id) {
      await advanceWinnerToNextMatch(match, winnerId);
    }

    if (tournament?.type === 'double_elimination') {
      const loserId = match.team1_id === winnerId ? match.team2_id : match.team1_id;
      if (loserId) {
        await advanceLoserToLosersBracket(match, winnerId);
      }
    }
  }

  // Always track player stats and ratings where possible. Ratings are only
  // updated for decisive results; true draws do not change ratings.
  await trackPlayerStatsForMatch(match, winnerId, matchSlug);
  if (winnerId) {
    await updateRatingsForMatch(match, winnerId, matchSlug);
  }

  // Emit match + bracket updates so all UIs (including bracket view and
  // player profile pages) can react *after* stats and ratings are fully
  // persisted. This ensures that any API calls triggered by these socket
  // events will see the final, updated data.
  const updatedMatch = await db.queryOneAsync<DbMatchRow>('SELECT * FROM matches WHERE id = ?', [
    match.id,
  ]);
  if (updatedMatch) {
    // Emit a rich payload with series score so bracket/matches views can update immediately
    emitMatchUpdate({
      id: updatedMatch.id,
      slug: updatedMatch.slug,
      status: updatedMatch.status,
      team1Score,
      team2Score,
      winnerId,
    });
    emitBracketUpdate({
      action: 'match_status',
      matchSlug: updatedMatch.slug,
      status: updatedMatch.status,
      team1Score,
      team2Score,
    });
  }

  // Shuffle-specific round progression
  if (tournament?.type === 'shuffle') {
    await checkAndAdvanceShuffleRound(tournamentIdForMatch(match), match.round);
  }

  // Pairs the next Swiss round when this one is done, then checks whether the
  // tournament is complete.
  await checkTournamentCompletion(tournamentIdForMatch(match));
  return true;
}

/**
 * Check if shuffle round is complete and advance if needed
 */
async function checkAndAdvanceShuffleRound(
  tournamentId: number,
  roundNumber: number
): Promise<void> {
  try {
    const { checkRoundCompletion } = await import('../services/shuffleTournamentService');
    const isComplete = await checkRoundCompletion(tournamentId, roundNumber);

    if (isComplete) {
      log.info(`Round ${roundNumber} is complete, advancing to next round...`);
      const result = await advanceToNextRound(tournamentId);

      if (result) {
        log.success(
          `Advanced to round ${result.roundNumber} with ${result.matches.length} matches`
        );
        // Emit bracket update for new matches
        emitBracketUpdate({ action: 'round_advanced', roundNumber: result.roundNumber });

        // Automatically allocate servers to newly generated matches, but enforce
        // a global grace window between rounds before any of the new matches
        // are actually loaded. This is independent of the per‑server idle
        // cooldown and guarantees e.g. a 5‑minute pause between rounds even if
        // other servers are already free.
        await scheduler.scheduleRoundAllocation(
          tournamentId,
          result.roundNumber,
          result.matches.map((m) => m.slug)
        );
      } else {
        log.info('Tournament is complete or no more rounds');
      }
    }
  } catch (error) {
    log.error('Error checking/advancing shuffle round', { error, roundNumber });
    // Don't throw - round advancement failure shouldn't break match completion
  }
}

export const matchLifecycle: MatchLifecycleApi = {
  applySeriesResult,
  ingest,
};
