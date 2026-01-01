import { Router, Request, Response } from 'express';
import { matchService } from '../services/matchService';
import { matchAllocationService } from '../services/matchAllocationService';
import { loadMatchOnServer } from '../services/matchLoadingService';
import { CreateMatchInput, MatchConfig, MatchListItem, MatchPlayer } from '../types/match.types';
import { TournamentResponse } from '../types/tournament.types';
import { requireAuth } from '../middleware/auth';
import { log } from '../utils/logger';
import { db } from '../config/database';
import type { DbMatchRow, DbTournamentRow } from '../types/database.types';
import { getBaseUrl, getWebhookBaseUrl } from '../utils/urlHelper';
import { emitMatchUpdate, emitBracketUpdate } from '../services/socketService';
import { generateMatchConfig } from '../services/matchConfigBuilder';
import { enrichMatch } from '../utils/matchEnrichment';
import { matchLiveStatsService } from '../services/matchLiveStatsService';
import { normalizeConfigPlayers } from '../utils/playerTransform';
import { teamService } from '../services/teamService';
import { playerService } from '../services/playerService';
import { getMapResults } from '../services/matchMapResultService';

const router = Router();

/**
 * Helper: build a rich MatchListItem (teams, maps, results, players) for a single match row.
 * This mirrors the shape used by GET /api/matches so team pages and history views
 * get full details, not just raw config.
 */
