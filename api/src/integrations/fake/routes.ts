/**
 * Test-only routes of the fake integration, mounted at
 * /api/test/integration/fake (only when the fake integration is registered,
 * see `isFakeIntegrationEnabled`).
 *
 * - `POST /tournament` creates the tournament with `game = 'fake'`. The public
 *   create route always makes a CS2 tournament; this is the only way to pick
 *   another game today.
 * - `POST /:slug/events` takes `NormalizedEvent[]` for one of the fake game's
 *   matches and hands them to the core's `matchLifecycle.ingest`, the same
 *   entry point the CS2 event adapter uses.
 *
 * Not in the API reference: the route table is built without the fake
 * integration outside test runs.
 */

import { Router, type Request, type Response } from 'express';
import { requireAuth } from '../../middleware/auth';
import { log } from '../../utils/logger';
import type { NormalizedEvent, NormalizedEventType } from '../types';
import type {
  CreateTournamentInput,
  MatchFormat,
  TournamentType,
} from '../../types/tournament.types';
import { FAKE_GAME_ID } from './index';

export const fakeEventRoutes = Router();

const TOURNAMENT_TYPES = ['single_elimination', 'double_elimination', 'round_robin', 'swiss'];
const FORMATS = ['bo1', 'bo3', 'bo5'];

const EVENT_TYPES: ReadonlySet<NormalizedEventType> = new Set<NormalizedEventType>([
  'series.started',
  'map.started',
  'score.updated',
  'map.result',
  'series.ended',
  'player.stats',
  'phase.changed',
  'presence.changed',
]);

function isEnabled(): boolean {
  if (process.env.NODE_ENV !== 'production') return true;
  const flag = (process.env.ENABLE_TEST_ENDPOINTS || '').toLowerCase();
  return flag === '1' || flag === 'true' || flag === 'yes';
}

fakeEventRoutes.use(requireAuth, (_req, res, next) => {
  if (!isEnabled()) {
    res.status(403).json({ success: false, error: 'Disabled in production' });
    return;
  }
  next();
});

fakeEventRoutes.post('/tournament', async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as {
    name?: unknown;
    type?: unknown;
    format?: unknown;
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
    return res.status(400).json({ success: false, error: `type must be one of ${TOURNAMENT_TYPES.join(', ')}` });
  }
  if (typeof body.format !== 'string' || !FORMATS.includes(body.format)) {
    return res.status(400).json({ success: false, error: `format must be one of ${FORMATS.join(', ')}` });
  }
  if (teamIds.length < 2) {
    return res.status(400).json({ success: false, error: 'At least 2 teams are required' });
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
        ...(body.settings && typeof body.settings === 'object'
          ? { settings: body.settings as CreateTournamentInput['settings'] }
          : {}),
      },
      { game: FAKE_GAME_ID }
    );
    return res.json({ success: true, tournament });
  } catch (error) {
    log.error('[FAKE] Failed to create tournament', error);
    return res.status(400).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to create tournament',
    });
  }
});

/** Structural check only: the core validates the rest as it applies them. */
function asEvents(value: unknown, slug: string): NormalizedEvent[] | string {
  if (!Array.isArray(value)) return 'Body must be an array of NormalizedEvent';
  for (const [i, event] of value.entries()) {
    const e = event as { type?: unknown; slug?: unknown; eventId?: unknown } | null;
    if (!e || typeof e !== 'object') return `events[${i}] is not an object`;
    if (typeof e.type !== 'string' || !EVENT_TYPES.has(e.type as NormalizedEventType)) {
      return `events[${i}].type is not a NormalizedEvent type`;
    }
    if (e.slug !== slug) return `events[${i}].slug must be '${slug}'`;
    if (typeof e.eventId !== 'string' || !e.eventId) return `events[${i}].eventId is required`;
  }
  return value as NormalizedEvent[];
}

fakeEventRoutes.post('/:slug/events', async (req: Request, res: Response) => {
  const { slug } = req.params;
  const events = asEvents(req.body, slug);
  if (typeof events === 'string') {
    return res.status(400).json({ success: false, error: events });
  }

  try {
    const { db } = await import('../../config/database');
    const match = await db.queryOneAsync<{ game: string | null }>(
      'SELECT game FROM matches WHERE slug = ?',
      [slug]
    );
    if (!match) {
      return res.status(404).json({ success: false, error: `Match '${slug}' not found` });
    }
    // Only the fake game's matches: this route must not drive a CS2 match.
    if (match.game !== FAKE_GAME_ID) {
      return res
        .status(409)
        .json({ success: false, error: `Match '${slug}' belongs to '${match.game}', not '${FAKE_GAME_ID}'` });
    }

    const { matchLifecycle } = await import('../../core/matchLifecycle');
    await matchLifecycle.ingest(events);
    return res.json({ success: true, applied: events.length });
  } catch (error) {
    log.error('[FAKE] Failed to ingest events', error, { slug });
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to ingest events',
    });
  }
});
