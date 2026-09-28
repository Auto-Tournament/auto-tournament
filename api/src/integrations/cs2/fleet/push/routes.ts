/**
 * Admin routes for the server-level pushes, mounted at `/api/fleet` after
 * the registry's routes (../routes.ts). All need an admin (`requireAuth`).
 *
 *   GET  /api/fleet/admins                       the admins.set list, its rev, and each server's copy
 *   PUT  /api/fleet/admins/extras                extra in-game admins {admins: [{steamid64, name}]}
 *   POST /api/fleet/admins/push                  send the current list to every enrolled server again
 *   GET  /api/fleet/settings                     the fleet default settings and their rev
 *   PUT  /api/fleet/settings                     save the fleet default {settings} (pushed to every server)
 *   GET  /api/fleet/servers/:id/push             one server: settings override, effective settings,
 *                                                whitelist / practice / plugins, and every push's status
 *   PUT  /api/fleet/servers/:id/settings         save its override {settings} (null clears it); pushed
 *   POST /api/fleet/servers/:id/settings/push    send its effective settings again
 *   PUT  /api/fleet/servers/:id/whitelist        {enabled, steamids?} → cmd whitelist.set
 *   PUT  /api/fleet/servers/:id/practice         {on} → cmd practice.set
 *   POST /api/fleet/servers/:id/plugins          {enable?, disable?} → cmd plugins.set
 *   GET  /api/fleet/matches/:slug/roster         a fleet match's roster, config_rev and recent updates
 *   POST /api/fleet/matches/:slug/update         {ops, baseConfigRev?} → match.update (CAS on config_rev)
 *
 * Settings responses never contain the status HTTP token (`statusTokenSet`).
 */

import { Router, type Request, type Response } from 'express';
import { db } from '../../../../config/database';
import { requireAuth, requestActorId } from '../../../../middleware/auth';
import { log } from '../../../../utils/logger';
import { getCommand, awaitCommandResult, type FleetCommandRecord } from '../commands';
import * as registry from '../registry';
import { fleetBus } from '../service';
import type { CmdPayload } from '../protocol/v1';
import { getAdminsState, isSteam64, pushAdmins, setExtraAdmins, type FleetAdmin } from './admins';
import {
  setPlugins,
  setPractice,
  setWhitelist,
  validatePlugins,
  validateWhitelist,
} from './controls';
import { getMatchRoster, sendMatchUpdate, validateRosterOps } from './matchUpdate';
import {
  MATCH_SETTINGS,
  effectiveSettings,
  getDefaultSettings,
  pushSettings,
  redactSettings,
  saveDefaultSettings,
  saveServerSettings,
  validateSettings,
} from './settings';
import { enrolledServerIds, readAllPrefs, type PushRecord } from './store';

export const fleetPushRouter = Router();
fleetPushRouter.use(requireAuth);

/** How long a switch waits for its cmd.result before answering "sent". */
const CONTROL_WAIT_MS = 5_000;

function handler(what: string, fn: (req: Request, res: Response) => Promise<unknown>) {
  return (req: Request, res: Response) => {
    fn(req, res).catch((error) => {
      log.error(`[FLEET] ${what} failed: ${(error as Error).message}`);
      if (!res.headersSent) res.status(500).json({ success: false, error: `Failed to ${what}` });
    });
  };
}

/** `cmd.issued_by` for the signed-in admin (their player name when there is one). */
async function issuedBy(req: Request): Promise<CmdPayload['issued_by']> {
  const actor = requestActorId(req);
  let name = actor ?? 'admin';
  if (actor && isSteam64(actor)) {
    const row = await db.queryOneAsync<{ name: string }>('SELECT name FROM players WHERE id = ?', [
      actor,
    ]);
    if (row?.name) name = row.name;
  }
  return { user_id: (actor ?? 'admin').slice(0, 64), name: name.slice(0, 128), root: false };
}