async function getMatchDetailsBySlug(slug: string): Promise<MatchListItem | null> {
  // Fetch match with team and server info
  const row = await db.queryOneAsync<
    DbMatchRow & {
      team1_id?: string;
      team1_name?: string;
      team1_tag?: string;
      team2_id?: string;
      team2_name?: string;
      team2_tag?: string;
      winner_id?: string;
      winner_name?: string;
      winner_tag?: string;
      demo_file_path?: string;
      server_name?: string | null;
    }
  >(
    `
      SELECT
        m.*,
        t1.id as team1_id, t1.name as team1_name, t1.tag as team1_tag,
        t2.id as team2_id, t2.name as team2_name, t2.tag as team2_tag,
        w.id as winner_id, w.name as winner_name, w.tag as winner_tag,
        s.name as server_name
      FROM matches m
      LEFT JOIN teams t1 ON m.team1_id = t1.id
      LEFT JOIN teams t2 ON m.team2_id = t2.id
      LEFT JOIN teams w ON m.winner_id = w.id
      LEFT JOIN servers s ON m.server_id = s.id
      WHERE m.slug = ?
      LIMIT 1
    `,
    [slug]
  );

  if (!row) {
    return null;
  }

  // Determine if this is a shuffle tournament (enables ELO enrichment)
  const tournamentType = await db.queryOneAsync<{ type: string }>(
    'SELECT type FROM tournament WHERE id = ?',
    [row.tournament_id || 1]
  );
  const isShuffleTournament = tournamentType?.type === 'shuffle';

  const config = row.config ? JSON.parse(row.config as string) : {};
  const vetoState = row.veto_state ? JSON.parse(row.veto_state as string) : null;

  // Normalize players from config
  const normalizedTeam1Players = config.team1
    ? normalizeConfigPlayers(config.team1.players)
    : [];
  const normalizedTeam2Players = config.team2
    ? normalizeConfigPlayers(config.team2.players)
    : [];

  // Enrich players with avatars from team records if team IDs are available
  let enrichedTeam1Players = normalizedTeam1Players;
  let enrichedTeam2Players = normalizedTeam2Players;

  if (config.team1?.id && row.team1_id) {
    try {
      const team1Data = await teamService.getTeamById(config.team1.id);
      if (team1Data?.players) {
        const avatarMap = new Map(
          team1Data.players.map((p) => [p.steamId.toLowerCase(), p.avatar])
        );
        enrichedTeam1Players = normalizedTeam1Players.map((p) => ({
          ...p,
          avatar: p.avatar || avatarMap.get(p.steamid.toLowerCase()),
        }));
      }
    } catch (error) {
      log.debug(
        `Failed to enrich team1 players with avatars: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  if (config.team2?.id && row.team2_id) {
    try {
      const team2Data = await teamService.getTeamById(config.team2.id);
      if (team2Data?.players) {
        const avatarMap = new Map(
          team2Data.players.map((p) => [p.steamId.toLowerCase(), p.avatar])
        );
        enrichedTeam2Players = normalizedTeam2Players.map((p) => ({
          ...p,
          avatar: p.avatar || avatarMap.get(p.steamid.toLowerCase()),
        }));
      }
    } catch (error) {
      log.debug(
        `Failed to enrich team2 players with avatars: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  // Transform config to include properly formatted team players with avatars
  const transformedConfig = {
    ...config,
    team1: config.team1
      ? {
          ...config.team1,
          players: enrichedTeam1Players,
        }
      : undefined,
    team2: config.team2
      ? {
          ...config.team2,
          players: enrichedTeam2Players,
        }
      : undefined,
  };

  const match: MatchListItem = {
    id: row.id,
    slug: row.slug,
    round: row.round,
    matchNumber: row.match_number,
    team1:
      row.team1_id && row.team1_name
        ? {
            id: row.team1_id,
            name: row.team1_name,
            tag: row.team1_tag,
          }
        : undefined,
    team2:
      row.team2_id && row.team2_name
        ? {
            id: row.team2_id,
            name: row.team2_name,
            tag: row.team2_tag,
          }
        : undefined,
    winner:
      row.winner_id && row.winner_name
        ? {
            id: row.winner_id,
            name: row.winner_name,
            tag: row.winner_tag,
          }
        : undefined,
    status: row.status,
    serverId: row.server_id,
    serverName: row.server_name || undefined,
    config: transformedConfig,
    demoFilePath: row.demo_file_path,
    createdAt: row.created_at ?? 0,
    loadedAt: row.loaded_at,
    completedAt: row.completed_at,
    vetoCompleted: vetoState?.status === 'completed',
    currentMap: row.current_map ?? undefined,
    mapNumber: typeof row.map_number === 'number' ? row.map_number : undefined,
    maps: undefined,
  };

  const mapResults = await getMapResults(row.slug);
  if (mapResults.length > 0) {
    match.mapResults = mapResults;
  }

  if (Array.isArray(vetoState?.pickedMaps) && vetoState.pickedMaps.length > 0) {
    const orderedPickedMaps = [...vetoState.pickedMaps].sort(
      (a: { mapNumber?: number }, b: { mapNumber?: number }) => (a.mapNumber || 0) - (b.mapNumber || 0)
    );
    const pickedMapNames = orderedPickedMaps
      .map((m: { mapName?: string | null }) => m.mapName)
      .filter((name): name is string => Boolean(name));
    if (pickedMapNames.length > 0) {
      match.maps = pickedMapNames;
    }
  }

  if (!match.maps && mapResults.length > 0) {
    const resultsMaps = mapResults
      .map((result) => result.mapName)
      .filter((name): name is string => Boolean(name));
    if (resultsMaps.length > 0) {
      match.maps = resultsMaps;
    }
  }

  // Enrich match with player stats and scores from events
  await enrichMatch(match, row.slug);

  // For shuffle tournaments, enrich players with ELO
  if (
    isShuffleTournament &&
    (enrichedTeam1Players.length > 0 || enrichedTeam2Players.length > 0)
  ) {
    try {
      const allSteamIds = [
        ...enrichedTeam1Players.map((p) => p.steamid),
        ...enrichedTeam2Players.map((p) => p.steamid),
      ];

      if (allSteamIds.length > 0) {
        const players = await playerService.getPlayersByIds(allSteamIds);
        const eloMap = new Map(players.map((p) => [p.id.toLowerCase(), p.current_elo]));

        // Add ELO to team1 players
        enrichedTeam1Players = enrichedTeam1Players.map((p) => ({
          ...p,
          elo: eloMap.get(p.steamid.toLowerCase()),
        }));

        // Add ELO to team2 players
        enrichedTeam2Players = enrichedTeam2Players.map((p) => ({
          ...p,
          elo: eloMap.get(p.steamid.toLowerCase()),
        }));

        // Update config with enriched players
        if (transformedConfig.team1) {
          transformedConfig.team1.players = enrichedTeam1Players;
        }
        if (transformedConfig.team2) {
          transformedConfig.team2.players = enrichedTeam2Players;
        }
        match.config = transformedConfig;
      }
    } catch (error) {
      log.debug(
        `Failed to enrich players with ELO: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  return match;
}

/**
 * GET /api/matches/:slug.json
 * Protected endpoint for MatchZy to fetch match configuration
 * Returns a FRESH, on-demand config assembled from DB (reads veto_state)
 * Requires bearer token authentication from game server (kept commented for local dev)
 */
router.get('/:slug.json', async (req: Request, res: Response) => {
  try {
    // // Optional bearer token auth — enable when you wire SERVER_TOKEN on the game server
    // const authHeader = req.headers.authorization;
    // const expectedToken = process.env.SERVER_TOKEN;
    // if (!expectedToken) {
    //   return res.status(500).json({
    //     success: false,
    //     error: 'SERVER_TOKEN environment variable is not configured',
    //   });
    // }
    // if (!authHeader?.startsWith('Bearer ')) {
    //     return res.status(401).json({
    //       success: false,
    //       error: 'Missing or invalid authorization header. Expected: Bearer <token>',
    //     });
    // }
    // const token = authHeader.substring(7);
    // if (token !== expectedToken) {
    //   return res.status(403).json({ success: false, error: 'Invalid bearer token' });
    // }

    const { slug } = req.params;

    // 1) Load the match row
    const match = await db.queryOneAsync<DbMatchRow>('SELECT * FROM matches WHERE slug = ?', [
      slug,
    ]);
    if (!match) {
      return res.status(404).json({
        success: false,
        error: `Match configuration '${slug}' not found`,
      });
    }

    // Manual / non-bracket matches:
    // We treat any match with round = 0 as a manually created match. For these,
    // we return the stored config from the `matches.config` column instead of
    // generating a fresh tournament-backed config. This allows admins to create
    // ad hoc matches that are independent from the tournament bracket.
    if (match.round === 0) {
      let storedConfig: Partial<MatchConfig> = {};
      try {
        storedConfig = match.config ? (JSON.parse(match.config) as Partial<MatchConfig>) : {};
      } catch (e) {
        console.error('Failed to parse stored match config for manual match', e);
        storedConfig = {};
      }

      const normalizePlayers = (value: unknown): MatchPlayer => {
        if (!value) return {};

        // Case 1: already a map of steamId -> name
        if (typeof value === 'object' && !Array.isArray(value)) {
          const result: MatchPlayer = {};
          for (const [steamId, name] of Object.entries(value as Record<string, unknown>)) {
            if (typeof name === 'string') {
              result[steamId] = name;
            }
          }
          return result;
        }

        // Case 2: array of { steamid/name } objects from the manual match modal
        if (Array.isArray(value)) {
          const result: MatchPlayer = {};
          for (const entry of value as Array<unknown>) {
            if (!entry || typeof entry !== 'object') continue;
            const steamid =
              (entry as { steamid?: string; steamId?: string }).steamid ||
              (entry as { steamid?: string; steamId?: string }).steamId;
            const name = (entry as { name?: string }).name;
            if (steamid && name) {
              result[steamid] = name;
            }
          }
          return result;
        }

        // Fallback: unknown shape
        return {};
      };

      // Ensure required fields for MatchZy are present.
      const safeConfig: MatchConfig = {
        ...storedConfig,
        matchid: match.id,
        players_per_team:
          typeof storedConfig.players_per_team === 'number' && storedConfig.players_per_team > 0
            ? storedConfig.players_per_team
            : 5,
        num_maps:
          typeof storedConfig.num_maps === 'number' && storedConfig.num_maps > 0
            ? storedConfig.num_maps
            : Array.isArray(storedConfig.maplist) && storedConfig.maplist.length > 0
            ? storedConfig.maplist.length
            : 1,
        maplist: storedConfig.maplist ?? null,
        skip_veto: true,
        spectators: {
          players: normalizePlayers(storedConfig.spectators?.players),
        },
        team1:
          storedConfig.team1 && storedConfig.team1.name
            ? {
                ...storedConfig.team1,
                players: normalizePlayers(
                  (storedConfig.team1 as { players?: unknown } | undefined)?.players
                ),
              }
            : {
                name: 'Team 1',
                players: {},
              },
        team2:
          storedConfig.team2 && storedConfig.team2.name
            ? {
                ...storedConfig.team2,
                players: normalizePlayers(
                  (storedConfig.team2 as { players?: unknown } | undefined)?.players
                ),
              }
            : {
                name: 'Team 2',
                players: {},
              },
      };

      return res.json(safeConfig);
    }

    // 2) Load the tournament row for bracket-managed matches
    const t = await db.queryOneAsync<DbTournamentRow>('SELECT * FROM tournament WHERE id = ?', [
      match.tournament_id ?? 1,
    ]);
    if (!t) {
      return res.status(500).json({
        success: false,
        error: 'Tournament not found',
      });
    }

    // 3) Hydrate a Tournament-like object for config generation
    const tournament: TournamentResponse = {
      id: t.id,
      name: t.name,
      type: t.type as TournamentResponse['type'],
      format: t.format as TournamentResponse['format'],
      status: t.status as TournamentResponse['status'],
      maps: JSON.parse(t.maps),
      teamIds: JSON.parse(t.team_ids),
      settings: t.settings ? JSON.parse(t.settings) : {},
      created_at: t.created_at,
      updated_at: t.updated_at ?? t.created_at,
      started_at: t.started_at,
      completed_at: t.completed_at,
      teams: [], // Not needed for config generation
      // Carry shuffle / round-limit fields so matchConfigBuilder can honor them.
      mapSequence: t.map_sequence ? JSON.parse(t.map_sequence) : undefined,
      teamSize:
        t.team_size === null || typeof t.team_size === 'undefined' ? undefined : t.team_size,
      maxRounds:
        t.max_rounds === null || typeof t.max_rounds === 'undefined'
          ? undefined
          : t.max_rounds,
      overtimeMode: (t.overtime_mode as 'enabled' | 'disabled' | null) || undefined,
      overtimeSegments:
        t.overtime_segments === null || typeof t.overtime_segments === 'undefined'
          ? undefined
          : t.overtime_segments,
      eloTemplateId: t.elo_template_id ?? undefined,
    };

    // 4) Generate a fresh config (reads veto_state internally)
    const fresh = await generateMatchConfig(
      tournament,
      match.team1_id ?? undefined,
      match.team2_id ?? undefined,
      slug
    );

    // Return raw MatchZy config
    return res.json(fresh);
  } catch (error) {
    console.error('Error fetching match config:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch match configuration',
    });
  }
});

/**
 * DELETE /api/matches/:slug
 * Delete a match by slug (admin only).
 *
 * IMPORTANT: For safety, this endpoint only allows deleting **manual**
 * matches (round = 0). Bracket/tournament matches are tightly coupled to
 * the tournament structure (next_match_id, standings, history, etc.) and
 * must be reset via the dedicated tournament reset/regeneration flows
 * instead of being deleted piecemeal.
 */
router.delete('/:slug', requireAuth, async (req: Request, res: Response) => {
  try {
    const { slug } = req.params;

    const match = await db.queryOneAsync<DbMatchRow>('SELECT * FROM matches WHERE slug = ?', [
      slug,
    ]);
    if (!match) {
      return res.status(404).json({
        success: false,
        error: 'Match not found',
      });
    }

    // Guardrail: only allow deleting manual (non‑bracket) matches.
    // Bracket matches always have round >= 1 and are managed by the
    // tournament/bracket flows; deleting them directly could corrupt
    // progression or historical stats.
    if (match.round !== 0) {
      return res.status(400).json({
        success: false,
        error:
          'Deleting bracket/tournament matches is not supported. Use the tournament reset/regeneration tools instead.',
      });
    }

    await matchService.deleteMatch(slug);
    emitMatchUpdate({ slug, deleted: true });
    log.success(`Match deleted via API: ${slug}`);

    return res.json({ success: true });
  } catch (error) {
    console.error('Error deleting match:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to delete match',
    });
  }
});

/**
 * POST /api/matches/bulk-delete
 * Bulk delete **manual** matches by slug array (admin only).
 *
 * This reuses the same guardrails as the single-delete endpoint:
 * - Only matches with round = 0 are eligible.
 */
router.post('/bulk-delete', requireAuth, async (req: Request, res: Response) => {
  try {
    const { slugs } = req.body as { slugs?: string[] };

    if (!Array.isArray(slugs) || slugs.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Request body must include a non-empty slugs array',
      });
    }

    let deleted = 0;
    const skipped: { slug: string; reason: string }[] = [];
    const failed: { slug: string; error: string }[] = [];

    for (const slug of slugs) {
      try {
        const match = await db.queryOneAsync<DbMatchRow>(
          'SELECT * FROM matches WHERE slug = ?',
          [slug]
        );
        if (!match) {
          skipped.push({ slug, reason: 'not_found' });
          continue;
        }
        if (match.round !== 0) {
          skipped.push({ slug, reason: 'not_manual_round_0' });
          continue;
        }

        await matchService.deleteMatch(slug);
        emitMatchUpdate({ slug, deleted: true });
        deleted += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to delete match';
        failed.push({ slug, error: message });
        log.error('Error bulk deleting match', { error, slug });
      }
    }

    const statusCode = failed.length > 0 ? 207 : 200;
    return res.status(statusCode).json({
      success: failed.length === 0,
      deleted,
      skipped,
      failed,
    });
  } catch (error) {
    console.error('Error bulk deleting matches:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to bulk delete matches',
    });
  }
});

/**
 * GET /api/matches
 * List all matches (public - used by team pages)
 * Returns tournament matches with team information
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const serverId = req.query.serverId as string | undefined;

    // Fetch matches with tournament and server information
    let query = `
      SELECT 
        m.*,
        t1.id as team1_id, t1.name as team1_name, t1.tag as team1_tag,
        t2.id as team2_id, t2.name as team2_name, t2.tag as team2_tag,
        w.id as winner_id, w.name as winner_name, w.tag as winner_tag,
        s.name as server_name
      FROM matches m
      LEFT JOIN teams t1 ON m.team1_id = t1.id
      LEFT JOIN teams t2 ON m.team2_id = t2.id
      LEFT JOIN teams w ON m.winner_id = w.id
      LEFT JOIN servers s ON m.server_id = s.id
    `;

    const params: unknown[] = [];
    if (serverId) {
      query += ' WHERE m.server_id = ?';
      params.push(serverId);
    }

    query += ' ORDER BY m.created_at DESC';

    // This query includes JOIN columns that extend DbMatchRow
    const rows = await db.queryAsync<
      DbMatchRow & {
        team1_name?: string;
        team1_tag?: string;
        team2_name?: string;
        team2_tag?: string;
        winner_name?: string;
        winner_tag?: string;
        demo_file_path?: string;
        server_name?: string | null;
      }
    >(query, params);

    // Get tournament type once (optimization to avoid N+1 queries)
    const tournamentType = await db.queryOneAsync<{ type: string }>(
      'SELECT type FROM tournament WHERE id = ?',
      [rows[0]?.tournament_id || 1]
    );
    const isShuffleTournament = tournamentType?.type === 'shuffle';

    // Transform players from dictionary to array for frontend
    const matches: MatchListItem[] = await Promise.all(
      rows.map(async (row) => {
        const config = row.config ? JSON.parse(row.config as string) : {};
        const vetoState = row.veto_state ? JSON.parse(row.veto_state as string) : null;

        // Normalize players and enrich with avatars from team data
        const normalizedTeam1Players = config.team1
          ? normalizeConfigPlayers(config.team1.players)
          : [];
        const normalizedTeam2Players = config.team2
          ? normalizeConfigPlayers(config.team2.players)
          : [];

        // Enrich players with avatars from team records if team IDs are available
        let enrichedTeam1Players = normalizedTeam1Players;
        let enrichedTeam2Players = normalizedTeam2Players;

        if (config.team1?.id && row.team1_id) {
          try {
            const team1Data = await teamService.getTeamById(config.team1.id);
            if (team1Data?.players) {
              const avatarMap = new Map(
                team1Data.players.map((p) => [p.steamId.toLowerCase(), p.avatar])
              );
              enrichedTeam1Players = normalizedTeam1Players.map((p) => ({
                ...p,
                avatar: p.avatar || avatarMap.get(p.steamid.toLowerCase()),
              }));
            }
          } catch (error) {
            log.debug(
              `Failed to enrich team1 players with avatars: ${
                error instanceof Error ? error.message : String(error)
              }`
            );
          }
        }

        if (config.team2?.id && row.team2_id) {
          try {
            const team2Data = await teamService.getTeamById(config.team2.id);
            if (team2Data?.players) {
              const avatarMap = new Map(
                team2Data.players.map((p) => [p.steamId.toLowerCase(), p.avatar])
              );
              enrichedTeam2Players = normalizedTeam2Players.map((p) => ({
                ...p,
                avatar: p.avatar || avatarMap.get(p.steamid.toLowerCase()),
              }));
            }
          } catch (error) {
            log.debug(
              `Failed to enrich team2 players with avatars: ${
                error instanceof Error ? error.message : String(error)
              }`
            );
          }
        }

        // Transform config to include properly formatted team players with avatars
        const transformedConfig = {
          ...config,
          team1: config.team1
            ? {
                ...config.team1,
                players: enrichedTeam1Players,
              }
            : undefined,
          team2: config.team2
            ? {
                ...config.team2,
                players: enrichedTeam2Players,
              }
            : undefined,
        };

        const match: MatchListItem = {
          id: row.id,
          slug: row.slug,
          round: row.round,
          matchNumber: row.match_number,
          team1:
            row.team1_id && row.team1_name
              ? {
                  id: row.team1_id,
                  name: row.team1_name,
                  tag: row.team1_tag,
                }
              : undefined,
          team2:
            row.team2_id && row.team2_name
              ? {
                  id: row.team2_id,
                  name: row.team2_name,
                  tag: row.team2_tag,
                }
              : undefined,
          winner:
            row.winner_id && row.winner_name
              ? {
                  id: row.winner_id,
                  name: row.winner_name,
                  tag: row.winner_tag,
                }
              : undefined,
          status: row.status,
          serverId: row.server_id,
          serverName: row.server_name || undefined,
          config: transformedConfig,
          demoFilePath: row.demo_file_path,
          createdAt: row.created_at ?? 0,
          loadedAt: row.loaded_at,
          completedAt: row.completed_at,
          vetoCompleted: vetoState?.status === 'completed',
          currentMap: row.current_map ?? undefined,
          mapNumber: typeof row.map_number === 'number' ? row.map_number : undefined,
          maps: undefined,
        };

        const mapResults = await getMapResults(row.slug);
        if (mapResults.length > 0) {
          match.mapResults = mapResults;
        }

        if (Array.isArray(vetoState?.pickedMaps) && vetoState.pickedMaps.length > 0) {
          const orderedPickedMaps = [...vetoState.pickedMaps].sort(
            (a: { mapNumber?: number }, b: { mapNumber?: number }) =>
              (a.mapNumber || 0) - (b.mapNumber || 0)
          );
          const pickedMapNames = orderedPickedMaps
            .map((m: { mapName?: string | null }) => m.mapName)
            .filter((name): name is string => Boolean(name));
          if (pickedMapNames.length > 0) {
            match.maps = pickedMapNames;
          }
        }

        if (!match.maps && mapResults.length > 0) {
          const resultsMaps = mapResults
            .map((result) => result.mapName)
            .filter((name): name is string => Boolean(name));
          if (resultsMaps.length > 0) {
            match.maps = resultsMaps;
          }
        }

        // Enrich match with player stats and scores from persisted events
        await enrichMatch(match, row.slug);

        // For COMPLETED matches, if we still don't have any non‑zero score, fall
        // back to the final map result so the admin never sees "0‑0" after a
        // full game has been played (especially for BO1/manual matches).
        if (
          row.status === 'completed' &&
          (!Number.isFinite(match.team1Score as number) || !Number.isFinite(match.team2Score as number) ||
            ((match.team1Score as number) === 0 && (match.team2Score as number) === 0)) &&
          mapResults.length > 0
        ) {
          const lastResult = mapResults[mapResults.length - 1];
          match.team1Score = lastResult.team1Score;
          match.team2Score = lastResult.team2Score;
        }

        // For matches that are still in progress, optionally overlay in‑memory
        // live stats so the admin "Matches" page reflects the most recent
        // score. As with the bracket view, prefer a positive series score when
        // available (e.g. 1‑0 in a BO3); otherwise fall back to current map
        // rounds (e.g. 8‑5) so we don't show 0‑0 while rounds are being played.
        if (row.status !== 'completed') {
          const liveStats = matchLiveStatsService.getStats(row.slug);
          if (liveStats) {
            const liveTeam1 =
              typeof liveStats.team1SeriesScore === 'number' && liveStats.team1SeriesScore > 0
                ? liveStats.team1SeriesScore
                : liveStats.team1Score;
            const liveTeam2 =
              typeof liveStats.team2SeriesScore === 'number' && liveStats.team2SeriesScore > 0
                ? liveStats.team2SeriesScore
                : liveStats.team2Score;

            if (typeof liveTeam1 === 'number' && Number.isFinite(liveTeam1)) {
              match.team1Score = liveTeam1;
            }
            if (typeof liveTeam2 === 'number' && Number.isFinite(liveTeam2)) {
              match.team2Score = liveTeam2;
            }
          }
        }

        // For shuffle tournaments, enrich players with ELO
        if (
          isShuffleTournament &&
          (enrichedTeam1Players.length > 0 || enrichedTeam2Players.length > 0)
        ) {
          try {
            const allSteamIds = [
              ...enrichedTeam1Players.map((p) => p.steamid),
              ...enrichedTeam2Players.map((p) => p.steamid),
            ];

            if (allSteamIds.length > 0) {
              const players = await playerService.getPlayersByIds(allSteamIds);
              const eloMap = new Map(players.map((p) => [p.id.toLowerCase(), p.current_elo]));

              // Add ELO to team1 players
              enrichedTeam1Players = enrichedTeam1Players.map((p) => ({
                ...p,
                elo: eloMap.get(p.steamid.toLowerCase()),
              }));

              // Add ELO to team2 players
              enrichedTeam2Players = enrichedTeam2Players.map((p) => ({
                ...p,
                elo: eloMap.get(p.steamid.toLowerCase()),
              }));

              // Update config with enriched players
              if (transformedConfig.team1) {
                transformedConfig.team1.players = enrichedTeam1Players;
              }
              if (transformedConfig.team2) {
                transformedConfig.team2.players = enrichedTeam2Players;
              }
              match.config = transformedConfig;
            }
          } catch (error) {
            log.debug(
              `Failed to enrich players with ELO: ${
                error instanceof Error ? error.message : String(error)
              }`
            );
          }
        }

        return match;
      })
    );

    // Get tournament status
    const tournamentStatus = await db.queryOneAsync<{ status: string }>(
      'SELECT status FROM tournament WHERE id = 1'
    );

    return res.json({
      success: true,
      count: matches.length,
      tournamentStatus: tournamentStatus?.status || 'setup',
      matches,
    });
  } catch (error) {
    console.error('Error fetching matches:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch matches',
    });
  }
});

/**
 * GET /api/matches/:slug
 * Get match details (public - used by team pages)
 */
router.get('/:slug', async (req: Request, res: Response) => {
  try {
    const { slug } = req.params;
    const match = await getMatchDetailsBySlug(slug);

    if (!match) {
      return res.status(404).json({
        success: false,
        error: `Match '${slug}' not found`,
      });
    }

    return res.json({
      success: true,
      match,
    });
  } catch (error) {
    console.error('Error fetching match:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch match',
    });
  }
});

/**
 * POST /api/matches
 * Create a new match configuration (authenticated)
 */
router.post('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const input: CreateMatchInput = req.body;

    if (!input.slug || !input.config) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: slug, config',
      });
    }

    // Validate config structure
    if (!input.config.team1 || !input.config.team2) {
      return res.status(400).json({
        success: false,
        error: 'Match config must include team1 and team2',
      });
    }

    const baseUrl = getBaseUrl(req);
    const webhookBaseUrl = await getWebhookBaseUrl(req);
    const match = await matchService.createMatch(input, baseUrl);

    // When no serverId is provided, attempt to auto-allocate a server for
    // this match using the same allocator used for tournament matches. This
    // is primarily used for manual matches so the admin does not need to pick
    // a specific server; they just say "play this match" and the API finds a
    // suitable host.
    if (!input.serverId) {
      // Fire-and-forget auto-allocation so match creation returns quickly and
      // the UI doesn't block on potentially slow RCON / connectivity checks.
      setImmediate(async () => {
        try {
          const allocation = await matchAllocationService.allocateSingleMatch(
            match.slug,
            webhookBaseUrl
          );
          if (!allocation.success) {
            log.warn(
              `Auto-allocation failed for manual match ${match.slug}: ${allocation.error}`
            );
          }
        } catch (allocError) {
          log.warn(
            `Auto-allocation threw for manual match ${match.slug}`,
            allocError as Error
          );
        }
      });
    }

    return res.status(201).json({
      success: true,
      message: 'Match created successfully',
      match,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create match';
    const statusCode = message.includes('already exists')
      ? 409
      : message.includes('not found')
      ? 404
      : 400;

    console.error('Error creating match:', error);
    return res.status(statusCode).json({
      success: false,
      error: message,
    });
  }
});

/**
 * POST /api/matches/:slug/load
 * Load match on server via RCON (authenticated)
 * Automatically configures webhook unless ?skipWebhook=true
 */
router.post('/:slug/load', requireAuth, async (req: Request, res: Response) => {
  try {
    const { slug } = req.params;
    const skipWebhook = req.query.skipWebhook === 'true';
    const match = await matchService.getMatchBySlug(slug, getBaseUrl(req));

    if (!match) {
      return res.status(404).json({
        success: false,
        error: `Match '${slug}' not found`,
      });
    }

    const baseUrl = await getWebhookBaseUrl(req);

    // For manual matches (round = 0), double‑check that the selected server is
    // still truly available at load time. The admin UI already filters
    // "busy"/non‑allocatable servers out of the dropdown, but there is still a
    // race window where a server can become allocated between the time the
    // modal is opened and the match is created. If that happens, we try to
    // transparently re‑allocate the match to a different idle server instead
    // of letting it hang forever.
    let serverIdToUse = match.serverId;
    if (typeof match.round === 'number' && match.round === 0 && match.serverId) {
      const busy = await db.queryOneAsync<{ count: number }>(
        `SELECT COUNT(*) as count
           FROM matches
          WHERE server_id = ?
            AND slug != ?
            AND status IN ('ready', 'loaded', 'live')`,
        [match.serverId, slug]
      );

      if (busy && busy.count > 0) {
        log.warn(
          `Manual match ${slug} requested busy server ${match.serverId}; attempting re‑allocation`
        );

        const availableServers = await matchAllocationService.getAvailableServers();
        const fallback = availableServers.find((s) => s.id !== match.serverId);

        if (fallback) {
          await db.updateAsync('matches', { server_id: fallback.id }, 'id = ?', [match.id]);
          serverIdToUse = fallback.id;
          log.success(
            `Re‑allocated manual match ${slug} from busy server ${match.serverId} to ${fallback.id}`
          );
        } else {
          return res.status(409).json({
            success: false,
            error:
              'Selected server is now busy with another match and no alternative idle servers are available. Please try again in a moment or free up a server.',
          });
        }
      }
    }

    // Use centralized match loading service
    const result = await loadMatchOnServer(slug, serverIdToUse, {
      skipWebhook,
      baseUrl,
    });

    if (result.success) {
      return res.status(200).json({
        success: true,
        message: result.webhookConfigured
          ? 'Match loaded and webhook configured'
          : 'Match loaded (webhook skipped)',
        webhookConfigured: result.webhookConfigured,
        demoUploadConfigured: result.demoUploadConfigured,
        match: await matchService.getMatchBySlug(slug, getBaseUrl(req)),
        rconResponses: result.rconResponses,
      });
    } else {
      return res.status(400).json({
        success: false,
        error: result.error || 'Failed to load match',
        webhookConfigured: result.webhookConfigured,
        demoUploadConfigured: result.demoUploadConfigured,
        rconResponses: result.rconResponses,
      });
    }
  } catch (error) {
    console.error('Error loading match:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to load match on server',
    });
  }
});

/**
 * POST /api/matches/:slug/restart
 * Restart a match - end it and reload it (authenticated)
 */
router.post('/:slug/restart', requireAuth, async (req: Request, res: Response) => {
  try {
    const { slug } = req.params;
    const baseUrl = await getWebhookBaseUrl(req);

    const result = await matchAllocationService.restartMatch(slug, baseUrl);

    if (result.success) {
      log.success(`Match ${slug} restarted successfully`);

      // Emit match restart event
      const updatedMatch = await matchService.getMatchBySlug(slug, baseUrl);
      if (updatedMatch) {
        emitMatchUpdate(updatedMatch);
        emitBracketUpdate({ action: 'match_restarted', matchSlug: slug });
      }

      return res.json({
        success: true,
        message: result.message,
        match: updatedMatch,
      });
    } else {
      return res.status(400).json({
        success: false,
        error: result.message,
      });
    }
  } catch (error) {
    log.error(`Error restarting match`, error);
    return res.status(500).json({
      success: false,
      error: 'Failed to restart match',
    });
  }
});

/**
 * PATCH /api/matches/:slug/status
 * Update match status (authenticated)
 */
router.patch('/:slug/status', requireAuth, async (req: Request, res: Response) => {
  try {
    const { slug } = req.params;
    const { status } = req.body;

    if (!status || !['pending', 'loaded', 'live', 'completed'].includes(status)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid status. Must be: pending, loaded, live, or completed',
      });
    }

    await matchService.updateMatchStatus(slug, status);
    const match = await matchService.getMatchBySlug(slug, getBaseUrl(req));

    return res.json({
      success: true,
      message: 'Match status updated',
      match,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to update status';
    const statusCode = message.includes('not found') ? 404 : 500;

    console.error('Error updating match status:', error);
    return res.status(statusCode).json({
      success: false,
      error: message,
    });
  }
});

/**
 * DELETE /api/matches/:slug
 * Delete a match (authenticated)
 */
router.delete('/:slug', requireAuth, async (req: Request, res: Response) => {
  try {
    const { slug } = req.params;
    await matchService.deleteMatch(slug);

    return res.json({
      success: true,
      message: 'Match deleted successfully',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to delete match';
    const statusCode = message.includes('not found') ? 404 : 500;

    console.error('Error deleting match:', error);
    return res.status(statusCode).json({
      success: false,
      error: message,
    });
  }
});

export default router;
