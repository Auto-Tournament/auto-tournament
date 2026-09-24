/**
 * Players API Routes
 * Handles player CRUD operations and bulk import
 */

import { Router, Request, Response } from 'express';
import {
  playerService,
  InvalidDiscordIdError,
  type CreatePlayerInput,
  type UpdatePlayerInput,
} from '../services/playerService';
import { abbreviateId, isValidDiscordId, parseDiscordIdEdit } from '../utils/discordId';
import { getRatingHistory } from '../services/ratingService';
import { steamService } from '../services/steamService';
import { requireAuth } from '../middleware/auth';
import { log } from '../utils/logger';
import { db } from '../config/database';
import { playerConnectionService } from '../services/playerConnectionService';
import type { NormalizedServerPlayer } from '../utils/playerTransform';
import { teamService } from '../services/teamService';
import { matchLiveStatsService } from '../services/matchLiveStatsService';
import type { DbMatchRow } from '../types/database.types';
import { getMapResults } from '../services/matchMapResultService';
import { currentMatchConfig, describeMatch, describedPlayers } from '../utils/matchIntegration';
import { generateAvatarSvg } from '../generation/avatar';
import { getEffectiveViewerSteamId, resolveViewerIdentity } from '../utils/viewerIdentity';
import { getIntegration, integrationForMatch } from '../integrations/registry';
import { DEFAULT_GAME } from '../integrations/types';

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
    const steamApiAvailable = await steamService.isAvailable();

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
          if (steamApiAvailable) {
            const resolvedId = await steamService.resolveSteamId(searchQuery);
            if (resolvedId) {
              resolvedSteamId = resolvedId;
            }
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
    else if (steamApiAvailable) {
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

    // No players found - provide clearer errors for vanity URLs vs general search
    if (!steamApiAvailable && searchQuery.includes('steamcommunity.com')) {
      log.debug('Steam API not configured, cannot resolve vanity URL in /api/players/find');
      return res.json({
        success: false,
        error:
          'Steam API is not configured, so Steam vanity URLs cannot be resolved. Enter a Steam ID64 instead, or ask an admin to set the Steam Web API key on the Settings page.',
        steamApiConfigured: false,
      });
    }

    return res.json({
      success: false,
      error: 'Player not found',
      steamApiConfigured: steamApiAvailable,
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
      isAdmin: p.isAdmin,
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

/**
 * GET /api/players/selection
 * Get players for selection modal (with team membership status)
 *
 * NOTE: Declared before any /:playerId routes so that the literal segment
 * "selection" is not treated as a dynamic :playerId by the parameterized
 * handlers below. Access is restricted to admins via requireAuth.
 */
router.get('/selection', requireAuth, async (req: Request, res: Response) => {
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
 * GET /api/players/:playerId/team
 * Resolve the team a player belongs to (public).
 *
 * Used by the public player page to show "My Team" even when the player has no
 * current/upcoming match.
 */
router.get('/:playerId/team', async (req: Request, res: Response) => {
  try {
    const { playerId } = req.params;

    // Ensure player exists (consistent with other public player endpoints)
    const player = await playerService.getPlayerById(playerId);
    if (!player) {
      return res.status(404).json({
        success: false,
        error: `Player '${playerId}' not found`,
      });
    }

    const likeParam = `%${playerId}%`;

    // Prefilter: string LIKE on JSON column, then verify by parsing to avoid false positives.
    const rows = await db.queryAsync<{
      id: string;
      name: string;
      tag: string | null;
      players: string;
      created_at: number;
      updated_at: number | null;
    }>(
      `SELECT id, name, tag, players, created_at, updated_at
       FROM teams
       WHERE players LIKE ? ESCAPE '\\'
       ORDER BY COALESCE(updated_at, created_at) DESC`,
      [likeParam]
    );

    const parsePlayers = (
      playersJson: string
    ): Array<{ steamId: string; name: string; avatar?: string }> => {
      try {
        const parsed = JSON.parse(playersJson) as unknown;
        if (!parsed) return [];

        // Canonical format: Player[]
        if (Array.isArray(parsed)) {
          return parsed
            .map((p) => {
              if (!p || typeof p !== 'object') return null;
              const anyP = p as { steamId?: unknown; name?: unknown; avatar?: unknown };
              if (typeof anyP.steamId !== 'string' || typeof anyP.name !== 'string') return null;
              const base: { steamId: string; name: string; avatar?: string } = {
                steamId: anyP.steamId,
                name: anyP.name,
              };
              if (typeof anyP.avatar === 'string') {
                base.avatar = anyP.avatar;
              }
              return base;
            })
            .filter((p): p is { steamId: string; name: string; avatar?: string } => !!p);
        }

        // Legacy formats:
        // - Object map { idx: { steamId, name, avatar? } }
        // - Object map { steamId: name }
        if (typeof parsed === 'object') {
          const record = parsed as Record<string, unknown>;

          // Old: { steamId: name }
          const fromEntries = Object.entries(record)
            .map(([k, v]) => {
              if (typeof v === 'string' && k.trim().length > 0) {
                return { steamId: k, name: v };
              }
              return null;
            })
            .filter((p): p is { steamId: string; name: string } => !!p);
          if (fromEntries.length > 0) return fromEntries;

          // New-ish map: { idx: { steamId, name, avatar? } }
          return Object.values(record)
            .map((v) => {
              if (!v || typeof v !== 'object') return null;
              const anyV = v as { steamId?: unknown; name?: unknown; avatar?: unknown };
              if (typeof anyV.steamId !== 'string' || typeof anyV.name !== 'string') return null;
              const base: { steamId: string; name: string; avatar?: string } = {
                steamId: anyV.steamId,
                name: anyV.name,
              };
              if (typeof anyV.avatar === 'string') {
                base.avatar = anyV.avatar;
              }
              return base;
            })
            .filter((p): p is { steamId: string; name: string; avatar?: string } => !!p);
        }
      } catch {
        // ignore parse errors, treat as empty
      }
      return [];
    };

    const matching = rows.find((team) => {
      const players = parsePlayers(team.players);
      return players.some((p) => p.steamId === playerId);
    });

    if (!matching) {
      return res.json({
        success: true,
        team: null,
      });
    }

    return res.json({
      success: true,
      team: {
        id: matching.id,
        name: matching.name,
        tag: matching.tag ?? undefined,
        players: parsePlayers(matching.players),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    log.error('Error resolving player team', { error, playerId: req.params.playerId });
    return res.status(500).json({
      success: false,
      error: message,
    });
  }
});

/**
 * GET /api/players/me/match-status
 * Lightweight status for the navbar CTA: "YOUR TURN IN VETO", "Match ready", etc.
 * Requires player_steam_id cookie (Steam sign-in). Returns status, matchSlug, and a label key.
 */
router.get('/me/match-status', async (req: Request, res: Response) => {
  try {
    // Honour admin impersonation so the navbar CTA reflects the player being
    // impersonated, not the admin doing the impersonating.
    const steamId = await getEffectiveViewerSteamId(req);
    if (!steamId) {
      return res.json({
        success: true,
        status: 'none',
        matchSlug: null,
        label: null,
      });
    }

    const player = await playerService.getPlayerById(steamId);
    if (!player) {
      return res.json({
        success: true,
        status: 'none',
        matchSlug: null,
        label: null,
      });
    }

    const likeParam = `%${steamId}%`;

    let match = await db.queryOneAsync<
      DbMatchRow & { team1_players?: string | null; team2_players?: string | null }
    >(
      `SELECT m.id, m.slug, m.status, m.config, m.veto_state, m.team1_id, m.team2_id,
              m.round, m.tournament_id,
              t1.players as team1_players, t2.players as team2_players
       FROM matches m
       LEFT JOIN teams t1 ON m.team1_id = t1.id
       LEFT JOIN teams t2 ON m.team2_id = t2.id
       WHERE m.status IN ('loaded', 'live')
         AND (
           (t1.players LIKE ? ESCAPE '\\')
           OR (t2.players LIKE ? ESCAPE '\\')
           OR (m.config LIKE ? ESCAPE '\\')
         )
       ORDER BY m.loaded_at DESC
       LIMIT 1`,
      [likeParam, likeParam, likeParam]
    );

    if (!match) {
      match = await db.queryOneAsync<
        DbMatchRow & { team1_players?: string | null; team2_players?: string | null }
      >(
        `SELECT m.id, m.slug, m.status, m.config, m.veto_state, m.team1_id, m.team2_id,
                m.round, m.tournament_id,
                t1.players as team1_players, t2.players as team2_players
         FROM matches m
         LEFT JOIN teams t1 ON m.team1_id = t1.id
         LEFT JOIN teams t2 ON m.team2_id = t2.id
         WHERE m.status IN ('pending', 'ready')
           AND (
             (t1.players LIKE ? ESCAPE '\\')
             OR (t2.players LIKE ? ESCAPE '\\')
             OR (m.config LIKE ? ESCAPE '\\')
           )
         ORDER BY m.round ASC, m.match_number ASC
         LIMIT 1`,
        [likeParam, likeParam, likeParam]
      );
    }

    if (!match) {
      return res.json({
        success: true,
        status: 'none',
        matchSlug: null,
        label: null,
      });
    }

    const description = describeMatch(match);
    const t1 = describedPlayers(description.team1);
    const t2 = describedPlayers(description.team2);
    const in1 = t1.some((p) => p.steamid === steamId);
    const in2 = t2.some((p) => p.steamid === steamId);
    const team1Json = (match.team1_players ?? '') as string;
    const team2Json = (match.team2_players ?? '') as string;
    const in1Json = team1Json.includes(steamId);
    const in2Json = team2Json.includes(steamId);
    const isTeam1 = in1 || (in1Json && !in2Json) || (!in2 && !in2Json);

    if (!in1 && !in2 && !in1Json && !in2Json) {
      return res.json({
        success: true,
        status: 'none',
        matchSlug: null,
        label: null,
      });
    }

    const vetoState = match.veto_state
      ? (JSON.parse(match.veto_state) as {
          status?: string;
          currentTurn?: string;
          actions?: Array<{ team?: string }>;
        })
      : null;
    const vetoCompleted = vetoState?.status === 'completed';

    // Do NOT read currentTurn straight off veto_state: that row is only written
    // once the first action is submitted, so on step 1 it is NULL and the team
    // that has to act first would be told "waiting for veto" instead of
    // "your turn". The integration's preMatchTurn derives the opening step
    // from the configured veto order in that case.
    const currentTurn = vetoCompleted
      ? null
      : ((await integrationForMatch(match).preMatchTurn?.(match)) ?? null);

    if (['loaded', 'live'].includes(match.status)) {
      return res.json({
        success: true,
        status: 'match_ready',
        matchSlug: match.slug,
        label: 'match_ready',
      });
    }

    if ((match.status === 'pending' || match.status === 'ready') && !vetoCompleted) {
      const myTurn =
        currentTurn &&
        ((currentTurn === 'team1' && isTeam1) || (currentTurn === 'team2' && !isTeam1));
      // Who made the most recent veto move, so the navbar can tell "the
      // opponent made their choice" apart from the viewer's own action.
      const vetoActions = Array.isArray(vetoState?.actions) ? vetoState.actions : [];
      const lastTeam = vetoActions[vetoActions.length - 1]?.team;
      return res.json({
        success: true,
        status: myTurn ? 'your_turn_veto' : 'waiting_veto',
        matchSlug: match.slug,
        label: myTurn ? 'your_turn_veto' : 'waiting_veto',
        viewerTeam: isTeam1 ? 'team1' : 'team2',
        vetoActionCount: vetoActions.length,
        lastVetoActionTeam: lastTeam === 'team1' || lastTeam === 'team2' ? lastTeam : null,
      });
    }

    if ((match.status === 'pending' || match.status === 'ready') && vetoCompleted) {
      return res.json({
        success: true,
        status: 'waiting_server',
        matchSlug: match.slug,
        label: 'waiting_server',
      });
    }

    return res.json({
      success: true,
      status: 'match_ready',
      matchSlug: match.slug,
      label: 'match_ready',
    });
  } catch (e) {
    log.error('Failed to compute match status for /me/match-status', e as Error);
    return res.status(500).json({
      success: false,
      error: 'Failed to load match status',
    });
  }
});

// ----------------------------------------------------------------------------
// Player self-service: the signed-in player's own Discord ID
// ----------------------------------------------------------------------------

/**
 * Work out whose Discord ID a self-service request may touch, or answer it.
 *
 * Deliberately the REAL viewer (Passport session, or the signed
 * `player_steam_id` cookie), never the effective one, and never a Steam ID from
 * the URL or body: a player can only ever read or change their own. There is no
 * parameter to get wrong.
 *
 * An admin who is impersonating is refused outright rather than served either
 * identity. Acting on the impersonated player would let an admin quietly edit a
 * child's contact details through a page built for the player; acting on the
 * admin's own row while the UI shows someone else would be worse. Admins have
 * the Players page for this, which is the edit an audit would expect to find.
 *
 * These routes sit above `router.use(requireAuth)` because a normal player is
 * not an admin; they do their own authentication here. A service token carries
 * no Steam ID, so it gets 401 like any anonymous caller.
 */
async function resolveSelfServiceSteamId(req: Request, res: Response): Promise<string | null> {
  const identity = await resolveViewerIdentity(req);

  if (!identity.realSteamId) {
    res.status(401).json({ success: false, error: 'Sign in with Steam to manage your Discord ID' });
    return null;
  }

  if (identity.isImpersonating) {
    res.status(403).json({
      success: false,
      error:
        "You are impersonating a player. Admins edit a player's Discord ID on the Players page; " +
        'stop impersonating to manage your own.',
    });
    return null;
  }

  return identity.realSteamId;
}

/**
 * GET /api/players/me/discord-id
 * The signed-in player's own Discord ID (player session, not admin).
 */
router.get('/me/discord-id', async (req: Request, res: Response) => {
  try {
    const steamId = await resolveSelfServiceSteamId(req, res);
    if (!steamId) return;

    const discordId = await playerService.getDiscordId(steamId);
    if (discordId === undefined) {
      return res.status(404).json({ success: false, error: 'No player record for this Steam account' });
    }

    return res.json({ success: true, steamId, discordId });
  } catch (error) {
    log.error('Error reading own Discord ID', { error });
    return res.status(500).json({ success: false, error: 'Failed to load Discord ID' });
  }
});

/**
 * PUT /api/players/me/discord-id
 * Set (string) or clear (null / "") the signed-in player's own Discord ID.
 *
 * An explicit edit: it overwrites whatever is stored, including a value an
 * import filled in. That is the point — the player is the authority on their
 * own Discord account, and a later re-import will not undo this (imports never
 * overwrite).
 */
router.put('/me/discord-id', async (req: Request, res: Response) => {
  try {
    const steamId = await resolveSelfServiceSteamId(req, res);
    if (!steamId) return;

    const body = (req.body ?? {}) as { discordId?: unknown };
    if (!('discordId' in body)) {
      return res.status(400).json({
        success: false,
        error: 'discordId is required: a Discord user ID string, or null to remove it',
      });
    }

    const edit = parseDiscordIdEdit(body.discordId);
    if (edit.kind === 'invalid') {
      return res.status(400).json({ success: false, error: edit.error });
    }

    const updated = await playerService.updatePlayer(steamId, {
      discordId: edit.kind === 'set' ? edit.value : null,
    });
    if (!updated) {
      return res.status(404).json({ success: false, error: 'No player record for this Steam account' });
    }

    const discordId = (await playerService.getDiscordId(steamId)) ?? null;
    log.info(
      `Player ${steamId} ${discordId ? `set their Discord ID to ${abbreviateId(discordId)}` : 'cleared their Discord ID'}`
    );
    return res.json({ success: true, steamId, discordId });
  } catch (error) {
    if (error instanceof InvalidDiscordIdError) {
      return res.status(400).json({ success: false, error: error.message });
    }
    log.error('Error updating own Discord ID', { error });
    return res.status(500).json({ success: false, error: 'Failed to save Discord ID' });
  }
});

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
        AND (
          (t1.players LIKE ? ESCAPE '\\')
          OR (t2.players LIKE ? ESCAPE '\\')
          OR (m.config LIKE ? ESCAPE '\\')
        )
      ORDER BY m.loaded_at DESC
      LIMIT 1`,
      [likeParam, likeParam, likeParam]
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
          AND (
            (t1.players LIKE ? ESCAPE '\\')
            OR (t2.players LIKE ? ESCAPE '\\')
            OR (m.config LIKE ? ESCAPE '\\')
          )
        ORDER BY m.round ASC, m.match_number ASC
        LIMIT 1`,
        [likeParam, likeParam, likeParam]
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

    // Determine if this player is on team1 or team2 based on config players.
    // For bracket-managed matches (round >= 1) we rebuild the config on-demand
    // so team rosters always reflect the latest team membership instead of a
    // stale snapshot from bracket generation.
    // Manual/non-bracket matches keep their stored config as-is.
    const cfg = describeMatch({ game: match.game, config: await currentMatchConfig(match) });

    const normalizedTeam1Players = describedPlayers(cfg.team1);
    const normalizedTeam2Players = describedPlayers(cfg.team2);

    const isPlayerInTeam1 = normalizedTeam1Players.some((p) => p.steamid === playerId);
    const isPlayerInTeam2 = normalizedTeam2Players.some((p) => p.steamid === playerId);

    // Fallback to team players JSON if config is ambiguous
    const team1PlayersStr = match.team1_players || '';
    const team2PlayersStr = match.team2_players || '';
    const isInTeam1Json = team1PlayersStr.includes(playerId);
    const isInTeam2Json = team2PlayersStr.includes(playerId);

    const isPlayerOnTeam1 = isPlayerInTeam1 || (isInTeam1Json && !isInTeam2Json);
    const isPlayerOnTeam2 = isPlayerInTeam2 || (isInTeam2Json && !isInTeam1Json);

    // If the player cannot be found on either side (neither config nor team JSON),
    // treat this as a false positive from the broad SQL LIKE match (for example,
    // a shuffle tournament where the player is registered for the event but not
    // actually playing in this specific match). In that case, do NOT claim the
    // player has a current match.
    if (!isPlayerOnTeam1 && !isPlayerOnTeam2) {
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

    // At this point we know the player is on exactly one of the teams. Resolve
    // which side we should render from the player's perspective.
    let isTeam1: boolean;

    if (isPlayerOnTeam1 && !isPlayerOnTeam2) {
      isTeam1 = true;
    } else if (!isPlayerOnTeam1 && isPlayerOnTeam2) {
      isTeam1 = false;
    } else {
      // Extremely defensive fallback: if our checks disagree, default to team1.
      isTeam1 = true;
    }

    const isManualMatch = match.round === 0 && !match.team1_id && !match.team2_id;
    const t1Name = match.team1_name ?? (cfg.team1.name || undefined);
    const t2Name = match.team2_name ?? (cfg.team2.name || undefined);
    const t1Tag = match.team1_tag ?? cfg.team1.tag ?? '';
    const t2Tag = match.team2_tag ?? cfg.team2.tag ?? '';

    const playerTeam = isTeam1
      ? {
          id: isManualMatch ? 'team1' : match.team1_id,
          name: t1Name,
          tag: t1Tag,
        }
      : {
          id: isManualMatch ? 'team2' : match.team2_id,
          name: t2Name,
          tag: t2Tag,
        };

    const opponent = isTeam1
      ? { id: isManualMatch ? 'team2' : match.team2_id, name: t2Name, tag: t2Tag }
      : { id: isManualMatch ? 'team1' : match.team1_id, name: t1Name, tag: t1Tag };

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
        const vetoState = JSON.parse(match.veto_state) as {
          status?: 'pending' | 'in_progress' | 'completed' | string;
          team1Name?: string;
          team2Name?: string;
          pickedMaps?: Array<{ mapNumber?: number; mapName?: string }>;
          actions?: Array<{
            step?: number;
            team?: 'team1' | 'team2';
            action?: string;
            mapName?: string;
            side?: string;
            timestamp?: number;
          }>;
        };
        if (vetoState) {
          const orderedPickedMaps = Array.isArray(vetoState.pickedMaps)
            ? [...vetoState.pickedMaps].sort(
                (a: { mapNumber?: number }, b: { mapNumber?: number }) =>
                  (a.mapNumber || 0) - (b.mapNumber || 0)
              )
            : [];

          const sanitizedPickedMaps = orderedPickedMaps.filter(
            (m): m is { mapNumber?: number; mapName: string } =>
              typeof m.mapName === 'string' && m.mapName.trim().length > 0
          );

          pickedMaps = sanitizedPickedMaps.map((m) => m.mapName);

          const status: 'pending' | 'in_progress' | 'completed' =
            vetoState.status === 'completed' || vetoState.status === 'in_progress'
              ? vetoState.status
              : 'pending';

          vetoSummary = {
            status,
            team1Name:
              vetoState.team1Name ||
              match.team1_name ||
              cfg.team1.name ||
              'Team 1',
            team2Name:
              vetoState.team2Name ||
              match.team2_name ||
              cfg.team2.name ||
              'Team 2',
            pickedMaps: sanitizedPickedMaps,
            actions: Array.isArray(vetoState.actions)
              ? vetoState.actions
                  .filter(
                    (a): a is {
                      step: number;
                      team: 'team1' | 'team2';
                      action: string;
                      mapName?: string;
                      side?: string;
                      timestamp?: number;
                    } =>
                      typeof a.step === 'number' &&
                      (a.team === 'team1' || a.team === 'team2') &&
                      typeof a.action === 'string'
                  )
                  .sort((a, b) => (a.step || 0) - (b.step || 0))
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
          integrationForMatch(match).resourceStatus?.(match.server_id) ?? Promise.resolve(null),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), 2000)),
        ]);

        if (statusInfo) {
          realServerStatus = statusInfo.status;
          serverStatusDescription = statusInfo.description;
        }
      } catch (error) {
        // Silently fail - server status is nice-to-have, not critical
        log.debug('[PlayerMatch] Server status check failed (plugin ConVars may not exist yet)', {
          matchSlug: match.slug,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // IMPORTANT: Do NOT force a fresh match report here.
    // This endpoint may be hit frequently from the public player page, and
    // we don't want a single player spamming this route to repeatedly ping
    // the CS2 server via RCON. Instead, we rely on:
    //   - webhook-driven live stats (match events)
    //   - periodic/TTL-based refreshes from the team views and /api/events/*
    //
    // That means this route only ever reads the most recent cached snapshots.
    const connectionStatus = playerConnectionService.getStatus(match.slug);
    const liveStats = matchLiveStatsService.getStats(match.slug);

    const rawMapResults = await getMapResults(match.slug);
    const normalizedMapResults = rawMapResults.map((result) => ({
      mapNumber: result.mapNumber,
      mapName: result.mapName,
      team1Score: result.team1Score,
      team2Score: result.team2Score,
      winner: result.winnerTeam,
      winnerTeam: result.winnerTeam,
      demoFilePath: result.demoFilePath,
      completedAt: result.completedAt,
    }));

    // Normalize and enrich config players with avatars from team data or players table
    const enrichPlayers = async (
      normalizedPlayers: NormalizedServerPlayer[],
      teamId?: string
    ) => {
      if (teamId) {
        try {
          const teamData = await teamService.getTeamById(teamId);
          if (teamData?.players) {
            const avatarMap = new Map(
              teamData.players.map((p) => [p.steamId.toLowerCase(), p.avatar])
            );
            return normalizedPlayers.map((p) => ({
              ...p,
              avatar: avatarMap.get(p.steamid.toLowerCase()),
            }));
          }
        } catch (error) {
          log.debug('[PlayerMatch] Failed to enrich players with avatars', {
            teamId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
      return normalizedPlayers;
    };

    let [enrichedTeam1Players, enrichedTeam2Players] = await Promise.all([
      enrichPlayers(normalizedTeam1Players, cfg.team1.id),
      enrichPlayers(normalizedTeam2Players, cfg.team2.id),
    ]);

    // Manual matches: no team rows, enrich from players table
    if (isManualMatch) {
      const allSteamIds = [
        ...enrichedTeam1Players.map((p) => p.steamid),
        ...enrichedTeam2Players.map((p) => p.steamid),
      ];
      if (allSteamIds.length > 0) {
        try {
          const placeholders = allSteamIds.map(() => '?').join(', ');
          const rows = await db.queryAsync<{ id: string; avatar_url: string | null }>(
            `SELECT id, avatar_url FROM players WHERE id IN (${placeholders})`,
            allSteamIds
          );
          const avatarMap = new Map(
            rows.map((r) => [r.id.toLowerCase(), r.avatar_url ?? undefined])
          );
          enrichedTeam1Players = enrichedTeam1Players.map((p) => ({
            ...p,
            avatar: p.avatar || avatarMap.get(p.steamid.toLowerCase()),
          }));
          enrichedTeam2Players = enrichedTeam2Players.map((p) => ({
            ...p,
            avatar: p.avatar || avatarMap.get(p.steamid.toLowerCase()),
          }));
        } catch (error) {
          log.debug('[PlayerMatch] Failed to enrich manual-match players with avatars', {
            matchSlug: match.slug,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }

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
        liveStats,
        maps: pickedMaps.length > 0 ? pickedMaps : [],
        mapResults: normalizedMapResults,
        veto: vetoSummary,
        matchFormat:
          (tournament?.format as 'bo1' | 'bo3' | 'bo5') ||
          (cfg.seriesLength === 1 ? 'bo1' : cfg.seriesLength === 5 ? 'bo5' : 'bo3'),
        loadedAt: match.loaded_at,
        // Neutral match summary, kept in the shape the player page reads.
        config: {
          maplist: cfg.maps.length > 0 ? cfg.maps : null,
          num_maps: cfg.seriesLength,
          players_per_team: cfg.playersPerTeam ?? null,
          expected_players_total: cfg.playersPerTeam !== undefined ? cfg.playersPerTeam * 2 : 10,
          expected_players_team1: cfg.playersPerTeam ?? 5,
          expected_players_team2: cfg.playersPerTeam ?? 5,
          vetoDisabled: cfg.skipPreMatchPhase,
          team1: {
            id: cfg.team1.id,
            name: cfg.team1.name,
            tag: cfg.team1.tag,
            flag: cfg.team1.flag,
            players: enrichedTeam1Players,
          },
          team2: {
            id: cfg.team2.id,
            name: cfg.team2.name,
            tag: cfg.team2.tag,
            flag: cfg.team2.flag,
            players: enrichedTeam2Players,
          },
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
 * @openapi
 * /api/players/{playerId}/summary:
 *   get:
 *     tags: [Players]
 *     summary: Aggregate player view used by the public player page
 *     description: >
 *       Player details (with matchesPlayed normalized from stats), rating
 *       history, deduplicated match history (each row carries the `game` id
 *       it was played under), basic derived stats, and the distinct games
 *       this player has recorded matches in.
 *     parameters:
 *       - name: playerId
 *         in: path
 *         required: true
 *         schema: { type: string }
 *       - name: tournamentId
 *         in: query
 *         required: false
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: Player summary
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 player: { type: object }
 *                 stats:
 *                   type: object
 *                   properties:
 *                     matchesPlayed: { type: integer }
 *                     wins: { type: integer }
 *                     losses: { type: integer }
 *                     winRate: { type: number }
 *                     averageAdr: { type: number }
 *                     recentForm: { type: string }
 *                 ratingHistory: { type: array, items: { type: object } }
 *                 matches:
 *                   type: array
 *                   description: Deduplicated match history; each row includes `game`.
 *                   items: { type: object }
 *                 games:
 *                   type: array
 *                   description: Distinct games this player has recorded matches in, newest first.
 *                   items:
 *                     type: object
 *                     properties:
 *                       id: { type: string, example: 'cs2' }
 *                       name: { type: string, example: 'Counter-Strike 2' }
 *       404:
 *         description: Player not found
 */
router.get('/:playerId/summary', async (req: Request, res: Response) => {
  try {
    const { playerId } = req.params;
    const { tournamentId } = req.query;

    const player = await playerService.getPlayerById(playerId);
    if (!player) {
      return res.status(404).json({
        success: false,
        error: `Player '${playerId}' not found`,
      });
    }

    // Derive "matches played" from stats table so duplicates in rating history
    // or other bookkeeping do not inflate the visible count.
    const matchCountRow = await db.queryOneAsync<{ count: number | string }>(
      'SELECT COUNT(DISTINCT match_slug) as count FROM player_match_stats WHERE player_id = ?',
      [playerId]
    );
    const matchesPlayed = Number(matchCountRow?.count ?? 0);

    // Rating history (same as /:playerId/rating-history)
    const ratingHistory = await getRatingHistory(
      playerId,
      tournamentId ? parseInt(tournamentId as string, 10) : undefined
    );

    // Match history (same as /:playerId/matches) but deduplicated by slug
    let query = `
      SELECT 
        m.slug,
        m.round,
        m.match_number,
        m.status,
        m.completed_at,
        -- Quoted: Postgres folds an unquoted identifier to lower case, so
        -- without the quotes this came back as tournamentid and every client
        -- reading tournamentId got undefined.
        m.tournament_id as "tournamentId",
        m.team1_id,
        m.team2_id,
        m.winner_id,
        m.game,
        t1.name as team1_name,
        t1.tag as team1_tag,
        t2.name as team2_name,
        t2.tag as team2_tag,
        pms.team,
        pms.won_match,
        pms.adr,
        pms.total_damage,
        pms.kills,
        pms.deaths,
        pms.assists,
        pms.headshots
      FROM player_match_stats pms
      JOIN matches m ON pms.match_slug = m.slug
      LEFT JOIN teams t1 ON m.team1_id = t1.id
      LEFT JOIN teams t2 ON m.team2_id = t2.id
      WHERE pms.player_id = ?
    `;
    const params: unknown[] = [playerId];

    if (tournamentId) {
      query += ' AND m.tournament_id = ?';
      params.push(parseInt(tournamentId as string, 10));
    }

    // Order by match completion time and then by stats row creation time so that,
    // when multiple player_match_stats rows exist for the same (player, match),
    // the most recent stats entry (with the best data) is the one we keep when
    // deduplicating by slug below.
    query += ' ORDER BY m.completed_at DESC, m.round DESC, pms.created_at DESC';

    type RawMatchRow = {
      slug: string;
      round: number;
      match_number: number;
      status: string;
      completed_at: number;
      tournamentId?: number;
      team1_id?: string | null;
      team2_id?: string | null;
      winner_id?: string | null;
      game?: string | null;
      team1_name?: string | null;
      team1_tag?: string | null;
      team2_name?: string | null;
      team2_tag?: string | null;
      team: 'team1' | 'team2';
      won_match: boolean;
      adr?: number | null;
      total_damage?: number | null;
      kills?: number | null;
      deaths?: number | null;
      assists?: number | null;
      headshots?: number | null;
    };

    const rawMatches = await db.queryAsync<RawMatchRow>(query, params);

    // Deduplicate by match slug so a single match only appears once in history
    const bySlug = new Map<string, RawMatchRow>();
    for (const row of rawMatches) {
      if (!bySlug.has(row.slug)) {
        bySlug.set(row.slug, row);
      }
    }
    const matches = Array.from(bySlug.values());

    // Derived stats
    const wins = matches.filter((m) => m.won_match).length;
    const totalMatches = matches.length;
    const losses = totalMatches - wins;
    const winRate = totalMatches > 0 ? wins / totalMatches : 0;
    const averageAdr =
      totalMatches > 0
        ? matches.reduce((sum, m) => sum + (typeof m.adr === 'number' ? m.adr : 0), 0) /
          totalMatches
        : 0;

    const sortedByCompleted = [...matches].sort(
      (a, b) => (a.completed_at || 0) - (b.completed_at || 0)
    );
    const recentForm = sortedByCompleted
      .slice(-5)
      .map((m) => (m.won_match ? 'W' : 'L'))
      .reverse()
      .join('');

    let bestAdrMatch: RawMatchRow | null = null;
    let worstAdrMatch: RawMatchRow | null = null;
    for (const m of matches) {
      if (typeof m.adr !== 'number') continue;
      if (!bestAdrMatch || (bestAdrMatch.adr ?? 0) < m.adr) {
        bestAdrMatch = m;
      }
      if (!worstAdrMatch || (worstAdrMatch.adr ?? Infinity) > m.adr) {
        worstAdrMatch = m;
      }
    }

    // Distinct games this player has recorded matches in (newest match first),
    // read from the already-computed integration registry rather than
    // hard-coding a game name on the client.
    const gameIds: string[] = [];
    for (const m of matches) {
      const id = m.game || DEFAULT_GAME;
      if (!gameIds.includes(id)) gameIds.push(id);
    }
    const games = gameIds.map((id) => {
      try {
        return { id, name: getIntegration(id).displayName };
      } catch {
        return { id, name: id };
      }
    });

    return res.json({
      success: true,
      player: {
        ...player,
        // Override matchCount with the normalized distinct match count so UI
        // doesn't show inflated numbers when history/stat rows are duplicated.
        matchCount: matchesPlayed,
      },
      stats: {
        matchesPlayed,
        wins,
        losses,
        winRate,
        averageAdr,
        recentForm,
        bestAdrMatch,
        worstAdrMatch,
      },
      ratingHistory,
      matches,
      games,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    log.error('Error fetching player summary', { error, playerId: req.params.playerId });
    return res.status(500).json({
      success: false,
      error: message,
    });
  }
});

/**
 * GET /api/players/:playerId/avatar.svg
 * Deterministic DiceBear avatar for a player, seeded from player ID.
 * Public endpoint so the frontend can embed SVGs directly.
 */
router.get('/:playerId/avatar.svg', async (req: Request, res: Response) => {
  try {
    const { playerId } = req.params;
    const player = await playerService.getPlayerById(playerId);

    if (!player) {
      return res.status(404).send('Player not found');
    }

    const svg = generateAvatarSvg(player.id);
    res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=86400, immutable');

    return res.send(svg);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    log.error('Error generating player avatar', { error, playerId: req.params.playerId });
    return res.status(500).send(message);
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

    // Get all matches this player participated in (with team names for nicer display)
    let query = `
      SELECT 
        m.slug,
        m.round,
        m.match_number,
        m.status,
        m.completed_at,
        -- Quoted: Postgres folds an unquoted identifier to lower case, so
        -- without the quotes this came back as tournamentid and every client
        -- reading tournamentId got undefined.
        m.tournament_id as "tournamentId",
        m.team1_id,
        m.team2_id,
        m.winner_id,
        t1.name as team1_name,
        t1.tag as team1_tag,
        t2.name as team2_name,
        t2.tag as team2_tag,
        pms.team,
        pms.won_match,
        pms.adr,
        pms.total_damage,
        pms.kills,
        pms.deaths,
        pms.assists
      FROM player_match_stats pms
      JOIN matches m ON pms.match_slug = m.slug
      LEFT JOIN teams t1 ON m.team1_id = t1.id
      LEFT JOIN teams t2 ON m.team2_id = t2.id
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
    // Admin mapping: includes the Discord ID. Public routes use getAllPlayers.
    const players = await playerService.getAllPlayersForAdmin();
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
 * GET /api/players/by-discord-id/:discordId
 * Every player with this Discord ID — how the Discord bot finds a player.
 *
 * Admin-guarded (the bot uses a service token; a read-only one is enough). An
 * ARRAY, and 200 with `[]` when nobody matches: the ID is not unique (a parent
 * may list theirs on several children), and "not registered" is an ordinary
 * answer for a bot, not an error it should have to parse.
 *
 * Two segments, so no `/:playerId` route can shadow it; the public
 * `/:playerId/<fixed>` routes above all end in a different literal.
 */
router.get('/by-discord-id/:discordId', async (req: Request, res: Response) => {
  try {
    const { discordId } = req.params;
    if (!isValidDiscordId(discordId)) {
      return res.status(400).json({
        success: false,
        error: 'discordId must be a Discord user ID: 17–20 digits',
      });
    }

    const players = await playerService.getPlayersByDiscordId(discordId);
    return res.json({ success: true, players });
  } catch (error) {
    log.error('Error looking up players by Discord ID', { error });
    return res.status(500).json({ success: false, error: 'Failed to look up players' });
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

    // An explicit edit: an invalid discordId refuses the whole create (400).
    const created = await playerService.createPlayer(input);
    const player = (await playerService.getPlayerByIdForAdmin(created.id)) ?? created;

    return res.status(201).json({
      success: true,
      message: 'Player created successfully',
      player,
    });
  } catch (error) {
    if (error instanceof InvalidDiscordIdError) {
      return res.status(400).json({ success: false, error: error.message });
    }
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
      // Discord IDs follow the import rule: never overwritten, bad ones dropped.
      ...(result.warnings.length > 0 ? { warnings: result.warnings } : {}),
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
 * POST /api/players/bulk-delete
 * Bulk delete players by ID array
 */
router.post('/bulk-delete', async (req: Request, res: Response) => {
  try {
    const { ids } = req.body as { ids?: string[] };

    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Request body must include a non-empty ids array',
      });
    }

    let deletedCount = 0;
    let missingCount = 0;

    for (const id of ids) {
      // Reuse existing single-delete semantics so cascades/logging stay consistent
      const deleted = await playerService.deletePlayer(id);
      if (deleted) {
        deletedCount += 1;
      } else {
        missingCount += 1;
      }
    }

    return res.json({
      success: missingCount === 0,
      deleted: deletedCount,
      missing: missingCount,
      message: `Deleted ${deletedCount} player(s), ${missingCount} not found`,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    log.error('Error bulk deleting players', { error });
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

    // An explicit edit: a string overwrites, null/"" clears, an absent key
    // leaves it alone, and an invalid value refuses the whole update (400).
    const updated = await playerService.updatePlayer(playerId, input);

    if (!updated) {
      return res.status(404).json({
        success: false,
        error: `Player '${playerId}' not found`,
      });
    }

    const player = (await playerService.getPlayerByIdForAdmin(playerId)) ?? updated;

    return res.json({
      success: true,
      message: 'Player updated successfully',
      player,
    });
  } catch (error) {
    if (error instanceof InvalidDiscordIdError) {
      return res.status(400).json({ success: false, error: error.message });
    }
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
