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
 * `seriesPlayerStats` and `standaloneRoster` when a series ends, and stores
 * and rates the stats through `playerStatsColumns` / `playerStatsMetrics`
 * (./stats). The server side of allocation is `./allocation` (`Cs2ServerPool`): which servers are
 * free, loading a match onto one, restarting, moving and ending it. The core
 * scheduler (`core/scheduler.ts`) keeps the queue and calls it through
 * `capacity`, `allocate`, `allocateBatch`, `restart`, `load`, `cancel` and
 * `release`; the tournament start preflight and webhook bootstrap are
 * `checkStart` and `prepareStart` (./tournamentStart). The map veto is a
 * CS2 pre-match phase (`veto/`: the `/api/veto` routes, the veto orders, and
 * the simulation auto-veto behind `isReadyToAllocate`, `onMatchReady` and
 * `startPendingPreMatchPhases`). Its progress is `matches.veto_state`, which
 * CS2 owns (core match views still read it for display). Maps and map pools
 * are `maps/`: the `/api/maps` and `/api/map-pools` routes, the catalogue
 * fetch, and the default data behind `seed`. `validateTournamentSettings`
 * (./tournamentSettings) checks the CS2 tournament fields on create and
 * update: the map pool, the shuffle map sequence and max rounds, and the veto
 * order. The `matchzy_*` and simulation app settings are CS2's
 * `instanceSettings` (./settings), read through `cs2Settings`
 * (./settingsReaders).
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
import { validateCs2TournamentSettings } from './tournamentSettings';
import { CS2_INSTANCE_SCHEMA, CS2_INSTANCE_SETTINGS } from './settings';
import type { ServerActionResult, ServerAllocationResult } from './allocation';
import type {
  AllocateResult,
  BuildMatchConfigContext,
  GameIntegration,
  MatchContext,
  MatchDescription,
  MatchDescriptionTeam,
  ResourceActionResult,
} from '../types';
import {
  CS2_STATS_SCHEMA,
  cs2PlayerStatsColumns,
  cs2PlayerStatsMetrics,
  metricsFromMatchZyStats,
} from './stats';

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

/** The pool's allocation outcome in the interface's terms. */
function toAllocateResult(result: ServerAllocationResult): AllocateResult {
  if (result.success) {
    return { status: 'assigned', ...(result.serverId ? { resourceId: result.serverId } : {}) };
  }
  const error = result.error ?? 'Allocation failed';
  if (!result.serverId && error === 'No available servers') {
    return { status: 'queued', reason: error };
  }
  // The allocator is polled, so a failed attempt is retried later.
  return {
    status: 'failed',
    error,
    retryable: true,
    ...(result.serverId ? { resourceId: result.serverId } : {}),
  };
}

function toResourceActionResult(result: ServerActionResult): ResourceActionResult {
  if (!result.ok) return result;
  const { serverId, ...rest } = result;
  return { ...rest, ...(serverId ? { resourceId: serverId } : {}) };
}

