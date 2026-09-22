/**
 * Swiss round progression.
 *
 * The Swiss generator creates every round up front, but only round 1 has teams.
 * Once every match of the current round is completed, the next round's
 * placeholder matches are filled from the standings (see utils/swissPairing),
 * readied (config, veto/allocation) and the tournament moves on. When the last
 * round completes, the regular completion check finishes the tournament.
 */

import { db } from '../config/database';
import { log } from '../utils/logger';
import { emitBracketUpdate } from './socketService';
import { buildMatchConfigFor, serializeMatchConfig } from '../utils/matchIntegration';
import { settingsService } from './settingsService';
import { integrationForMatch } from '../integrations/registry';
import { DEFAULT_GAME } from '../integrations/types';
import { makeMatchReady } from '../utils/matchProgression';
import { tournamentRowToResponse } from '../utils/tournamentRow';
import {
  computeSwissStandings,
  pairSwissRound,
  type SwissMatchLike,
  type SwissStanding,
} from '../utils/swissPairing';
import type { DbMatchRow, DbTournamentRow } from '../types/database.types';
import type { SwissStandingEntry } from '../types/tournament.types';

interface RoundRow extends DbMatchRow {
  team1_rounds?: number | string | null;
  team2_rounds?: number | string | null;
}

/**
 * Load every bracket match with its summed map rounds (for the differential).
 * Nothing Swiss-specific: round robin standings use it too.
 */
export async function loadSwissMatches(tournamentId: number): Promise<RoundRow[]> {
  return db.queryAsync<RoundRow>(
    `SELECT m.*,
            COALESCE(r.team1_rounds, 0) AS team1_rounds,
            COALESCE(r.team2_rounds, 0) AS team2_rounds
       FROM matches m
       LEFT JOIN (
         SELECT match_slug, SUM(team1_score) AS team1_rounds, SUM(team2_score) AS team2_rounds
           FROM match_map_results
          GROUP BY match_slug
       ) r ON r.match_slug = m.slug
      WHERE m.tournament_id = ? AND m.round >= 1
      ORDER BY m.round, m.match_number`,
    [tournamentId]
  );
}

export function toSwissMatch(row: RoundRow): SwissMatchLike {
  return {
    team1Id: row.team1_id ?? null,
    team2Id: row.team2_id ?? null,
    winnerId: row.winner_id ?? null,
    status: row.status,
    team1Rounds: Number(row.team1_rounds ?? 0),
    team2Rounds: Number(row.team2_rounds ?? 0),
  };
}

