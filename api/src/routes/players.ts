/**
 * Players API Routes
 * Handles player CRUD operations and bulk import
 */

import { Router, Request, Response } from 'express';
import {
  playerService,
  type CreatePlayerInput,
  type UpdatePlayerInput,
} from '../services/playerService';
import { getRatingHistory } from '../services/ratingService';
import { steamService } from '../services/steamService';
import { requireAuth } from '../middleware/auth';
import { log } from '../utils/logger';
import { db } from '../config/database';
import { serverStatusService } from '../services/serverStatusService';
import { playerConnectionService } from '../services/playerConnectionService';
import { refreshConnectionsFromServer } from '../services/connectionSnapshotService';
import { normalizeConfigPlayers } from '../utils/playerTransform';
import { teamService } from '../services/teamService';
import { matchLiveStatsService, type MatchLiveStats } from '../services/matchLiveStatsService';
import type { DbMatchRow } from '../types/database.types';
import { getMapResults } from '../services/matchMapResultService';

const router = Router();

// ============================================================================
// PUBLIC ROUTES (no authentication required)
// ============================================================================

/**
 * GET /api/players/find
 * Find player by Steam URL or Steam ID (public)
 * NOTE: This route must come before /:playerId to avoid route conflicts
 */
router.get('/find', async (req: Request, res: Response) => {
  try {
    const { query, steamId } = req.query;

    // Support both 'query' and 'steamId' parameters for backward compatibility
    const searchQuery = (query || steamId) as string;

    if (!searchQuery || typeof searchQuery !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Missing query or steamId parameter',
      });
    }

    // Extract Steam ID from various formats
    let resolvedSteamId: string | null = null;

    // Direct Steam ID (64-bit)
    if (/^7656\d{13}$/.test(searchQuery)) {
      resolvedSteamId = searchQuery;
    }
    // Steam profile URL
    else if (searchQuery.includes('steamcommunity.com')) {
      // Extract from URL: https://steamcommunity.com/profiles/76561198012345678
      const profileMatch = searchQuery.match(/\/profiles\/(\d+)/);
      if (profileMatch) {
        resolvedSteamId = profileMatch[1];
      }
      // Extract from vanity URL: https://steamcommunity.com/id/username
      // Try to resolve via Steam API if available
      else if (searchQuery.includes('/id/')) {
        try {
          if (await steamService.isAvailable()) {
            const resolvedId = await steamService.resolveSteamId(searchQuery);
            if (resolvedId) {
              resolvedSteamId = resolvedId;
            }
          } else {
            log.debug('Steam API not configured, cannot resolve vanity URL');
          }
        } catch (error) {
          log.debug(
            `Failed to resolve vanity URL: ${
              error instanceof Error ? error.message : String(error)
            }`
          );
        }
      }
    }
    // Try to resolve as vanity URL/ID if Steam API is available
    else if (await steamService.isAvailable()) {
      try {
        const resolvedId = await steamService.resolveSteamId(searchQuery);
        if (resolvedId) {
          resolvedSteamId = resolvedId;
        }
      } catch (error) {
        log.debug(
          `Failed to resolve Steam input: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    if (resolvedSteamId) {
      const player = await playerService.getPlayerById(resolvedSteamId);
      if (player) {
        return res.json({
          success: true,
          players: [player],
        });
      }
    }

    // Fallback: search by name
    const players = await playerService.searchPlayers(searchQuery, 10);
    if (players.length === 1) {
      return res.json({
        success: true,
        players: [players[0]],
      });
    } else if (players.length > 1) {
      return res.json({
        success: true,
        players, // Return multiple results
        message: 'Multiple players found',
      });
    }

    return res.status(404).json({
      success: false,
      error: 'Player not found',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    log.error('Error finding player', { error, query: req.query.query });
    return res.status(500).json({
      success: false,
      error: message,
    });
  }
});

/**
 * GET /api/players/public-selection
 * Lightweight player list for public selection/autocomplete (no auth required)
 */
router.get('/public-selection', async (_req: Request, res: Response) => {
  try {
    const players = await playerService.getAllPlayers();

    // Return only the fields needed for public selection/autocomplete
    const simplifiedPlayers = players.map((p) => ({
      id: p.id,
      name: p.name,
      avatar: p.avatar,
      currentElo: p.currentElo,
    }));

    return res.json({
      success: true,
      count: simplifiedPlayers.length,
      players: simplifiedPlayers,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    log.error('Error fetching public player selection list', { error });
    return res.status(500).json({
      success: false,
      error: message,
    });
  }
});

function normalizeLiveStatsForPlayerView(
  liveStats: MatchLiveStats,
  isTeam1: boolean
): MatchLiveStats {
  if (isTeam1) {
    return liveStats;
  }

  return {
    ...liveStats,
    team1Score: liveStats.team2Score,
    team2Score: liveStats.team1Score,
    team1SeriesScore: liveStats.team2SeriesScore,
    team2SeriesScore: liveStats.team1SeriesScore,
    playerStats: liveStats.playerStats
      ? {
          team1: [...liveStats.playerStats.team2],
          team2: [...liveStats.playerStats.team1],
        }
      : liveStats.playerStats,
  };
}

/**
 * GET /api/players/:playerId/current-match
 * Get the current or next match for a player (public)
 * This is primarily used for the public player page to show connect info
 */
router.get('/:playerId/current-match', async (req: Request, res: Response) => {
  try {
    const { playerId } = req.params;

    // Ensure player exists
    const player = await playerService.getPlayerById(playerId);
    if (!player) {
      return res.status(404).json({
        success: false,
        error: `Player '${playerId}' not found`,
      });
    }

    const likeParam = `%${playerId}%`;

    // First look for an active match (loaded or live)
    let match = await db.queryOneAsync<
      DbMatchRow & {
        team1_name?: string;
        team1_tag?: string;
        team1_players?: string | null;
        team2_name?: string;
        team2_tag?: string;
        team2_players?: string | null;
        server_name?: string;
        server_host?: string;
        server_port?: number;
      }
    >(
      `SELECT 
        m.*,
        t1.name as team1_name, t1.tag as team1_tag, t1.players as team1_players,
        t2.name as team2_name, t2.tag as team2_tag, t2.players as team2_players,
        s.name as server_name, s.host as server_host, s.port as server_port
      FROM matches m
      LEFT JOIN teams t1 ON m.team1_id = t1.id
      LEFT JOIN teams t2 ON m.team2_id = t2.id
      LEFT JOIN servers s ON m.server_id = s.id
      WHERE m.status IN ('loaded', 'live')
        AND ((t1.players LIKE ? ESCAPE '\\') OR (t2.players LIKE ? ESCAPE '\\'))
      ORDER BY m.loaded_at DESC
      LIMIT 1`,
      [likeParam, likeParam]
    );

    // If no active match, look for the next pending/ready match
    if (!match) {
      match = await db.queryOneAsync<
        DbMatchRow & {
          team1_name?: string;
          team1_tag?: string;
          team1_players?: string | null;
          team2_name?: string;
          team2_tag?: string;
          team2_players?: string | null;
          server_name?: string;
          server_host?: string;
          server_port?: number;
        }
      >(
        `SELECT 
          m.*,
          t1.name as team1_name, t1.tag as team1_tag, t1.players as team1_players,
          t2.name as team2_name, t2.tag as team2_tag, t2.players as team2_players,
          s.name as server_name, s.host as server_host, s.port as server_port
        FROM matches m
        LEFT JOIN teams t1 ON m.team1_id = t1.id
        LEFT JOIN teams t2 ON m.team2_id = t2.id
        LEFT JOIN servers s ON m.server_id = s.id
        WHERE m.status IN ('pending', 'ready')
          AND ((t1.players LIKE ? ESCAPE '\\') OR (t2.players LIKE ? ESCAPE '\\'))
        ORDER BY m.round ASC, m.match_number ASC
        LIMIT 1`,
        [likeParam, likeParam]
      );
    }

    if (!match) {
      return res.json({
        success: true,
        player: {
          id: player.id,
          name: player.name,
          avatar: (player as { avatar_url?: string }).avatar_url,
        },
        hasMatch: false,
        message: 'No upcoming matches found',
      });
    }

    // Determine if this player is on team1 or team2 based on config players
    const config = match.config ? JSON.parse(match.config as unknown as string) : {};

    const normalizedTeam1Players = config.team1
      ? normalizeConfigPlayers(config.team1.players)
      : [];
    const normalizedTeam2Players = config.team2
      ? normalizeConfigPlayers(config.team2.players)
      : [];

    const isPlayerInTeam1 = normalizedTeam1Players.some((p) => p.steamid === playerId);
    const isPlayerInTeam2 = normalizedTeam2Players.some((p) => p.steamid === playerId);

    let isTeam1: boolean;

    if (isPlayerInTeam1 && !isPlayerInTeam2) {
      isTeam1 = true;
    } else if (!isPlayerInTeam1 && isPlayerInTeam2) {
      isTeam1 = false;
    } else {
      // Fallback to team players JSON if config is ambiguous
      const team1PlayersStr = match.team1_players || '';
      const team2PlayersStr = match.team2_players || '';

      if (team1PlayersStr.includes(playerId) && !team2PlayersStr.includes(playerId)) {
        isTeam1 = true;
      } else if (!team1PlayersStr.includes(playerId) && team2PlayersStr.includes(playerId)) {
        isTeam1 = false;
      } else {
        // Default to team1 if we can't determine (should be extremely rare)
        isTeam1 = true;
      }
    }

    const playerTeam = isTeam1
      ? {
          id: match.team1_id,
          name: match.team1_name,
          tag: match.team1_tag,
        }
      : {
          id: match.team2_id,
          name: match.team2_name,
          tag: match.team2_tag,
        };

    const opponent = isTeam1
      ? { id: match.team2_id, name: match.team2_name, tag: match.team2_tag }
      : { id: match.team1_id, name: match.team1_name, tag: match.team1_tag };

    // Get veto state to determine actual picked maps
    let pickedMaps: string[] = [];
    let vetoSummary: {
      status: 'pending' | 'in_progress' | 'completed';
      team1Name?: string;
      team2Name?: string;
      pickedMaps: Array<{
        mapNumber?: number;
        mapName: string;
        pickedBy?: string;
        sideTeam1?: string;
        sideTeam2?: string;
        knifeRound?: boolean;
      }>;
      actions: Array<{
        step: number;
        team: 'team1' | 'team2';
        action: string;
        mapName?: string;
        side?: string;
        timestamp?: number;
      }>;
    } | null = null;

    if (match.veto_state) {
      try {
        const vetoState = JSON.parse(match.veto_state as unknown as string);
        if (vetoState) {
          const orderedPickedMaps = Array.isArray(vetoState.pickedMaps)
            ? [...vetoState.pickedMaps].sort(
                (a: { mapNumber?: number }, b: { mapNumber?: number }) =>
                  (a.mapNumber || 0) - (b.mapNumber || 0)
              )
            : [];

          pickedMaps = orderedPickedMaps.map((m: { mapName: string }) => m.mapName);

          vetoSummary = {
            status: vetoState.status || 'pending',
            team1Name: vetoState.team1Name || match.team1_name || 'Team 1',
            team2Name: vetoState.team2Name || match.team2_name || 'Team 2',
            pickedMaps: orderedPickedMaps,
            actions: Array.isArray(vetoState.actions)
              ? [...vetoState.actions].sort(
                  (a: { step?: number }, b: { step?: number }) => (a.step || 0) - (b.step || 0)
                )
              : [],
          };
        }
      } catch (e) {
        console.error('[PlayerMatch] Failed to parse veto_state:', e);
      }
    }

    // Get tournament status and format
    const tournament = await db.queryOneAsync<{ status: string; format: string }>(
      'SELECT status, format FROM tournament WHERE id = ?',
      [match.tournament_id]
    );

    // Note: We're NOT exposing RCON password to players
    const serverPassword = null;

    // Get real-time server status from custom plugin ConVars (with 2s timeout)
    let realServerStatus = null;
    let serverStatusDescription = null;
    if (match.server_id) {
      try {
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
          '[PlayerMatch] Server status check failed (plugin ConVars may not exist yet):',
          error
        );
      }
    }

    await refreshConnectionsFromServer(match.slug);
    const connectionStatus = playerConnectionService.getStatus(match.slug);
    const liveStats = matchLiveStatsService.getStats(match.slug);

    const normalizedLiveStats = liveStats
      ? normalizeLiveStatsForPlayerView(liveStats, isTeam1)
      : null;
    const rawMapResults = await getMapResults(match.slug);
    const normalizedMapResults = rawMapResults.map((result) => ({
      mapNumber: result.mapNumber,
      mapName: result.mapName,
      team1Score: isTeam1 ? result.team1Score : result.team2Score,
      team2Score: isTeam1 ? result.team2Score : result.team1Score,
      winner: isTeam1
        ? result.winnerTeam
        : result.winnerTeam === 'team1'
        ? 'team2'
        : result.winnerTeam === 'team2'
        ? 'team1'
        : result.winnerTeam,
      demoFilePath: result.demoFilePath,
      completedAt: result.completedAt,
    }));

    // Normalize and enrich config players with avatars from team data
    const enrichPlayers = async (
      normalizedPlayers: Array<{ steamid: string; name: string }>,
      teamId?: string
    ) => {
      if (!teamId) return normalizedPlayers;
      try {
        const teamData = await teamService.getTeamById(teamId);
        if (teamData?.players) {
          const avatarMap = new Map(teamData.players.map((p) => [p.steamId.toLowerCase(), p.avatar]));
          return normalizedPlayers.map((p) => ({
            ...p,
            avatar: avatarMap.get(p.steamid.toLowerCase()),
          }));
        }
      } catch (error) {
        console.debug('[PlayerMatch] Failed to enrich players with avatars:', error);
      }
      return normalizedPlayers;
    };

    const [enrichedTeam1Players, enrichedTeam2Players] = await Promise.all([
      enrichPlayers(normalizedTeam1Players, config.team1?.id),
      enrichPlayers(normalizedTeam2Players, config.team2?.id),
    ]);

    return res.json({
      success: true,
      player: {
        id: player.id,
        name: player.name,
        avatar: (player as { avatar_url?: string }).avatar_url,
      },
      hasMatch: true,
      tournamentStatus: tournament?.status || 'setup',
      match: {
        slug: match.slug,
        round: match.round,
        matchNumber: match.match_number,
        status: match.status,
        isTeam1,
        currentMap: match.current_map ?? null,
        mapNumber: match.map_number ?? null,
        team1: isTeam1
          ? playerTeam.id
            ? { id: playerTeam.id, name: playerTeam.name, tag: playerTeam.tag }
            : null
          : opponent.id
          ? { id: opponent.id, name: opponent.name, tag: opponent.tag }
          : null,
        team2: !isTeam1
          ? playerTeam.id
            ? { id: playerTeam.id, name: playerTeam.name, tag: playerTeam.tag }
            : null
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
        connectionStatus: connectionStatus
          ? {
              ...connectionStatus,
              connectedPlayers: connectionStatus.connectedPlayers.map((connectedPlayer) => ({
                steamId: connectedPlayer.steamId,
                name: connectedPlayer.name,
                team: connectedPlayer.team,
                connectedAt: connectedPlayer.connectedAt,
                isReady: connectedPlayer.isReady,
              })),
            }
          : null,
        liveStats: normalizedLiveStats,
        maps: pickedMaps.length > 0 ? pickedMaps : [],
        mapResults: normalizedMapResults,
        veto: vetoSummary,
        matchFormat: (tournament?.format as 'bo1' | 'bo3' | 'bo5') || 'bo3',
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
                players: enrichedTeam1Players,
              }
            : undefined,
          team2: config.team2
            ? {
                id: config.team2.id,
                name: config.team2.name,
                tag: config.team2.tag,
                flag: config.team2.flag,
                players: enrichedTeam2Players,
              }
            : undefined,
        },
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    log.error('Error fetching player current match', { error, playerId: req.params.playerId });
    return res.status(500).json({
      success: false,
      error: message,
    });
  }
});

/**
 * GET /api/players/:playerId
 * Get player details (public - no auth required for viewing)
 */
router.get('/:playerId', async (req: Request, res: Response) => {
  try {
    const { playerId } = req.params;
    const player = await playerService.getPlayerById(playerId);

    if (!player) {
      return res.status(404).json({
        success: false,
        error: `Player '${playerId}' not found`,
      });
    }

    return res.json({
      success: true,
      player,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    log.error('Error fetching player', { error, playerId: req.params.playerId });
    return res.status(500).json({
      success: false,
      error: message,
    });
  }
});

/**
 * GET /api/players/:playerId/rating-history
 * Get player rating history (public)
 */
router.get('/:playerId/rating-history', async (req: Request, res: Response) => {
  try {
    const { playerId } = req.params;
    const { tournamentId } = req.query;

    const history = await getRatingHistory(
      playerId,
      tournamentId ? parseInt(tournamentId as string, 10) : undefined
    );

    return res.json({
      success: true,
      history,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    log.error('Error fetching rating history', { error, playerId: req.params.playerId });
    return res.status(500).json({
      success: false,
      error: message,
    });
  }
});

/**
 * GET /api/players/:playerId/matches
 * Get player match history (public)
 */
router.get('/:playerId/matches', async (req: Request, res: Response) => {
  try {
    const { playerId } = req.params;
    const { tournamentId } = req.query;

    // Get all matches this player participated in
    let query = `
      SELECT 
        m.slug,
        m.round,
        m.match_number,
        m.status,
        m.completed_at,
        m.tournament_id as tournamentId,
        m.team1_id,
        m.team2_id,
        m.winner_id,
        pms.team,
        pms.won_match,
        pms.adr,
        pms.total_damage,
        pms.kills,
        pms.deaths,
        pms.assists
      FROM player_match_stats pms
      JOIN matches m ON pms.match_slug = m.slug
      WHERE pms.player_id = ?
    `;
    const params: unknown[] = [playerId];

    if (tournamentId) {
      query += ' AND m.tournament_id = ?';
      params.push(parseInt(tournamentId as string, 10));
    }

    query += ' ORDER BY m.completed_at DESC, m.round DESC';

    const matches = await db.queryAsync(query, params);

    return res.json({
      success: true,
      matches,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    log.error('Error fetching player matches', { error, playerId: req.params.playerId });
    return res.status(500).json({
      success: false,
      error: message,
    });
  }
});

// ============================================================================
// PROTECTED ROUTES (authentication required)
// ============================================================================

// All player management routes require authentication (admin only)
router.use(requireAuth);

/**
 * GET /api/players
 * Get all players (for admin management)
 */
router.get('/', async (_req: Request, res: Response) => {
  try {
    const players = await playerService.getAllPlayers();
    return res.json({
      success: true,
      count: players.length,
      players,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    log.error('Error fetching players', { error });
    return res.status(500).json({
      success: false,
      error: message,
    });
  }
});

/**
 * GET /api/players/selection
 * Get players for selection modal (with team membership status)
 */
router.get('/selection', async (req: Request, res: Response) => {
  try {
    const { teamId } = req.query;
    const players = await playerService.getAllPlayers();

    // If teamId provided, mark which players are already in that team
    let teamPlayerIds: string[] = [];
    if (teamId && typeof teamId === 'string') {
      const team = await db.queryOneAsync<{ players: string }>(
        'SELECT players FROM teams WHERE id = ?',
        [teamId]
      );
      if (team) {
        const teamPlayers = JSON.parse(team.players) as Array<{ steamId: string }>;
        teamPlayerIds = teamPlayers.map((p) => p.steamId);
      }
    }

    const playersWithStatus = players.map((p) => ({
      ...p,
      inTeam: teamPlayerIds.includes(p.id),
    }));

    return res.json({
      success: true,
      players: playersWithStatus,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    log.error('Error fetching players for selection', { error });
    return res.status(500).json({
      success: false,
      error: message,
    });
  }
});

/**
 * POST /api/players
 * Create a new player
 */
router.post('/', async (req: Request, res: Response) => {
  try {
    const input: CreatePlayerInput = req.body;

    if (!input.id || !input.name) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: id (Steam ID), name',
      });
    }

    const player = await playerService.createPlayer(input);

    return res.status(201).json({
      success: true,
      message: 'Player created successfully',
      player,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    const statusCode = message.includes('already exists') ? 409 : 400;
    log.error('Error creating player', { error });
    return res.status(statusCode).json({
      success: false,
      error: message,
    });
  }
});

/**
 * POST /api/players/bulk-import
 * Bulk import players from CSV/JSON
 */
router.post('/bulk-import', async (req: Request, res: Response) => {
  try {
    const players: CreatePlayerInput[] = req.body;

    if (!Array.isArray(players) || players.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Request body must be an array of players',
      });
    }

    // Validate each player has required fields
    for (const player of players) {
      if (!player.id || !player.name) {
        return res.status(400).json({
          success: false,
          error: 'Each player must have id (Steam ID) and name',
        });
      }
    }

    const result = await playerService.bulkImportPlayers(players);
    const statusCode = result.errors.length > 0 ? 207 : 201; // 207 Multi-Status if some failed

    return res.status(statusCode).json({
      success: result.errors.length === 0,
      message: `Imported ${result.created} player(s), updated ${result.updated}, ${result.errors.length} error(s)`,
      created: result.created,
      updated: result.updated,
      errors: result.errors,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    log.error('Error bulk importing players', { error });
    return res.status(500).json({
      success: false,
      error: message,
    });
  }
});

/**
 * PUT /api/players/:playerId
 * Update a player (admin only)
 */
router.put('/:playerId', async (req: Request, res: Response) => {
  try {
    const { playerId } = req.params;
    const input: UpdatePlayerInput = req.body;

    const player = await playerService.updatePlayer(playerId, input);

    if (!player) {
      return res.status(404).json({
        success: false,
        error: `Player '${playerId}' not found`,
      });
    }

    return res.json({
      success: true,
      message: 'Player updated successfully',
      player,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    log.error('Error updating player', { error, playerId: req.params.playerId });
    return res.status(500).json({
      success: false,
      error: message,
    });
  }
});

/**
 * DELETE /api/players/:playerId
 * Delete a player (admin only)
 */
router.delete('/:playerId', async (req: Request, res: Response) => {
  try {
    const { playerId } = req.params;
    const deleted = await playerService.deletePlayer(playerId);

    if (!deleted) {
      return res.status(404).json({
        success: false,
        error: `Player '${playerId}' not found`,
      });
    }

    return res.json({
      success: true,
      message: 'Player deleted successfully',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    log.error('Error deleting player', { error, playerId: req.params.playerId });
    return res.status(500).json({
      success: false,
      error: message,
    });
  }
});

export default router;
