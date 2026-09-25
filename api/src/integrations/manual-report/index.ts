/**
 * Manual reporting: the game module for games MAT cannot watch (3.0 phase D).
 *
 * Rocket League, chess and a hall full of people on consoles have no server we
 * can allocate, no webhook and no live events. What they do have is two teams
 * who know the score. This module is that path: the match goes live, a captain
 * types the result in, the opponent agrees (or an admin decides), and the
 * series finishes through exactly the same core path a CS2 series does
 * (`matchLifecycle.applySeriesResult`), so brackets, ratings, Swiss pairing and
 * tournament completion all keep working without knowing where the result
 * came from.
 *
 * What it declares:
 * - **no servers**: `capacity` is unlimited and `allocate`/`load` put the match
 *   straight to `live`. There is nothing to load a match onto, so the match
 *   going live is the whole of "loading" it.
 * - **no veto**: there are no maps to pick, so round 1 is ready at once and
 *   `tournamentService` never marks a slot `pending` for a pre-match phase.
 * - **no live events, no demos, no player stats**: nothing reports while the
 *   match runs. Extra numbers a tournament wants (goals, laps) are typed in
 *   with the result, against `custom_stat_fields` (D1's tables), not against a
 *   `statsSchema` the game fills in.
 *
 * What it runs: the titles in `./catalog`, plus — through
 * `runsAnyCatalogGame` — any other catalogue game, because `tournament.game`
 * holds a catalogue id from phase D onwards and a game found through
 * search must still find a module.
 *
 * The report state machine itself is `./reports` (3.0 phase D, PR D3), and the
 * routes onto it are `./reportRoutes` (captains, PR D4) and `./adminRoutes`
 * (PR D5), both mounted at `/api/game/manual`. Like CS2 and the fake module,
 * services are imported lazily inside each method, so loading the registry
 * stays free of side effects and import cycles.
 */

import type {
  AllocateResult,
  BuildMatchConfigContext,
  CapacityScope,
  GameIntegration,
  MatchContext,
  MatchDescription,
  MatchDescriptionTeam,
  ResourceActionResult,
  SetupSchema,
  StatsSchema,
  TournamentSettingsInput,
  TournamentSettingsValidation,
} from '../types';
import { MANUAL_REPORT_GAME_ID } from './catalog';
import {
  MANUAL_REPORT_TOURNAMENT_SCHEMA,
  readSetup,
  validateSetup,
  type ConfirmationMode,
  type TimeoutAction,
} from './setup';

export { MANUAL_REPORT_GAME_ID } from './catalog';

/** The `matches.config` blob this module stores. */
export interface ManualReportMatchConfig {
  game: typeof MANUAL_REPORT_GAME_ID;
  slug: string;
  /** The catalogue id the tournament is for ('rocket-league'), when it has one. */
  catalogGame: string | null;
  /** What to call the game in the report form. */
  gameLabel: string;
  seriesLength: number;
  allowDraw: boolean;
  /** The reporting rules as they stood when the match was built. */
  confirmation: ConfirmationMode;
  confirmTimeoutMin: number;
  timeoutAction: TimeoutAction;
  team1: ManualReportTeam;
  team2: ManualReportTeam;
}

export interface ManualReportTeam {
  id?: string;
  name: string;
  /** `players.id` of each rostered player. */
  players: Array<{ id: string; name: string }>;
}

/** Nothing is measured automatically, so the module declares no metrics. */
const MANUAL_REPORT_STATS_SCHEMA: StatsSchema = { metrics: [] };

const SETUP_SCHEMA: SetupSchema = {
  tournament: MANUAL_REPORT_TOURNAMENT_SCHEMA,
  // No `app_settings` keys: every decision belongs to a tournament, not to the
  // instance, so `instanceSettings` stays empty too.
  instance: { type: 'object', properties: {} },
};

