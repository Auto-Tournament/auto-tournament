import { Router, Request, Response } from 'express';
import { db } from '../config/database';
import { playerConnectionService } from '../services/playerConnectionService';
import { integrationForMatch } from '../integrations/registry';
import { DEFAULT_GAME } from '../integrations/types';
import { describeMatch, describedPlayers } from '../utils/matchIntegration';
import { normalizeConfigPlayers } from '../utils/playerTransform';
import { teamService } from '../services/teamService';
import { teamMembers, type TeamMemberRole } from '../services/teamMembers';
import { matchLiveStatsService, type MatchLiveStats } from '../services/matchLiveStatsService';
import type { DbMatchRow } from '../types/database.types';
import { getMapResults } from '../services/matchMapResultService';
import { resolveViewerIdentity } from '../utils/viewerIdentity';
import { log } from '../utils/logger';
import { resolveTournamentId } from '../utils/tournamentRow';
import { NEEDS_DECISION_STATUS } from '../utils/matchStatusHelpers';

const router = Router();

/**
 * Steam ID this request should be treated as (admin impersonation applied).
 */
async function getViewerSteamId(req: Request): Promise<string | null> {
  const { effectiveSteamId } = await resolveViewerIdentity(req);
  return effectiveSteamId;
}

/**
 * GET /team/:teamId/match
 * Get current or next match for a team (public, no auth required)
 * This is for teams to view their match info and connect to servers
 */
