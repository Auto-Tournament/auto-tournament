/**
 * The "your server crashed" popup's state, from the failover broadcasts
 * (`fleet:failover`: open, moving, moved, withdrawn, dismissed) for the
 * viewer's own match. No client imports: tests load this file directly.
 */

export type CrashPhase = 'down' | 'moving' | 'back';

export interface CrashState {
  matchSlug: string;
  phase: CrashPhase;
}

/** The popup after a broadcast for `mySlug` (anything else leaves it as it is). */
export function nextCrashState(
  prev: CrashState | null,
  event: { matchSlug: string; status: string | null },
  mySlug: string | null
): CrashState | null {
  if (!mySlug || event.matchSlug !== mySlug) return prev;
  switch (event.status) {
    case 'open':
      return { matchSlug: mySlug, phase: 'down' };
    case 'moving':
      return { matchSlug: mySlug, phase: 'moving' };
    // Moved to another server, or the old one came back by itself: reconnect.
    case 'moved':
    case 'withdrawn':
      return prev || event.status === 'moved' ? { matchSlug: mySlug, phase: 'back' } : null;
    case 'dismissed':
      return null;
    default:
      return prev;
  }
}

/** A move the page missed (it opened after): shown when this recent and not closed before. */
export const MISSED_MOVE_SECONDS = 10 * 60;

export function showMissedMove(
  movedAt: number | null | undefined,
  nowSeconds: number,
  seen: boolean
): boolean {
  return typeof movedAt === 'number' && nowSeconds - movedAt < MISSED_MOVE_SECONDS && !seen;
}
