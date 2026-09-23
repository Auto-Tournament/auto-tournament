/**
 * Round robin round progression.
 *
 * The round robin generator creates every match up front, teams and all, and
 * holds everything past round 1 as `pending`. In CS2 that hold is the map
 * veto: every match with two known teams is vetoable from the moment the
 * tournament starts, and finishing a veto is what readies and allocates it.
 *
 * A game without a pre-match phase (`capabilities.veto === false`: manual
 * reporting, the test-only fake module) has nothing that does that, so its
 * rounds after 1 used to stay `pending` for ever and the tournament stalled
 * as soon as round 1 finished. Here the round itself opens the next one, the
 * way Swiss pairs its next round and the elimination brackets ready the match
 * a winner advances into — all three go through `makeMatchReady`, which builds
 * the config, flips the status and hands the match to the scheduler.
 *
 * CS2 is left exactly as it was: the veto still opens every round, in its own
 * order and with its own timing. See the `capabilities.veto` guard below.
 */

import { db } from '../config/database';
import { log } from '../utils/logger';
import { emitBracketUpdate } from './socketService';
import { integrationForMatch } from '../integrations/registry';
import { DEFAULT_GAME } from '../integrations/types';
import { makeMatchReady } from '../utils/matchProgression';
import type { DbMatchRow, DbTournamentRow } from '../types/database.types';

/**
 * A match that can actually be played: both slots filled, with two different
 * teams. An odd team count gives one team a bye every round, and a bye is a
 * row with an empty slot that nobody ever reports — it must not hold its
 * round open for ever.
 */
function isPlayable(match: DbMatchRow): boolean {
  return Boolean(match.team1_id && match.team2_id && match.team1_id !== match.team2_id);
}

/**
 * Open the next round of a round robin whose game has no pre-match phase.
 *
 * Called from `checkTournamentCompletion`, so it runs on every completed
 * match and on a bracket read. That also unsticks a tournament whose round
 * finished earlier without the next one opening.
 *
 * At most one round opens per call, and only a round where nothing has opened
 * yet, so a round already under way is never touched.
 */
export async function advanceRoundRobinTournament(tournamentId: number): Promise<void> {
  const tournament = await db.queryOneAsync<DbTournamentRow>(
    'SELECT * FROM tournament WHERE id = ?',
    [tournamentId]
  );
  if (!tournament || tournament.type !== 'round_robin') return;
  if (tournament.status === 'completed') return;

  // Not started yet: `POST /api/tournament/start` opens round 1.
  if (tournament.status === 'setup' || tournament.status === 'ready') return;

  // The veto opens every CS2 round already; opening them here as well would
  // ready matches that have not been vetoed.
  if (integrationForMatch(tournament).capabilities.veto) return;

  const rows = await db.queryAsync<DbMatchRow>(
    'SELECT * FROM matches WHERE tournament_id = ? AND round >= 1 ORDER BY round, match_number',
    [tournamentId]
  );
  if (rows.length === 0) return;

  const rounds = [...new Set(rows.map((row) => Number(row.round)))].sort((a, b) => a - b);

  for (const round of rounds) {
    const playable = rows.filter((row) => Number(row.round) === round && isPlayable(row));
    // A round of byes only (or of rows without teams) is nothing to wait for.
    if (playable.length === 0) continue;
    // This round is behind us.
    if (playable.every((match) => match.status === 'completed')) continue;

    // The first round that is not finished. If any of its matches has been
    // opened already the round is under way and there is nothing to do here;
    // only a round that is still entirely `pending` gets opened.
    const waiting = playable.filter((match) => match.status === 'pending');
    if (waiting.length !== playable.length) return;

    log.info(
      `[ROUND-ROBIN] Opening round ${round}: ${waiting.length} match(es), ` +
        `${tournament.game || DEFAULT_GAME} has no pre-match phase`
    );
    emitBracketUpdate({ action: 'round_advanced', roundNumber: round });
    for (const match of waiting) {
      await makeMatchReady(match);
    }
    return;
  }
}
