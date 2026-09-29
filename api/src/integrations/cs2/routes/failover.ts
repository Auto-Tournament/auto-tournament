/**
 * Fleet failover for the admin (FLEET.md §11, ../fleet/failover.ts). Admin
 * only (`requireAuth` on each route).
 *
 *   GET  /api/game/cs2/matches/:slug/failover
 *        The match's open failover (or null), its recent ones (the history),
 *        the free Ready Up servers it can move to (the reserve included), the
 *        round backups of the current map, and whether auto-failover is on.
 *   POST /api/game/cs2/matches/:slug/failover/:id/accept { targetServerId?, round? }
 *        Carry out an open failover (auto-failover off, or another pick): the
 *        old epoch is fenced, the server gets `match.assign` with a new epoch
 *        and `resume` (the chosen backup). 200 moved; 404 no such failover /
 *        backup; 409 not open, no free server, or the match moved on; 502 the
 *        server refused or did not answer (the failover stays open).
 *   POST /api/game/cs2/matches/:slug/failover/:id/dismiss
 *        Leave it: the platform does not act on that epoch again.
 *   POST /api/game/cs2/matches/:slug/failover/move { targetServerId?, round? }
 *        Move a fleet match to another free server now (a different pick
 *        after a failover, or back to the old one), from a round backup.
 *
 *   GET  /api/fleet/failover/settings
 *   PUT  /api/fleet/failover/settings { auto?, reserve? }
 *        Auto-failover (on by default) and the reserve: idle Ready Up servers
 *        normal allocation leaves for failover (null = automatic: 1 once two
 *        servers are online). Reserve servers count toward the license like
 *        any other server. The answer says which servers are held now.
 */

import { Router, type Request, type Response } from 'express';
import { requireAuth, requestActorId } from '../../../middleware/auth';
import { log } from '../../../utils/logger';
import { roundBackupStore } from '../fleet/backups';
import {
  acceptFailover,
  activeProposal,
  dismissFailover,
  freeFleetServers,
  getProposal,
  listProposals,
  moveMatch,
  type AcceptOutcome,
  type FailoverProposal,
} from '../fleet/failover';
import { getFailoverSettings, MAX_RESERVE, reserveCount, setFailoverSettings } from '../fleet/failoverSettings';
import { pickReserved } from '../fleet/failoverPlan';
import { liveStateStore } from '../fleet/state';
import { getAssignment } from '../fleet/driver';
import { db } from '../../../config/database';

const SLUG_RE = /^[A-Za-z0-9_.-]{1,128}$/;
const ID_RE = /^[0-9A-Za-z]{10,40}$/;

export const failoverMatchRouter = Router();
export const failoverSettingsRouter = Router();

async function serverNames(ids: Array<string | null>): Promise<Map<string, string>> {
  const wanted = [...new Set(ids.filter((id): id is string => !!id))];
  if (wanted.length === 0) return new Map();
  const rows = await db.queryAsync<{ id: string; name: string }>(
    `SELECT id, name FROM cs2_servers WHERE id IN (${wanted.map(() => '?').join(', ')})`,
    wanted
  );
  return new Map(rows.map((r) => [r.id, r.name]));
}

async function view(proposals: FailoverProposal[]): Promise<Array<FailoverProposal & { fromServerName: string | null; targetServerName: string | null; newServerName: string | null }>> {
  const names = await serverNames(proposals.flatMap((p) => [p.fromCs2ServerId, p.targetCs2ServerId, p.newCs2ServerId]));
  return proposals.map((p) => ({
    ...p,
    fromServerName: p.fromCs2ServerId ? (names.get(p.fromCs2ServerId) ?? null) : null,
    targetServerName: p.targetCs2ServerId ? (names.get(p.targetCs2ServerId) ?? null) : null,
    newServerName: p.newCs2ServerId ? (names.get(p.newCs2ServerId) ?? null) : null,
  }));
}

function answer(res: Response, outcome: AcceptOutcome): Response {
  if (outcome.ok) return res.json({ success: true, proposal: outcome.proposal });
  return res
    .status(outcome.status)
    .json({ success: false, code: outcome.code, error: outcome.error, proposal: outcome.proposal });
}

failoverMatchRouter.get('/matches/:slug/failover', requireAuth, async (req: Request, res: Response) => {
  const { slug } = req.params;
  if (!SLUG_RE.test(slug)) return res.status(400).json({ success: false, error: 'Invalid match slug' });
  try {
    const [open, recent, settings, record, assignment] = await Promise.all([
      activeProposal(slug),
      listProposals(slug, 10),
      getFailoverSettings(),
      liveStateStore.getLiveState(slug),
      getAssignment(slug),
    ]);
    const [openView] = open ? await view([open]) : [null];
    const onFleet = !!assignment && assignment.endedAt === null;
    // Only worth asking the pool when there is something to move.
    const candidates = open?.status === 'moving' || (!open && !onFleet) ? [] : await freeFleetServers();
    const mapNumber = open?.mapNumber ?? record?.state?.series?.current_map ?? 1;
    const backups = (await roundBackupStore.list(slug))
      .filter((b) => b.mapNumber === mapNumber)
      .sort((a, b) => b.round - a.round);
    return res.json({
      success: true,
      matchSlug: slug,
      proposal: openView,
      recent: await view(recent),
      candidates: candidates.map((c) => ({ id: c.cs2ServerId, name: c.name })),
      mapNumber,
      backups,
      autoFailover: settings.auto,
      // The fleet assignment the match is on now (null: not on a Ready Up server).
      assignment:
        assignment && assignment.endedAt === null
          ? { serverId: assignment.cs2ServerId, epoch: assignment.epoch }
          : null,
    });
  } catch (error) {
    log.error(`[FAILOVER] reading the failover of ${slug} failed: ${(error as Error).message}`);
    return res.status(500).json({ success: false, error: 'Failed to read the failover state' });
  }
});

