/**
 * The scaler's settings: the 'autoscale' row of `cs2_fleet_lists` (`data` =
 * AutoscaleSettings JSON; no row = the defaults, scaling on). And the
 * failover reserve, from the failover settings.
 */

import { db } from '../../../../config/database';
import { log } from '../../../../utils/logger';
import { getFailoverSettings } from '../failoverSettings';
import { normalizeAutoscaleSettings, type AutoscaleSettings } from './plan';

export interface StoredAutoscaleSettings extends AutoscaleSettings {
  updatedBy: string | null;
  updatedAt: number | null;
}

const nowS = () => Math.floor(Date.now() / 1000);

function parse(raw: string | null | undefined): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function getAutoscaleSettings(): Promise<StoredAutoscaleSettings> {
  const row = await db.queryOneAsync<{
    data: string | null;
    updated_by: string | null;
    updated_at: number | null;
  }>(`SELECT data, updated_by, updated_at FROM cs2_fleet_lists WHERE name = 'autoscale'`);
  return {
    ...normalizeAutoscaleSettings(parse(row?.data)),
    updatedBy: row?.updated_by ?? null,
    updatedAt:
      row?.updated_at === null || row?.updated_at === undefined ? null : Number(row.updated_at),
  };
}

export async function setAutoscaleSettings(
  patch: Partial<AutoscaleSettings>,
  actor: string | null
): Promise<StoredAutoscaleSettings> {
  const current = await getAutoscaleSettings();
  const next: AutoscaleSettings = normalizeAutoscaleSettings({
    enabled: patch.enabled ?? current.enabled,
    leadTimeSeconds: patch.leadTimeSeconds ?? current.leadTimeSeconds,
    cooldownSeconds: patch.cooldownSeconds ?? current.cooldownSeconds,
    maxServersPerHost: patch.maxServersPerHost ?? current.maxServersPerHost,
  });
  await db.runAsync(
    `INSERT INTO cs2_fleet_lists (name, rev, data, updated_by, updated_at) VALUES ('autoscale', 1, ?, ?, ?)
       ON CONFLICT (name) DO UPDATE SET rev = cs2_fleet_lists.rev + 1, data = EXCLUDED.data,
         updated_by = EXCLUDED.updated_by, updated_at = EXCLUDED.updated_at`,
    [JSON.stringify(next), actor, nowS()]
  );
  log.info(
    `[AUTOSCALE] settings: ${next.enabled ? 'on' : 'off'}, lead ${next.leadTimeSeconds}s, cool-down ${next.cooldownSeconds}s, max ${next.maxServersPerHost}/machine (by ${actor ?? 'unknown'})`
  );
  return getAutoscaleSettings();
}

/** The failover reserve an admin set (../failoverSettings.ts), or null for automatic. */
export async function configuredReserve(): Promise<number | null> {
  return (await getFailoverSettings()).reserve;
}