/** An enrolled server, or the error response already sent. */
async function enrolledServer(
  req: Request,
  res: Response
): Promise<registry.FleetServerRow | null> {
  const server = await registry.getFleetServer(req.params.id);
  if (!server) {
    res.status(404).json({ success: false, error: 'Fleet server not found' });
    return null;
  }
  if (server.status !== 'enrolled') {
    res.status(409).json({ success: false, error: 'Only an enrolled server takes settings' });
    return null;
  }
  return server;
}

interface PushStatus {
  at: number;
  rev: number | null;
  /** For ack-only messages (admins.set, server.config): the server acked it. */
  acked: boolean;
  /** For commands: pending until the cmd.result, then ok / rejected / failed / expired. */
  status: FleetCommandRecord['status'] | null;
  errorCode: string | null;
  message: string | null;
  output: string | null;
}

async function pushStatus(
  record: PushRecord | undefined,
  txAcked: number
): Promise<PushStatus | null> {
  if (!record) return null;
  const acked = typeof record.seq === 'number' && record.seq <= txAcked;
  const command = record.id ? await getCommand(record.id) : null;
  return {
    at: record.at,
    rev: record.rev ?? null,
    acked,
    status: command?.status ?? null,
    errorCode: command?.errorCode ?? null,
    message: command?.result?.error?.message ?? null,
    output: command?.result?.output ?? null,
  };
}

function commandView(command: FleetCommandRecord | null, id: string, delivered: boolean) {
  return {
    id,
    delivered,
    status: command?.status ?? 'pending',
    errorCode: command?.errorCode ?? null,
    message: command?.result?.error?.message ?? null,
    output: command?.result?.output ?? null,
  };
}

// --- admins.set ---------------------------------------------------------------

fleetPushRouter.get(
  '/admins',
  handler('read the fleet admin list', async (_req, res) => {
    const [state, servers, prefs] = await Promise.all([
      getAdminsState(),
      registry.listFleetServers(),
      readAllPrefs(),
    ]);
    const bus = fleetBus();
    const perServer = await Promise.all(
      servers
        .filter((s) => s.status === 'enrolled')
        .map(async (s) => {
          const push = prefs.get(s.id)?.pushed.admins;
          const stream = await registry.getStreamState(s.id);
          return {
            serverId: s.id,
            name: s.name,
            online: bus.isConnected(s.id),
            rev: push?.rev ?? null,
            acked: typeof push?.seq === 'number' && push.seq <= stream.txAcked,
            at: push?.at ?? null,
          };
        })
    );
    return res.json({ success: true, ...state, servers: perServer });
  })
);

fleetPushRouter.put(
  '/admins/extras',
  handler('save the extra admins', async (req, res) => {
    const raw = (req.body as { admins?: unknown })?.admins;
    if (!Array.isArray(raw))
      return res
        .status(400)
        .json({ success: false, error: 'admins must be an array of {steamid64, name}' });
    if (raw.length > 1000)
      return res.status(400).json({ success: false, error: 'at most 1000 extra admins' });
    const extras: FleetAdmin[] = [];
    for (const entry of raw) {
      const e = entry as { steamid64?: unknown; name?: unknown };
      const id = typeof e?.steamid64 === 'string' ? e.steamid64.trim() : '';
      if (!isSteam64(id))
        return res
          .status(400)
          .json({ success: false, error: `not a SteamID64: ${String(e?.steamid64)}` });
      const name = typeof e.name === 'string' ? e.name.trim().slice(0, 128) : '';
      if (!extras.some((x) => x.steamid64 === id)) extras.push({ steamid64: id, name: name || id });
    }
    const result = await setExtraAdmins(extras, requestActorId(req));
    return res.json({ success: true, ...result });
  })
);

fleetPushRouter.post(
  '/admins/push',
  handler('push the admin list', async (_req, res) => {
    const state = await getAdminsState();
    if (state.rev < 1)
      return res.status(409).json({ success: false, error: 'The admin list has no rev yet' });
    let pushed = 0;
    for (const serverId of await enrolledServerIds()) {
      await pushAdmins(serverId, state.rev, state.admins);
      pushed += 1;
    }
    return res.json({ success: true, rev: state.rev, pushed });
  })
);

