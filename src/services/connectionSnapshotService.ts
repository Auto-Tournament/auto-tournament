import { db } from '../config/database';
import { rconService } from './rconService';
import { playerConnectionService, type ConnectedPlayer } from './playerConnectionService';
import type { DbMatchRow } from '../types/database.types';
import {
  matchLiveStatsService,
  type MatchPlayerStatsSnapshot,
  type PlayerStatLine,
} from './matchLiveStatsService';
import { emitMatchUpdate } from './socketService';
import { log } from '../utils/logger';

export type MatchReport = {
  match?: {
    matchId?: number;
    slug?: string;
    phase?: string;
    map?: {
      name?: string;
      index?: number;
      number?: number;
      total?: number;
      round?: number;
    };
    score?: {
      team1?: number;
      team2?: number;
      series?: { team1?: number; team2?: number };
    };
    paused?: boolean;
    ready?: { readyPlayers?: number; trackingPlayers?: number };
  };
  teams?: {
    team1?: MatchReportTeam;
    team2?: MatchReportTeam;
  };
  connections?: MatchReportConnection[];
};

type MatchReportTeam = {
  id?: string;
  name?: string;
  connectedCount?: number;
  readyCount?: number;
  expectedPlayers?: number;
  players?: MatchReportPlayer[];
  roster?: Array<{ steamId?: string; steamid?: string; name?: string }>;
};

type MatchReportPlayer = {
  steamId?: string;
  steamid?: string;
  name?: string;
  slot?: string;
  teamSide?: string;
  ready?: boolean;
  connectedAt?: number;
  connected?: boolean;
  stats?: MatchReportPlayerStats;
};

type MatchReportConnection = {
  steamId?: string;
  name?: string;
  slot?: string;
  teamSide?: string;
  ready?: boolean;
  connectedAt?: number;
  coach?: boolean;
};

type MatchReportPlayerStats = {
  kills?: number;
  deaths?: number;
  assists?: number;
  flash_assists?: number;
  flashAssists?: number;
  headshot_kills?: number;
  headshotKills?: number;
  damage?: number;
  utility_damage?: number;
  utilityDamage?: number;
  kast?: number;
  score?: number;
  mvp?: number;
  mvps?: number;
  rounds_played?: number;
  roundsPlayed?: number;
  [key: string]: unknown;
};

const MATCH_REPORT_COMMANDS = ['matchzy_match_report', 'css_match_report'];
const REFRESH_TTL_MS = 5000;
const REPORT_ERROR_LOG_COOLDOWN_MS = 30000;

type RefreshState = {
  lastRun: number;
  promise: Promise<void> | null;
};

const refreshState = new Map<string, RefreshState>();
const reportErrorLogState = new Map<string, number>();

export async function refreshConnectionsFromServer(
  matchSlug: string,
  options?: { force?: boolean }
): Promise<void> {
  const force = options?.force ?? false;
  const now = Date.now();
  const state = refreshState.get(matchSlug) ?? { lastRun: 0, promise: null };

  if (state.promise) {
    log.debug('[Connections] Awaiting in-flight refresh', { matchSlug });
    return state.promise;
  }

  if (!force && now - state.lastRun < REFRESH_TTL_MS) {
    log.debug('[Connections] Skipping refresh (recent)', {
      matchSlug,
      ageMs: now - state.lastRun,
    });
    return;
  }

  const refreshPromise = (async () => {
    try {
      const match = await db.queryOneAsync<DbMatchRow>('SELECT * FROM matches WHERE slug = ?', [matchSlug]);
      if (!match || !match.server_id) {
        return;
      }

      const report = await fetchMatchReport(match.server_id);
      if (!report) {
        return;
      }

      await applyMatchReport(match.slug, report);
    } catch (error) {
      log.error(`Failed to refresh connections via match report for match ${matchSlug}`, error);
    } finally {
      refreshState.set(matchSlug, {
        lastRun: Date.now(),
        promise: null,
      });
    }
  })();

  refreshState.set(matchSlug, {
    lastRun: state.lastRun,
    promise: refreshPromise,
  });

  return refreshPromise;
}

