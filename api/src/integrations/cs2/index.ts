/**
 * CS2 (MatchZy) game integration.
 *
 * Owns the MatchZy match config: `buildMatchConfig` (./matchConfig) builds the
 * `matches.config` blob for tournament and standalone matches, and
 * `describeMatch` is the only reader of it the core uses. It also owns the
 * game servers: RCON, the server fleet and its status, bootstrap, health and
 * CS2 update monitoring, and demos (`services/`, `utils/`, `routes/`), mounted
 * through `legacyRoutes` and started through `start()`. Event ingest is the
 * `events/` adapter: the MatchZy webhooks (`/api/events`), the match report
 * and connection snapshot, and `normalize()`, which maps MatchZy events to
 * `NormalizedEvent`s. The adapter applies the CS2-only side effects (live
 * score, connections, stale-event guards) and hands the rest to the core's
 * `matchLifecycle.ingest`; the core calls back into `release`,
 * `seriesPlayerStats` and `standaloneRoster` when a series ends. Allocation
 * still lives in the core and calls some of this code directly (the legacy list in
 * eslint-rules/integration-boundaries.mjs); later PRs move them behind the
 * interface (see the TODOs in ../types.ts).
 *
 * Services are imported lazily inside each method. That keeps loading the
 * registry free of side effects (no database pool, no monitors) and avoids an
 * import cycle once core modules start importing the registry while this
 * module still delegates back to them.
 */

import type { MatchConfig } from '../../types/match.types';
import type { TournamentResponse } from '../../types/tournament.types';
import type { DbTournamentRow } from '../../types/database.types';
import type { MatchReport } from './events/connectionSnapshotService';
import { normalizeConfigPlayers } from '../../utils/playerTransform';
import type {
  AllocateResult,
  BuildMatchConfigContext,
  GameIntegration,
  MatchContext,
  MatchDescription,
  MatchDescriptionTeam,
  StatsSchema,
} from '../types';

/**
 * The metrics MatchZy reports, i.e. the CS2 columns of `player_match_stats`.
 * The same for every tournament today; `statsSchema` is a function so a mode
 * that records less (or more) can say so later.
 */
const CS2_STATS_SCHEMA: StatsSchema = {
  metrics: [
    { key: 'kills', label: 'Kills', higherIsBetter: true, ratingWeightable: true },
    { key: 'deaths', label: 'Deaths', higherIsBetter: false, ratingWeightable: true },
    { key: 'assists', label: 'Assists', higherIsBetter: true, ratingWeightable: true },
    { key: 'adr', label: 'ADR', higherIsBetter: true, ratingWeightable: true },
    { key: 'kast', label: 'KAST', higherIsBetter: true, ratingWeightable: true },
    { key: 'headshots', label: 'Headshots', higherIsBetter: true, ratingWeightable: true },
    { key: 'flash_assists', label: 'Flash assists', higherIsBetter: true, ratingWeightable: true },
    { key: 'utility_damage', label: 'Utility damage', higherIsBetter: true, ratingWeightable: true },
    { key: 'mvps', label: 'MVPs', higherIsBetter: true, ratingWeightable: true },
    { key: 'score', label: 'Score', higherIsBetter: true, ratingWeightable: true },
    { key: 'rounds_played', label: 'Rounds played', higherIsBetter: true, ratingWeightable: false },
  ],
};

function looksLikeTournamentResponse(value: unknown): value is TournamentResponse {
  return (
    typeof value === 'object' &&
    value !== null &&
    Array.isArray((value as TournamentResponse).maps) &&
    Array.isArray((value as TournamentResponse).teamIds)
  );
}

/**
 * The tournament view `generateMatchConfig` needs. Callers pass it as
 * `ctx.tournament.settings`; otherwise it is read the way `makeMatchReady`
 * reads it today.
 */
async function resolveTournament(
  ctx: BuildMatchConfigContext & { tournament: NonNullable<BuildMatchConfigContext['tournament']> }
): Promise<TournamentResponse> {
  if (looksLikeTournamentResponse(ctx.tournament.settings)) {
    return ctx.tournament.settings;
  }
  const { db } = await import('../../config/database');
  const { tournamentRowToResponse } = await import('../../utils/tournamentRow');
  const row = await db.queryOneAsync<DbTournamentRow>('SELECT * FROM tournament WHERE id = ?', [
    ctx.tournament.id,
  ]);
  if (!row) {
    throw new Error(`cs2.buildMatchConfig: tournament ${ctx.tournament.id} not found`);
  }
  return tournamentRowToResponse(row);
}