failoverMatchRouter.post('/matches/:slug/failover/:id/accept', requireAuth, async (req: Request, res: Response) => {
  const { slug, id } = req.params;
  if (!SLUG_RE.test(slug) || !ID_RE.test(id)) return res.status(400).json({ success: false, error: 'Invalid request' });
  const body = (req.body ?? {}) as { targetServerId?: unknown; round?: unknown };
  if (body.targetServerId !== undefined && body.targetServerId !== null && typeof body.targetServerId !== 'string') {
    return res.status(400).json({ success: false, code: 'bad_args', error: 'targetServerId must be a string' });
  }
  if (body.round !== undefined && body.round !== null && typeof body.round !== 'number') {
    return res.status(400).json({ success: false, code: 'bad_args', error: 'round must be a number' });
  }
  try {
    const proposal = await getProposal(id);
    if (!proposal || proposal.matchSlug !== slug) {
      return res.status(404).json({ success: false, code: 'not_found', error: 'No such failover proposal' });
    }
    const outcome = await acceptFailover(id, {
      targetServerId: (body.targetServerId as string | null | undefined) ?? null,
      round: (body.round as number | null | undefined) ?? null,
      actor: requestActorId(req),
    });
    return answer(res, outcome);
  } catch (error) {
    log.error(`[FAILOVER] accepting ${id} for ${slug} failed: ${(error as Error).message}`);
    return res.status(500).json({ success: false, error: 'Failed to move the match' });
  }
});

failoverMatchRouter.post('/matches/:slug/failover/move', requireAuth, async (req: Request, res: Response) => {
  const { slug } = req.params;
  if (!SLUG_RE.test(slug)) return res.status(400).json({ success: false, error: 'Invalid match slug' });
  const body = (req.body ?? {}) as { targetServerId?: unknown; round?: unknown };
  if (body.targetServerId !== undefined && body.targetServerId !== null && typeof body.targetServerId !== 'string') {
    return res.status(400).json({ success: false, code: 'bad_args', error: 'targetServerId must be a string' });
  }
  if (body.round !== undefined && body.round !== null && typeof body.round !== 'number') {
    return res.status(400).json({ success: false, code: 'bad_args', error: 'round must be a number' });
  }
  try {
    const outcome = await moveMatch(slug, {
      targetServerId: (body.targetServerId as string | null | undefined) ?? null,
      round: (body.round as number | null | undefined) ?? null,
      actor: requestActorId(req),
    });
    return answer(res, outcome);
  } catch (error) {
    log.error(`[FAILOVER] moving ${slug} failed: ${(error as Error).message}`);
    return res.status(500).json({ success: false, error: 'Failed to move the match' });
  }
});

failoverMatchRouter.post('/matches/:slug/failover/:id/dismiss', requireAuth, async (req: Request, res: Response) => {
  const { slug, id } = req.params;
  if (!SLUG_RE.test(slug) || !ID_RE.test(id)) return res.status(400).json({ success: false, error: 'Invalid request' });
  try {
    const proposal = await getProposal(id);
    if (!proposal || proposal.matchSlug !== slug) {
      return res.status(404).json({ success: false, code: 'not_found', error: 'No such failover proposal' });
    }
    return answer(res, await dismissFailover(id, requestActorId(req)));
  } catch (error) {
    log.error(`[FAILOVER] dismissing ${id} for ${slug} failed: ${(error as Error).message}`);
    return res.status(500).json({ success: false, error: 'Failed to dismiss the proposal' });
  }
});

async function settingsView() {
  const [settings, reserve, free] = await Promise.all([getFailoverSettings(), reserveCount(), freeFleetServers()]);
  const held = pickReserved(
    free.map((c) => ({ id: c.cs2ServerId, name: c.name })),
    reserve.effective
  );
  return {
    settings,
    reserve: {
      configured: reserve.configured,
      effective: reserve.effective,
      poolSize: reserve.poolSize,
      held: free.filter((c) => held.has(c.cs2ServerId)).map((c) => ({ id: c.cs2ServerId, name: c.name })),
    },
  };
}

failoverSettingsRouter.get('/failover/settings', requireAuth, async (_req: Request, res: Response) => {
  try {
    return res.json({ success: true, ...(await settingsView()) });
  } catch (error) {
    log.error(`[FAILOVER] reading the settings failed: ${(error as Error).message}`);
    return res.status(500).json({ success: false, error: 'Failed to read the failover settings' });
  }
});

failoverSettingsRouter.put('/failover/settings', requireAuth, async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as { auto?: unknown; reserve?: unknown };
  if (body.auto !== undefined && typeof body.auto !== 'boolean') {
    return res.status(400).json({ success: false, code: 'bad_args', error: 'auto must be a boolean' });
  }
  if (
    body.reserve !== undefined &&
    body.reserve !== null &&
    (typeof body.reserve !== 'number' || !Number.isInteger(body.reserve) || body.reserve < 0 || body.reserve > MAX_RESERVE)
  ) {
    return res
      .status(400)
      .json({ success: false, code: 'bad_args', error: `reserve must be null (automatic) or 0-${MAX_RESERVE}` });
  }
  try {
    await setFailoverSettings(
      {
        ...(body.auto !== undefined ? { auto: body.auto as boolean } : {}),
        ...(body.reserve !== undefined ? { reserve: body.reserve as number | null } : {}),
      },
      requestActorId(req)
    );
    return res.json({ success: true, ...(await settingsView()) });
  } catch (error) {
    log.error(`[FAILOVER] saving the settings failed: ${(error as Error).message}`);
    return res.status(500).json({ success: false, error: 'Failed to save the failover settings' });
  }
});
