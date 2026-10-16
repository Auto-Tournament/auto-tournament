/**
 * Match times (Manage › Schedule): each round of a tournament can have a
 * start time, a single match its own (`matches.starts_at`), and the veto
 * opens a few minutes before it so the match can start on time.
 *
 * `settings.matchTimes`: `{ mode: 'times' | 'asap', rounds: { [round]: ISO },
 * vetoLeadMinutes, reminderMinutes }`. In 'asap' mode (or with no time for a
 * match) everything works as before: a match goes ahead once both teams and
 * a server are ready.
 *
 * - The veto opens at the start minus `vetoLeadMinutes` (5 by default): the
 *   match is held until then (core's hold, the same as the break between
 *   matches), so nothing about it begins earlier. A later hold (a team still
 *   playing, the break) wins; players see the time it actually opens.
 * - A reminder goes to the match's players `reminderMinutes` before the veto
 *   opens (15 by default; 0 is off): in their bell and on their channels
 *   (Discord, email). The veto opening is announced as before.
 *
 * Holds this module sets carry the reason prefix START_REASON so a change of
 * times can move or lift them without touching an admin's own hold.
 */
import { db } from '../config/database';
import { log } from '../utils/logger';
import { describeMatch, describedPlayers } from '../utils/matchIntegration';
import { holdForBreak } from './matchHolds';
import { teamPlayers } from './matchViewer';
import { notificationService } from './notificationService';
import { notifyChannels } from './notifyChannels';
import type { GameId } from '../integrations/types';

export const DEFAULT_VETO_LEAD_MINUTES = 5;
export const DEFAULT_REMINDER_MINUTES = 15;
const START_REASON = 'Start time';
/** A reminder this late is not sent. */
const LATE_REMINDER_S = 10 * 60;

export interface MatchTimes {
  mode: 'times' | 'asap';
  /** Round number → start (unix seconds). */
  rounds: Record<number, number>;
  vetoLeadMinutes: number;
  reminderMinutes: number;
}

/** The match times in a tournament's settings; null in 'asap' mode or when there are none (pure). */
export function matchTimesOf(settings: unknown): MatchTimes | null {
  const s = settings && typeof settings === 'object' ? (settings as Record<string, unknown>) : {};
  const raw = s.matchTimes;
  if (!raw || typeof raw !== 'object') return null;
  const m = raw as Record<string, unknown>;
  if (m.mode !== 'times') return null;
  const rounds: Record<number, number> = {};
  if (m.rounds && typeof m.rounds === 'object') {
    for (const [k, v] of Object.entries(m.rounds as Record<string, unknown>)) {
      const round = Number(k);
      const at = typeof v === 'string' ? Date.parse(v) : NaN;
      if (Number.isInteger(round) && round >= 1 && Number.isFinite(at)) {
        rounds[round] = Math.floor(at / 1000);
      }
    }
  }
  const minutes = (v: unknown, fallback: number) =>
    typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 120 ? v : fallback;
  return {
    mode: 'times',
    rounds,
    vetoLeadMinutes: minutes(m.vetoLeadMinutes, DEFAULT_VETO_LEAD_MINUTES),
    reminderMinutes: minutes(m.reminderMinutes, DEFAULT_REMINDER_MINUTES),
  };
}

/** Checks `settings.matchTimes` as sent; an error message, or null when it is fine. */
export function matchTimesError(raw: unknown): string | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== 'object') return 'settings.matchTimes must be an object';
  const m = raw as Record<string, unknown>;
  if (m.mode !== 'times' && m.mode !== 'asap')
    return "settings.matchTimes.mode must be 'times' or 'asap'";
  if (m.rounds !== undefined) {
    if (!m.rounds || typeof m.rounds !== 'object')
      return 'settings.matchTimes.rounds must be an object';
    for (const [k, v] of Object.entries(m.rounds as Record<string, unknown>)) {
      if (!Number.isInteger(Number(k)) || Number(k) < 1 || Number(k) > 64)
        return 'settings.matchTimes.rounds is keyed by round number';
      if (typeof v !== 'string' || !Number.isFinite(Date.parse(v)))
        return 'settings.matchTimes.rounds holds ISO times';
    }
  }
  for (const key of ['vetoLeadMinutes', 'reminderMinutes'] as const) {
    const v = m[key];
    if (v !== undefined && (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > 120))
      return `settings.matchTimes.${key} must be 0 to 120 minutes`;
  }
  return null;
}