export async function fetchMatchReport(serverId: string): Promise<MatchReport | null> {
  let lastError: unknown = null;
  let lastErrorDetails: Record<string, unknown> | null = null;

  for (const command of MATCH_REPORT_COMMANDS) {
    try {
      const result = await rconService.sendCommand(serverId, command);
      log.info('[MatchReport] RCON response', {
        serverId,
        command,
        success: result.success,
        error: result.error,
        response: result.response,
      });

      if (!result.success || !result.response) {
        lastError = result.error;
        continue;
      }

      const jsonStart = result.response.indexOf('{');
      if (jsonStart === -1) {
        lastError = 'No JSON payload detected';
        continue;
      }

      const jsonPayload = result.response.slice(jsonStart).trim();

      try {
        return JSON.parse(jsonPayload) as MatchReport;
      } catch (parseError) {
        lastError = parseError;
        lastErrorDetails = {
          reason: 'Invalid JSON payload',
          length: jsonPayload.length,
          startsWith: jsonPayload.slice(0, 40),
          endsWith: jsonPayload.slice(-40),
        };
        log.warn('[MatchReport] Invalid JSON payload received', {
          serverId,
          command,
          ...lastErrorDetails,
        });
        continue;
      }
    } catch (error) {
      lastError = error;
      lastErrorDetails = {
        reason: 'RCON command failed',
        command,
      };
    }
  }

  const now = Date.now();
  const lastLoggedAt = reportErrorLogState.get(serverId) ?? 0;
  if (now - lastLoggedAt > REPORT_ERROR_LOG_COOLDOWN_MS) {
    log.error('[MatchReport] Unable to retrieve match report', {
      serverId,
      lastError,
      lastErrorDetails,
    });
    reportErrorLogState.set(serverId, now);
  } else {
    log.debug('[MatchReport] Suppressed duplicate error', {
      serverId,
      lastErrorDetails,
    });
  }

  return null;
}

export async function applyMatchReport(matchSlug: string, report: MatchReport): Promise<void> {
  const connectedPlayers = extractConnectedPlayers(report, matchSlug);
  playerConnectionService.setConnections(matchSlug, connectedPlayers);
  log.info('[Connections] Parsed players from match report', {
    matchSlug,
    connectedPlayers,
  });

  await updateLiveStatsFromReport(matchSlug, report);
}

function extractConnectedPlayers(report: MatchReport, matchSlug: string): ConnectedPlayer[] {
  const connections = Array.isArray(report.connections) ? report.connections : [];
  const connectedViaConnections = connections
    .map((connection) => {
      const team = normalizeTeamSlot(connection.slot);
      const steamId = connection.steamId;
      if (!steamId || !team) {
        return null;
      }

      return {
        steamId,
        name: connection.name || 'Unknown',
        team,
        connectedAt: toMillis(connection.connectedAt),
        isReady: Boolean(connection.ready),
      };
    })
    .filter((player): player is ConnectedPlayer => Boolean(player));

  if (connectedViaConnections.length > 0) {
    return connectedViaConnections;
  }

  const players: ConnectedPlayer[] = [];
  const teams = report.teams || {};

  (['team1', 'team2'] as const).forEach((teamKey) => {
    const teamReport = teams[teamKey];
    if (!teamReport || !Array.isArray(teamReport.players)) {
      return;
    }

    teamReport.players.forEach((player) => {
      const steamId = player.steamId || player.steamid;
      if (!steamId) return;

      const isConnected = Boolean(player.connected || player.connectedAt || player.ready);
      if (!isConnected) {
        return;
      }

      players.push({
        steamId,
        name: player.name || 'Unknown',
        team: teamKey,
        connectedAt: toMillis(player.connectedAt),
        isReady: Boolean(player.ready),
      });
    });
  });

  log.info('[Connections] Team lookup fallback', {
    matchSlug,
    connectedViaFallback: players,
  });

  return players;
}

