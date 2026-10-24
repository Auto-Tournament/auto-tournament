/* global fetch */
/**
 * A tournament's start time (`settings.startsAt`, ISO): reminders to its
 * players before it, and, with `settings.autoStart`, the start itself.
 *
 * - Reminders: `settings.startReminders` minutes before (default 60, 30, 5),
 *   in the players' bells and on the channels they picked (Discord, email:
 *   `tournament_starting`). Each goes out once (notifyOnce / deliver keys); a
 *   reminder whose moment passed more than 10 minutes ago is skipped (a
 *   start time set at the last minute does not send the 60-minute one late).
 * - Auto start: at `startsAt` the tournament starts through the same route an
 *   admin's Start button calls (POST /api/tournament/start, with a token only
 *   this process holds), so every check runs (team count, server preflight).
 *   If it refuses, admins get a notice with the reason; it is tried once per
 *   start time.
 *
 * A 30-second sweep, started from index.ts once the HTTP server listens.
 */
import crypto from 'crypto';
import { db } from '../config/database';
import { log } from '../utils/logger';
import { addInternalServiceToken } from '../utils/serviceTokens';
import { adminNoticeService } from './adminNoticeService';
import { notificationService } from './notificationService';
import { notifyChannels } from './notifyChannels';
import { tournamentPlayers } from './tournamentNotices';
import type { Untrusted } from '../utils/untrusted';
import { guarded } from '../utils/guarded';

export const DEFAULT_START_REMINDERS = [60, 30, 5];
/** A reminder this late is not sent at all. */
const LATE_REMINDER_MS = 10 * 60_000;
/** An auto start this long after its time is not tried (the platform was down). */
const LATE_START_MS = 6 * 3600_000;

export interface StartSchedule {
  startsAt: number | null; // ms
  autoStart: boolean;
  reminders: number[]; // minutes before, distinct, descending
}

/** The schedule in a tournament's settings (pure: tested on its own). */
export function startScheduleOf(settings: Untrusted): StartSchedule {
  const s = settings && typeof settings === 'object' ? (settings as Record<string, Untrusted>) : {};
  const at = typeof s.startsAt === 'string' ? Date.parse(s.startsAt) : NaN;
  const raw = Array.isArray(s.startReminders) ? s.startReminders : DEFAULT_START_REMINDERS;
  const reminders = [
    ...new Set(
      raw.map((m) => Number(m)).filter((m) => Number.isInteger(m) && m >= 1 && m <= 7 * 24 * 60)
    ),
  ].sort((a, b) => b - a);
  return {
    startsAt: Number.isFinite(at) ? at : null,
    autoStart: s.autoStart === true,
    reminders,
  };
}

/** Reminders due at `now` (minutes before), given the start (pure). */
export function remindersDue(schedule: StartSchedule, now: number): number[] {
  if (schedule.startsAt === null || now >= schedule.startsAt) return [];
  return schedule.reminders.filter((m) => {
    const at = schedule.startsAt! - m * 60_000;
    return now >= at && now - at <= LATE_REMINDER_MS;
  });
}

/** Whether the auto start is due at `now` (pure). */
export function autoStartDue(schedule: StartSchedule, now: number): boolean {
  return (
    schedule.autoStart &&
    schedule.startsAt !== null &&
    now >= schedule.startsAt &&
    now - schedule.startsAt <= LATE_START_MS
  );
}

/** "in 1 hour" / "in 30 minutes" / "in 5 minutes" for messages. */
export function inMinutes(m: number): string {
  if (m % 60 === 0) return m === 60 ? 'in 1 hour' : `in ${m / 60} hours`;
  return m === 1 ? 'in 1 minute' : `in ${m} minutes`;
}

const tried = new Set<string>(); // `${id}:${startsAt}` auto starts attempted by this process
let port = 0;
let secret = '';

async function startTournament(id: number, name: string, startsAt: number): Promise<void> {
  const key = `${id}:${startsAt}`;
  if (tried.has(key)) return;
  tried.add(key);
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/tournament/start?tournamentId=${id}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
      body: '{}',
    });
    const body = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
    if (res.ok) {
      log.info(`[SCHEDULE] Started tournament ${id} (${name}) at its start time`);
      return;
    }
    const why = body.message ?? body.error ?? `HTTP ${res.status}`;
    log.warn(`[SCHEDULE] Tournament ${id} did not start at its start time: ${why}`);
    await adminNoticeService
      .raise(
        'tournament_autostart_failed',
        { tournamentId: id, name, reason: why },
        `tournament:${id}:autostart:${startsAt}`
      )
      .catch(() => undefined);
  } catch (error) {
    log.warn('[SCHEDULE] Auto start failed', { error });
  }
}

/** Reminders this early also say to update the game: a big patch takes a while to download. */
export const UPDATE_HINT_MINUTES = 15;
const UPDATE_HINT = 'Start your game now so any update is done before your first match.';

async function sweep(): Promise<void> {
  const rows = await db.queryAsync<{
    id: number;
    name: string;
    status: string;
    settings: string | null;
  }>("SELECT id, name, status, settings FROM tournament WHERE status IN ('setup', 'ready')", []);
  const now = Date.now();
  for (const t of rows) {
    let schedule: StartSchedule;
    try {
      schedule = startScheduleOf(JSON.parse(t.settings ?? '{}'));
    } catch {
      continue;
    }
    if (schedule.startsAt === null) continue;
    for (const m of remindersDue(schedule, now)) {
      const key = `tournament:${t.id}:starts:${schedule.startsAt}:${m}`;
      const players = await tournamentPlayers(t.id);
      await notificationService.notifyOnce(
        players,
        'tournament',
        {
          tournamentId: t.id,
          name: t.name,
          event: 'starts_soon',
          minutes: m,
          startsAt: Math.floor(schedule.startsAt / 1000),
        },
        key
      );
      await notifyChannels.deliver(players, 'tournament_starting', key, {
        subject: `${t.name} starts ${inMinutes(m)}`,
        text:
          `You signed up for ${t.name}. It starts ${inMinutes(m)}; be ready to join your first match.` +
          (m >= UPDATE_HINT_MINUTES ? ` ${UPDATE_HINT}` : ''),
        url: `/tournament/${t.id}`,
        action: 'Open the tournament',
      });
    }
    if (autoStartDue(schedule, now)) await startTournament(t.id, t.name, schedule.startsAt);
  }
}

let started = false;

/** Start the 30-second sweep. `apiPort`: where this process listens. */
export function startTournamentSchedule(apiPort: number): void {
  if (started) return;
  started = true;
  port = apiPort;
  secret = crypto.randomBytes(32).toString('hex');
  addInternalServiceToken('tournament-schedule', secret);
  const guardedSweep = guarded(sweep);
  const run = () =>
    guardedSweep().catch((error) => {
      log.debug('[SCHEDULE] sweep failed', { error });
    });
  setTimeout(run, 10_000).unref?.();
  setInterval(run, 30_000).unref?.();
}