/** A match's start (unix s): its own time, else its round's; null when it has none (pure). */
export function startOfMatch(
  match: { round: number | null; starts_at?: number | null },
  times: MatchTimes | null
): number | null {
  if (!times) return null;
  if (match.starts_at !== null && match.starts_at !== undefined) return Number(match.starts_at);
  return match.round ? (times.rounds[match.round] ?? null) : null;
}

/** When its veto opens (unix s), or null (pure). */
export function vetoOpensOf(start: number | null, times: MatchTimes | null): number | null {
  if (start === null || !times) return null;
  return start - times.vetoLeadMinutes * 60;
}

/** The times of one match for its pages: `{ startsAt, vetoOpensAt }` (unix s), or nulls. */
export function matchTimeFields(
  match: { round: number | null; starts_at?: number | null },
  settings: unknown
): { startsAt: number | null; vetoOpensAt: number | null } {
  const times = matchTimesOf(settings);
  const startsAt = startOfMatch(match, times);
  return { startsAt, vetoOpensAt: vetoOpensOf(startsAt, times) };
}

async function tournamentSettings(tournamentId: number): Promise<unknown> {
  const row = await db.queryOneAsync<{ settings: string | null }>(
    'SELECT settings FROM tournament WHERE id = ?',
    [tournamentId]
  );
  try {
    return row?.settings ? JSON.parse(row.settings) : {};
  } catch {
    return {};
  }
}

function clock(at: number): string {
  return new Date(at * 1000).toISOString();
}

/**
 * Hold a match whose veto is not open yet until it opens. Returns that time
 * (unix s) when it is held for it, else null. Never shortens a longer hold.
 */
export async function holdForStartTime(slug: string): Promise<number | null> {
  const match = await db.queryOneAsync<{
    tournament_id: number | null;
    round: number | null;
    starts_at: number | null;
    veto_state: string | null;
    server_id: string | null;
  }>('SELECT tournament_id, round, starts_at, veto_state, server_id FROM matches WHERE slug = ?', [
    slug,
  ]);
  if (!match?.tournament_id || match.veto_state || match.server_id) return null;
  const times = matchTimesOf(await tournamentSettings(match.tournament_id));
  const opens = vetoOpensOf(startOfMatch(match, times), times);
  if (opens === null || opens <= Math.floor(Date.now() / 1000) + 5) return null;
  await holdForBreak(slug, opens, `${START_REASON}: the veto opens at ${clock(opens)}`);
  return opens;
}

/**
 * The times changed (Manage › Schedule): every match of the tournament that
 * has not begun is held to its new time, or let go when it has none any more.
 */
export async function applyMatchTimes(tournamentId: number): Promise<void> {
  const times = matchTimesOf(await tournamentSettings(tournamentId));
  const now = Math.floor(Date.now() / 1000);
  const rows = await db.queryAsync<{
    slug: string;
    round: number | null;
    starts_at: number | null;
    held_until: number | null;
    hold_reason: string | null;
  }>(
    `SELECT slug, round, starts_at, held_until, hold_reason FROM matches
      WHERE tournament_id = ? AND status IN ('pending', 'ready')
        AND veto_state IS NULL AND (server_id IS NULL OR server_id = '')`,
    [tournamentId]
  );
  const { releaseMatch } = await import('./matchHolds');
  for (const row of rows) {
    const opens = vetoOpensOf(startOfMatch(row, times), times);
    const ours = (row.hold_reason ?? '').startsWith(START_REASON);
    if (opens !== null && opens > now + 5) {
      if (ours) {
        await db.runAsync('UPDATE matches SET held_until = ?, hold_reason = ? WHERE slug = ?', [
          opens,
          `${START_REASON}: the veto opens at ${clock(opens)}`,
          row.slug,
        ]);
      } else {
        await holdForBreak(row.slug, opens, `${START_REASON}: the veto opens at ${clock(opens)}`);
      }
    } else if (ours && row.held_until) {
      await releaseMatch(row.slug, null);
    }
  }
  const { emitBracketUpdate } = await import('./socketService');
  emitBracketUpdate({ action: 'match_times', tournamentId });
}