// --- settings (server.config + settings.set) ------------------------------------

fleetPushRouter.get(
  '/settings',
  handler('read the fleet settings', async (_req, res) => {
    const def = await getDefaultSettings();
    return res.json({
      success: true,
      rev: def.rev,
      settings: redactSettings(def.settings),
      matchSettings: Object.keys(MATCH_SETTINGS),
      updatedBy: def.updatedBy,
      updatedAt: def.updatedAt,
    });
  })
);

fleetPushRouter.put(
  '/settings',
  handler('save the fleet settings', async (req, res) => {
    const check = validateSettings((req.body as { settings?: unknown })?.settings);
    if (!check.ok)
      return res
        .status(400)
        .json({ success: false, error: 'Invalid settings', details: check.errors });
    const saved = await saveDefaultSettings(check.value, requestActorId(req), await issuedBy(req));
    const def = await getDefaultSettings();
    return res.json({ success: true, ...saved, settings: redactSettings(def.settings) });
  })
);

fleetPushRouter.get(
  '/servers/:id/push',
  handler('read the server push state', async (req, res) => {
    const server = await registry.getFleetServer(req.params.id);
    if (!server) return res.status(404).json({ success: false, error: 'Fleet server not found' });
    const [{ rev, override, effective, prefs }, stream] = await Promise.all([
      effectiveSettings(server.id),
      registry.getStreamState(server.id),
    ]);
    const p = prefs.pushed;
    const [admins, serverConfig, settings, whitelist, practice, plugins] = await Promise.all([
      pushStatus(p.admins, stream.txAcked),
      pushStatus(p.server_config, stream.txAcked),
      pushStatus(p.settings, stream.txAcked),
      pushStatus(p.whitelist, stream.txAcked),
      pushStatus(p.practice, stream.txAcked),
      pushStatus(p.plugins, stream.txAcked),
    ]);
    return res.json({
      success: true,
      serverId: server.id,
      online: fleetBus().isConnected(server.id),
      settingsRev: rev,
      override: override ? redactSettings(override) : null,
      effective: redactSettings(effective),
      whitelist: prefs.whitelist,
      practice: prefs.practice,
      plugins: prefs.plugins,
      pushed: { admins, serverConfig, settings, whitelist, practice, plugins },
    });
  })
);

fleetPushRouter.put(
  '/servers/:id/settings',
  handler('save the server settings', async (req, res) => {
    const server = await enrolledServer(req, res);
    if (!server) return;
    const raw = (req.body as { settings?: unknown })?.settings;
    let value = null;
    if (raw !== null) {
      const check = validateSettings(raw);
      if (!check.ok)
        return res
          .status(400)
          .json({ success: false, error: 'Invalid settings', details: check.errors });
      value = check.value;
    }
    const saved = await saveServerSettings(
      server.id,
      value,
      requestActorId(req),
      await issuedBy(req)
    );
    return res.json({ success: true, ...saved });
  })
);

fleetPushRouter.post(
  '/servers/:id/settings/push',
  handler('push the server settings', async (req, res) => {
    const server = await enrolledServer(req, res);
    if (!server) return;
    const sent = await pushSettings(server.id, await issuedBy(req));
    if (!sent.serverConfig && !sent.settingsSet) {
      return res.status(409).json({
        success: false,
        error: 'No settings to push: set a fleet default or an override first',
      });
    }
    return res.json({ success: true, ...sent });
  })
);

// --- whitelist / practice / plugins ------------------------------------------------

fleetPushRouter.put(
  '/servers/:id/whitelist',
  handler('set the whitelist', async (req, res) => {
    const server = await enrolledServer(req, res);
    if (!server) return;
    const check = validateWhitelist(req.body);
    if (!check.ok) return res.status(400).json({ success: false, error: check.error });
    const sent = await setWhitelist(
      server.id,
      check.value,
      await issuedBy(req),
      requestActorId(req)
    );
    const answer = await awaitCommandResult(sent.id, CONTROL_WAIT_MS);
    return res.json({ success: true, command: commandView(answer, sent.id, sent.delivered) });
  })
);

