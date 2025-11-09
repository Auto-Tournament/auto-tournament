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

    // Check if team exists and get players
    const team = db.queryOne<{ id: string; name: string; tag: string; players: string }>(
      'SELECT id, name, tag, players FROM teams WHERE id = ?',
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

    // Parse players JSON
    let parsedPlayers: Array<{ steamId: string; name: string }> = [];
    if (team.players) {
      try {
        const playersObj = JSON.parse(team.players);
        // Convert {index: {name, steamId}} to [{steamId, name}]
        parsedPlayers = Object.values(playersObj).map((playerData: unknown) => {
          if (typeof playerData === 'string') {
            // Old format: {steamId: name}
            return { steamId: 'unknown', name: playerData };
          }
          // New format: {index: {name, steamId}}
          if (
            playerData &&
            typeof playerData === 'object' &&
            'steamId' in playerData &&
            'name' in playerData
          ) {
            const player = playerData as { steamId?: string; name?: string };
            return {
              steamId: player.steamId || 'unknown',
              name: player.name || 'Unknown',
            };
          }
          return { steamId: 'unknown', name: 'Unknown' };
        });
      } catch (err) {
        console.error('[TeamMatch] Failed to parse players JSON:', err);
      }
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
          players: parsedPlayers,
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

    // Get veto state to determine actual picked maps
    let pickedMaps: string[] = [];
    if (match.veto_state) {
      try {
        const vetoState = JSON.parse(match.veto_state);
        if (vetoState?.status === 'completed' && Array.isArray(vetoState.pickedMaps)) {
          pickedMaps = vetoState.pickedMaps
            .sort(
              (a: { mapNumber?: number }, b: { mapNumber?: number }) =>
                (a.mapNumber || 0) - (b.mapNumber || 0)
            )
            .map((m: { mapName: string }) => m.mapName);
        }
      } catch (e) {
        console.error('[TeamMatch] Failed to parse veto_state:', e);
      }
    }

    // Transform players from dictionary to array for frontend
    const transformPlayers = (players: Record<string, unknown> | undefined) => {
      if (!players) return [];
      return Object.values(players).map((playerData: unknown) => {
        if (typeof playerData === 'string') {
          // Old format: {steamId: name}
          return { steamid: 'unknown', name: playerData };
        }
        // New format: {index: {name, steamId}}
        if (
          playerData &&
          typeof playerData === 'object' &&
          'steamId' in playerData &&
          'name' in playerData
        ) {
          const player = playerData as { steamId?: string; name?: string };
          return {
            steamid: player.steamId || 'unknown',
            name: player.name || 'Unknown',
          };
        }
        return { steamid: 'unknown', name: 'Unknown' };
      });
    };

    // Get tournament status
    const tournament = db.queryOne<{ status: string }>(
      'SELECT status FROM tournament WHERE id = ?',
      [match.tournament_id]
    );

    // Note: We're NOT exposing RCON password to teams
    // CS2 servers typically don't have a join password by default
    // If you want to add join passwords, add a separate field to servers table
    const serverPassword = null;

    // Get real-time server status from custom plugin ConVars (with 2s timeout)
    // The CS2 plugin manages these ConVars; we just query them for real-time status
    let realServerStatus = null;
    let serverStatusDescription = null;
    if (match.server_id) {
      try {
        // 2 second timeout - fail fast if server is unreachable or ConVars don't exist yet
        const statusInfo = await Promise.race([
          serverStatusService.getServerStatus(match.server_id),
          new Promise<{ status: null; matchSlug: null; updatedAt: null; online: false }>(
            (resolve) =>
              setTimeout(
                () => resolve({ status: null, matchSlug: null, updatedAt: null, online: false }),
                2000
              )
          ),
        ]);

        if (statusInfo.online && statusInfo.status) {
          realServerStatus = statusInfo.status;
          serverStatusDescription = serverStatusService.getStatusDescription(statusInfo.status);
        }
      } catch (error) {
        // Silently fail - server status is nice-to-have, not critical
        console.debug(
          '[TeamMatch] Server status check failed (plugin ConVars may not exist yet):',
          error
        );
      }
    }

    return res.json({
      success: true,
      team: {
        id: team.id,
        name: team.name,
        tag: team.tag,
        players: parsedPlayers,
      },
      hasMatch: true,
      tournamentStatus: tournament?.status || 'setup',
      match: {
        slug: match.slug,
        round: match.round,
        matchNumber: match.match_number,
        status: match.status,
        isTeam1,
        team1: isTeam1
          ? { id: team.id, name: team.name, tag: team.tag }
          : opponent.id
          ? { id: opponent.id, name: opponent.name, tag: opponent.tag }
          : null,
        team2: !isTeam1
          ? { id: team.id, name: team.name, tag: team.tag }
          : opponent.id
          ? { id: opponent.id, name: opponent.name, tag: opponent.tag }
          : null,
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
        maps: pickedMaps.length > 0 ? pickedMaps : [], // Only show picked maps from veto
        matchFormat: config.num_maps ? `BO${config.num_maps}` : 'BO3',
        loadedAt: match.loaded_at,
        config: {
          maplist: config.maplist,
          num_maps: config.num_maps,
          players_per_team: config.players_per_team,
          expected_players_total: config.players_per_team ? config.players_per_team * 2 : 10,
          expected_players_team1: config.players_per_team || 5,
          expected_players_team2: config.players_per_team || 5,
          team1: config.team1
            ? {
                id: config.team1.id,
                name: config.team1.name,
                tag: config.team1.tag,
                flag: config.team1.flag,
                players: transformPlayers(config.team1.players),
              }
            : undefined,
          team2: config.team2
            ? {
                id: config.team2.id,
                name: config.team2.name,
                tag: config.team2.tag,
                flag: config.team2.flag,
                players: transformPlayers(config.team2.players),
              }
            : undefined,
        },
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
