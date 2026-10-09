/**
 * The daily license check-in, wired to this instance: the store is
 * `app_settings`, the counts come from the database (./checkin.ts has the
 * rules and what is sent).
 *
 * Runs only with a license key saved, and only when check-ins are on here
 * (`resolveCheckinUrl`): about a minute after boot, when the key changes, and
 * once a day after that (jittered, so instances don't all call at once).
 * Everything is in the background and best-effort: a failure is a debug line.
 */

import { db } from '../../config/database';
import { log } from '../../utils/logger';
import packageJson from '../../../package.json';
import {
  CHECKIN_INTERVAL_MS,
  CHECKIN_STARTUP_DELAY_MS,
  LicenseCheckin,
  summarizeActivity,
  type Activity,
  type CheckinStore,
} from './checkin';
import { countServers } from './serverCount';
import { configuredPublicOrigin } from '../../utils/publicOrigin';

/** Up to this much is added to the startup delay, and ± this much to each day. */
const JITTER_MS = 60 * 60 * 1000;

/**
 * Straight to `app_settings`: the settings service logs every write, and
 * these are bookkeeping, not an admin's change. The keys are registered in
 * settingsService's CORE_SETTINGS all the same.
 */
const store: CheckinStore = {
  get: (key) => db.getAppSettingAsync(key),
  set: (key, value) => db.setAppSettingAsync(key, value),
};

async function getKey(): Promise<string | null> {
  return (await db.getAppSettingAsync('license_key'))?.trim() || null;
}

/** Finished matches and tournaments with activity in [since, until), unix seconds. */
export async function readActivity(since: number, until: number): Promise<Activity> {
  const [finished, started, tournaments] = await Promise.all([
    db.queryAsync<{ tournament_id: number | null }>(
      'SELECT tournament_id FROM matches WHERE completed_at >= $1 AND completed_at < $2',
      [since, until]
    ),
    db.queryAsync<{ id: number }>('SELECT id FROM tournament WHERE started_at >= $1 AND started_at < $2', [
      since,
      until,
    ]),
    db.queryAsync<{ id: number; team_ids: string | null }>('SELECT id, team_ids FROM tournament'),
  ]);
  return summarizeActivity(
    finished,
    started.map((row) => row.id),
    tournaments
  );
}

/** Match finish and tournament start times since `since` (unix seconds), for the event-license question. */
export async function readEventActivity(
  since: number
): Promise<{ matchFinishedAt: number[]; tournamentStartedAt: number[] }> {
  const [matches, tournaments] = await Promise.all([
    db.queryAsync<{ completed_at: number | string }>(
      'SELECT completed_at FROM matches WHERE completed_at >= $1',
      [since]
    ),
    db.queryAsync<{ started_at: number | string }>('SELECT started_at FROM tournament WHERE started_at >= $1', [
      since,
    ]),
  ]);
  return {
    matchFinishedAt: matches.map((row) => Number(row.completed_at)),
    tournamentStartedAt: tournaments.map((row) => Number(row.started_at)),
  };
}

export const licenseCheckin = new LicenseCheckin({
  store,
  getKey,
  countServers,
  activity: readActivity,
  version: packageJson.version,
  publicUrl: () => configuredPublicOrigin(),
});

let timer: NodeJS.Timeout | null = null;

function schedule(delayMs: number): void {
  timer = setTimeout(() => {
    void licenseCheckin.run().finally(() => {
      if (timer) schedule(CHECKIN_INTERVAL_MS + Math.round((Math.random() * 2 - 1) * JITTER_MS));
    });
  }, delayMs);
  timer.unref();
}

/** At startup: the first check-in about a minute after boot, then daily. A no-op when check-ins are off. */
export function startLicenseCheckin(): void {
  if (timer) return;
  if (!licenseCheckin.url()) {
    log.debug('[LICENSE] Check-in is off here (LICENSE_CHECKIN_URL, or NODE_ENV=test)');
    return;
  }
  schedule(CHECKIN_STARTUP_DELAY_MS + Math.round(Math.random() * JITTER_MS * 0.1));
}

export function stopLicenseCheckin(): void {
  if (timer) clearTimeout(timer);
  timer = null;
}

/**
 * The key was saved, replaced or removed: forget what the server said about
 * the old one, and check in with the new one now (in the background).
 */
export function licenseKeyChanged(hasKey: boolean): void {
  void licenseCheckin
    .clearState()
    .then(() => (hasKey && licenseCheckin.url() ? licenseCheckin.run({ force: true }) : undefined))
    .catch((error: unknown) => {
      log.debug('[LICENSE] Could not reset the check-in state', {
        error: error instanceof Error ? error.message : String(error),
      });
    });
}