/**
 * Stored configs carry players as a steamId -> name map (generated configs) or
 * as the manual match modal's `{ steamid, name }` array; both are read the way
 * the API always normalised them (`normalizeConfigPlayers`).
 */
function describeTeam(team: MatchConfig['team1'] | undefined): MatchDescriptionTeam {
  const players = normalizeConfigPlayers(
    team?.players as Record<string, unknown> | Array<unknown> | undefined
  );
  return {
    ...(team?.id ? { id: team.id } : {}),
    name: team?.name ?? '',
    ...(team?.tag ? { tag: team.tag } : {}),
    ...(team?.flag ? { flag: team.flag } : {}),
    players: players.map((p) => ({
      account: { provider: 'steam', externalId: p.steamid },
      name: p.name,
      ...(p.avatar ? { avatar: p.avatar } : {}),
    })),
  };
}

/** `matches.config` as stored (JSON text) or already parsed; anything unreadable describes as empty. */
function parseConfig(config: unknown): Partial<MatchConfig> {
  let value = config;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      return {};
    }
  }
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Partial<MatchConfig>)
    : {};
}

export const cs2Integration: GameIntegration = {
  id: 'cs2',
  displayName: 'Counter-Strike 2',
  catalog: { slug: 'counter-strike-2', aliases: ['cs2', 'cs', 'counter strike', 'csgo'] },
  accountProvider: 'steam',
  capabilities: {
    servers: true,
    veto: true,
    liveEvents: true,
    demos: true,
    playerStats: true,
  },

  statsSchema: () => CS2_STATS_SCHEMA,

  async buildMatchConfig(ctx) {
    const { generateMatchConfig, buildStandaloneMatchConfig, serveStandaloneMatchConfig } =
      await import('./matchConfig');
    const { tournament } = ctx;
    if (!tournament || ctx.round === 0) {
      // Standalone: create from the admin's settings, or serve the stored config.
      if (ctx.settings !== undefined) {
        const defaults = looksLikeTournamentResponse(ctx.defaultsFrom?.settings)
          ? ctx.defaultsFrom.settings
          : null;
        return buildStandaloneMatchConfig(
          ctx.slug,
          (ctx.settings ?? {}) as Partial<MatchConfig>,
          defaults
        );
      }
      const served = await serveStandaloneMatchConfig(ctx.slug);
      if (!served) {
        throw new Error(`cs2.buildMatchConfig: match ${ctx.slug} not found`);
      }
      return served;
    }
    const resolved = await resolveTournament({ ...ctx, tournament });
    return generateMatchConfig(resolved, ctx.team1?.id, ctx.team2?.id, ctx.slug, {
      round: ctx.round,
    });
  },

  describeMatch(config): MatchDescription {
    const cfg = parseConfig(config);
    return {
      seriesLength: typeof cfg.num_maps === 'number' ? cfg.num_maps : 1,
      maps: Array.isArray(cfg.maplist) ? [...cfg.maplist] : [],
      ...(typeof cfg.players_per_team === 'number' ? { playersPerTeam: cfg.players_per_team } : {}),
      ...(typeof cfg.vetoDisabled === 'boolean' ? { skipPreMatchPhase: cfg.vetoDisabled } : {}),
      // Overtime off, and no explicit overtime segments (or none): a map can end level.
      ...(cfg.overtimeMode === 'disabled' &&
      (typeof cfg.overtimeSegments !== 'number' || cfg.overtimeSegments === 0)
        ? { gamesCanDraw: true }
        : {}),
      team1: describeTeam(cfg.team1),
      team2: describeTeam(cfg.team2),
    };
  },

  /** Today's auto-allocation after a match becomes ready (see makeMatchReady). */
  async onMatchReady(ctx: MatchContext) {
    const { autoAllocateServerToMatch } = await import('../../utils/matchProgression');
    await autoAllocateServerToMatch(ctx.slug);
  },

  async capacity() {
    const { matchAllocationService } = await import('../../services/matchAllocationService');
    return matchAllocationService.getAvailableServerCount();
  },

  async allocate(ctx, { baseUrl }): Promise<AllocateResult> {
    const { matchAllocationService, isQueuedAllocationResult } = await import(
      '../../services/matchAllocationService'
    );
    const result = await matchAllocationService.allocateSingleMatch(ctx.slug, baseUrl);
    if (result.success) {
      return { status: 'assigned', ...(result.serverId ? { resourceId: result.serverId } : {}) };
    }
    const error = result.error ?? 'Allocation failed';
    if (isQueuedAllocationResult(error)) {
      return { status: 'queued', reason: error };
    }
    // The allocator is polled today, so a failed attempt is retried later.
    return { status: 'failed', error, retryable: true };
  },

  async restart(ctx, { baseUrl }) {
    const { matchAllocationService } = await import('../../services/matchAllocationService');
    const result = await matchAllocationService.restartMatch(ctx.slug, baseUrl);
    if (!result.success) {
      throw new Error(result.error ?? result.message);
    }
  },

  /**
   * The series is over: the server is free for new work. Mark it idle for the
   * allocator and try to allocate waiting matches now rather than on the next
   * polling cycle. Demo uploads and the plugin's restore delay are still
   * honoured: `serverTurnover` holds a server until they are done.
   */
  async release(ctx) {
    if (!ctx.resourceId) return;
    const { serverAllocationTracker } = await import('../../services/serverAllocationTracker');
    const { matchAllocationService } = await import('../../services/matchAllocationService');
    serverAllocationTracker.markIdle(ctx.resourceId);
    setImmediate(() => {
      void matchAllocationService.tryImmediateAllocation();
    });
  },

  async seriesPlayerStats(slug) {
    const { seriesPlayerStats } = await import('./events/matchEvents');
    return seriesPlayerStats(slug);
  },

  /**
   * Steam IDs from the `{ steamid }` player arrays the manual match modal
   * stores. Null when the config is not JSON; a shape it cannot read throws.
   */
  standaloneRoster(config) {
    let parsed: unknown;
    try {
      parsed = typeof config === 'string' ? JSON.parse(config) : config;
    } catch {
      return null;
    }
    const cfg = parsed as {
      team1?: { players?: Array<{ steamid?: string }> };
      team2?: { players?: Array<{ steamid?: string }> };
    };
    const steamIds = (players: Array<{ steamid?: string }> | undefined): string[] =>
      players?.map((p) => (p.steamid ? p.steamid : null)).filter((p): p is string => !!p) ?? [];
    return { team1: steamIds(cfg.team1?.players), team2: steamIds(cfg.team2?.players) };
  },

  /** A stored MatchZy event through the same handling as the events route, minus its checks. */
  async replayEvent(event) {
    const { applyMatchEvent } = await import('./events/matchEvents');
    await applyMatchEvent(event as import('./events/matchzy-events.types').MatchZyEvent);
  },

  /**
   * /api/servers (bootstrap, fleet, status), /api/rcon, /api/demos and
   * /api/matchzy, at their existing URLs. Loaded on first call, not with the
   * registry (see the note at the top).
   */
  legacyRoutes() {
    // A synchronous lazy load: the route table is built synchronously.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { cs2LegacyRoutes } = require('./routes') as typeof import('./routes');
    return cs2LegacyRoutes;
  },

  /** Server webhook bootstrap, then the MatchZy version fetch and the health monitor. */
  async start() {
    const { startCs2 } = await import('./startup');
    await startCs2();
  },

  async stop() {
    const { stopCs2 } = await import('./startup');
    stopCs2();
  },

  /** `cs2Fleet` and `servers` for GET /api/health/fleet. */
  async healthContributions() {
    const { cs2FleetHealth } = await import('./health');
    return cs2FleetHealth();
  },

  async refreshPresence(slug, opts) {
    const { refreshConnectionsFromServer } = await import('./events/connectionSnapshotService');
    await refreshConnectionsFromServer(slug, opts);
  },

  /** The MatchZy match report: fetched over RCON from the server, or passed in. */
  async syncMatchState(slug, source) {
    const { fetchMatchReport, applyMatchReport } = await import(
      './events/connectionSnapshotService'
    );
    const report =
      'report' in source
        ? (source.report as MatchReport)
        : await fetchMatchReport(source.resourceId);
    if (!report) return null;
    await applyMatchReport(slug, report);
    return {
      map: report.match?.map?.name,
      phase: report.match?.phase,
      score: report.match?.score,
    };
  },

  clientSlots: ['MatchPanel', 'SetupStep', 'StatsPanel'],
};
