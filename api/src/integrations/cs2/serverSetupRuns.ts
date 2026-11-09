/**
 * Starting and stopping a saved setup (serverSetups.ts) on a server. Start takes a free server
 * (one the allocator could hand a match), records the run so no match and no scaler touches it
 * (fleet/setupRuns.ts), gives it the setup's plugin set, then its map pool, loading the first
 * map. Stop gives the server back the plugins it had and the map vote its own pool, and it goes
 * back to tournaments. A setup is never stopped for a match (decided 2026-11-09); admins only.
 */
import { log } from '../../utils/logger';
import { cs2ServerPool } from './allocation';
import { awaitCommandResult } from './fleet/commands';
import { fleetServerIdOf } from './fleet/link';
import { setMapvotePool, setPlugins, type IssuedBy } from './fleet/push/controls';
import {
  getDefaultPluginSet,
  pluginSetCommand,
  presetSet,
  type StoredPlugins,
} from './fleet/push/pluginSets';
import { readPrefs } from './fleet/push/store';
import { claimSetupRun, endSetupRun, listSetupRuns, setupRunOn } from './fleet/setupRuns';
import { listSetups } from './serverSetups';

const ANSWER_MS = 15_000;

export type RunOutcome =
  | { ok: true; cs2ServerId: string; serverName: string }
  | { ok: false; status: 404 | 409 | 502; error: string };

/** Start a setup on a free server (`cs2ServerId`: that one, if it is free). */
export async function startSetup(
  setupId: string,
  by: { actorId: string | null; issuedBy: IssuedBy },
  cs2ServerId?: string
): Promise<RunOutcome> {
  const setup = (await listSetups()).find((s) => s.id === setupId);
  if (!setup) return { ok: false, status: 404, error: 'No such setup' };
  const running = (await listSetupRuns()).find((r) => r.setupId === setupId);
  if (running) return { ok: false, status: 409, error: 'This setup is already running' };

  const free = (await cs2ServerPool.getAvailableServers()).filter(
    (s) => !cs2ServerId || s.id === cs2ServerId
  );
  for (const server of free) {
    const fleetServerId = await fleetServerIdOf(server.id);
    if (!fleetServerId) continue;
    const before = (await readPrefs(fleetServerId)).plugins;
    const claimed = await claimSetupRun({
      fleetServerId,
      cs2ServerId: server.id,
      setupId,
      previousPlugins: before ? JSON.stringify(before) : null,
      startedBy: by.actorId,
    });
    if (!claimed) continue;
    try {
      const plugins = await setPlugins(
        fleetServerId,
        pluginSetCommand(setup.plugins),
        by.issuedBy,
        by.actorId
      );
      await awaitCommandResult(plugins.id, ANSWER_MS);
      // The map vote's pool, and the first map now (mapvote.so loads with the plugins above).
      const pool = await setMapvotePool(fleetServerId, setup.maps, true, by.issuedBy);
      const answer = await awaitCommandResult(pool.id, ANSWER_MS);
      if (answer && answer.status !== 'ok')
        log.warn(
          `[SETUPS] "${setup.name}" on ${server.id}: mapvote.set ${answer.status} ${answer.errorCode ?? ''}`
        );
    } catch (error) {
      // Nothing reached the server: it stays free for matches.
      await endSetupRun(fleetServerId);
      log.error(`[SETUPS] "${setup.name}" on ${server.id} failed: ${(error as Error).message}`);
      return { ok: false, status: 502, error: 'The server did not take the setup' };
    }
    log.info(`[SETUPS] "${setup.name}" started on ${server.id} by ${by.actorId ?? 'admin'}`);
    return { ok: true, cs2ServerId: server.id, serverName: server.name };
  }
  return {
    ok: false,
    status: 409,
    error: cs2ServerId ? 'That server is not free' : 'No free server',
  };
}

/** Stop the setup on a server: its own plugins and map vote again, back to tournaments. */
export async function stopSetup(
  cs2ServerId: string,
  by: { actorId: string | null; issuedBy: IssuedBy }
): Promise<RunOutcome> {
  const fleetServerId = await fleetServerIdOf(cs2ServerId);
  const run = fleetServerId ? await setupRunOn(fleetServerId) : null;
  if (!fleetServerId || !run) return { ok: false, status: 404, error: 'No setup runs on it' };
  let back: StoredPlugins | null = null;
  try {
    back = run.previousPlugins ? (JSON.parse(run.previousPlugins) as StoredPlugins) : null;
  } catch {
    back = null;
  }
  // No set of its own before: the fleet default, else the Tournament preset.
  back ??= pluginSetCommand((await getDefaultPluginSet()).set ?? presetSet('tournament'));
  await setPlugins(fleetServerId, back, by.issuedBy, by.actorId);
  await setMapvotePool(fleetServerId, [], false, by.issuedBy);
  await endSetupRun(fleetServerId);
  log.info(`[SETUPS] stopped on ${cs2ServerId} by ${by.actorId ?? 'admin'}`);
  return { ok: true, cs2ServerId, serverName: cs2ServerId };
}