async function updateLiveStatsFromReport(matchSlug: string, report: MatchReport): Promise<void> {
  const matchInfo = report.match;
  if (!matchInfo) {
    return;
  }

  const playerStats = extractPlayerStats(report);
  const stats = matchLiveStatsService.update(matchSlug, {
    status: mapPhaseToLiveStatus(matchInfo.phase),
    team1Score: matchInfo.score?.team1 ?? 0,
    team2Score: matchInfo.score?.team2 ?? 0,
    team1SeriesScore: matchInfo.score?.series?.team1 ?? 0,
    team2SeriesScore: matchInfo.score?.series?.team2 ?? 0,
    mapNumber: matchInfo.map?.index ?? matchInfo.map?.number ?? 0,
    roundNumber: matchInfo.map?.round ?? 0,
    mapName: matchInfo.map?.name ?? null,
    totalMaps: matchInfo.map?.total ?? report.match?.map?.total ?? 1,
    playerStats: playerStats,
  });

  await persistMatchMetaFromReport(matchSlug, matchInfo);

  emitMatchUpdate({
    slug: matchSlug,
    liveStats: stats,
    status: matchInfo.phase,
  });
}

async function persistMatchMetaFromReport(matchSlug: string, matchInfo: MatchReport['match']): Promise<void> {
  if (!matchInfo) return;

  const updates: Record<string, unknown> = {};

  if (matchInfo.map?.name !== undefined) {
    updates.current_map = matchInfo.map?.name ?? null;
  }
  if (matchInfo.map?.index !== undefined) {
    updates.map_number = matchInfo.map.index;
  } else if (matchInfo.map?.number !== undefined) {
    updates.map_number = matchInfo.map.number;
  }

  if (Object.keys(updates).length === 0) {
    return;
  }

  try {
    await db.updateAsync('matches', updates, 'slug = ?', [matchSlug]);
  } catch (error) {
    log.warn('[MatchReport] Failed to persist match meta from report', {
      matchSlug,
      error,
      updates,
    });
  }
}

function extractPlayerStats(report: MatchReport): MatchPlayerStatsSnapshot | null {
  if (!report.teams) {
    return null;
  }

  const buildTeamStats = (team?: MatchReportTeam): PlayerStatLine[] => {
    if (!team?.players || !Array.isArray(team.players)) {
      return [];
    }

    return team.players
      .map((player) => {
        const steamId = player.steamId || player.steamid;
        if (!steamId) {
          return null;
        }
        const stats = player.stats ?? {};
        return {
          steamId,
          name: player.name || 'Unknown',
          kills: pickStat(stats, ['kills']),
          deaths: pickStat(stats, ['deaths']),
          assists: pickStat(stats, ['assists']),
          flashAssists: pickStat(stats, ['flash_assists', 'flashAssists']),
          headshotKills: pickStat(stats, ['headshot_kills', 'headshotKills']),
          damage: pickStat(stats, ['damage']),
          utilityDamage: pickStat(stats, ['utility_damage', 'utilityDamage']),
          kast: pickStat(stats, ['kast']),
          mvps: pickStat(stats, ['mvp', 'mvps']),
          score: pickStat(stats, ['score']),
          roundsPlayed: pickStat(stats, ['rounds_played', 'roundsPlayed']),
        };
      })
      .filter((line): line is PlayerStatLine => Boolean(line));
  };

  const team1Stats = buildTeamStats(report.teams.team1);
  const team2Stats = buildTeamStats(report.teams.team2);

  if (!team1Stats.length && !team2Stats.length) {
    return null;
  }

  return {
    team1: team1Stats,
    team2: team2Stats,
  };
}

function pickStat(stats: MatchReportPlayerStats, keys: string[], defaultValue = 0): number {
  for (const key of keys) {
    const value = stats[key];
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === 'string' && value.trim() !== '' && !Number.isNaN(Number(value))) {
      return Number(value);
    }
  }
  return defaultValue;
}

function normalizeTeamSlot(
  slot?: string | null
): 'team1' | 'team2' | null {
  if (!slot) return null;
  const normalized = slot.toLowerCase();
  if (normalized === 'team1' || normalized === 'team_1') return 'team1';
  if (normalized === 'team2' || normalized === 'team_2') return 'team2';
  return null;
}

function toMillis(value?: number | null): number {
  if (!value || Number.isNaN(value)) {
    return Date.now();
  }
  return value > 1_000_000_000_000 ? value : value * 1000;
}

function mapPhaseToLiveStatus(phase?: string) {
  switch ((phase || '').toLowerCase()) {
    case 'knife':
      return 'knife';
    case 'live':
      return 'live';
    case 'halftime':
      return 'halftime';
    case 'postgame':
      return 'postgame';
    default:
      return 'warmup';
  }
}