/** Series formats that run a map veto (case-sensitive, as the veto has always checked). */
function usesVeto(format: string | undefined): boolean {
  return format === 'bo1' || format === 'bo3' || format === 'bo5';
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
  setupSchema: { instance: CS2_INSTANCE_SCHEMA },
  instanceSettings: CS2_INSTANCE_SETTINGS,
  async readInstanceSettings() {
    const { readCs2InstanceSettings } = await import('./settingsReaders');
    return readCs2InstanceSettings();
  },

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

  /**
   * Hold a newly ready BO match for the automated veto in simulation mode.
   * The same check `makeMatchReady` made inline before the veto moved here.
   */
  async isReadyToAllocate(ctx: MatchContext) {
    const { settingsService } = await import('../../services/settingsService');
    if (!(await settingsService.isSimulationModeEnabled())) return true;
    return !usesVeto(ctx.tournament?.format);
  },

  /** Simulation mode: run the automated veto; it allocates the match when done. */
  async onMatchReady(ctx: MatchContext) {
    const [{ log }, { autoCompleteVetoForMatch }] = await Promise.all([
      import('../../utils/logger'),
      import('./veto/simulation'),
    ]);
    log.info(
      `[VETO-SIM] Simulation mode active – auto-completing veto for newly ready match ${ctx.slug}`
    );
    await autoCompleteVetoForMatch(ctx.slug);
  },

  /** The map pool, the shuffle map sequence and max rounds, and the custom veto order. */
  validateTournamentSettings(input) {
    return validateCs2TournamentSettings(input);
  },

  /** The map catalogue (when the table is empty) and the default map pools. */
  async seed(client) {
    // One-time fix for installs affected by the map-images path bug (PR
    // #284's "Judgement calls"): moves any images left in the old, wrong
    // directory into the correct one. See maps/migrateLegacyImages.ts.
    const { migrateLegacyMapImages } = await import('./maps/migrateLegacyImages');
    migrateLegacyMapImages();

    const { seedCs2Maps } = await import('./maps/seed');
    await seedCs2Maps(client);
  },

  /** The veto's current turn, derived from the veto order before the first action. */
  async preMatchTurn(match) {
    const { resolveCurrentVetoTurn } = await import('./veto/context');
    return (await resolveCurrentVetoTurn(match))?.currentTurn ?? null;
  },

  /** Simulation mode: auto-veto every match of the tournament waiting on a veto. */
  async startPendingPreMatchPhases(tournamentId: number) {
    const { autoVetoPendingMatches } = await import('./veto/simulation');
    return autoVetoPendingMatches(tournamentId);
  },

  /**
   * Free servers. The fleet is shared by every tournament, so the scope does
   * not narrow it today.
   */
  async capacity(_scope) {
    const { cs2ServerPool } = await import('./allocation');
    return cs2ServerPool.getFreeServerCount();
  },

  async allocate(ctx, { baseUrl }): Promise<AllocateResult> {
    const { cs2ServerPool } = await import('./allocation');
    return toAllocateResult(await cs2ServerPool.allocate(ctx.slug, baseUrl));
  },

  async allocateBatch(ctxs, { baseUrl }) {
    const { cs2ServerPool } = await import('./allocation');
    const results = await cs2ServerPool.allocateBatch(
      ctxs.map((ctx) => ctx.slug),
      baseUrl
    );
    // The pool reports left-over matches first; answer in the order asked.
    const bySlug = new Map(results.map((result) => [result.matchSlug, result]));
    return ctxs.map((ctx) => {
      const result = bySlug.get(ctx.slug);
      return result
        ? toAllocateResult(result)
        : { status: 'failed', error: 'Allocation failed', retryable: true };
    });
  },

  /** css_restart and reload on the same server, or move a match that has not gone live. */
  async restart(ctx, { baseUrl, moveResource }): Promise<ResourceActionResult> {
    const { cs2ServerPool } = await import('./allocation');
    if (moveResource) {
      if (!ctx.resourceId) {
        return { ok: false, error: 'Match has no server assigned. There is nothing to reallocate.' };
      }
      return toResourceActionResult(
        await cs2ServerPool.moveToOtherServer(ctx.slug, ctx.resourceId, baseUrl)
      );
    }
    const result = await cs2ServerPool.restartMatch(ctx.slug, baseUrl);
    return result.success
      ? { ok: true, message: result.message, ...(ctx.resourceId ? { resourceId: ctx.resourceId } : {}) }
      : { ok: false, error: result.message };
  },

  async load(ctx, { baseUrl, skipWebhook }) {
    const { cs2ServerPool } = await import('./allocation');
    return toResourceActionResult(
      await cs2ServerPool.loadAssigned(
        { id: ctx.matchId, slug: ctx.slug, round: ctx.round, server_id: ctx.resourceId ?? null },
        { baseUrl, skipWebhook }
      )
    );
  },

  /**
   * End the match on its server. Force-cancel keeps its own command (see
   * `endMatchOnServer`); a tournament restart, reset or delete restarts the
   * server (`css_restart`).
   */
  async cancel(ctx, reason) {
    if (!ctx.resourceId) return;
    const { cs2ServerPool } = await import('./allocation');
    if (reason === 'force-cancel') {
      await cs2ServerPool.endMatchOnServer(ctx.resourceId, ctx.slug);
      return;
    }
    await cs2ServerPool.restartServerToEndMatch(ctx.resourceId);
  },

  /** Every enabled server runs an up-to-date CS2 build (RCON BuildID + Steam UpToDateCheck). */
  async checkStart(_scope) {
    const { preflightServersUpToDateForTournamentStart } = await import('./tournamentStart');
    const preflight = await preflightServersUpToDateForTournamentStart();
    if (preflight.ok) return { ok: true };
    return {
      ok: false,
      errorCode: 'cs2_outdated_servers',
      message:
        'One or more enabled servers are out of date (or could not be verified). Update or disable the affected servers before starting the tournament.',
      details: { servers: preflight.servers },
    };
  },

  /** Persistent MatchZy webhook config on every enabled server, so allocation's connectivity checks pass. */
  async prepareStart(_scope) {
    const { bootstrapServerWebhooksForTournamentStart } = await import('./tournamentStart');
    await bootstrapServerWebhooksForTournamentStart();
  },

  /**
   * The webhook URL from Settings: where MatchZy on the server posts its
   * events, and the base of the match config and demo upload URLs it is
   * given. Rejects when it is not configured, which blocks the start.
   */
  async resolveBaseUrl(_scope) {
    const { settingsService } = await import('../../services/settingsService');
    return settingsService.requireWebhookUrl();
  },

  /**
   * The series is over: the server is free for new work. Mark it idle for the
   * allocator and try to allocate waiting matches now rather than on the next
   * polling cycle. Demo uploads and the plugin's restore delay are still
   * honoured: `serverTurnover` holds a server until they are done.
   */
  async release(ctx) {
    if (!ctx.resourceId) return;
    const { cs2ServerPool } = await import('./allocation');
    const { scheduler } = await import('../../core/scheduler');
    cs2ServerPool.markIdle(ctx.resourceId);
    setImmediate(() => {
      void scheduler.tryImmediateAllocation();
    });
  },

  async poolStatus() {
    const { cs2ServerPool } = await import('./allocation');
    return cs2ServerPool.getPoolStatus();
  },

  /** The server grace period (shorter in simulation mode). */
  async turnoverSeconds() {
    const { cs2ServerPool } = await import('./allocation');
    return cs2ServerPool.getEffectiveGracePeriodSeconds();
  },

  /** Verify the server's persistent webhook and demo upload config (recovery). */
  async reattach(ctx) {
    if (!ctx.resourceId) return;
    const { serverInitializationService } = await import('./services/serverInitializationService');
    // NOTE: kept as recovery has always called it: `false` lands in the baseUrl
    // parameter.
    await serverInitializationService.initializeServer(ctx.resourceId, false);
  },

  /** The MatchZy status convar, read through the short status cache. */
  async resourceStatus(resourceId) {
    const { serverStatusService } = await import('./services/serverStatusService');
    const statusInfo = await serverStatusService.getServerStatus(resourceId);
    if (!statusInfo.online || !statusInfo.status) return null;
    return {
      status: statusInfo.status,
      description: serverStatusService.getStatusDescription(statusInfo.status),
    };
  },

  /** MatchZy's series stats as stat lines, team1's block first (./stats maps the fields). */
  async seriesPlayerStats(slug) {
    const { seriesPlayerStats } = await import('./events/matchEvents');
    const bySide = await seriesPlayerStats(slug);
    return (['team1', 'team2'] as const).flatMap((team) =>
      Object.entries(bySide[team]).map(([steamId, stats]) => ({
        account: { provider: 'steam', externalId: steamId },
        name: '',
        team,
        metrics: metricsFromMatchZyStats(stats ?? {}),
      }))
    );
  },

  playerStatsColumns: cs2PlayerStatsColumns,
  playerStatsMetrics: cs2PlayerStatsMetrics,

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
   * /api/servers (bootstrap, fleet, status), /api/rcon, /api/demos,
   * /api/matchzy, /api/events, /api/veto, /api/maps and /api/map-pools, at their existing URLs. Loaded on first call, not with the
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