/** The Steam ids of a match's two teams (live rosters, else the match's snapshot). */
async function matchPlayerIds(match: {
  game: GameId | null;
  config: string | null;
  team1_players: string | null;
  team2_players: string | null;
}): Promise<string[]> {
  const description = describeMatch({ game: match.game, config: match.config });
  return [
    ...teamPlayers(match.team1_players, describedPlayers(description.team1)),
    ...teamPlayers(match.team2_players, describedPlayers(description.team2)),
  ]
    .map((p) => p.steamid)
    .filter((id) => /^7656\d{13}$/.test(id));
}

/** Reminders due now: `reminderMinutes` before each match's veto opens, once each. */
async function sweepReminders(): Promise<void> {
  const tournaments = await db.queryAsync<{ id: number; name: string; settings: string | null }>(
    "SELECT id, name, settings FROM tournament WHERE status = 'in_progress'",
    []
  );
  const now = Math.floor(Date.now() / 1000);
  for (const t of tournaments) {
    let settings: unknown = {};
    try {
      settings = JSON.parse(t.settings ?? '{}');
    } catch {
      continue;
    }
    const times = matchTimesOf(settings);
    if (!times || times.reminderMinutes === 0) continue;
    const matches = await db.queryAsync<{
      slug: string;
      round: number | null;
      starts_at: number | null;
      game: GameId | null;
      config: string | null;
      team1_name: string | null;
      team2_name: string | null;
      team1_players: string | null;
      team2_players: string | null;
    }>(
      `SELECT m.slug, m.round, m.starts_at, m.game, m.config,
              t1.name AS team1_name, t2.name AS team2_name,
              t1.players AS team1_players, t2.players AS team2_players
         FROM matches m
         JOIN teams t1 ON t1.id = m.team1_id
         JOIN teams t2 ON t2.id = m.team2_id
        WHERE m.tournament_id = ? AND m.status IN ('pending', 'ready') AND m.veto_state IS NULL`,
      [t.id]
    );
    for (const m of matches) {
      const start = startOfMatch(m, times);
      const opens = vetoOpensOf(start, times);
      if (start === null || opens === null) continue;
      const due = opens - times.reminderMinutes * 60;
      if (now < due || now - due > LATE_REMINDER_S || now >= opens) continue;
      const key = `match:${m.slug}:starts:${start}:remind`;
      const players = await matchPlayerIds(m);
      if (!players.length) continue;
      const minutes = Math.max(1, Math.round((opens - now) / 60));
      await notificationService.notifyOnce(
        players,
        'tournament',
        {
          tournamentId: t.id,
          name: t.name,
          event: 'match_soon',
          matchSlug: m.slug,
          minutes,
          startsAt: start,
          vetoOpensAt: opens,
        },
        key
      );
      await notifyChannels.deliver(players, 'match_ready', key, {
        subject: `${m.team1_name} vs ${m.team2_name}: the veto opens in ${minutes} minutes`,
        text: `Your match in ${t.name} starts soon. The veto opens ${times.vetoLeadMinutes} minutes before the start and goes on without you, so be at your PC.`,
        url: `/match/${encodeURIComponent(m.slug)}`,
        action: 'Open the match room',
      });
      log.info(`[MATCH-TIMES] ${m.slug}: reminder sent to ${players.length} players`);
    }
  }
}

let started = false;

/** Start the 30-second reminder sweep. */
export function startMatchTimes(): void {
  if (started) return;
  started = true;
  const run = () =>
    sweepReminders().catch((error) => log.debug('[MATCH-TIMES] sweep failed', { error }));
  setTimeout(run, 15_000).unref?.();
  setInterval(run, 30_000).unref?.();
}
