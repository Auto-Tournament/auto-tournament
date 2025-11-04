import { Router, Request, Response } from 'express';
import { db } from '../config/database';
import { serverStatusService } from '../services/serverStatusService';
import type { DbMatchRow } from '../types/database.types';

const router = Router();

/**
 * GET /team/:teamId/match
 * Get current or next match for a team (public, no auth required)
 * This is for teams to view their match info and connect to servers
 */
router.get('/:teamId/match', async (req: Request, res: Response) => {
  try {
    const { teamId } = req.params;

    console.log(`[TeamMatch] Looking for matches for team: ${teamId}`);

    // Check if team exists
    const team = db.queryOne<{ id: string; name: string; tag: string }>(
      'SELECT id, name, tag FROM teams WHERE id = ?',
      [teamId]
    );

    if (!team) {
      console.log(`[TeamMatch] Team not found: ${teamId}`);
      return res.status(404).json({
        success: false,
        error: 'Team not found',
      });
    }

    console.log(`[TeamMatch] Team found: ${team.name}`);

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

    if (match) {
      console.log(`[TeamMatch] Found active match: ${match.slug} (status: ${match.status})`);
    }

    // If no active match, find next pending/ready match
    if (!match) {
      console.log(`[TeamMatch] No active match, looking for pending/ready matches...`);
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

      if (match) {
        console.log(
          `[TeamMatch] Found pending/ready match: ${match.slug} (status: ${match.status})`
        );
      }
    }

    // Check all matches for this team for debugging
    const allMatches = db.query<DbMatchRow>(
      `SELECT slug, status, round, match_number FROM matches 
       WHERE team1_id = ? OR team2_id = ?
       ORDER BY round, match_number`,
      [teamId, teamId]
    );
    console.log(
      `[TeamMatch] All matches for team ${team.name}:`,
      allMatches.map((m) => `${m.slug} (${m.status})`).join(', ') || 'none'
    );

    if (!match) {
      console.log(`[TeamMatch] No matches found for team ${team.name}`);
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

    console.log(
      `[TeamMatch] Returning match ${match.slug} for team ${team.name} (opponent: ${
        opponent.name || 'TBD'
      }, server: ${match.server_name || 'not assigned'})`
    );

    // Get match config for map pool
    const config = match.config ? JSON.parse(match.config) : {};

    // Note: We're NOT exposing RCON password to teams
    // CS2 servers typically don't have a join password by default
    // If you want to add join passwords, add a separate field to servers table
    const serverPassword = null;

    // Get real server status from the server itself
    let realServerStatus = null;
    let serverStatusDescription = null;
    if (match.server_id) {
      const statusInfo = await serverStatusService.getServerStatus(match.server_id);
      if (statusInfo.online && statusInfo.status) {
        realServerStatus = statusInfo.status;
        serverStatusDescription = serverStatusService.getStatusDescription(statusInfo.status);
      }
    }

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
              status: realServerStatus,
              statusDescription: serverStatusDescription,
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
