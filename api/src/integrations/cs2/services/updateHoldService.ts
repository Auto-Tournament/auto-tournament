/**
 * Should a game host pause its automatic CS2 updates right now?
 *
 * CS2 Server Manager (csm) auto-updates a server once it has been idle for a
 * grace period. Idle is a local judgement — no players, no match loaded — and
 * it is right up until the moment MAT allocates that server the next match of
 * a tournament. A server that restarts for a Valve update in the two minutes
 * between two rounds is indistinguishable, from the players' side, from a
 * server that fell over.
 *
 * MAT is the only party that knows a tournament is running, so it answers the
 * question and csm asks it (`GET /api/servers/update-hold`). Nothing is pushed:
 * see the route for why.
 *
 * The answer is fleet-wide on purpose. MAT runs one tournament at a time
 * (`tournament` is a single row) and its allocator may hand *any* enabled
 * server the next match, so "is a tournament live on the servers you manage"
 * has the same answer for every host while that tournament is in progress.
 * Scoping the reply to one host's own addresses would need csm to know its
 * public address and MAT to match it — a new failure mode for no gain.
 */

import { db } from '../../../config/database';
import { ACTIVE_MATCH_STATUSES } from '../../../utils/serverAttribution';

/** A match MAT considers to be running on a server right now. */
export interface ActiveMatchRow {
  slug: string;
  serverId: string | null;
  status: string;
}

/** What the decision needs to know. Separate so it can be table-tested. */
export interface UpdateHoldInputs {
  /** `tournament.status`, or null when there is no tournament row yet. */
  tournamentStatus: string | null;
  /** `tournament.name`, for the reason string. */
  tournamentName: string | null;
  /** Matches in an active status (`loaded`, `live`). */
  activeMatches: readonly ActiveMatchRow[];
}

export interface UpdateHoldDecision {
  hold: boolean;
  /** One sentence, written to be pasted straight into csm's monitor log. */
  reason: string;
}

/** Tournament statuses during which servers must not restart themselves. */
export const HOLDING_TOURNAMENT_STATUSES: readonly string[] = ['in_progress'];

/** How many match slugs the reason string names before it summarises. */
const REASON_MATCH_LIMIT = 3;

/**
 * Decide the hold. Pure.
 *
 * A loaded or live match is checked first and independently of the tournament
 * status, so a manually started match still holds updates on an instance whose
 * tournament row sits in `setup`.
 */
export function decideUpdateHold(inputs: UpdateHoldInputs): UpdateHoldDecision {
  const active = inputs.activeMatches;
  if (active.length > 0) {
    const named = active
      .slice(0, REASON_MATCH_LIMIT)
      .map((match) => (match.serverId ? `${match.slug} on ${match.serverId}` : match.slug))
      .join(', ');
    const more =
      active.length > REASON_MATCH_LIMIT ? `, +${active.length - REASON_MATCH_LIMIT} more` : '';
    return {
      hold: true,
      reason: `${active.length} match(es) in progress (${named}${more})`,
    };
  }

  const status = inputs.tournamentStatus;
  if (status && HOLDING_TOURNAMENT_STATUSES.includes(status)) {
    const name = inputs.tournamentName?.trim();
    return {
      hold: true,
      reason:
        `tournament${name ? ` "${name}"` : ''} is in progress, ` +
        'so any enabled server may be given a match at any moment',
    };
  }

  return {
    hold: false,
    reason: status
      ? `no match is loaded or live and the tournament is "${status}"`
      : 'no match is loaded or live and there is no tournament',
  };
}

/** The decision plus the facts behind it, as the endpoint returns them. */
export interface UpdateHoldStatus extends UpdateHoldDecision {
  tournamentStatus: string | null;
  activeMatches: ActiveMatchRow[];
  checkedAt: number;
}

interface TournamentStatusRow {
  status: string | null;
  name: string | null;
}

interface ActiveMatchDbRow {
  slug: string;
  server_id: string | null;
  status: string;
}

/** Read the facts out of the database and decide. */
export async function getUpdateHoldStatus(): Promise<UpdateHoldStatus> {
  const placeholders = ACTIVE_MATCH_STATUSES.map(() => '?').join(', ');
  const [tournament, matches] = await Promise.all([
    db.queryOneAsync<TournamentStatusRow>('SELECT status, name FROM tournament WHERE id = ?', [1]),
    db.queryAsync<ActiveMatchDbRow>(
      `SELECT slug, server_id, status FROM matches WHERE status IN (${placeholders}) ORDER BY slug`,
      [...ACTIVE_MATCH_STATUSES]
    ),
  ]);

  const activeMatches: ActiveMatchRow[] = matches.map((row) => ({
    slug: row.slug,
    serverId: row.server_id ?? null,
    status: row.status,
  }));

  const decision = decideUpdateHold({
    tournamentStatus: tournament?.status ?? null,
    tournamentName: tournament?.name ?? null,
    activeMatches,
  });

  return {
    ...decision,
    tournamentStatus: tournament?.status ?? null,
    activeMatches,
    checkedAt: Math.floor(Date.now() / 1000),
  };
}
