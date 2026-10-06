/**
 * The veto timer: each team gets `veto_turn_seconds` (Match rules, default
 * 45, 0 = no limit) for a step. When the time is up the platform takes the
 * step for them, at random like the simulation does, marked `timedOut` in the
 * veto's actions, and the next team's clock starts. A team that never shows
 * up can no longer hold a match.
 *
 * A turn starts at the previous action (its timestamp), or, for the first
 * step, when this process first saw the match waiting on its veto. That first
 * time is kept in memory: a restart gives the first team a fresh clock, which
 * is the fair side to err on.
 */

import { db } from '../../../config/database';
import { log } from '../../../utils/logger';
import type { DbMatchRow } from '../../../types/database.types';
import { cs2Settings } from '../settingsReaders';
import { autoCompleteVetoForMatch } from './simulation';

const TICK_MS = 2_000;

/** First seen waiting on step 1 (no veto action yet), by match slug. */
const firstSeen = new Map<string, number>();
/** Matches the timer is acting on right now. */
const acting = new Set<string>();
let timer: ReturnType<typeof setInterval> | null = null;

interface StoredVeto {
  status?: string;
  actions?: Array<{ timestamp?: string }>;
}

function parseVeto(raw: string | null | undefined): StoredVeto | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as StoredVeto | null;
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * When the current turn started (epoch ms), or null when the veto is over.
 * Records the first sighting of a match still on step 1.
 */
export function turnStartedAt(slug: string, rawVeto: string | null | undefined, now = Date.now()): number | null {
  const veto = parseVeto(rawVeto);
  if (veto?.status === 'completed') {
    firstSeen.delete(slug);
    return null;
  }
  const last = veto?.actions?.[veto.actions.length - 1]?.timestamp;
  const lastMs = last ? Date.parse(last) : NaN;
  if (Number.isFinite(lastMs)) {
    firstSeen.delete(slug);
    return lastMs;
  }
  let seen = firstSeen.get(slug);
  if (seen === undefined) {
    seen = now;
    firstSeen.set(slug, seen);
  }
  return seen;
}

/** The current turn's deadline as an ISO string, or null without a limit or a turn. */
export async function vetoTurnDeadline(
  slug: string,
  rawVeto: string | null | undefined
): Promise<{ deadline: string; seconds: number } | null> {
  const seconds = await cs2Settings.getVetoTurnSeconds();
  if (seconds <= 0) return null;
  const started = turnStartedAt(slug, rawVeto);
  if (started === null) return null;
  return { deadline: new Date(started + seconds * 1000).toISOString(), seconds };
}

/** Tournament matches whose veto is open: both teams in, no server yet, veto not done. */
async function openVetoMatches(): Promise<DbMatchRow[]> {
  return db.queryAsync<DbMatchRow>(
    `SELECT m.* FROM matches m
       JOIN tournament t ON t.id = m.tournament_id
      WHERE t.status = 'in_progress'
        AND t.type <> 'shuffle'
        AND LOWER(t.format) IN ('bo1', 'bo3', 'bo5')
        AND m.team1_id IS NOT NULL
        AND m.team2_id IS NOT NULL
        AND (m.server_id IS NULL OR m.server_id = '')
        AND (
          (m.veto_state IS NULL AND m.status = 'pending')
          OR (m.veto_state IS NOT NULL AND m.status IN ('pending', 'ready') AND m.veto_state NOT LIKE '%"status":"completed"%')
        )`
  );
}

async function tick(): Promise<void> {
  const seconds = await cs2Settings.getVetoTurnSeconds();
  if (seconds <= 0) return;
  const now = Date.now();
  const open = await openVetoMatches();
  const openSlugs = new Set(open.map((m) => m.slug));
  for (const slug of firstSeen.keys()) if (!openSlugs.has(slug)) firstSeen.delete(slug);

  for (const match of open) {
    const started = turnStartedAt(match.slug, match.veto_state, now);
    if (started === null || now < started + seconds * 1000 || acting.has(match.slug)) continue;
    acting.add(match.slug);
    log.info(`[VETO-TIMER] ${match.slug}: the team ran out of time (${seconds}s); taking the step for them`);
    autoCompleteVetoForMatch(match.slug, { timedOut: true, maxSteps: 1, stepDelayMs: 0 })
      .catch((error: unknown) => log.warn(`[VETO-TIMER] ${match.slug}: could not take the step`, { error: String(error) }))
      .finally(() => acting.delete(match.slug));
  }
}

export function startVetoTimer(): void {
  if (timer) return;
  timer = setInterval(() => {
    tick().catch((error: unknown) => log.warn('[VETO-TIMER] tick failed', { error: String(error) }));
  }, TICK_MS);
  timer.unref?.();
}

export function stopVetoTimer(): void {
  if (timer) clearInterval(timer);
  timer = null;
  firstSeen.clear();
}
