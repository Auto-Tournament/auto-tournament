/**
 * Test-only routes of the manual-report module, mounted at
 * `/api/test/integration/manual-report`.
 *
 * `POST /tournament` creates a tournament whose `game` is a catalogue id the
 * module runs ('rocket-league'), with the module's `manualReport` settings.
 * The public create route always makes a CS2 tournament, so this is the only
 * way to pick another game today — the same hole the fake integration's test
 * route fills.
 *
 * The captain and admin routes that drive the report state machine land in
 * 3.0 phase D, PR D4 and D5. Until then these helpers are how the state
 * machine is exercised against a live API.
 *
 * Not in the API reference: `LegacyRouteMount.testOnly` keeps them out of the
 * generated docs and the OpenAPI spec.
 */

import { Router, type Request, type Response } from 'express';
import { requireAuth } from '../../middleware/auth';
import { log } from '../../utils/logger';
import type {
  CreateTournamentInput,
  MatchFormat,
  TournamentType,
} from '../../types/tournament.types';
import { MANUAL_REPORT_CATALOG, MANUAL_REPORT_GAME_ID } from './catalog';
import { validateSetup } from './setup';

export const manualReportTestRoutes = Router();

const TOURNAMENT_TYPES = ['single_elimination', 'double_elimination', 'round_robin', 'swiss'];
const FORMATS = ['bo1', 'bo3', 'bo5'];

/** The E2E test endpoints switch, the same gate `routes/test.ts` uses. */
function isEnabled(): boolean {
  if (process.env.NODE_ENV !== 'production') return true;
  const flag = (process.env.ENABLE_TEST_ENDPOINTS || '').toLowerCase();
  return flag === '1' || flag === 'true' || flag === 'yes';
}

manualReportTestRoutes.use(requireAuth, (_req, res, next) => {
  if (!isEnabled()) {
    res.status(403).json({ success: false, error: 'Disabled in production' });
    return;
  }
  next();
});

manualReportTestRoutes.post('/tournament', async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as {
    name?: unknown;
    type?: unknown;
    format?: unknown;
    game?: unknown;
    teamIds?: unknown;
    settings?: unknown;
  };
  const teamIds = Array.isArray(body.teamIds)
    ? body.teamIds.filter((id): id is string => typeof id === 'string')
    : [];

  if (typeof body.name !== 'string' || !body.name.trim()) {
    return res.status(400).json({ success: false, error: 'name is required' });
  }
  if (typeof body.type !== 'string' || !TOURNAMENT_TYPES.includes(body.type)) {
    return res
      .status(400)
      .json({ success: false, error: `type must be one of ${TOURNAMENT_TYPES.join(', ')}` });
  }
  if (typeof body.format !== 'string' || !FORMATS.includes(body.format)) {
    return res
      .status(400)
      .json({ success: false, error: `format must be one of ${FORMATS.join(', ')}` });
  }
  if (teamIds.length < 2) {
    return res.status(400).json({ success: false, error: 'At least 2 teams are required' });
  }

  // `game` is a catalogue id the module runs ('rocket-league'), not the module
  // id: that is the whole point of `runsAnyCatalogGame`. It defaults to the
  // module's own id, which means "a game with no catalogue row here".
  const game =
    typeof body.game === 'string' && body.game.trim()
      ? body.game.trim().toLowerCase()
      : MANUAL_REPORT_GAME_ID;

  // Only a game this module ships, or the module itself. The registry would
  // answer this for any catalogue id, but an integration must not import it
  // (eslint-rules/integration-boundaries.mjs), and a test helper has no
  // business creating a tournament for someone else's game anyway.
  const runnable =
    game === MANUAL_REPORT_GAME_ID || MANUAL_REPORT_CATALOG.some((entry) => entry.slug === game);
  if (!runnable) {
    return res.status(409).json({
      success: false,
      error: `Game '${game}' is not one this module ships; use a slug from its catalogue entries`,
    });
  }

  const settings = (body.settings ?? {}) as CreateTournamentInput['settings'];
  const check = validateSetup({ settings });
  if (!check.valid) {
    return res.status(400).json({ success: false, error: check.errors.join('; ') });
  }

  try {
    const { tournamentService } = await import('../../services/tournamentService');
    const { resolveTournamentId } = await import('../../utils/tournamentRow');
    const tournament = await tournamentService.createTournament(
      resolveTournamentId(req),
      {
        name: body.name,
        type: body.type as TournamentType,
        format: body.format as MatchFormat,
        maps: [],
        teamIds,
        ...(settings ? { settings } : {}),
      },
      { game }
    );
    return res.json({ success: true, tournament });
  } catch (error) {
    log.error('[MANUAL-REPORT] Failed to create tournament', error);
    return res.status(400).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to create tournament',
    });
  }
});
