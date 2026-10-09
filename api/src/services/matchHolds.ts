/**
 * Holding matches and pausing brackets: when something goes wrong at an event
 * (a player is late, a PC breaks), an admin stops the automation instead of
 * letting it hand out a walkover.
 *
 * - A held match (`matches.held_until`) is not loaded onto a server, not
 *   auto-started, and its walkover clock on the server is off; for some
 *   minutes or until released. Other matches go on as before.
 * - A paused tournament (`tournament.paused_at`): matches being played finish
 *   (their results count), no new match is loaded or auto-started and the
 *   walkover clocks of the loaded ones are off, until resumed (or `resume_at`).
 * - When either ends, or an admin restarts a match's countdown, the countdown
 *   to auto-start runs again from then (`matches.countdown_from`) and the
 *   walkover clock starts afresh.
 *
 * The game module turns the walkover clock off and on (`onHoldChanged`; CS2:
 * Ready Up's absent-team forfeit, through the match's config).
 */

import { db } from '../config/database';
import { log } from '../utils/logger';
import type { DbMatchRow } from '../types/database.types';
import { integrationForMatch } from '../integrations/registry';
import { matchContextFor } from '../utils/matchIntegration';
import { emitBracketUpdate, emitTournamentUpdate } from './socketService';

/** held_until for a hold with no end: released by an admin. */
export const HOLD_FOREVER = 2147483647;

const now = () => Math.floor(Date.now() / 1000);

/**
 * SQL (on `matches`, aliased `m` unless given) that is true while the match
 * may go ahead: not held, and its tournament (if any) not paused.
 */
export function notHeldSql(alias = 'matches'): string {
  return `((${alias}.held_until IS NULL OR ${alias}.held_until <= EXTRACT(EPOCH FROM NOW())::INTEGER)
    AND NOT EXISTS (SELECT 1 FROM tournament hold_t WHERE hold_t.id = ${alias}.tournament_id AND hold_t.paused_at IS NOT NULL))`;
}

export interface HoldState {
  /** Held until (unix seconds), HOLD_FOREVER, or null. */
  heldUntil: number | null;
  reason: string | null;
  /** Held because its tournament is paused (not the match itself). */
  tournamentPaused: boolean;
}

/** Whether a match is held now, and why. */
export async function holdOf(slug: string): Promise<HoldState | null> {
  const row = await db.queryOneAsync<{
    held_until: number | null;
    hold_reason: string | null;
    paused_at: number | null;
    pause_reason: string | null;
    resume_at: number | null;
  }>(
    `SELECT m.held_until, m.hold_reason, t.paused_at, t.pause_reason, t.resume_at
       FROM matches m LEFT JOIN tournament t ON t.id = m.tournament_id WHERE m.slug = ?`,
    [slug]
  );
  if (!row) return null;
  if (row.paused_at !== null && row.paused_at !== undefined) {
    return {
      heldUntil: row.resume_at ? Number(row.resume_at) : HOLD_FOREVER,
      reason: row.pause_reason,
      tournamentPaused: true,
    };
  }
  const until = row.held_until === null ? null : Number(row.held_until);
  if (until === null || until <= now())
    return { heldUntil: null, reason: null, tournamentPaused: false };
  return { heldUntil: until, reason: row.hold_reason, tournamentPaused: false };
}

/** Whether a match row may go ahead (not held; the tournament's pause is checked separately). */
export function matchHeld(row: Pick<DbMatchRow, 'held_until'>): boolean {
  return row.held_until !== null && row.held_until !== undefined && Number(row.held_until) > now();
}

async function holdChanged(slugs: string[]): Promise<void> {
  for (const slug of slugs) {
    const match = await db.queryOneAsync<DbMatchRow>('SELECT * FROM matches WHERE slug = ?', [
      slug,
    ]);
    if (!match) continue;
    const integration = integrationForMatch(match);
    if (!integration.onHoldChanged) continue;
    try {
      await integration.onHoldChanged(await matchContextFor(match));
    } catch (error) {
      log.warn(`[HOLD] ${slug}: the server did not take the hold change`, { error: String(error) });
    }
  }
}

/** Matches of a tournament a pause reaches: everything not finished. */
async function openMatchSlugs(tournamentId: number): Promise<string[]> {
  const rows = await db.queryAsync<{ slug: string }>(
    `SELECT slug FROM matches WHERE tournament_id = ? AND status NOT IN ('completed', 'cancelled')`,
    [tournamentId]
  );
  return rows.map((r) => r.slug);
}

export interface Actor {
  userId: string;
  name: string;
}

/** Who did what, in the match's event log (the admin's match page shows it). */
async function logEvent(
  slugs: string[],
  type: string,
  by: Actor | null,
  data: Record<string, unknown>
): Promise<void> {
  for (const slug of slugs) {
    await db
      .runAsync('INSERT INTO match_events (match_slug, event_type, event_data) VALUES (?, ?, ?)', [
        slug,
        type,
        JSON.stringify({ ...data, by: by ? { userId: by.userId, name: by.name } : 'automatic' }),
      ])
      .catch((error: unknown) =>
        log.warn(`[HOLD] ${slug}: event not logged`, { error: String(error) })
      );
  }
}