async function readTeam(teamId: string | undefined | null): Promise<ManualReportTeam> {
  if (!teamId) return { name: '', players: [] };
  const { db } = await import('../../config/database');
  const row = await db.queryOneAsync<{ id: string; name: string; players: string | null }>(
    'SELECT id, name, players FROM teams WHERE id = ?',
    [teamId]
  );
  if (!row) return { id: teamId, name: '', players: [] };
  return { id: row.id, name: row.name, players: rosterOf(row.players) };
}

/** `teams.players` is the roster of record; an unreadable one describes as empty. */
function rosterOf(json: string | null): ManualReportTeam['players'] {
  const players: ManualReportTeam['players'] = [];
  try {
    const parsed: unknown = JSON.parse(json || '[]');
    const list = parsed && typeof parsed === 'object' ? Object.values(parsed) : [];
    for (const entry of list) {
      const player = entry as { steamId?: unknown; id?: unknown; name?: unknown };
      const id = typeof player.steamId === 'string' ? player.steamId : player.id;
      if (typeof id === 'string' && id) {
        players.push({ id, name: typeof player.name === 'string' ? player.name : '' });
      }
    }
  } catch {
    // An unreadable roster describes as empty, never throws: describeMatch is total.
  }
  return players;
}

function parseConfig(config: unknown): Partial<ManualReportMatchConfig> {
  let value = config;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      return {};
    }
  }
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Partial<ManualReportMatchConfig>)
    : {};
}

function describeTeam(team: Partial<ManualReportTeam> | undefined): MatchDescriptionTeam {
  const players = Array.isArray(team?.players) ? team.players : [];
  return {
    ...(typeof team?.id === 'string' ? { id: team.id } : {}),
    name: typeof team?.name === 'string' ? team.name : '',
    players: players
      .filter((p) => p && typeof p.id === 'string')
      .map((p) => ({ account: { provider: 'player', externalId: p.id }, name: p.name ?? '' })),
  };
}

/**
 * Put a ready match straight to `live`: there is no server to load it on, and
 * a manually reported match is being played the moment its teams are told to
 * play it. Only a `ready` match moves, so this is safe to call twice.
 */
async function setLive(slug: string): Promise<void> {
  const { db } = await import('../../config/database');
  const now = Math.floor(Date.now() / 1000);
  const result = await db.runAsync(
    "UPDATE matches SET status = 'live', loaded_at = ? WHERE slug = ? AND status = 'ready'",
    [now, slug]
  );
  if (result.changes > 0) {
    const { emitMatchUpdate, emitBracketUpdate } = await import('../../services/socketService');
    emitMatchUpdate({ slug, status: 'live' });
    emitBracketUpdate({ action: 'match_status', matchSlug: slug, status: 'live' });
  }
}