fleetPushRouter.put(
  '/servers/:id/practice',
  handler('switch practice mode', async (req, res) => {
    const server = await enrolledServer(req, res);
    if (!server) return;
    const on = (req.body as { on?: unknown })?.on;
    if (typeof on !== 'boolean')
      return res.status(400).json({ success: false, error: 'on must be true or false' });
    const sent = await setPractice(server.id, on, await issuedBy(req), requestActorId(req));
    const answer = await awaitCommandResult(sent.id, CONTROL_WAIT_MS);
    return res.json({ success: true, command: commandView(answer, sent.id, sent.delivered) });
  })
);

fleetPushRouter.post(
  '/servers/:id/plugins',
  handler('change the plugins', async (req, res) => {
    const server = await enrolledServer(req, res);
    if (!server) return;
    const check = validatePlugins(req.body);
    if (!check.ok) return res.status(400).json({ success: false, error: check.error });
    const sent = await setPlugins(server.id, check.value, await issuedBy(req), requestActorId(req));
    const answer = await awaitCommandResult(sent.id, CONTROL_WAIT_MS);
    return res.json({ success: true, command: commandView(answer, sent.id, sent.delivered) });
  })
);

// --- match.update ---------------------------------------------------------------------

fleetPushRouter.get(
  '/matches/:slug/roster',
  handler('read the match roster', async (req, res) => {
    const info = await getMatchRoster(req.params.slug);
    return res.json({ success: true, ...info });
  })
);

fleetPushRouter.post(
  '/matches/:slug/update',
  handler('update the match', async (req, res) => {
    const body = (req.body ?? {}) as { ops?: unknown; baseConfigRev?: unknown };
    const check = validateRosterOps(body.ops);
    if (!check.ok) return res.status(400).json({ success: false, error: check.error });
    let baseConfigRev: number | undefined;
    if (body.baseConfigRev !== undefined && body.baseConfigRev !== null) {
      if (
        typeof body.baseConfigRev !== 'number' ||
        !Number.isInteger(body.baseConfigRev) ||
        body.baseConfigRev < 0
      ) {
        return res
          .status(400)
          .json({ success: false, error: 'baseConfigRev must be a non-negative integer' });
      }
      baseConfigRev = body.baseConfigRev;
    }
    const outcome = await sendMatchUpdate(req.params.slug, check.ops, { baseConfigRev });
    switch (outcome.kind) {
      case 'not_fleet':
        return res.status(409).json({
          success: false,
          code: 'not_fleet',
          error: 'This match is not running on a Ready Up fleet server',
        });
      case 'stale':
        return res.status(409).json({
          success: false,
          code: 'stale',
          configRev: outcome.configRev,
          error: 'The match config changed since you loaded it; review the roster and try again',
        });
      case 'pending':
        return res.status(202).json({
          success: true,
          status: 'pending',
          commandId: outcome.commandId,
          delivered: outcome.delivered,
        });
      case 'answered': {
        const { command } = outcome;
        const view = {
          status: command.status,
          commandId: command.id,
          configRev: outcome.configRev,
          errorCode: command.errorCode,
          message: command.result?.error?.message ?? null,
          configSaved: outcome.configSaved,
        };
        if (command.status === 'ok') return res.json({ success: true, ...view });
        if (command.errorCode === 'conflict') {
          return res.status(409).json({
            success: false,
            code: 'conflict',
            ...view,
            error: `The server's config is at rev ${outcome.configRev}; review the roster and try again`,
          });
        }
        return res.status(422).json({
          success: false,
          code: command.errorCode ?? command.status,
          ...view,
          error: command.result?.error?.message ?? `The server answered ${command.status}`,
        });
      }
    }
  })
);
