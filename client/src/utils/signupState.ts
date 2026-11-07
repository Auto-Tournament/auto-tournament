/**
 * Where sign-up stands for a viewer who has not signed up a team: one answer for
 * the overview's hero and the sign-up tab, so they can never disagree (cs.sivert.io,
 * 2026-11-07: "Sign-up is open" on one, "closed" on the other). Pure.
 */
import { signupOpenNow } from './signupOpen';

export type SignupStateKind =
  /** The viewer's team is in the tournament (the organizer added it). */
  | 'teamIn'
  /** Sign-up is switched off: the organizer adds the teams. */
  | 'off'
  /** Switched on, before its opening time. */
  | 'notYet'
  /** A team can sign up now. */
  | 'open'
  /** Open, but every spot is taken. */
  | 'full'
  /** Its deadline (or check-in) has passed, or the bracket is set. */
  | 'ended';

export interface SignupState {
  kind: SignupStateKind;
  /** Epoch ms; for 'notYet'. */
  opensAt: number | null;
  /** Epoch ms it closed; for 'ended' (null when the bracket is set without a deadline). */
  closedAt: number | null;
  /** Spots left, when there is a cap. */
  left: number | null;
}

export interface SignupStateInput {
  window: {
    registrationOpen: boolean;
    registrationOpensAt?: string | null;
    registrationClosesAt: string | null;
    checkInClosesAt: string | null;
    maxTeams: number | null;
  } | null;
  /** The tournament's status: only 'setup' takes sign-ups ('ready' has its bracket). */
  status: string;
  teamCount: number;
  /** The viewer's team is one of the tournament's teams. */
  teamIn: boolean;
  now: number;
}

const ms = (iso: string | null | undefined): number | null => {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(t) ? t : null;
};

export function signupState({
  window,
  status,
  teamCount,
  teamIn,
  now,
}: SignupStateInput): SignupState {
  const max = window?.maxTeams ?? null;
  const left = max !== null ? Math.max(max - teamCount, 0) : null;
  const base = { opensAt: null, closedAt: null, left };
  if (teamIn) return { ...base, kind: 'teamIn' };
  if (!window?.registrationOpen) return { ...base, kind: 'off' };
  const opensAt = ms(window.registrationOpensAt);
  const passed = [ms(window.registrationClosesAt), ms(window.checkInClosesAt)].filter(
    (t): t is number => t !== null && t <= now
  );
  if (status === 'setup' && passed.length === 0 && opensAt !== null && opensAt > now)
    return { ...base, kind: 'notYet', opensAt };
  if (status !== 'setup' || !signupOpenNow(window, now))
    return { ...base, kind: 'ended', closedAt: passed.length ? Math.min(...passed) : null };
  if (left === 0) return { ...base, kind: 'full' };
  return { ...base, kind: 'open' };
}
