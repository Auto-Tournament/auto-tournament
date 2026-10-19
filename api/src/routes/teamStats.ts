import type { Request, Response } from 'express';
import { Router } from 'express';
import { db } from '../config/database';
import { mapWinnerOf } from '../utils/matchEnrichment';
import type { DbMatchRow } from '../types/database.types';
import { computeTeamStanding, globalMatchNumbers, type TeamStanding } from '../utils/teamPage';
import { matchBracketOf } from '../core/allocationQueue';
import { resolveTournamentId } from '../utils/tournamentRow';
import { getSwissStandingEntries } from '../services/swissProgressionService';
import { gameDisplayName } from '../utils/gameDisplayName';
import { DEFAULT_GAME } from '../integrations/types';
import type { Untrusted } from '../utils/untrusted';

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
    // The maps each series was played on, in order.
    const slugs = matches.map((m) => m.slug);
    const mapsBySlug = new Map<string, string[]>();
    if (slugs.length) {
      const mapRows = await db.queryAsync<{ match_slug: string; map_name: string | null }>(
        'SELECT match_slug, map_name FROM match_map_results WHERE match_slug = ANY(?::text[]) ORDER BY match_slug, map_number',
        [slugs]
      );
      for (const r of mapRows) {
        if (!r.map_name) continue;
        mapsBySlug.set(r.match_slug, [...(mapsBySlug.get(r.match_slug) ?? []), r.map_name]);
      }
    }

    const history = await Promise.all(
      matches.map(async (match) => {
        const isTeam1 = match.team1_id === teamId;
        const opponent = isTeam1
          ? { id: match.team2_id, name: match.team2_name, tag: match.team2_tag }
          : { id: match.team1_id, name: match.team1_name, tag: match.team1_tag };

        const won = match.winner_id === teamId;

        // The series score: the maps' recorded winners.
        const mapRows = await db.queryAsync<{
          team1_score: number;
          team2_score: number;
          winner_team: string | null;
        }>(
          'SELECT team1_score, team2_score, winner_team FROM match_map_results WHERE match_slug = ?',
          [match.slug]
        );
        let team1Score = 0;
        let team2Score = 0;
        for (const row of mapRows) {
          const side = mapWinnerOf(row);
          if (side === 'team1') team1Score += 1;
          else if (side === 'team2') team2Score += 1;
        }
        const teamScore = isTeam1 ? team1Score : team2Score;
        const opponentScore = isTeam1 ? team2Score : team1Score;

        return {
          slug: match.slug,
          round: match.round,
          matchNumber: match.match_number,
          globalMatchNumber: numbers.get(match.slug) ?? match.match_number,
          bracket: matchBracketOf(match),
          opponent: opponent.id
            ? { id: opponent.id, name: opponent.name, tag: opponent.tag }
            : null,
          won,
          teamScore,
          opponentScore,
          completedAt: match.completed_at,
          maps: (mapsBySlug.get(match.slug) ?? []).filter(Boolean),
        };
      })
    );

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
    const tournamentId = resolveTournamentId(req);
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
      game: string | null;
    }>('SELECT id, name, status, type, team_ids, game FROM tournament WHERE id = ?', [
      tournamentId,
    ]);

    // Rank among this tournament's teams only; counting every team in the
    // database gave "#6 of 9" in an 8-team event.
    let standing: TeamStanding | null = null;
    if (tournament && tournament.status !== 'setup') {
      let teamIds: string[] = [];
      try {
        const parsed: Untrusted = JSON.parse(tournament.team_ids || '[]');
        if (Array.isArray(parsed)) teamIds = parsed.map(String);
      } catch {
        // Malformed team_ids: fall back to the teams in the matches below.
      }
      if (teamIds.length === 0) {
        // Shuffle tournaments have no fixed team list: use the teams that played.
        const rows = await db.queryAsync<{ team_id: string }>(
          `SELECT team1_id as team_id FROM matches WHERE tournament_id = ? AND team1_id IS NOT NULL
           UNION SELECT team2_id as team_id FROM matches WHERE tournament_id = ? AND team2_id IS NOT NULL`,
          [tournament.id, tournament.id]
        );
        teamIds = rows.map((r) => r.team_id);
      }
      const winRows = await db.queryAsync<{ winner_id: string; wins: number }>(
        `SELECT winner_id, COUNT(*) as wins FROM matches
         WHERE status = 'completed' AND tournament_id = ? AND winner_id IS NOT NULL
         GROUP BY winner_id`,
        [tournament.id]
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
            id: tournament.id,
            name: tournament.name,
            status: tournament.status,
            // The game, for the team page's game badge and its rows.
            game: tournament.game ?? DEFAULT_GAME,
            gameName: await gameDisplayName(tournament.game ?? DEFAULT_GAME),
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
