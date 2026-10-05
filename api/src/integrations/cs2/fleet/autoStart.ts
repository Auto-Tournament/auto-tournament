/**
 * Auto-start (admin setting `at_autostart_after_minutes`): a match loaded on a
 * Ready Up server that is still in warmup N minutes after it loaded goes live,
 * ready or not, through the same `start` command an admin's force start sends.
 * Players are warned in chat 60 s and 10 s before. 0 = off (the match waits
 * for everyone to ready up, as before).
 */

import { db } from '../../../config/database';
import { log } from '../../../utils/logger';
import { runFleetCommand, type IssuedBy } from './driver';

const TICK_MS = 5_000;
const ISSUED_BY: IssuedBy = { userId: 'platform:auto-start', name: 'Auto-start', root: false };

let timer: ReturnType<typeof setInterval> | null = null;
/** Per match load (slug + loaded_at): what was sent already. */
const sent = new Map<string, { warned60: boolean; warned10: boolean; started: boolean }>();

async function tick(): Promise<void> {
  const { cs2Settings } = await import('../settingsReaders');
  const minutes = await cs2Settings.getAtAutostartAfterMinutes();
  if (minutes <= 0) {
    sent.clear();
    return;
  }
  const rows = await db.queryAsync<{ slug: string; server_id: string; loaded_at: number | null }>(
    `SELECT slug, server_id, loaded_at FROM matches
      WHERE status = 'loaded' AND server_id IS NOT NULL AND loaded_at IS NOT NULL`
  );
  const now = Math.floor(Date.now() / 1000);
  const seen = new Set<string>();
  for (const row of rows) {
    const key = `${row.slug}@${row.loaded_at}`;
    seen.add(key);
    const state = sent.get(key) ?? { warned60: false, warned10: false, started: false };
    sent.set(key, state);
    const left = Number(row.loaded_at) + minutes * 60 - now;
    const say = (text: string) =>
      runFleetCommand(row.server_id, 'say', { text, as_admin: true }, ISSUED_BY).catch(() => undefined);
    if (left <= 0 && !state.started) {
      state.started = true;
      const outcome = await runFleetCommand(row.server_id, 'start', {}, ISSUED_BY).catch((error: unknown) => {
        log.warn(`[AUTOSTART] ${row.slug}: start failed`, { error: String(error) });
        return null;
      });
      log.info(`[AUTOSTART] ${row.slug}: ${minutes} min in warmup, started (${outcome?.status ?? 'error'})`);
    } else if (left <= 10 && !state.warned10 && !state.started) {
      state.warned10 = true;
      void say('The match starts in 10 seconds, ready or not.');
    } else if (left <= 60 && !state.warned60 && !state.started) {
      state.warned60 = true;
      void say('The match starts in 1 minute, ready or not.');
    }
  }
  for (const key of [...sent.keys()]) if (!seen.has(key)) sent.delete(key);
}

export function startAutoStart(): void {
  if (timer) return;
  timer = setInterval(() => {
    tick().catch((error: unknown) => log.warn('[AUTOSTART] tick failed', { error: String(error) }));
  }, TICK_MS);
  timer.unref?.();
}

export function stopAutoStart(): void {
  if (timer) clearInterval(timer);
  timer = null;
  sent.clear();
}
