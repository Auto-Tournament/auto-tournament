/**
 * Which servers run a saved setup now (../serverSetups.ts, ../serverSetupRuns.ts). Like a
 * practice server, such a server is not for matches: the allocator never hands it one and the
 * scaler leaves it alone (neither capacity nor stopped as idle) until an admin stops the setup.
 */
import { db } from '../../../config/database';
import { matchPluginDisabled } from './push/pluginSets';

export interface SetupRun {
  fleetServerId: string;
  cs2ServerId: string;
  setupId: string;
  /** The server's stored plugin set before the setup (JSON), given back on stop. */
  previousPlugins: string | null;
  startedBy: string | null;
  startedAt: number;
}

interface Row {
  fleet_server_id: string;
  cs2_server_id: string;
  setup_id: string;
  previous_plugins: string | null;
  started_by: string | null;
  started_at: number;
}

const runOf = (r: Row): SetupRun => ({
  fleetServerId: r.fleet_server_id,
  cs2ServerId: r.cs2_server_id,
  setupId: r.setup_id,
  previousPlugins: r.previous_plugins,
  startedBy: r.started_by,
  startedAt: Number(r.started_at),
});

export async function listSetupRuns(): Promise<SetupRun[]> {
  const rows = await db.queryAsync<Row>('SELECT * FROM cs2_server_setup_runs ORDER BY started_at');
  return rows.map(runOf);
}

export async function setupRunOn(fleetServerId: string): Promise<SetupRun | null> {
  const row = await db.queryOneAsync<Row>(
    'SELECT * FROM cs2_server_setup_runs WHERE fleet_server_id = ?',
    [fleetServerId]
  );
  return row ? runOf(row) : null;
}

/** Records a run; false when the server or the setup already has one (a race lost). */
export async function claimSetupRun(run: Omit<SetupRun, 'startedAt'>): Promise<boolean> {
  const r = await db.runAsync(
    `INSERT INTO cs2_server_setup_runs
       (fleet_server_id, cs2_server_id, setup_id, previous_plugins, started_by, started_at)
     VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`,
    [
      run.fleetServerId,
      run.cs2ServerId,
      run.setupId,
      run.previousPlugins,
      run.startedBy,
      Math.floor(Date.now() / 1000),
    ]
  );
  return r.changes > 0;
}

export async function endSetupRun(fleetServerId: string): Promise<void> {
  await db.runAsync('DELETE FROM cs2_server_setup_runs WHERE fleet_server_id = ?', [fleetServerId]);
}

/** Not for matches: a saved setup runs on it, or its plugin set turns match off (practice). */
export async function notForMatches(fleetServerId: string): Promise<boolean> {
  return !!(await setupRunOn(fleetServerId)) || matchPluginDisabled(fleetServerId);
}
