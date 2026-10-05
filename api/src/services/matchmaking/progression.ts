/**
 * XP, levels and commends (docs/design/matchmaking.md, "After the match"),
 * the parts with no database. XP measures how experienced a player is on the
 * platform: how much they play and finish, not how good they are.
 */

export type XpReason = 'completed' | 'win' | 'draw' | 'performance' | 'first_win' | 'admin';

export const XP = {
  completed: 100,
  win: 50,
  draw: 25,
  /** The top player of the match gets this much; the last none. */
  performanceMax: 50,
  firstWin: 100,
} as const;

export interface XpInput {
  result: 'win' | 'loss' | 'draw';
  /** 0 = best in the match by score; null = no stats for this player. */
  performanceRank: number | null;
  /** Players ranked in the match (with stats). */
  rankedPlayers: number;
  /** No first-win bonus yet today (UTC). */
  firstWinToday: boolean;
}

/** The XP parts for one finished match. Never negative. */
export function xpForMatch(input: XpInput): Array<{ reason: XpReason; amount: number }> {
  const parts: Array<{ reason: XpReason; amount: number }> = [{ reason: 'completed', amount: XP.completed }];
  if (input.result === 'win') parts.push({ reason: 'win', amount: XP.win });
  if (input.result === 'draw') parts.push({ reason: 'draw', amount: XP.draw });
  if (input.performanceRank !== null && input.rankedPlayers > 1) {
    const share = (input.rankedPlayers - 1 - input.performanceRank) / (input.rankedPlayers - 1);
    const amount = Math.round(XP.performanceMax * Math.min(1, Math.max(0, share)));
    if (amount > 0) parts.push({ reason: 'performance', amount });
  }
  if (input.result === 'win' && input.firstWinToday) parts.push({ reason: 'first_win', amount: XP.firstWin });
  return parts;
}

/** Level curve: going from level n to n + 1 takes `base + step × (n − 1)` XP. */
export interface LevelCurve {
  base: number;
  step: number;
}

export const DEFAULT_LEVEL_CURVE: LevelCurve = { base: 400, step: 50 };

/** The level for a total, and how far into it. Level 1 at 0 XP; no cap. */
export function levelFor(
  totalXp: number,
  curve: LevelCurve = DEFAULT_LEVEL_CURVE
): { level: number; intoLevel: number; forNext: number } {
  let level = 1;
  let left = Math.max(0, Math.floor(totalXp));
  for (;;) {
    const need = curve.base + curve.step * (level - 1);
    if (left < need) return { level, intoLevel: left, forNext: need };
    left -= need;
    level += 1;
  }
}

export const COMMEND_UP_TAGS = ['friendly', 'team_player', 'leader', 'good_comms'] as const;
export const COMMEND_DOWN_TAGS = ['toxic', 'griefing', 'afk', 'other'] as const;
export type CommendTag = (typeof COMMEND_UP_TAGS)[number] | (typeof COMMEND_DOWN_TAGS)[number];

/** Commends are open for this long after the match ends. */
export const COMMEND_WINDOW_SECONDS = 24 * 60 * 60;

/** Validate a commend body: thumbs up with an optional tag, thumbs down with a reason. */
export function parseCommend(
  body: unknown
): { ok: true; value: 1 | -1; tag: CommendTag | null } | { ok: false; error: string } {
  const b = (body ?? {}) as { value?: unknown; tag?: unknown };
  if (b.value !== 1 && b.value !== -1) return { ok: false, error: 'value must be 1 or -1' };
  const tag = b.tag === undefined || b.tag === null || b.tag === '' ? null : b.tag;
  if (b.value === 1) {
    if (tag !== null && !(COMMEND_UP_TAGS as readonly unknown[]).includes(tag)) {
      return { ok: false, error: `tag must be one of ${COMMEND_UP_TAGS.join(', ')}` };
    }
    return { ok: true, value: 1, tag: tag as CommendTag | null };
  }
  if (!(COMMEND_DOWN_TAGS as readonly unknown[]).includes(tag)) {
    return { ok: false, error: `A thumbs down needs a reason: ${COMMEND_DOWN_TAGS.join(', ')}` };
  }
  return { ok: true, value: -1, tag: tag as CommendTag };
}
