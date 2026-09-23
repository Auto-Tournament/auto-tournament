import { Router, Request, Response } from 'express';
import { matchService } from '../services/matchService';
import { scheduler } from '../core/scheduler';
import { CreateMatchInput, MatchConfig, MatchListItem } from '../types/match.types';
import { TournamentResponse } from '../types/tournament.types';
import { requestActorId, requireAuth } from '../middleware/auth';
import { MATCH_CONFIG_FETCHED_BY_SERVER, requireMatchConfigAccess } from '../middleware/serverAuth';
import { log } from '../utils/logger';
import { db } from '../config/database';
import { matchConfigFetchTracker } from '../services/matchConfigFetchTracker';
import {
  checkConfigFetch,
  readQueryString,
  SERVER_ID_PARAM,
  MATCH_ID_PARAM,
} from '../utils/serverAttribution';
import type { DbMatchRow, DbTournamentRow } from '../types/database.types';
import { DEFAULT_GAME } from '../integrations/types';
import { getBaseUrl, getWebhookBaseUrl } from '../utils/urlHelper';
import { emitMatchUpdate, emitBracketUpdate } from '../services/socketService';
import {
  buildMatchConfigFor,
  currentMatchConfig,
  describeMatch,
  describedPlayers,
} from '../utils/matchIntegration';
import { applyScoreFields, enrichMatch } from '../utils/matchEnrichment';
import { matchLiveStatsService } from '../services/matchLiveStatsService';
import { teamService } from '../services/teamService';
import { playerService } from '../services/playerService';
import { getMapResults } from '../services/matchMapResultService';
import {
  resolveTournamentId,
  tournamentIdForMatch,
  tournamentRowToResponse,
} from '../utils/tournamentRow';
import { compareQueueOrder, isQueueable, matchBracketOf } from '../core/allocationQueue';

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
    [tournamentIdForMatch(row)]
  );
  const isShuffleTournament = tournamentType?.type === 'shuffle';

  // For bracket-managed matches (round >= 1) rebuild the config on demand so
  // team rosters and settings always reflect the latest DB state instead of a
  // stale snapshot from when the match was first generated. Manual matches
  // (round = 0) keep their stored config as-is.
  // Integration-owned; forwarded to the client below (client slots: PR 12).
  const config = (await currentMatchConfig(row)) as MatchConfig | Record<string, unknown>;
  const description = describeMatch({ game: row.game, config });
  const vetoState = row.veto_state ? JSON.parse(row.veto_state as string) : null;

  // Normalize players from config
  const normalizedTeam1Players = describedPlayers(description.team1);
  const normalizedTeam2Players = describedPlayers(description.team2);

  // Enrich players with avatars from team records if team IDs are available
  let enrichedTeam1Players = normalizedTeam1Players;
  let enrichedTeam2Players = normalizedTeam2Players;

  if (description.team1.id && row.team1_id) {
    try {
      const team1Data = await teamService.getTeamById(description.team1.id);
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

  if (description.team2.id && row.team2_id) {
    try {
      const team2Data = await teamService.getTeamById(description.team2.id);
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

  // Manual matches: no team rows in DB, enrich avatars from players table
  if (!row.team1_id && !row.team2_id) {
    const allSteamIds = [
      ...normalizedTeam1Players.map((p) => p.steamid),
      ...normalizedTeam2Players.map((p) => p.steamid),
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
        enrichedTeam1Players = normalizedTeam1Players.map((p) => ({
          ...p,
          avatar: p.avatar || avatarMap.get(p.steamid.toLowerCase()),
        }));
        enrichedTeam2Players = normalizedTeam2Players.map((p) => ({
          ...p,
          avatar: p.avatar || avatarMap.get(p.steamid.toLowerCase()),
        }));
      } catch (error) {
        log.debug(
          `Failed to enrich manual-match players with avatars: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
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
    game: row.game || DEFAULT_GAME,
    round: row.round,
    matchNumber: row.match_number,
    bracket: matchBracketOf(row),
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
  applyScoreFields(match, {
    status: row.status,
    mapResults,
    liveStats: row.status !== 'completed' ? matchLiveStatsService.getStats(row.slug) : null,
  });

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
 * @openapi
 * /api/matches/{slug}.json:
 *   get:
 *     tags:
 *       - Matches
 *     summary: Match config for MatchZy
 *     description: |
 *       The MatchZy match config the game server downloads when MAT sends
 *       `matchzy_loadmatch_url "<url>" "X-MatchZy-Token" "<SERVER_TOKEN>"`.
 *       Assembled fresh from the database on every request.
 *
 *       Requires `X-MatchZy-Token: <SERVER_TOKEN>` (game servers) or admin
 *       auth: a session, or a service token (read-only scope is enough). A
 *       request presenting a wrong `X-MatchZy-Token` is refused even with an
 *       admin session.
 *
 *       `server_id` and `match_id` are added by MAT to the URL it sends; when
 *       present, the fetch is refused with 409 if the match has since moved to
 *       another server or the slug now belongs to a different match.
 *     security:
 *       - matchzyServerToken: []
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: slug
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: server_id
 *         required: false
 *         schema:
 *           type: string
 *       - in: query
 *         name: match_id
 *         required: false
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: MatchZy match config (JSON)
 *       401:
 *         description: Missing or wrong X-MatchZy-Token and no admin auth
 *       404:
 *         description: Match not found
 *       409:
 *         description: The load this fetch belongs to no longer applies
 */
/**
 * GET /api/matches/:slug.json
 * Endpoint MatchZy fetches the match configuration from.
 * Returns a FRESH, on-demand config assembled from DB (reads veto_state)
 * Requires `X-MatchZy-Token: <SERVER_TOKEN>` (sent by the plugin, see
 * getMatchZyLoadMatchCommand) or an admin session / service token.
 */
router.get('/:slug.json', requireMatchConfigAccess, async (req: Request, res: Response) => {
  try {
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

    // A fetch carrying server_id / match_id is MatchZy acting on a load MAT sent
    // earlier - possibly minutes earlier, if the plugin queued it behind a
    // series in postgame. If the match has moved to another server since, or
    // the slug now belongs to a new match (tournament reset), refuse: MatchZy
    // has no command to cancel a queued load, so this is where it is stopped.
    // Fetches without the parameters (older loads, manual tooling) are served.
    const verdict = checkConfigFetch(
      match,
      readQueryString(req.query[SERVER_ID_PARAM]),
      readQueryString(req.query[MATCH_ID_PARAM])
    );
    if (!verdict.ok) {
      log.warn('[MATCH CONFIG] Refusing config fetch for a load that no longer applies', {
        slug,
        matchId: match.id,
        assignedServerId: match.server_id ?? null,
        requestedServerId: readQueryString(req.query[SERVER_ID_PARAM]),
        requestedMatchId: readQueryString(req.query[MATCH_ID_PARAM]),
        reason: verdict.reason,
      });
      return res.status(409).json({
        success: false,
        error: `Match configuration '${slug}' is not available to this server: ${verdict.reason}`,
      });
    }

    // The game server fetching this config is the only reliable proof that
    // MatchZy accepted the load command - see matchConfigFetchTracker. An admin
    // viewing the config proves nothing, so only a server's fetch counts.
    if (res.locals[MATCH_CONFIG_FETCHED_BY_SERVER] === true) {
      matchConfigFetchTracker.record(slug);
    }

    // Manual / non-bracket matches:
    // We treat any match with round = 0 as a manually created match. For these,
    // the integration serves the stored `matches.config` instead of generating
    // a fresh tournament-backed config. This allows admins to create ad hoc
    // matches that are independent from the tournament bracket.
    if (match.round === 0) {
      const served = await buildMatchConfigFor(
        { slug, id: match.id, game: match.game, round: 0 },
        null
      );
      return res.json(served);
    }

    // 2) Load the tournament row for bracket-managed matches
    const t = await db.queryOneAsync<DbTournamentRow>('SELECT * FROM tournament WHERE id = ?', [
      tournamentIdForMatch(match),
    ]);
    if (!t) {
      return res.status(500).json({
        success: false,
        error: 'Tournament not found',
      });
    }

    // 3) Hydrate a Tournament-like object for config generation
    const tournament: TournamentResponse = tournamentRowToResponse(t);

    // 4) Build a fresh config through the match's integration (CS2 reads veto_state)
    const fresh = await buildMatchConfigFor(
      {
        slug,
        id: match.id,
        game: match.game,
        round: match.round,
        bracket: match.bracket,
        team1Id: match.team1_id,
        team2Id: match.team2_id,
      },
      tournament
    );

    // Return the raw game config (MatchZy JSON for CS2)
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

    // After bulk deletion, trigger immediate allocation if any servers were freed
    if (deleted > 0) {
      log.info(`Bulk deleted ${deleted} match(es), triggering immediate allocation`);
      setImmediate(() => {
        void scheduler.tryImmediateAllocation();
      });
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
    const tournamentId = resolveTournamentId(req);
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
      [tournamentIdForMatch(rows[0])]
    );
    const isShuffleTournament = tournamentType?.type === 'shuffle';

    // Transform players from dictionary to array for frontend
    const matches: MatchListItem[] = await Promise.all(
      rows.map(async (row) => {
        // For bracket-managed matches (round >= 1) rebuild config on demand so
        // admin views always see the latest team composition and settings. Manual
        // matches (round = 0) keep their stored config.
        // Integration-owned; forwarded to the client below (client slots: PR 12).
        const config = (await currentMatchConfig(row)) as MatchConfig | Record<string, unknown>;
        const description = describeMatch({ game: row.game, config });

        const vetoState = row.veto_state ? JSON.parse(row.veto_state as string) : null;

        // Normalize players and enrich with avatars from team data
        const normalizedTeam1Players = describedPlayers(description.team1);
        const normalizedTeam2Players = describedPlayers(description.team2);

        // Enrich players with avatars from team records if team IDs are available
        let enrichedTeam1Players = normalizedTeam1Players;
        let enrichedTeam2Players = normalizedTeam2Players;

        if (description.team1.id && row.team1_id) {
          try {
            const team1Data = await teamService.getTeamById(description.team1.id);
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

        if (description.team2.id && row.team2_id) {
          try {
            const team2Data = await teamService.getTeamById(description.team2.id);
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
          game: row.game || DEFAULT_GAME,
          round: row.round,
          matchNumber: row.match_number,
          bracket: matchBracketOf(row),
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

        // Normalise score fields: series (maps won), current map rounds, and the
        // headline team1Score/team2Score. See applyScoreFields for semantics.
        applyScoreFields(match, {
          status: row.status,
          mapResults,
          liveStats: row.status !== 'completed' ? matchLiveStatsService.getStats(row.slug) : null,
        });

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

    // Queue positions: only matches with both teams known and no server yet,
    // in the same order the allocator hands out servers (see allocationQueue).
    const waitingMatches = matches.filter(isQueueable).sort(compareQueueOrder);

    const queuePositionMap = new Map<number, number>();
    waitingMatches.forEach((match, index) => {
      queuePositionMap.set(match.id, index + 1);
    });

    // Apply queue positions to all matches
    matches.forEach((match) => {
      if (queuePositionMap.has(match.id)) {
        match.queuePosition = queuePositionMap.get(match.id)!;
      } else {
        match.queuePosition = null;
      }
    });

    // Get tournament status
    const tournamentStatus = await db.queryOneAsync<{ status: string }>(
      'SELECT status FROM tournament WHERE id = ?',
      [tournamentId]
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
    const tournamentId = resolveTournamentId(req);
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
    const match = await matchService.createMatch(input, baseUrl, tournamentId);

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
          const allocation = await scheduler.allocateSingleMatch(
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

    const row = await db.queryOneAsync<DbMatchRow>('SELECT * FROM matches WHERE slug = ?', [slug]);
    // What the match's integration needs its resources to reach us on (CS2:
    // the webhook URL from Settings; a game with no servers needs none).
    const baseUrl = row ? await scheduler.resolveBaseUrlForMatch(row) : '';

    // The integration loads it on the assigned server (for manual matches it
    // first moves the match off a server that has become busy since).
    const result = row ? await scheduler.loadMatch(row, { baseUrl, skipWebhook }) : null;
    if (!result) {
      return res.status(400).json({ success: false, error: 'Failed to load match' });
    }

    if (result.ok) {
      return res.status(200).json({
        success: true,
        message: result.message,
        ...result.details,
        match: await matchService.getMatchBySlug(slug, getBaseUrl(req)),
      });
    } else if (result.conflict) {
      return res.status(409).json({ success: false, error: result.error });
    } else {
      return res.status(400).json({
        success: false,
        error: result.error,
        ...result.details,
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

    const row = await db.queryOneAsync<DbMatchRow>('SELECT * FROM matches WHERE slug = ?', [slug]);
    const baseUrl = row ? await scheduler.resolveBaseUrlForMatch(row) : '';
    const result = row
      ? await scheduler.restartMatch(row, { baseUrl })
      : ({ ok: false, error: 'Match not found' } as const);

    if (result.ok) {
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
        error: result.error,
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
 * POST /api/matches/:slug/reallocate
 * Reallocate a match to a different server (authenticated).
 *
 * Intended for pre-live recovery (e.g. the assigned server is out of date).
 * Allowed only when match status is 'ready' or 'loaded' (never during live play).
 */
router.post('/:slug/reallocate', requireAuth, async (req: Request, res: Response) => {
  try {
    const { slug } = req.params;

    const match = await db.queryOneAsync<DbMatchRow>('SELECT * FROM matches WHERE slug = ?', [
      slug,
    ]);

    if (!match) {
      return res.status(404).json({
        success: false,
        error: `Match '${slug}' not found`,
      });
    }

    const baseUrl = await scheduler.resolveBaseUrlForMatch(match);

    const status = match.status as string | null;
    if (status !== 'ready' && status !== 'loaded') {
      return res.status(400).json({
        success: false,
        error: `Match is in '${status}' status. Can only reallocate ready/loaded matches.`,
      });
    }

    const oldServerId = match.server_id;
    if (!oldServerId) {
      return res.status(409).json({
        success: false,
        error: 'Match has no server assigned. There is nothing to reallocate.',
      });
    }

    // The integration picks another free server, frees the old one and loads
    // the match on the new one.
    const moved = await scheduler.reallocateMatch(match, { baseUrl });

    if (!moved.ok) {
      return res.status(moved.conflict ? 409 : 400).json({
        success: false,
        error: moved.error,
        ...moved.details,
      });
    }

    const updatedMatch = await matchService.getMatchBySlug(slug, baseUrl);
    if (updatedMatch) {
      emitMatchUpdate(updatedMatch);
      emitBracketUpdate({ action: 'match_reallocated', matchSlug: slug });
    }

    return res.json({
      success: true,
      message: moved.message,
      match: updatedMatch,
      ...moved.details,
    });
  } catch (error) {
    log.error(`Error reallocating match`, error);
    return res.status(500).json({
      success: false,
      error: 'Failed to reallocate match',
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
 * POST /api/matches/:slug/winner
 * Admin decision: finish a series for team1 or team2 (authenticated).
 *
 * For a series that ran out of maps level (status 'needs_decision'), or one
 * stuck live/loaded because the plugin never sent series_end. Runs the normal
 * series_end path, so bracket progression, stats and ratings all apply.
 * Body: { winner: 'team1' | 'team2' }
 */
router.post('/:slug/winner', requireAuth, async (req: Request, res: Response) => {
  try {
    const { slug } = req.params;
    const winner = (req.body as { winner?: unknown } | undefined)?.winner;
    if (winner !== 'team1' && winner !== 'team2') {
      return res.status(400).json({ success: false, error: "winner must be 'team1' or 'team2'" });
    }
    const { setSeriesWinnerByAdmin } = await import('../core/matchLifecycle');
    const actorId = requestActorId(req);
    const result = await setSeriesWinnerByAdmin(slug, winner, actorId);
    if (!result.ok) {
      return res.status(result.status).json({ success: false, error: result.error });
    }
    const match = await getMatchDetailsBySlug(slug);
    return res.json({ success: true, message: 'Match winner set', match });
  } catch (error) {
    log.error('Error setting match winner', error);
    return res.status(500).json({ success: false, error: 'Failed to set match winner' });
  }
});

/**
 * POST /api/matches/:slug/force-cancel
 * Force cancel a match even if the server is unreachable (authenticated)
 * This will:
 * - Try to end the match on the server (best effort, doesn't fail if server is down)
 * - Mark the match as completed in database
 * - Free up the server allocation
 */
router.post('/:slug/force-cancel', requireAuth, async (req: Request, res: Response) => {
  try {
    const { slug } = req.params;
    
    // Get the match
    const match = await db.queryOneAsync<DbMatchRow>(
      'SELECT * FROM matches WHERE slug = ?',
      [slug]
    );

    if (!match) {
      return res.status(404).json({
        success: false,
        error: 'Match not found',
      });
    }

    const serverId = match.server_id;
    const warnings: string[] = [];

    // Try to end the match on the server (best effort)
    if (serverId) {
      try {
        await scheduler.cancelMatch(match, 'force-cancel');
      } catch (rconError) {
        // Don't fail the whole operation if RCON fails - this is the whole point
        const errorMsg = rconError instanceof Error ? rconError.message : String(rconError);
        log.warn(`Failed to send end match command to server (continuing anyway): ${errorMsg}`);
        warnings.push(`Server unreachable (${errorMsg}) - match marked as cancelled anyway`);
      }
    }

    // Same settle-up the End Match control performs; shared so the two paths
    // cannot drift apart.
    const { settleEndedMatch } = await import('../services/matchTerminationService');
    await settleEndedMatch(match, 'force-cancel');

    return res.json({
      success: true,
      message: 'Match cancelled successfully',
      warnings: warnings.length > 0 ? warnings : undefined,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to cancel match';
    log.error('Error force-cancelling match:', error);
    return res.status(500).json({
      success: false,
      error: message,
    });
  }
});

export default router;
