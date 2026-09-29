/**
 * /api/integrations/teams — the teams API for integrators.
 *
 * An event website pushes its teams by its own ids (`externalId`) and gets
 * Auto Tournament's team id back. Authenticated with an integrator token
 * (`API_TOKENS_INTEGRATOR`, this API only), an admin token, or an admin
 * session; see `requireIntegratorAuth`.
 *
 * Every externalId lives in a *source*: the calling token's label. An admin
 * token may pass `?source=<label>` to act for an integrator; an admin session
 * must. An integrator token always uses its own label.
 *
 * Semantics (services/integrationTeamService.ts): idempotent upsert, the
 * player list replaces the old one, roster changes are refused while the
 * team is playing (409 `team_in_live_match`).
 */

import { Router, type Request, type Response } from 'express';
import { requireIntegratorAuth, type IntegratorRequest } from '../middleware/auth';
import { log } from '../utils/logger';
import {
  getIntegrationTeam,
  IntegrationTeamError,
  MAX_BATCH,
  parseTeamInput,
  upsertIntegrationTeam,
  teamView,
} from '../services/integrationTeamService';
import { listExternalIds, SOURCE_PATTERN, EXTERNAL_ID_PATTERN } from '../services/teamExternalIds';
import { teamService } from '../services/teamService';

const router = Router();

router.use(requireIntegratorAuth);

/** The source for this request, or an error response already sent. */
function sourceFor(req: Request, res: Response): string | null {
  const who = (req as IntegratorRequest).integrator;
  const asked = typeof req.query.source === 'string' ? req.query.source.trim() : undefined;
  if (asked !== undefined && !SOURCE_PATTERN.test(asked)) {
    res.status(400).json({ success: false, error: 'source must be 1-32 letters, digits, _ or -' });
    return null;
  }
  if (who?.scope === 'integrator') {
    if (asked !== undefined && asked !== who.tokenLabel) {
      res.status(403).json({
        success: false,
        error: `An integrator token acts for its own source ('${who.tokenLabel}') only`,
      });
      return null;
    }
    return who.tokenLabel;
  }
  const source = asked ?? who?.tokenLabel ?? null;
  if (!source) {
    res.status(400).json({
      success: false,
      error: 'source is required: pass ?source=<the integrator token label> when calling with an admin session',
    });
    return null;
  }
  return source;
}

function sendError(res: Response, error: unknown): Response {
  if (error instanceof IntegrationTeamError) {
    return res.status(error.status).json({ success: false, code: error.code, error: error.message, ...(error.details ?? {}) });
  }
  log.error('[Integrations] Teams API failed', error);
  return res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Unknown error' });
}

/**
 * GET /api/integrations/teams
 * This source's teams: externalId → Auto Tournament id, name, tag, players.
 */
router.get('/', async (req: Request, res: Response) => {
  const source = sourceFor(req, res);
  if (!source) return;
  try {
    const links = await listExternalIds(source);
    const teams = [];
    for (const link of links) {
      const team = await teamService.getTeamById(link.teamId);
      if (team) teams.push(teamView(team, source, link.externalId));
    }
    return res.json({ success: true, source, count: teams.length, teams });
  } catch (error) {
    return sendError(res, error);
  }
});

/**
 * POST /api/integrations/teams/batch
 * Upsert many teams: body `{ teams: [{ externalId, name, tag?, players }] }`
 * (at most 500). Each is applied on its own; 207 when any failed.
 */
router.post('/batch', async (req: Request, res: Response) => {
  const source = sourceFor(req, res);
  if (!source) return;
  const list = (req.body as { teams?: unknown } | undefined)?.teams;
  if (!Array.isArray(list) || list.length === 0) {
    return res.status(400).json({ success: false, error: 'Body must be { teams: [ ... ] } with at least one team' });
  }
  if (list.length > MAX_BATCH) {
    return res.status(400).json({ success: false, error: `At most ${MAX_BATCH} teams per batch` });
  }
  const results: Array<Record<string, unknown>> = [];
  const seen = new Set<string>();
  for (const [index, raw] of list.entries()) {
    const externalId = (raw as { externalId?: unknown } | null)?.externalId;
    try {
      const input = parseTeamInput(raw);
      if (seen.has(input.externalId)) {
        throw new IntegrationTeamError('invalid', 400, `externalId '${input.externalId}' appears more than once in this batch`);
      }
      seen.add(input.externalId);
      const r = await upsertIntegrationTeam(source, input);
      results.push({ index, ok: true, ...r });
    } catch (error) {
      if (error instanceof IntegrationTeamError) {
        results.push({ index, ok: false, externalId: typeof externalId === 'string' ? externalId : null, code: error.code, error: error.message, ...(error.details ?? {}) });
      } else {
        log.error('[Integrations] Teams batch item failed', error);
        results.push({ index, ok: false, externalId: typeof externalId === 'string' ? externalId : null, code: 'error', error: error instanceof Error ? error.message : 'Unknown error' });
      }
    }
  }
  const failed = results.filter((r) => !r.ok).length;
  const count = (kind: string) => results.filter((r) => r.result === kind).length;
  return res.status(failed > 0 ? 207 : 200).json({
    success: failed === 0,
    source,
    stats: {
      total: results.length,
      created: count('created'),
      updated: count('updated'),
      unchanged: count('unchanged'),
      failed,
    },
    results,
  });
});

/**
 * GET /api/integrations/teams/:externalId
 * One team by the integrator's id.
 */
router.get('/:externalId', async (req: Request, res: Response) => {
  const source = sourceFor(req, res);
  if (!source) return;
  const { externalId } = req.params;
  if (!EXTERNAL_ID_PATTERN.test(externalId)) {
    return res.status(400).json({ success: false, error: 'Invalid externalId' });
  }
  try {
    const team = await getIntegrationTeam(source, externalId);
    if (!team) {
      return res.status(404).json({ success: false, code: 'not_found', error: `No team with externalId '${externalId}' for source '${source}'` });
    }
    return res.json({ success: true, team });
  } catch (error) {
    return sendError(res, error);
  }
});

/**
 * PUT /api/integrations/teams/:externalId
 * Create or update one team: body `{ name, tag?, players: [{ steamId, name }] }`.
 * 201 when created, 200 when updated or unchanged; `result` says which.
 */
router.put('/:externalId', async (req: Request, res: Response) => {
  const source = sourceFor(req, res);
  if (!source) return;
  try {
    const input = parseTeamInput(req.body, req.params.externalId);
    const r = await upsertIntegrationTeam(source, input);
    return res.status(r.result === 'created' ? 201 : 200).json({ success: true, source, ...r });
  } catch (error) {
    return sendError(res, error);
  }
});

export default router;