/** Hold a match: for `minutes`, or until released when null. */
export async function holdMatch(
  slug: string,
  opts: { minutes: number | null; reason?: string | null },
  by: Actor
): Promise<HoldState | null> {
  const until = opts.minutes === null ? HOLD_FOREVER : now() + Math.round(opts.minutes * 60);
  await db.runAsync('UPDATE matches SET held_until = ?, hold_reason = ? WHERE slug = ?', [
    until,
    opts.reason?.trim().slice(0, 200) || null,
    slug,
  ]);
  await logEvent([slug], 'admin_hold', by, {
    until,
    minutes: opts.minutes,
    reason: opts.reason ?? null,
  });
  await holdChanged([slug]);
  emitBracketUpdate({ action: 'match_held', matchSlug: slug, heldUntil: until });
  return holdOf(slug);
}

/** Let a held match go ahead now; its countdowns start afresh. */
export async function releaseMatch(slug: string, by: Actor | null): Promise<void> {
  await db.runAsync(
    'UPDATE matches SET held_until = NULL, hold_reason = NULL, countdown_from = ? WHERE slug = ?',
    [now(), slug]
  );
  await logEvent([slug], 'admin_release', by, {});
  await holdChanged([slug]);
  emitBracketUpdate({ action: 'match_released', matchSlug: slug });
  await allocateSoon();
}

/**
 * Give the teams the full time again: the auto-start countdown from now and
 * a fresh walkover clock on the server (off and on again).
 */
export async function restartCountdown(slug: string, by: Actor): Promise<void> {
  await db.runAsync('UPDATE matches SET countdown_from = ? WHERE slug = ?', [now(), slug]);
  await logEvent([slug], 'admin_restart_countdown', by, {});
  // Off, then on: the server's clock starts over.
  const held = now() + 3600;
  await db.runAsync('UPDATE matches SET held_until = ? WHERE slug = ? AND held_until IS NULL', [
    held,
    slug,
  ]);
  await holdChanged([slug]);
  await db.runAsync('UPDATE matches SET held_until = NULL WHERE slug = ? AND held_until = ?', [
    slug,
    held,
  ]);
  await holdChanged([slug]);
  emitBracketUpdate({ action: 'match_countdown_restarted', matchSlug: slug });
}

/** Pause a tournament's bracket: for `minutes`, or until resumed when null. */
export async function pauseTournament(
  tournamentId: number,
  opts: { minutes: number | null; reason?: string | null },
  by: Actor
): Promise<void> {
  const resumeAt = opts.minutes === null ? null : now() + Math.round(opts.minutes * 60);
  await db.runAsync(
    'UPDATE tournament SET paused_at = COALESCE(paused_at, ?), pause_reason = ?, resume_at = ? WHERE id = ?',
    [now(), opts.reason?.trim().slice(0, 200) || null, resumeAt, tournamentId]
  );
  const open = await openMatchSlugs(tournamentId);
  await logEvent(open, 'admin_tournament_pause', by, {
    tournamentId,
    resumeAt,
    reason: opts.reason ?? null,
  });
  await holdChanged(open);
  emitTournamentUpdate({ id: tournamentId, action: 'tournament_paused', resumeAt });
}

/** Resume a paused tournament: the matches waiting go ahead, their countdowns afresh. */
export async function resumeTournament(tournamentId: number, by: Actor | null): Promise<void> {
  const row = await db.queryOneAsync<{ paused_at: number | null }>(
    'SELECT paused_at FROM tournament WHERE id = ?',
    [tournamentId]
  );
  if (!row?.paused_at) return;
  await db.runAsync(
    'UPDATE tournament SET paused_at = NULL, pause_reason = NULL, resume_at = NULL WHERE id = ?',
    [tournamentId]
  );
  // Loaded but not started yet: the auto-start countdown from now.
  await db.runAsync(
    `UPDATE matches SET countdown_from = ? WHERE tournament_id = ? AND status IN ('ready', 'loaded')`,
    [now(), tournamentId]
  );
  const open = await openMatchSlugs(tournamentId);
  await logEvent(open, 'admin_tournament_resume', by, { tournamentId });
  await holdChanged(open);
  emitTournamentUpdate({ id: tournamentId, action: 'tournament_resumed' });
  await allocateSoon();
}

/** Ready matches may go now: try to put them on servers. */
async function allocateSoon(): Promise<void> {
  const { scheduler } = await import('../core/scheduler');
  void scheduler.tryImmediateAllocation();
}

/** Holds and pauses whose time is up end by themselves. */
export async function tickHolds(): Promise<void> {
  // A lineup gap whose time is up is settled before its matches are let go.
  await (await import('./playerModeration')).resolveDueGaps().catch((error: unknown) =>
    log.warn('[HOLD] lineup gaps not settled', { error: String(error) })
  );
  const t = now();
  const matches = await db.queryAsync<{ slug: string }>(
    'SELECT slug FROM matches WHERE held_until IS NOT NULL AND held_until <= ?',
    [t]
  );
  for (const m of matches) {
    log.info(`[HOLD] ${m.slug}: hold over`);
    await releaseMatch(m.slug, null);
  }
  const tournaments = await db.queryAsync<{ id: number }>(
    'SELECT id FROM tournament WHERE paused_at IS NOT NULL AND resume_at IS NOT NULL AND resume_at <= ?',
    [t]
  );
  for (const tr of tournaments) {
    log.info(`[HOLD] tournament ${tr.id}: pause over`);
    await resumeTournament(Number(tr.id), null);
  }
}

let timer: ReturnType<typeof setInterval> | null = null;

export function startHoldTimer(): void {
  if (timer) return;
  timer = setInterval(() => {
    tickHolds().catch((error: unknown) => log.warn('[HOLD] tick failed', { error: String(error) }));
  }, 5_000);
  timer.unref?.();
}

export function stopHoldTimer(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
