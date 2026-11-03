/**
 * Whether a team can sign up now (pure): sign-up is switched on, has opened
 * and not closed, and the tournament has not started (check-in closes at the
 * start). Check-in being open does not close it: a late team checks in
 * straight away (decided 2026-11-03).
 */
export function signupOpenNow(
  window: {
    registrationOpen: boolean;
    registrationOpensAt?: string | null;
    registrationClosesAt: string | null;
    checkInClosesAt: string | null;
  } | null,
  now: number
): boolean {
  if (!window?.registrationOpen) return false;
  const at = (iso: string | null | undefined) => (iso ? Date.parse(iso) : null);
  const opens = at(window.registrationOpensAt);
  const closes = [at(window.registrationClosesAt), at(window.checkInClosesAt)].filter(
    (t): t is number => t !== null
  );
  return (opens === null || now >= opens) && closes.every((t) => now < t);
}
