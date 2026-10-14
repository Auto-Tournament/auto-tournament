/**
 * The veto timer: each team gets `at_veto_turn_seconds` (Match rules, default
 * 45, 0 = no limit) for a step. When the time is up the platform takes the
 * step for them, at random like the simulation does, marked `timedOut` in the
 * veto's actions, and the next team's clock starts. A team that never shows
 * up can no longer hold a match.
 *
 * A turn starts at the previous action (its timestamp), or, for the first
 * step, when this process first saw the match waiting on its veto. That first
 * time is kept in memory: a restart gives the first team a fresh clock, which
 * is the fair side to err on. The first step gets `at_veto_first_turn_seconds`
 * (default 2 min: the players are coming from their last match).
 *
 * A held match (an admin's hold, or the break between a team's matches) has
 * no clock: its veto opens when the hold ends (`opensAt` until then).
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
export function turnStartedAt(
  slug: string,
  rawVeto: string | null | undefined,
  now = Date.now()
): number | null {
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

/** Seconds for the turn after `actions` steps: the first one may be longer. */
async function secondsForTurn(rawVeto: string | null | undefined): Promise<number> {
  const seconds = await cs2Settings.getVetoTurnSeconds();
  if (seconds <= 0) return 0;
  if ((parseVeto(rawVeto)?.actions?.length ?? 0) > 0) return seconds;
  const first = await cs2Settings.getVetoFirstTurnSeconds();
  return first > 0 ? Math.max(seconds, first) : seconds;
}

/** The match's hold end (unix s) while it is held, else null. */
async function heldUntil(slug: string): Promise<number | null> {
  const row = await db.queryOneAsync<{ held_until: number | null; paused: number | null }>(
    `SELECT m.held_until, t.paused_at AS paused FROM matches m LEFT JOIN tournament t ON t.id = m.tournament_id
      WHERE m.slug = ?`,
    [slug]
  );
  const until = row?.held_until ? Number(row.held_until) : null;
  return until && until > Math.floor(Date.now() / 1000) ? until : null;
}

/**
 * The current turn's deadline as an ISO string, or null without a limit or a
 * turn; `opensAt` instead while the match is held (the break between matches).
 */
export async function vetoTurnDeadline(
  slug: string,
  rawVeto: string | null | undefined
): Promise<{ deadline?: string; seconds?: number; opensAt?: string } | null> {
  const held = await heldUntil(slug);
  if (held !== null) return { opensAt: new Date(held * 1000).toISOString() };
  const seconds = await secondsForTurn(rawVeto);
  if (seconds <= 0) return null;
  const started = turnStartedAt(slug, rawVeto);
  if (started === null) return null;
  return { deadline: new Date(started + seconds * 1000).toISOString(), seconds };
}

/** Whether the veto of `slug` is waiting for its hold to end (no actions until then). */
export async function vetoWaitingOnHold(slug: string): Promise<string | null> {
  const held = await heldUntil(slug);
  return held === null ? null : new Date(held * 1000).toISOString();
}

/** Tournament matches whose veto is open: both teams in, no server yet, veto not done. */
async function openVetoMatches(): Promise<DbMatchRow[]> {
  return db.queryAsync<DbMatchRow>(
    `SELECT m.* FROM matches m
       JOIN tournament t ON t.id = m.tournament_id
      WHERE t.status = 'in_progress'
        AND t.type <> 'shuffle'
        AND LOWER(t.format) IN ('bo1', 'bo3', 'bo5')
        AND COALESCE(t.settings::jsonb #>> '{cs2,veto}', 'true') <> 'false'
        AND m.team1_id IS NOT NULL
        AND m.team2_id IS NOT NULL
        AND (m.held_until IS NULL OR m.held_until <= EXTRACT(EPOCH FROM NOW())::int)
        AND t.paused_at IS NULL
        AND (m.server_id IS NULL OR m.server_id = '')
        AND (
          (m.veto_state IS NULL AND m.status IN ('pending', 'ready'))
          OR (m.veto_state IS NOT NULL AND m.status IN ('pending', 'ready') AND m.veto_state NOT LIKE '%"status":"completed"%')
        )`
  );
}

async function tick(): Promise<void> {
  if ((await cs2Settings.getVetoTurnSeconds()) <= 0) return;
  const now = Date.now();
  const open = await openVetoMatches();
  const openSlugs = new Set(open.map((m) => m.slug));
  for (const slug of firstSeen.keys()) if (!openSlugs.has(slug)) firstSeen.delete(slug);

  for (const match of open) {
    const seconds = await secondsForTurn(match.veto_state);
    const started = turnStartedAt(match.slug, match.veto_state, now);
    if (started === null || now < started + seconds * 1000 || acting.has(match.slug)) continue;
    acting.add(match.slug);
    log.info(
      `[VETO-TIMER] ${match.slug}: the team ran out of time (${seconds}s); taking the step for them`
    );
    autoCompleteVetoForMatch(match.slug, { timedOut: true, maxSteps: 1, stepDelayMs: 0 })
      .catch((error: unknown) =>
        log.warn(`[VETO-TIMER] ${match.slug}: could not take the step`, { error: String(error) })
      )
      .finally(() => acting.delete(match.slug));
  }
}

export function startVetoTimer(): void {
  if (timer) return;
  timer = setInterval(() => {
    tick().catch((error: unknown) =>
      log.warn('[VETO-TIMER] tick failed', { error: String(error) })
    );
  }, TICK_MS);
  timer.unref?.();
}

export function stopVetoTimer(): void {
  if (timer) clearInterval(timer);
  timer = null;
  firstSeen.clear();
}
