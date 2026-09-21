/**
 * CS2 (MatchZy) game integration.
 *
 * In this step it is a pure wrapper: every method delegates to the existing
 * services with no change in behaviour, and nothing in the core calls it yet.
 * Later PRs move the code itself in here (see the TODOs in ../types.ts).
 *
 * Services are imported lazily inside each method. That keeps loading the
 * registry free of side effects (no database pool, no monitors) and avoids an
 * import cycle once core modules start importing the registry while this
 * module still delegates back to them.
 */

import type { MatchConfig } from '../../types/match.types';
import type { TournamentResponse } from '../../types/tournament.types';
import type { DbTournamentRow } from '../../types/database.types';
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
async function resolveTournament(ctx: BuildMatchConfigContext): Promise<TournamentResponse> {
  if (!ctx.tournament) {
    // TODO(PR 4): standalone matches build their config in routes/matches.ts today.
    throw new Error(`cs2.buildMatchConfig: match ${ctx.slug} has no tournament`);
  }
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

function describeTeam(team: MatchConfig['team1'] | undefined): MatchDescriptionTeam {
  return {
    ...(team?.id ? { id: team.id } : {}),
    name: team?.name ?? '',
    players: Object.entries(team?.players ?? {}).map(([steamId, name]) => ({
      account: { provider: 'steam', externalId: steamId },
      name,
    })),
  };
}

function parseConfig(config: unknown): Partial<MatchConfig> {
  if (typeof config === 'string') {
    try {
      return JSON.parse(config) as Partial<MatchConfig>;
    } catch {
      return {};
    }
  }
  return (config ?? {}) as Partial<MatchConfig>;
}

export const cs2Integration: GameIntegration = {
  id: 'cs2',
  displayName: 'Counter-Strike 2',
  capabilities: {
    servers: true,
    veto: true,
    liveEvents: true,
    demos: true,
    playerStats: true,
  },

  statsSchema: () => CS2_STATS_SCHEMA,

  async buildMatchConfig(ctx) {
    const { generateMatchConfig } = await import('../../services/matchConfigBuilder');
    const tournament = await resolveTournament(ctx);
    return generateMatchConfig(tournament, ctx.team1?.id, ctx.team2?.id, ctx.slug);
  },

  describeMatch(config): MatchDescription {
    const cfg = parseConfig(config);
    return {
      seriesLength: typeof cfg.num_maps === 'number' ? cfg.num_maps : 1,
      maps: Array.isArray(cfg.maplist) ? [...cfg.maplist] : [],
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

  clientSlots: ['MatchPanel', 'SetupStep', 'StatsPanel'],
};
