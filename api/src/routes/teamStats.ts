import { Router, Request, Response } from 'express';
import { db } from '../config/database';
import type { DbMatchRow, DbEventRow } from '../types/database.types';
import { computeTeamStanding, globalMatchNumbers, type TeamStanding } from '../utils/teamPage';
import { matchBracketOf } from '../utils/allocationQueue';
import { getSwissStandingEntries } from '../services/swissProgressionService';

const router = Router();

/**
 * GET /team/:teamId/history
 * Get match history for a team (public, no auth required)
 */
router.get('/:teamId/history', async (req: Request, res: Response) => {
  try {
    const { teamId } = req.params;
    const limit = req.query.limit ? parseInt(req.query.limit as string) : 10;

    // Check if team exists
    const team = await db.queryOneAsync<{ id: string; name: string; tag: string }>(
      'SELECT id, name, tag FROM teams WHERE id = ?',
      [teamId]
    );

    if (!team) {
      return res.status(404).json({
        success: false,
        error: 'Team not found',
      });
    }

    // Get match history (completed matches)
    const matches = await db.queryAsync<
      DbMatchRow & {
        team1_name?: string;
        team1_tag?: string;
        team2_name?: string;
        team2_tag?: string;
      }
    >(
      `SELECT 
        m.*,
        t1.name as team1_name, t1.tag as team1_tag,
        t2.name as team2_name, t2.tag as team2_tag
      FROM matches m
      LEFT JOIN teams t1 ON m.team1_id = t1.id
      LEFT JOIN teams t2 ON m.team2_id = t2.id
      WHERE (m.team1_id = ? OR m.team2_id = ?)
        AND m.status = 'completed'
      ORDER BY m.completed_at DESC
      LIMIT ?`,
      [teamId, teamId, limit]
    );

    // Number matches the way the matches page does, not by per-round number.
    const orderRows = await db.queryAsync<{
      id: number;
      slug: string;
      round: number;
      match_number: number;
      bracket: string | null;
    }>('SELECT id, slug, round, match_number, bracket FROM matches');
    const numbers = globalMatchNumbers(orderRows);

    const history = await Promise.all(matches.map(async (match) => {
      const isTeam1 = match.team1_id === teamId;
      const opponent = isTeam1
        ? { id: match.team2_id, name: match.team2_name, tag: match.team2_tag }
        : { id: match.team1_id, name: match.team1_name, tag: match.team1_tag };

      const won = match.winner_id === teamId;

      // Get scores from latest series_end event
      const scoreEvent = await db.queryOneAsync<DbEventRow>(
        `SELECT event_data FROM match_events 
         WHERE match_slug = ? AND event_type = 'series_end' 
         ORDER BY received_at DESC, id DESC LIMIT 1`,
        [match.slug]
      );

      let teamScore = 0;
      let opponentScore = 0;

      if (scoreEvent) {
        try {
          const eventData = JSON.parse(scoreEvent.event_data);
          const team1Score = eventData.team1_series_score || 0;
          const team2Score = eventData.team2_series_score || 0;
          
          if (isTeam1) {
            teamScore = team1Score;
            opponentScore = team2Score;
          } else {
            teamScore = team2Score;
            opponentScore = team1Score;
          }
        } catch {
          // Ignore parse errors
        }
      }

      return {
        slug: match.slug,
        round: match.round,
        matchNumber: match.match_number,
        globalMatchNumber: numbers.get(match.slug) ?? match.match_number,
        bracket: matchBracketOf(match),
        opponent: opponent.id ? { id: opponent.id, name: opponent.name, tag: opponent.tag } : null,
        won,
        teamScore,
        opponentScore,
        completedAt: match.completed_at,
      };
    }));

    return res.json({
      success: true,
      team: {
        id: team.id,
        name: team.name,
        tag: team.tag,
      },
      matches: history,
      total: history.length,
    });
  } catch (error) {
    console.error('Error fetching team history:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch team history',
    });
  }
});

/**
 * GET /team/:teamId/stats
 * Get performance statistics for a team (public, no auth required)
 */
router.get('/:teamId/stats', async (req: Request, res: Response) => {
  try {
    const { teamId } = req.params;

    // Check if team exists
    const team = await db.queryOneAsync<{ id: string; name: string; tag: string }>(
      'SELECT id, name, tag FROM teams WHERE id = ?',
      [teamId]
    );

    if (!team) {
      return res.status(404).json({
        success: false,
        error: 'Team not found',
      });
    }

    // Get all completed matches
    const totalMatchesResult = await db.queryOneAsync<{ count: number }>(
      `SELECT COUNT(*) as count FROM matches 
       WHERE (team1_id = ? OR team2_id = ?) AND status = 'completed'`,
      [teamId, teamId]
    );
    const totalMatches = totalMatchesResult?.count || 0;

    // Get wins
    const winsResult = await db.queryOneAsync<{ count: number }>(
      `SELECT COUNT(*) as count FROM matches 
       WHERE winner_id = ? AND status = 'completed'`,
      [teamId]
    );
    const wins = winsResult?.count || 0;

    // Get losses (completed matches where they didn't win)
    const losses = totalMatches - wins;

    // Win rate
    const winRate = totalMatches > 0 ? (wins / totalMatches) * 100 : 0;

    // Get current tournament standing (if tournament exists)
    const tournament = await db.queryOneAsync<{
      id: number;
      name: string;
      status: string;
      type: string;
      team_ids: string;
    }>('SELECT id, name, status, type, team_ids FROM tournament WHERE id = 1');

    // Rank among this tournament's teams only; counting every team in the
    // database gave "#6 of 9" in an 8-team event.
    let standing: TeamStanding | null = null;
    if (tournament && tournament.status !== 'setup') {
      let teamIds: string[] = [];
      try {
        const parsed: unknown = JSON.parse(tournament.team_ids || '[]');
        if (Array.isArray(parsed)) teamIds = parsed.map(String);
      } catch {
        // Malformed team_ids: fall back to the teams in the matches below.
      }
      if (teamIds.length === 0) {
        // Shuffle tournaments have no fixed team list: use the teams that played.
        const rows = await db.queryAsync<{ team_id: string }>(
          `SELECT team1_id as team_id FROM matches WHERE tournament_id = 1 AND team1_id IS NOT NULL
           UNION SELECT team2_id as team_id FROM matches WHERE tournament_id = 1 AND team2_id IS NOT NULL`
        );
        teamIds = rows.map((r) => r.team_id);
      }
      const winRows = await db.queryAsync<{ winner_id: string; wins: number }>(
        `SELECT winner_id, COUNT(*) as wins FROM matches
         WHERE status = 'completed' AND tournament_id = 1 AND winner_id IS NOT NULL
         GROUP BY winner_id`
      );
      const winsByTeam = new Map(winRows.map((r) => [r.winner_id, Number(r.wins)]));
      const swissOrder =
        tournament.type === 'swiss' ? await getSwissStandingEntries(tournament.id) : null;
      standing = computeTeamStanding(teamId, teamIds, winsByTeam, swissOrder);
    }

    return res.json({
      success: true,
      team: {
        id: team.id,
        name: team.name,
        tag: team.tag,
      },
      stats: {
        totalMatches,
        wins,
        losses,
        winRate: Math.round(winRate),
      },
      standing,
      tournament: tournament
        ? {
            name: tournament.name,
            status: tournament.status,
          }
        : null,
    });
  } catch (error) {
    console.error('Error fetching team stats:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch team stats',
    });
  }
});

export default router;

