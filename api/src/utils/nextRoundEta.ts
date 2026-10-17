/**
 * "About when does the next round start?" for the public overview. A rough
 * estimate from the scores, labelled "about" in the UI; never a promise.
 *
 * - A live match needs (first to maxRounds/2 + 1) minus the leader's score more
 *   rounds, at ROUND_SECONDS each. From 12-12 on, one overtime segment is assumed
 *   (first to 4 more).
 * - A match not started yet (veto, warmup, waiting) takes WARMUP_SECONDS plus a full match.
 * - The next round's veto opens one break (Match rules, "Break between
 *   matches") after the last match of the current round ends.
 * - A hold on a next-round match (the break, or its scheduled start) is an exact time.
 */
import type { BracketMatch } from '../types/tournament.types';

/** One CS2 round on average, freeze time included. The only place this lives. */
export const ROUND_SECONDS = 115;
/** Warmup before the first round. */
export const WARMUP_SECONDS = 5 * 60;
/** MR12, as the default `maxRounds` (24 rounds in regulation). */
export const DEFAULT_MAX_ROUNDS = 24;
const OVERTIME_ROUNDS_TO_WIN = 4;

/** The "Break between matches" setting (`at_match_break_minutes`) in minutes: default 5, 0 = none. */
export function breakMinutesOf(value: string | null | undefined): number {
  if (value === null || value === undefined || value === '') return 5;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(Math.round(parsed), 120) : 0;
}

export interface NextRoundEta {
  /** ISO time the next round (its veto) is expected to open. */
  at: string;
  /** A hold or schedule fixes the time; otherwise it is an estimate. */
  exact: boolean;
  /** The current round is the last: `at` is when the tournament should end. */
  final: boolean;
}

/** Rounds left in the current map for a match at this score (pure). */
export function remainingRounds(
  score1: number,
  score2: number,
  maxRounds: number = DEFAULT_MAX_ROUNDS
): number {
  const half = Math.floor(maxRounds / 2);
  const lead = Math.max(score1, score2);
  if (Math.min(score1, score2) >= half) {
    // Overtime (or about to be): the leader's rounds past regulation count towards the segment.
    return Math.max(1, OVERTIME_ROUNDS_TO_WIN - (lead - half));
  }
  return Math.max(0, half + 1 - lead);
}

export interface EtaInput {
  matches: Array<
    Pick<
      BracketMatch,
      'slug' | 'round' | 'status' | 'team1' | 'team2' | 'team1Score' | 'team2Score'
    > &
      Partial<Pick<BracketMatch, 'team1MapScore' | 'team2MapScore' | 'vetoOpensAt'>>
  >;
  totalRounds: number;
  maxRounds?: number | null;
  breakMinutes: number;
  /** Unix s a match is held until (a future time), by slug. */
  heldUntil?: Record<string, number>;
  nowMs: number;
}

export function computeNextRoundEta(input: EtaInput): NextRoundEta | null {
  const { matches, breakMinutes, heldUntil = {}, nowMs } = input;
  const maxRounds = input.maxRounds && input.maxRounds >= 2 ? input.maxRounds : DEFAULT_MAX_ROUNDS;
  const open = matches.filter((m) => m.status !== 'completed');
  if (open.length === 0) return null;
  const round = Math.min(...open.map((m) => m.round));
  const current = open.filter((m) => m.round === round);
  const fullMatchMs = maxRounds * ROUND_SECONDS * 1000;
  const warmupMs = WARMUP_SECONDS * 1000;

  // Only matches that are being played give an estimate to build on.
  if (!current.some((m) => m.status === 'live')) return null;

  let ends = nowMs;
  for (const m of current) {
    let end: number;
    if (m.status === 'live') {
      const s1 = m.team1MapScore ?? m.team1Score ?? 0;
      const s2 = m.team2MapScore ?? m.team2Score ?? 0;
      end = nowMs + remainingRounds(s1, s2, maxRounds) * ROUND_SECONDS * 1000;
    } else {
      if (!m.team1 || !m.team2) continue; // no data: skip it
      const held = heldUntil[m.slug] ? heldUntil[m.slug] * 1000 : 0;
      end = Math.max(nowMs, held) + warmupMs + fullMatchMs;
    }
    ends = Math.max(ends, end);
  }

  const later = matches.filter((m) => m.round > round);
  const final = later.length === 0 && round >= input.totalRounds;
  if (final) return { at: new Date(ends).toISOString(), exact: false, final: true };

  const estimate = ends + Math.max(0, breakMinutes) * 60 * 1000;
  // A hold on a next-round match is when its veto really opens; a schedule is a floor.
  const times = later
    .filter((m) => m.status === 'pending' || m.status === 'ready')
    .flatMap((m) => {
      const held = heldUntil[m.slug];
      if (held) return [{ at: held * 1000, hold: true }];
      return m.vetoOpensAt && m.vetoOpensAt * 1000 > nowMs
        ? [{ at: m.vetoOpensAt * 1000, hold: false }]
        : [];
    });
  if (times.length > 0) {
    const first = times.reduce((a, b) => (a.at <= b.at ? a : b));
    if (first.at >= estimate || first.hold) {
      return { at: new Date(first.at).toISOString(), exact: true, final: false };
    }
  }
  return { at: new Date(estimate).toISOString(), exact: false, final: false };
}
