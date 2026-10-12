/**
 * CS2's category leaderboards (client: the Leaderboards page's
 * `leaderboardView`), from the per-map numbers the demos and the plugin
 * recorded (cs2_player_map_stats).
 *
 * Public:
 *   GET /api/game/cs2/leaderboards   ?category=rating|adr|kd|hs|opening|clutch|kast&tournament=<id>&days=<n>&limit=<n>
 *
 * Each category has its own qualification (a player needs enough maps and
 * rounds, and enough of what the category is about: kills for headshots,
 * opening duels, clutches), so a lucky single map does not top it. Ties
 * share a rank ("1, 2, 2, 4"); within a tie the player with more rounds is
 * listed first.
 */

import { Router, type Request, type Response } from 'express';
import { db } from '../../../config/database';
import { log } from '../../../utils/logger';
import { atRating, RATING_SUMS } from '../rating';

const router = Router();

export const CATEGORIES = ['rating', 'adr', 'kd', 'hs', 'opening', 'clutch', 'kast'] as const;
export type Category = (typeof CATEGORIES)[number];

/** At least this many maps and rounds for any category. */
export const MIN_MAPS = 3;
export const MIN_ROUNDS = 40;

interface Totals {
  player_id: string;
  name: string | null;
  avatar_url: string | null;
  maps: number;
  rounds_played: number;
  kills: number;
  deaths: number;
  assists: number;
  damage: number;
  kast_rounds: number;
  headshot_kills: number;
  entry_kills: number;
  entry_deaths: number;
  clutches_won: number;
  clutches_played: number;
}

/** The category's value for a player (higher is better), or null when they do not qualify for it. */
export function categoryValue(c: Category, t: Totals): { value: number; sample: number } | null {
  const n = (v: unknown) => Number(v) || 0;
  const rounds = n(t.rounds_played);
  if (n(t.maps) < MIN_MAPS || rounds < MIN_ROUNDS) return null;
  const round2 = (v: number) => Math.round(v * 100) / 100;
  switch (c) {
    case 'rating': {
      const r = atRating(t);
      return r === null ? null : { value: r, sample: rounds };
    }
    case 'adr':
      return { value: Math.round((n(t.damage) / rounds) * 10) / 10, sample: rounds };
    case 'kd':
      return {
        value: round2(n(t.kills) / Math.max(1, n(t.deaths))),
        sample: n(t.kills) + n(t.deaths),
      };
    case 'hs':
      // At least 50 kills.
      return n(t.kills) < 50
        ? null
        : { value: Math.round((100 * n(t.headshot_kills)) / n(t.kills)), sample: n(t.kills) };
    case 'opening': {
      // The share of opening duels won; at least 10 duels.
      const duels = n(t.entry_kills) + n(t.entry_deaths);
      return duels < 10
        ? null
        : { value: Math.round((100 * n(t.entry_kills)) / duels), sample: duels };
    }
    case 'clutch':
      // The share of 1vX rounds won; at least 5 played.
      return n(t.clutches_played) < 5
        ? null
        : {
            value: Math.round((100 * n(t.clutches_won)) / n(t.clutches_played)),
            sample: n(t.clutches_played),
          };
    case 'kast':
      return { value: Math.round((100 * n(t.kast_rounds)) / rounds), sample: rounds };
  }
}

/** Competition ranking: equal values share a rank, the next rank skips ("1, 2, 2, 4"). */
export function rank<T extends { value: number }>(rows: T[]): Array<T & { rank: number }> {
  let last: number | null = null;
  let lastRank = 0;
  return rows.map((r, i) => {
    if (r.value !== last) {
      lastRank = i + 1;
      last = r.value;
    }
    return { ...r, rank: lastRank };
  });
}

router.get('/leaderboards', async (req: Request, res: Response) => {
  const category = (CATEGORIES as readonly string[]).includes(String(req.query.category))
    ? (req.query.category as Category)
    : 'rating';
  const tournament = Number(req.query.tournament);
  const days = Number(req.query.days);
  const limit = Math.max(1, Math.min(100, Number(req.query.limit) || 50));
  try {
    const where: string[] = [`s.player_id ~ '^[0-9]{15,20}$'`];
    const args: unknown[] = [];
    if (Number.isInteger(tournament) && tournament > 0) {
      where.push('m.tournament_id = ?');
      args.push(tournament);
    }
    if (Number.isInteger(days) && days > 0) {
      where.push('s.created_at > EXTRACT(EPOCH FROM NOW())::INTEGER - ?');
      args.push(days * 86400);
    }
    const rows = await db.queryAsync<Totals>(
      `SELECT s.player_id, p.name, p.avatar_url, COUNT(*)::int AS maps, ${RATING_SUMS},
              SUM(s.headshot_kills) AS headshot_kills, SUM(s.entry_kills) AS entry_kills,
              SUM(s.entry_deaths) AS entry_deaths, SUM(s.clutches_won) AS clutches_won,
              SUM(s.clutches_played) AS clutches_played
         FROM cs2_player_map_stats s
         LEFT JOIN players p ON p.id = s.player_id
         LEFT JOIN matches m ON m.slug = s.match_slug
        WHERE ${where.join(' AND ')}
        GROUP BY s.player_id, p.name, p.avatar_url`,
      args
    );
    const scored = rows
      .flatMap((r) => {
        const v = categoryValue(category, r);
        return v
          ? [
              {
                playerId: r.player_id,
                name: r.name ?? r.player_id,
                avatarUrl: r.avatar_url,
                maps: Number(r.maps),
                rounds: Number(r.rounds_played),
                value: v.value,
                sample: v.sample,
              },
            ]
          : [];
      })
      .sort((a, b) => b.value - a.value || b.rounds - a.rounds || a.name.localeCompare(b.name));
    return res.json({
      success: true,
      category,
      minMaps: MIN_MAPS,
      minRounds: MIN_ROUNDS,
      players: rank(scored).slice(0, limit),
      qualified: scored.length,
    });
  } catch (error) {
    log.error('[LEADERBOARDS] failed', { error, category });
    return res.status(500).json({ success: false, error: 'Could not read the leaderboard' });
  }
});

export default router;