export const manualReportIntegration: GameIntegration = {
  id: MANUAL_REPORT_GAME_ID,
  displayName: 'Manual reporting',
  // The module is not a game, so it has no catalogue row of its own. Nor does
  // it ship any games: those are packs, installed on the instance, naming this
  // module as their engine (./catalog).
  catalog: null,
  runsAnyCatalogGame: true,
  capabilities: {
    servers: false,
    veto: false,
    liveEvents: false,
    demos: false,
    playerStats: false,
  },

  statsSchema: () => MANUAL_REPORT_STATS_SCHEMA,
  setupSchema: SETUP_SCHEMA,
  instanceSettings: [],

  validateTournamentSettings(input: TournamentSettingsInput): TournamentSettingsValidation {
    return validateSetup(input);
  },

  async buildMatchConfig(ctx: BuildMatchConfigContext): Promise<ManualReportMatchConfig> {
    // A standalone match carries the admin's own settings in `ctx.settings`;
    // a bracket match reads the tournament's. `readSetup` takes either shape.
    const standaloneSettings =
      ctx.settings === undefined
        ? null
        : { id: 0, type: '', format: '', settings: ctx.settings };
    const setup = readSetup(ctx.tournament ?? standaloneSettings, ctx.game);
    const standalone = parseConfig(ctx.settings);
    const seriesLength = ctx.tournament
      ? setup.bestOf
      : positiveOr(standalone.seriesLength, setup.bestOf);
    const [team1, team2] = await Promise.all([readTeam(ctx.team1?.id), readTeam(ctx.team2?.id)]);
    return {
      game: MANUAL_REPORT_GAME_ID,
      slug: ctx.slug,
      catalogGame: ctx.game === MANUAL_REPORT_GAME_ID ? null : ctx.game,
      gameLabel: setup.gameLabel,
      seriesLength,
      allowDraw: setup.allowDraw,
      confirmation: setup.confirmation,
      confirmTimeoutMin: setup.confirmTimeoutMin,
      timeoutAction: setup.timeoutAction,
      team1,
      team2,
    };
  },

  describeMatch(config: unknown): MatchDescription {
    const cfg = parseConfig(config);
    return {
      seriesLength: positiveOr(cfg.seriesLength, 1),
      // No maps: a manually reported series is a run of games, not of maps.
      maps: [],
      // There is no pre-match phase to skip, and saying so keeps a match from
      // waiting on one that will never happen.
      skipPreMatchPhase: true,
      gamesCanDraw: cfg.allowDraw === true,
      team1: describeTeam(cfg.team1),
      team2: describeTeam(cfg.team2),
    };
  },

  /** No resources, so a match never waits for one. */
  async capacity(_scope: CapacityScope): Promise<number | null> {
    return null;
  },

  async allocate(ctx: MatchContext): Promise<AllocateResult> {
    await setLive(ctx.slug);
    return { status: 'assigned' };
  },

  async load(ctx: MatchContext): Promise<ResourceActionResult> {
    await setLive(ctx.slug);
    return { ok: true, message: 'Match set live; report the result when it is played' };
  },

  /**
   * Nothing runs anywhere to restart. The admin action is still answered, so
   * the match view behaves, and it puts a match that never went live back to
   * `live`.
   */
  async restart(ctx: MatchContext): Promise<ResourceActionResult> {
    await setLive(ctx.slug);
    return { ok: true, message: 'Nothing to restart: this game reports its own result' };
  },

  async cancel(): Promise<void> {
    // Nothing runs anywhere, so there is nothing to stop.
  },

  async release(): Promise<void> {
    // No resource to free.
  },

  legacyRoutes() {
    // Required here, not at the top: loading the registry must not load routers.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { manualReportTestRoutes } = require('./routes') as typeof import('./routes');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { manualReportRoutes } = require('./reportRoutes') as typeof import('./reportRoutes');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { manualReportAdminRoutes } = require('./adminRoutes') as typeof import('./adminRoutes');
    return [
      {
        prefix: '/api/game/manual',
        router: manualReportRoutes,
        title: 'Manual reporting — captains',
        description:
          'Report a result, and confirm, dispute or withdraw one, for a game MAT cannot watch. A captain of one of the two teams only; answering names the revision it answers (3.0 phase D, PR D4).',
      },
      {
        prefix: '/api/game/manual',
        router: manualReportAdminRoutes,
        title: 'Manual reporting — admin',
        description:
          'The dispute queue, resolving and reopening a reported match, the extra stat fields a tournament asks reporters for, and who captains a team (3.0 phase D, PR D5).',
      },
      {
        prefix: '/api/test/integration/manual-report',
        router: manualReportTestRoutes,
        title: 'Test helpers (manual-report integration)',
        description:
          'Test-only: create a manual-report tournament and drive the report state machine before its captain and admin routes land (3.0 phase D, PR D4/D5).',
        // Out of the API reference and the OpenAPI spec: these are the test
        // helpers the state machine is exercised through until the real
        // routes land, exactly like the fake integration's.
        testOnly: true,
      },
    ];
  },

  /**
   * The timeout sweeper (./sweeper): one interval for the instance that acts
   * on reports whose confirmation deadline has passed.
   */
  async start(): Promise<void> {
    const { reportSweeper } = await import('./sweeper');
    reportSweeper.start();
  },

  async stop(): Promise<void> {
    const { reportSweeper } = await import('./sweeper');
    reportSweeper.stop();
  },
};

function positiveOr(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}