router.get('/:teamId/match', async (req: Request, res: Response) => {
  try {
    const tournamentId = resolveTournamentId(req);
    const { teamId } = req.params;

    // Check if team exists and get players
    const team = await db.queryOneAsync<{ id: string; name: string; tag: string; players: string }>(
      'SELECT id, name, tag, players FROM teams WHERE id = ?',
      [teamId]
    );

    if (!team) {
      return res.status(404).json({
        success: false,
        error: 'Team not found',
      });
    }

    // Parse players JSON (preserve avatar field)
    let parsedPlayers: Array<{
      steamId: string;
      name: string;
      avatar?: string;
      elo?: number;
      role?: TeamMemberRole;
    }> = [];
    if (team.players) {
      try {
        const playersObj = JSON.parse(team.players);
        // Convert {index: {name, steamId, avatar}} to [{steamId, name, avatar}]
        parsedPlayers = Object.values(playersObj).map((playerData: unknown) => {
          if (typeof playerData === 'string') {
            // Old format: {steamId: name}
            return { steamId: 'unknown', name: playerData };
          }
          // New format: {index: {name, steamId, avatar}}
          if (
            playerData &&
            typeof playerData === 'object' &&
            'steamId' in playerData &&
            'name' in playerData
          ) {
            const player = playerData as { steamId?: string; name?: string; avatar?: string };
            return {
              steamId: player.steamId || 'unknown',
              name: player.name || 'Unknown',
              avatar: player.avatar, // Preserve avatar if present
            };
          }
          return { steamId: 'unknown', name: 'Unknown' };
        });
      } catch (err) {
        console.error('[TeamMatch] Failed to parse players JSON:', err);
      }
    }

    // Roster ratings: the page sorted and labelled players by `elo`, which this
    // response never carried, so everyone read 1500.
    const rosterIds = parsedPlayers.map((p) => p.steamId).filter((id) => id && id !== 'unknown');
    if (rosterIds.length > 0) {
      const ratings = await db.queryAsync<{ id: string; current_elo: number; uid: string }>(
        `SELECT id, current_elo, uid FROM players WHERE id IN (${rosterIds.map(() => '?').join(', ')})`,
        rosterIds
      );
      const eloById = new Map(ratings.map((r) => [r.id, r.current_elo]));
      // The member's role (captain or member) from `team_members`, which is
      // keyed on the account, for the team page's roster.
      const roleByUid = new Map((await teamMembers.list(teamId)).map((m) => [m.accountUid, m.role]));
      const roleById = new Map(
        ratings
          .filter((r) => roleByUid.has(String(r.uid)))
          .map((r) => [r.id, roleByUid.get(String(r.uid)) as TeamMemberRole])
      );
      parsedPlayers = parsedPlayers.map((p) => ({
        ...p,
        ...(eloById.has(p.steamId) ? { elo: eloById.get(p.steamId) } : {}),
        ...(roleById.has(p.steamId) ? { role: roleById.get(p.steamId) } : {}),
      }));
    }

    // Find active match (loaded, live, or played but not yet settled).
    //
    // `needs_decision` belongs here (3.0 phase D, PR D8). It is a match that
    // has been *played* and is waiting for somebody to say what the result
    // was — a CS2 series that ran out of maps level, or a manually reported
    // result the opponent disputed. Leaving it out of both queries meant a
    // fresh page load answered `hasMatch: false`, so the team page told two
    // captains staring at an open dispute that they had no match, and the
    // report panel had no slug to render against. Ordered ahead of the
    // pending/ready query below on purpose: the match you have just played
    // and cannot get a result for is more current than the one you have not
    // started. A live or loaded match still wins over it, which the `ORDER BY`
    // says outright rather than leaving to `loaded_at` — both statuses carry
    // one.
    let match = await db.queryOneAsync<
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
      LEFT JOIN cs2_servers s ON m.server_id = s.id
      WHERE (m.team1_id = ? OR m.team2_id = ?)
        AND m.status IN ('loaded', 'live', ?)
      ORDER BY (m.status = ?) ASC, m.loaded_at DESC
      LIMIT 1`,
      [teamId, teamId, NEEDS_DECISION_STATUS, NEEDS_DECISION_STATUS]
    );

    // If no active match, find next pending/ready match
    if (!match) {
      match = await db.queryOneAsync<
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
        LEFT JOIN cs2_servers s ON m.server_id = s.id
        WHERE (m.team1_id = ? OR m.team2_id = ?)
          AND m.status IN ('pending', 'ready')
        ORDER BY m.round ASC, m.match_number ASC
        LIMIT 1`,
        [teamId, teamId]
      );

    }

    if (!match) {
      const currentTournament = await db.queryOneAsync<{ status: string }>(
        'SELECT status FROM tournament WHERE id = ?',
        [tournamentId]
      );
      return res.json({
        success: true,
        team: {
          id: team.id,
          name: team.name,
          tag: team.tag,
          players: parsedPlayers,
        },
        hasMatch: false,
        // Without this the page fell back to "setup" and told a finished
        // tournament's teams it hadn't started.
        tournamentStatus: currentTournament?.status || 'setup',
        message: 'No upcoming matches found',
      });
    }

    // Determine if this team is team1 or team2
    const isTeam1 = match.team1_id === teamId;
    const opponent = isTeam1
      ? { id: match.team2_id, name: match.team2_name, tag: match.team2_tag }
      : { id: match.team1_id, name: match.team1_name, tag: match.team1_tag };

    log.debug('[TeamMatch] Returning match for team', {
      teamId,
      matchSlug: match.slug,
      status: match.status,
      opponent: opponent.name || 'TBD',
      server: match.server_name || 'not assigned',
    });

    // Neutral view of the match config (rosters, maps) from its integration
    const description = describeMatch(match);

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
        const vetoState = JSON.parse(match.veto_state);
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
        console.error('[TeamMatch] Failed to parse veto_state:', e);
      }
    }

    // Get tournament status and format
    const tournament = await db.queryOneAsync<{ status: string; format: string }>(
      'SELECT status, format FROM tournament WHERE id = ?',
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
          integrationForMatch(match).resourceStatus?.(match.server_id) ?? Promise.resolve(null),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), 2000)),
        ]);

        if (statusInfo) {
          realServerStatus = statusInfo.status;
          serverStatusDescription = statusInfo.description;
        }
      } catch (error) {
        // Silently fail - server status is nice-to-have, not critical
        log.debug('[TeamMatch] Server status check failed (plugin ConVars may not exist yet)', {
          matchSlug: match.slug,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    await integrationForMatch(match).refreshPresence?.(match.slug);
    const connectionStatus = playerConnectionService.getStatus(match.slug);
    const liveStats = matchLiveStatsService.getStats(match.slug);

    const normalizedLiveStats = liveStats
      ? normalizeLiveStatsForTeamView(liveStats, isTeam1)
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
    const normalizedTeam1Players = describedPlayers(description.team1);
    const normalizedTeam2Players = describedPlayers(description.team2);

    // Determine whether the current viewer is actually on THIS team.
    // We intentionally scope this to the team whose page is being viewed
    // (teamId route param), not just "any team in the match", so opponents
    // cannot use the other team's link to see server or veto controls.
    //
    // The team's own roster decides this, not the match config. `config` is a
    // snapshot taken when the match was created, and it goes stale the moment
    // an admin edits the team — in both directions, both wrong:
    //
    //  - someone removed from the roster kept seeing the match server, because
    //    the snapshot still listed them;
    //  - someone added after the snapshot could not see their own server,
    //    which is the reported "the server shows on my player page but not on
    //    the team page".
    //
    // `veto.ts` already resolves membership this way, and for the same reason:
    // an admin correcting a roster should take effect immediately. The snapshot
    // is still the fallback for a team row that has no usable roster.
    const viewerSteamId = await getViewerSteamId(req);
    const rosterForThisTeam = normalizeConfigPlayers(
      (() => {
        try {
          return team.players ? JSON.parse(team.players) : [];
        } catch {
          return [];
        }
      })()
    );
    const snapshotForThisTeam = isTeam1 ? normalizedTeam1Players : normalizedTeam2Players;
    const playersForThisTeam =
      rosterForThisTeam.length > 0 ? rosterForThisTeam : snapshotForThisTeam;
    const viewerIsTeamMember =
      !!viewerSteamId && playersForThisTeam.some((p) => p.steamid === viewerSteamId);

    // Enrich players with avatars from team records
    const enrichPlayers = async (
      normalizedPlayers: Array<{ steamid: string; name: string }>,
      teamId?: string
    ) => {
      if (!teamId) return normalizedPlayers;
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
        log.debug('[TeamMatch] Failed to enrich players with avatars', {
          teamId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      return normalizedPlayers;
    };

    // Enrich both teams in parallel
    const [enrichedTeam1Players, enrichedTeam2Players] = await Promise.all([
      enrichPlayers(normalizedTeam1Players, description.team1.id),
      enrichPlayers(normalizedTeam2Players, description.team2.id),
    ]);

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
        game: match.game || DEFAULT_GAME,
        round: match.round,
        matchNumber: match.match_number,
        status: match.status,
        isTeam1,
        currentMap: match.current_map ?? null,
        mapNumber: match.map_number ?? null,
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
        server:
          match.server_id && viewerIsTeamMember
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
              connectedPlayers: connectionStatus.connectedPlayers.map((player) => ({
                steamId: player.steamId,
                name: player.name,
                team: player.team,
                connectedAt: player.connectedAt,
                isReady: player.isReady,
              })),
            }
          : null,
        liveStats: normalizedLiveStats,
        maps: pickedMaps.length > 0 ? pickedMaps : [], // Only show picked maps from veto
        mapResults: normalizedMapResults,
        // Veto summary is available to both teams and spectators so they can
        // see which maps were picked, but only verified team members will see
        // the interactive veto UI in the frontend.
        veto: vetoSummary,
        matchFormat: (tournament?.format as 'bo1' | 'bo3' | 'bo5') || 'bo3',
        loadedAt: match.loaded_at,
        // Neutral match summary, kept in the shape the team page reads.
        config: {
          maplist: description.maps.length > 0 ? description.maps : null,
          num_maps: description.seriesLength,
          players_per_team: description.playersPerTeam,
          expected_players_total: description.playersPerTeam ? description.playersPerTeam * 2 : 10,
          expected_players_team1: description.playersPerTeam || 5,
          expected_players_team2: description.playersPerTeam || 5,
          team1: {
            id: description.team1.id,
            name: description.team1.name,
            tag: description.team1.tag,
            flag: description.team1.flag,
            players: enrichedTeam1Players,
          },
          team2: {
            id: description.team2.id,
            name: description.team2.name,
            tag: description.team2.tag,
            flag: description.team2.flag,
            players: enrichedTeam2Players,
          },
        },
        // Used by the frontend to decide whether to show sensitive controls
        // like veto actions and server connection details.
        viewerIsTeamMember,
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

function normalizeLiveStatsForTeamView(
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
