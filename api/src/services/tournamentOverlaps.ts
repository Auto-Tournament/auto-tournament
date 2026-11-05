/**
 * When tournaments on this site play, to warn about overlaps (Claude Design,
 * Setup › Name and day and Schedule): an admin is only warned, and can always
 * save; a player can't sign up to a tournament whose rounds overlap a
 * tournament they are already in. The same day is fine: only times count.
 *
 * A tournament plays in windows: at set times, each round from its time to the
 * next round's, at most MAX_ROUND_MS (the last one for ROUND_MS); as soon as ready, from the start
 * for ASAP_MS. One with no start time plays nowhere yet.
 */

import { db } from '../config/database';
import type { Untrusted } from '../utils/untrusted';

/** shortcut: fixed lengths for the last round, the longest round and "as soon as ready", until match lengths are estimated per format. */
const ROUND_MS = 2 * 3600_000;
const MAX_ROUND_MS = 3 * 3600_000;
const ASAP_MS = 4 * 3600_000;

export interface PlayWindow {
  /** Epoch milliseconds. */
  start: number;
  end: number;
  /** The round at set times; null as soon as ready. */
  round: number | null;
}

/** A tournament's play windows from its settings (JSON). Pure. */
export function playWindowsOf(settings: string | null): PlayWindow[] {
  let s: Record<string, Untrusted> = {};
  try {
    s = settings ? (JSON.parse(settings) as Record<string, Untrusted>) : {};
  } catch {
    return [];
  }
  const times = (s.matchTimes ?? {}) as { mode?: Untrusted; rounds?: Record<string, Untrusted> };
  if (times.mode === 'times' && times.rounds && typeof times.rounds === 'object') {
    const rounds = Object.entries(times.rounds)
      .map(([r, at]) => ({ round: Number(r), at: typeof at === 'string' ? Date.parse(at) : NaN }))
      .filter((r) => Number.isInteger(r.round) && Number.isFinite(r.at))
      .sort((a, b) => a.round - b.round);
    if (rounds.length) {
      return rounds.map((r, i) => {
        const next = i + 1 < rounds.length ? rounds[i + 1].at : null;
        // Until the next round, but never overnight: the next one can be another day.
        const end =
          next !== null && next > r.at ? Math.min(next, r.at + MAX_ROUND_MS) : r.at + ROUND_MS;
        return { start: r.at, end, round: r.round };
      });
    }
  }
  const start = typeof s.startsAt === 'string' ? Date.parse(s.startsAt) : NaN;
  return Number.isFinite(start) ? [{ start, end: start + ASAP_MS, round: null }] : [];
}

/** The first pair of windows that overlap, or null. Pure. */
export function firstOverlap(
  a: PlayWindow[],
  b: PlayWindow[]
): { ours: PlayWindow; theirs: PlayWindow } | null {
  for (const ours of a) {
    for (const theirs of b) {
      if (ours.start < theirs.end && theirs.start < ours.end) return { ours, theirs };
    }
  }
  return null;
}

interface TournamentRow {
  id: number;
  name: string;
  settings: string | null;
}

const UPCOMING = "status IN ('setup', 'in_progress') AND archived_at IS NULL";

/** Every other tournament that hasn't finished, with its play windows (for the setup's warnings). */
export async function otherPlayWindows(
  excludeId: number | null
): Promise<Array<{ id: number; name: string; windows: PlayWindow[] }>> {
  const rows = await db.queryAsync<TournamentRow>(
    `SELECT id, name, settings FROM tournament WHERE ${UPCOMING} AND id <> ?`,
    [excludeId ?? -1]
  );
  return rows
    .map((r) => ({ id: r.id, name: r.name, windows: playWindowsOf(r.settings) }))
    .filter((r) => r.windows.length > 0);
}

export interface PlayerOverlap {
  steamId: string;
  tournamentId: number;
  name: string;
  /** When their round in the other tournament starts (epoch ms). */
  at: number;
}

/**
 * A player already in another tournament (a signed-up lineup, or a shuffle)
 * whose rounds overlap this one's, or null. Teams an admin added by hand play
 * with their whole roster and are not checked.
 */
export async function playerOverlap(
  tournamentId: number,
  settings: string | null,
  steamIds: string[]
): Promise<PlayerOverlap | null> {
  const ours = playWindowsOf(settings);
  if (ours.length === 0 || steamIds.length === 0) return null;
  const rows = await db.queryAsync<TournamentRow & { player_id: string }>(
    `SELECT t.id, t.name, t.settings, x.player_id FROM tournament t
       JOIN (
         SELECT tournament_id, player_id FROM tournament_lineups
         UNION
         SELECT tournament_id, player_id FROM shuffle_tournament_players WHERE left_at IS NULL
       ) x ON x.tournament_id = t.id
      WHERE t.${UPCOMING} AND t.id <> ? AND x.player_id = ANY(?::text[])`,
    [tournamentId, steamIds]
  );
  for (const row of rows) {
    const hit = firstOverlap(ours, playWindowsOf(row.settings));
    if (hit) {
      return { steamId: row.player_id, tournamentId: row.id, name: row.name, at: hit.theirs.start };
    }
  }
  return null;
}
