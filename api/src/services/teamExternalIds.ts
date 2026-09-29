/**
 * Integrators' own ids for teams (`team_external_ids`).
 *
 * An integrator pushes its teams through the teams API (routes/integrationTeams)
 * under a *source* — the label of the API token it calls with — and its own
 * id for each team, the `externalId`. The pair (source, externalId) names one
 * Auto Tournament team; a team has at most one externalId per source. The
 * webhooks carry them back (`external_id`, `external_ids`), so the integrator
 * can find its team in a payload without keeping Auto Tournament's ids.
 */

import { db } from '../config/database';

export { SOURCE_PATTERN, EXTERNAL_ID_PATTERN } from './integrationTeamInput';

export async function teamIdForExternalId(source: string, externalId: string): Promise<string | null> {
  const row = await db.queryOneAsync<{ team_id: string }>(
    'SELECT team_id FROM team_external_ids WHERE source = ? AND external_id = ?',
    [source, externalId]
  );
  return row?.team_id ?? null;
}

export async function externalIdForTeam(source: string, teamId: string): Promise<string | null> {
  const row = await db.queryOneAsync<{ external_id: string }>(
    'SELECT external_id FROM team_external_ids WHERE source = ? AND team_id = ?',
    [source, teamId]
  );
  return row?.external_id ?? null;
}

/** Every source's id for each of `teamIds`: teamId → { source: externalId }. */
export async function externalIdsForTeams(teamIds: string[]): Promise<Map<string, Record<string, string>>> {
  const out = new Map<string, Record<string, string>>();
  const ids = [...new Set(teamIds.filter(Boolean))];
  if (ids.length === 0) return out;
  const placeholders = ids.map(() => '?').join(', ');
  const rows = await db.queryAsync<{ team_id: string; source: string; external_id: string }>(
    `SELECT team_id, source, external_id FROM team_external_ids WHERE team_id IN (${placeholders}) ORDER BY source`,
    ids
  );
  for (const row of rows) {
    const map = out.get(row.team_id) ?? {};
    map[row.source] = row.external_id;
    out.set(row.team_id, map);
  }
  return out;
}

export async function linkExternalId(source: string, externalId: string, teamId: string): Promise<void> {
  const now = Date.now();
  await db.runAsync(
    `INSERT INTO team_external_ids (source, external_id, team_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (source, external_id) DO UPDATE SET team_id = EXCLUDED.team_id, updated_at = EXCLUDED.updated_at`,
    [source, externalId, teamId, now, now]
  );
}

export async function listExternalIds(source: string): Promise<Array<{ externalId: string; teamId: string }>> {
  const rows = await db.queryAsync<{ external_id: string; team_id: string }>(
    'SELECT external_id, team_id FROM team_external_ids WHERE source = ? ORDER BY external_id',
    [source]
  );
  return rows.map((r) => ({ externalId: r.external_id, teamId: r.team_id }));
}
