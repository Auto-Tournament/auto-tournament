import { Router, Request, Response } from 'express';
import { db } from '../config/database';
import type { DbMatchRow } from '../types/database.types';

const router = Router();

/**
 * GET /team/:teamId/match
 * Get current or next match for a team (public, no auth required)
 * This is for teams to view their match info and connect to servers
 */
router.get('/:teamId/match', (req: Request, res: Response) => {
  try {
    const { teamId } = req.params;

    // Check if team exists
    const team = db.queryOne<{ id: string; name: string; tag: string }>(
      'SELECT id, name, tag FROM teams WHERE id = ?',
      [teamId]
    );

    if (!team) {
      return res.status(404).json({
        success: false,
        error: 'Team not found',
      });
    }

    // Find active match (loaded or live)
    let match = db.queryOne<
      DbMatchRow & {
        team1_name?: string;
        team1_tag?: string;
        team2_name?: string;
        team2_tag?: string;
        server_name?: string;
        server_host?: string;
        server_port?: number;
      }
    >(
      `SELECT 
        m.*,
        t1.name as team1_name, t1.tag as team1_tag,
        t2.name as team2_name, t2.tag as team2_tag,
        s.name as server_name, s.host as server_host, s.port as server_port
      FROM matches m
      LEFT JOIN teams t1 ON m.team1_id = t1.id
      LEFT JOIN teams t2 ON m.team2_id = t2.id
      LEFT JOIN servers s ON m.server_id = s.id
      WHERE (m.team1_id = ? OR m.team2_id = ?)
        AND m.status IN ('loaded', 'live')
      ORDER BY m.loaded_at DESC
      LIMIT 1`,
      [teamId, teamId]
    );

    // If no active match, find next pending/ready match
    if (!match) {
      match = db.queryOne<
        DbMatchRow & {
          team1_name?: string;
          team1_tag?: string;
          team2_name?: string;
          team2_tag?: string;
          server_name?: string;
          server_host?: string;
          server_port?: number;
        }
      >(
        `SELECT 
          m.*,
          t1.name as team1_name, t1.tag as team1_tag,
          t2.name as team2_name, t2.tag as team2_tag,
          s.name as server_name, s.host as server_host, s.port as server_port
        FROM matches m
        LEFT JOIN teams t1 ON m.team1_id = t1.id
        LEFT JOIN teams t2 ON m.team2_id = t2.id
        LEFT JOIN servers s ON m.server_id = s.id
        WHERE (m.team1_id = ? OR m.team2_id = ?)
          AND m.status IN ('pending', 'ready')
        ORDER BY m.round ASC, m.match_number ASC
        LIMIT 1`,
        [teamId, teamId]
      );
    }

    if (!match) {
      return res.json({
        success: true,
        team: {
          id: team.id,
          name: team.name,
          tag: team.tag,
        },
        hasMatch: false,
        message: 'No upcoming matches found',
      });
    }

    // Determine if this team is team1 or team2
    const isTeam1 = match.team1_id === teamId;
    const opponent = isTeam1
      ? { id: match.team2_id, name: match.team2_name, tag: match.team2_tag }
      : { id: match.team1_id, name: match.team1_name, tag: match.team1_tag };

    // Get match config for map pool
    const config = match.config ? JSON.parse(match.config) : {};

    // Note: We're NOT exposing RCON password to teams
    // CS2 servers typically don't have a join password by default
    // If you want to add join passwords, add a separate field to servers table
    const serverPassword = null;

    return res.json({
      success: true,
      team: {
        id: team.id,
        name: team.name,
        tag: team.tag,
      },
      hasMatch: true,
      match: {
        slug: match.slug,
        round: match.round,
        matchNumber: match.match_number,
        status: match.status,
        isTeam1,
        opponent: opponent.id
          ? {
              id: opponent.id,
              name: opponent.name,
              tag: opponent.tag,
            }
          : null,
        server: match.server_id
          ? {
              id: match.server_id,
              name: match.server_name,
              host: match.server_host,
              port: match.server_port,
              password: serverPassword,
            }
          : null,
        maps: config.maplist || [],
        matchFormat: config.num_maps ? `BO${config.num_maps}` : 'BO3',
        loadedAt: match.loaded_at,
      },
    });
  } catch (error) {
    console.error('Error fetching team match:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch team match',
    });
  }
});

export default router;