export function parseTeamIds(raw: string | null | undefined): string[] {
  try {
    const parsed = JSON.parse(raw ?? '[]') as unknown;
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

/** Final/current Swiss standings for a tournament, best first. */
export async function getSwissStandings(tournamentId: number): Promise<SwissStanding[]> {
  const tournament = await db.queryOneAsync<DbTournamentRow>(
    'SELECT * FROM tournament WHERE id = ?',
    [tournamentId]
  );
  if (!tournament) return [];
  const rows = await loadSwissMatches(tournamentId);
  return computeSwissStandings(parseTeamIds(tournament.team_ids), rows.map(toSwissMatch));
}

/** Standings as exposed by the API (bracket and leaderboard), best first. */
export async function getSwissStandingEntries(
  tournamentId: number
): Promise<SwissStandingEntry[]> {
  const standings = await getSwissStandings(tournamentId);
  return standings.map((s, index) => ({
    rank: index + 1,
    teamId: s.teamId,
    wins: s.wins,
    losses: s.losses,
    buchholz: s.buchholz,
    roundDiff: s.roundDiff,
    byes: s.byes,
  }));
}

// Serialises advancement in this process: concurrent or retried series_end
// events for the last matches of a round must pair the next round once.
let advanceChain: Promise<void> = Promise.resolve();

/**
 * Pair the next Swiss round when the current one is complete. Safe to call any
 * number of times, concurrently: runs are serialised in-process and the fill
 * itself only claims placeholder rows that are still empty.
 */
export function advanceSwissTournament(tournamentId: number): Promise<void> {
  const run = advanceChain.then(() => advanceOnce(tournamentId));
  advanceChain = run.catch((error) => {
    log.error('[SWISS] Round advancement failed', error, { tournamentId });
  });
  return advanceChain;
}

async function advanceOnce(tournamentId: number): Promise<void> {
  const tournament = await db.queryOneAsync<DbTournamentRow>(
    'SELECT * FROM tournament WHERE id = ?',
    [tournamentId]
  );
  if (!tournament || tournament.type !== 'swiss') return;
  if (tournament.status === 'completed' || tournament.status === 'setup') return;

  const rows = await loadSwissMatches(tournamentId);
  const rounds = [...new Set(rows.map((r) => r.round))].sort((a, b) => a - b);

  // The next round to pair is the first one where nobody has been placed yet.
  const nextRound = rounds.find((round) =>
    rows.filter((r) => r.round === round).every((r) => !r.team1_id && !r.team2_id)
  );
  if (nextRound === undefined || nextRound === 1) return;

  const earlier = rows.filter((r) => r.round < nextRound);
  if (earlier.some((r) => r.status !== 'completed')) {
    log.debug(`[SWISS] Round ${nextRound - 1} not complete yet`);
    return;
  }

  const teamIds = parseTeamIds(tournament.team_ids);
  const standings = computeSwissStandings(teamIds, earlier.map(toSwissMatch));
  const pairing = pairSwissRound(standings);
  if (pairing.rematchesAllowed) {
    log.warn(`[SWISS] No rematch-free pairing exists for round ${nextRound}; allowing rematches`);
  }

  const slots = rows
    .filter((r) => r.round === nextRound)
    .sort((a, b) => a.match_number - b.match_number);
  const needed = pairing.pairs.length + (pairing.byeTeamId ? 1 : 0);

  // Brackets generated before byes existed have one slot too few for an odd
  // team count; add the missing placeholder.
  for (let n = slots.length + 1; n <= needed; n++) {
    const slug = `swiss-r${nextRound}m${n}`;
    await db.runAsync(
      `INSERT INTO matches (slug, tournament_id, game, round, match_number, config, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)
       ON CONFLICT (slug) DO NOTHING`,
      [
        slug,
        tournamentId,
        tournament.game || DEFAULT_GAME,
        nextRound,
        n,
        '{}',
        Math.floor(Date.now() / 1000),
      ]
    );
    const inserted = await db.queryOneAsync<RoundRow>('SELECT * FROM matches WHERE slug = ?', [
      slug,
    ]);
    if (inserted) slots.push(inserted);
  }

  const now = Math.floor(Date.now() / 1000);
  type Assignment = {
    id: number;
    team1: string;
    team2: string | null;
    status: 'pending' | 'completed';
    winner: string | null;
    completedAt: number | null;
  };
  const assignments: Assignment[] = pairing.pairs.map(([team1, team2], i) => ({
    id: slots[i].id,
    team1,
    team2,
    status: 'pending',
    winner: null,
    completedAt: null,
  }));
  if (pairing.byeTeamId) {
    assignments.push({
      id: slots[pairing.pairs.length].id,
      team1: pairing.byeTeamId,
      team2: null,
      status: 'completed',
      winner: pairing.byeTeamId,
      completedAt: now,
    });
  }

  // Atomic claim: one statement fills every slot, and only slots that are
  // still empty placeholders. Another process that got there first leaves
  // nothing to claim (Postgres re-checks the row conditions after waiting on
  // the row lock), so the round is paired exactly once.
  const values = assignments.map(() => '(?::int, ?::text, ?::text, ?::text, ?::text, ?::int)');
  const params = assignments.flatMap((a) => [
    a.id,
    a.team1,
    a.team2,
    a.status,
    a.winner,
    a.completedAt,
  ]);
  const claim = await db.runAsync(
    `UPDATE matches AS m
        SET team1_id = v.team1_id,
            team2_id = v.team2_id,
            status = v.status,
            winner_id = v.winner_id,
            completed_at = v.completed_at
       FROM (VALUES ${values.join(', ')}) AS v(id, team1_id, team2_id, status, winner_id, completed_at)
      WHERE m.id = v.id
        AND m.team1_id IS NULL
        AND m.team2_id IS NULL
        AND m.status = 'pending'`,
    params
  );
  if (claim.changes === 0) {
    log.debug(`[SWISS] Round ${nextRound} was already paired`);
    return;
  }
  if (claim.changes !== assignments.length) {
    log.error(
      `[SWISS] Round ${nextRound} only partially paired (${claim.changes}/${assignments.length}); check the bracket`
    );
  }

  // Placeholders the pairing did not need (e.g. a bracket generated for a
  // different team count) would otherwise block tournament completion forever.
  const unused = slots.slice(needed).map((s) => s.id);
  if (unused.length > 0) {
    await db.runAsync(
      `DELETE FROM matches WHERE id = ANY(?::int[]) AND team1_id IS NULL AND team2_id IS NULL`,
      [unused]
    );
  }

  const record = new Map(standings.map((s) => [s.teamId, `${s.wins}-${s.losses}`]));
  log.success(
    `[SWISS] Round ${nextRound} paired: ${pairing.pairs
      .map(([a, b]) => `${a} (${record.get(a)}) vs ${b} (${record.get(b)})`)
      .join(', ')}${pairing.byeTeamId ? `; bye: ${pairing.byeTeamId}` : ''}`
  );

  const tournamentData = tournamentRowToResponse(tournament);
  const paired: DbMatchRow[] = [];
  for (const a of assignments) {
    if (!a.team2) continue;
    const slot = slots.find((s) => s.id === a.id)!;
    const config = await buildMatchConfigFor(
      {
        slug: slot.slug,
        id: a.id,
        game: slot.game,
        round: nextRound,
        team1Id: a.team1,
        team2Id: a.team2,
      },
      tournamentData
    );
    await db.updateAsync('matches', { config: serializeMatchConfig(config) }, 'id = ?', [a.id]);
    const fresh = await db.queryOneAsync<DbMatchRow>('SELECT * FROM matches WHERE id = ?', [a.id]);
    if (fresh) paired.push(fresh);
  }

  emitBracketUpdate({ action: 'round_advanced', roundNumber: nextRound });

  // Veto and allocation happen in the background, the same way the other
  // bracket types ready a match: simulation auto-vetoes every waiting match at
  // once, otherwise each match is readied and offered to a server.
  setImmediate(() => {
    void (async () => {
      try {
        if (await settingsService.isSimulationModeEnabled()) {
          const started =
            (await integrationForMatch(tournament).startPendingPreMatchPhases?.(tournamentId)) ??
            [];
          if (started.length > 0) return;
        }
        for (const match of paired) {
          await makeMatchReady(match);
        }
      } catch (error) {
        log.error('[SWISS] Failed to ready newly paired matches', error, { round: nextRound });
      }
    })();
  });
}
