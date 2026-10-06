/**
 * GET /api/game/cs2/teams/:teamId/profile
 *
 * The CS2 part of a team's page (`teamProfileView`): how the team did on
 * each map, from the map results of its CS2 matches, and which maps it bans
 * and picks most in the veto. Public, like the rest of the team page.
 */

import { Router, Request, Response } from 'express';
import { db } from '../../../config/database';
import { log } from '../../../utils/logger';

const router = Router();

const num = (v: number | string | null | undefined): number => {
  const n = typeof v === 'string' ? Number(v) : (v ?? 0);
  return Number.isFinite(n) ? (n as number) : 0;
};

interface VetoActionRow {
  team?: string;
  action?: string;
  mapName?: string;
}

router.get('/teams/:teamId/profile', async (req: Request, res: Response) => {
  const { teamId } = req.params;
  try {
    const maps = await db.queryAsync<{
      map_name: string;
      played: number | string;
      won: number | string;
      rounds_won: number | string | null;
      rounds_lost: number | string | null;
    }>(
      `SELECT r.map_name,
              COUNT(*) AS played,
              SUM(CASE WHEN (r.winner_team = 'team1' AND m.team1_id = ?) OR (r.winner_team = 'team2' AND m.team2_id = ?) THEN 1 ELSE 0 END) AS won,
              SUM(CASE WHEN m.team1_id = ? THEN r.team1_score ELSE r.team2_score END) AS rounds_won,
              SUM(CASE WHEN m.team1_id = ? THEN r.team2_score ELSE r.team1_score END) AS rounds_lost
         FROM match_map_results r JOIN matches m ON m.slug = r.match_slug
        WHERE (m.team1_id = ? OR m.team2_id = ?) AND (m.game IS NULL OR m.game = 'cs2')
          AND r.map_name IS NOT NULL AND r.map_name <> '' AND r.winner_team IS NOT NULL
        GROUP BY r.map_name
        ORDER BY played DESC, r.map_name`,
      [teamId, teamId, teamId, teamId, teamId, teamId]
    );

    // The veto record says "team1" / "team2"; the match says which is us.
    const vetoes = await db.queryAsync<{ team1_id: string | null; veto_state: string }>(
      `SELECT team1_id, veto_state FROM matches
        WHERE (team1_id = ? OR team2_id = ?) AND veto_state IS NOT NULL AND (game IS NULL OR game = 'cs2')`,
      [teamId, teamId]
    );
    const bans = new Map<string, number>();
    const picks = new Map<string, number>();
    let vetoCount = 0;
    for (const v of vetoes) {
      let actions: VetoActionRow[] = [];
      try {
        const state = JSON.parse(v.veto_state) as { actions?: VetoActionRow[] };
        actions = Array.isArray(state.actions) ? state.actions : [];
      } catch {
        continue;
      }
      const ours = v.team1_id === teamId ? 'team1' : 'team2';
      let counted = false;
      for (const a of actions) {
        if (a.team !== ours || !a.mapName) continue;
        const into = a.action === 'ban' ? bans : a.action === 'pick' ? picks : null;
        if (!into) continue;
        into.set(a.mapName, (into.get(a.mapName) ?? 0) + 1);
        counted = true;
      }
      if (counted) vetoCount++;
    }
    const most = (m: Map<string, number>) => {
      const top = [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
      return top ? { map: top[0], count: top[1] } : null;
    };

    return res.json({
      success: true,
      maps: maps.map((r) => ({
        map: r.map_name,
        played: num(r.played),
        won: num(r.won),
        roundsWon: num(r.rounds_won),
        roundsLost: num(r.rounds_lost),
      })),
      veto: { count: vetoCount, mostBanned: most(bans), mostPicked: most(picks) },
    });
  } catch (error) {
    log.error('[Cs2TeamProfile] Failed to read the team stats', { error, teamId });
    return res.status(500).json({ success: false, error: 'Failed to read the team stats' });
  }
});

export default router;
