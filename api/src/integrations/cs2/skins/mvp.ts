/**
 * The tournament's MVP (its prize: settings.cs2.mvp, skinService.awardMvp):
 * every player who played in it with what could make them MVP, the commends
 * they got in its matches and their rating over its maps.
 *
 * Most commended: the most commends, then the most players who gave them,
 * then the rating. Best rating: the highest rating from MIN_ROUNDS_FOR_RATING
 * rounds on. The organizer picks: these as hints, after the final.
 */

import { db } from '../../../config/database';
import { tournamentPlayerExtras } from '../tournamentExtras';

/** Below this many rounds a rating says little (the Results awards use the same). */
export const MIN_ROUNDS_FOR_RATING = 20;

export interface MvpCandidate {
  steamId: string;
  name: string;
  avatar: string | null;
  teamName: string | null;
  /** Commends in the tournament's matches, from how many players, per kind. */
  commends: number;
  commendedBy: number;
  kinds: Record<string, number>;
  rating: number | null;
  matches: number;
  rounds: number;
}

export async function mvpCandidates(tournamentId: number): Promise<MvpCandidate[]> {
  const played = await db.queryAsync<{
    player_id: string;
    name: string;
    avatar_url: string | null;
    matches: number | string;
    rounds: number | string;
    team_name: string | null;
  }>(
    `SELECT s.player_id, p.name, p.avatar_url,
            COUNT(DISTINCT s.match_slug) AS matches, SUM(COALESCE(s.rounds_played, 0)) AS rounds,
            (SELECT t.name FROM player_match_stats s2 JOIN matches m2 ON m2.slug = s2.match_slug
               JOIN teams t ON t.id = CASE WHEN s2.team = 'team1' THEN m2.team1_id ELSE m2.team2_id END
              WHERE s2.player_id = s.player_id AND m2.tournament_id = ?
              ORDER BY m2.completed_at DESC NULLS LAST LIMIT 1) AS team_name
       FROM player_match_stats s
       JOIN matches m ON m.slug = s.match_slug
       JOIN players p ON p.id = s.player_id
      WHERE m.tournament_id = ? AND COALESCE(s.rounds_played, 0) > 0 AND p.deleted_at IS NULL
      GROUP BY s.player_id, p.name, p.avatar_url`,
    [tournamentId, tournamentId]
  );
  const commends = await db.queryAsync<{
    to_player_id: string;
    tag: string | null;
    n: number | string;
  }>(
    `SELECT c.to_player_id, c.tag, COUNT(*) AS n
       FROM commends c JOIN matches m ON m.slug = c.match_slug
      WHERE m.tournament_id = ? AND c.value = 1
      GROUP BY c.to_player_id, c.tag`,
    [tournamentId]
  );
  const givers = await db.queryAsync<{ to_player_id: string; givers: number | string }>(
    `SELECT c.to_player_id, COUNT(DISTINCT c.from_player_id) AS givers
       FROM commends c JOIN matches m ON m.slug = c.match_slug
      WHERE m.tournament_id = ? AND c.value = 1
      GROUP BY c.to_player_id`,
    [tournamentId]
  );
  const extras = await tournamentPlayerExtras(tournamentId);
  const giversOf = new Map(givers.map((g) => [g.to_player_id, Number(g.givers)]));
  return played.map((p) => {
    const mine = commends.filter((c) => c.to_player_id === p.player_id);
    const kinds: Record<string, number> = {};
    for (const c of mine) if (c.tag) kinds[c.tag] = (kinds[c.tag] ?? 0) + Number(c.n);
    const rounds = Number(p.rounds);
    const rating = extras[p.player_id]?.rating;
    return {
      steamId: p.player_id,
      name: p.name,
      avatar: p.avatar_url,
      teamName: p.team_name,
      commends: mine.reduce((sum, c) => sum + Number(c.n), 0),
      commendedBy: giversOf.get(p.player_id) ?? 0,
      kinds,
      rating: typeof rating === 'number' && rounds >= MIN_ROUNDS_FOR_RATING ? rating : null,
      matches: Number(p.matches),
      rounds,
    };
  });
}

/** The candidates in the order `by` ranks them, best first. */
export function rankMvp(
  candidates: MvpCandidate[],
  by: 'commends' | 'rating' | 'admin'
): MvpCandidate[] {
  const rating = (c: MvpCandidate) => c.rating ?? -1;
  return [...candidates].sort((a, b) =>
    by === 'rating'
      ? rating(b) - rating(a) || b.commends - a.commends
      : b.commends - a.commends || b.commendedBy - a.commendedBy || rating(b) - rating(a)
  );
}

/** Who wins by `by`, or null (nobody commended, nobody with a rating). */
export function pickMvp(
  candidates: MvpCandidate[],
  by: 'commends' | 'rating'
): MvpCandidate | null {
  const top = rankMvp(candidates, by)[0];
  if (!top) return null;
  if (by === 'commends' && top.commends === 0) return null;
  if (by === 'rating' && top.rating === null) return null;
  return top;
}
