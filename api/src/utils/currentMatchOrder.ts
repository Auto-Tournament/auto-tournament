/**
 * Which of a player's (or team's) open matches is "your match".
 *
 * Queries that pick the current or next match join the match's tournament
 * with {@link CURRENT_MATCH_TOURNAMENT_JOIN} and sort by
 * {@link CURRENT_MATCH_ORDER}:
 *
 * 1. loaded or live: the match is on a server now;
 * 2. a veto that has started and not finished;
 * 3. pending or ready, in a tournament that has started (or no tournament);
 * 4. a match in a tournament still in `setup`, last.
 *
 * Inside a rank, the lowest round and match number first.
 *
 * A draft (a tournament in `setup`, not started) has its bracket drawn, so its
 * round-1 match sorted ahead of a running Swiss's round-3 match by round alone.
 * A team placed in an upcoming final while still playing the Swiss was sent to
 * "Waiting for the tournament to start" and missed its veto (NTLAN,
 * 2026-10-17). A draft's match still counts when it is the only one, the way
 * the team page shows an upcoming drafted match.
 */
export const CURRENT_MATCH_TOURNAMENT_JOIN = 'LEFT JOIN tournament cmt ON cmt.id = m.tournament_id';

export const CURRENT_MATCH_ORDER = `CASE
    WHEN m.status IN ('loaded', 'live') THEN 0
    WHEN cmt.status = 'setup' THEN 3
    WHEN m.veto_state IS NOT NULL AND m.veto_state NOT LIKE '%"status":"completed"%' THEN 1
    ELSE 2
  END ASC, m.round ASC, m.match_number ASC`;
