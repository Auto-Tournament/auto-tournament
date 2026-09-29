/**
 * "Fresh session" for accounts with a local admin login: before such an
 * account connects a sign-in method, merges a Steam player or removes its
 * password login, it must have entered its local password (and TOTP, when
 * on) within the last 10 minutes. Local sign-in counts; so does
 * POST /api/auth/local/reauth.
 *
 * Kept on the server-side session, bound to the players id it was proven for.
 */
import type { Request } from 'express';

export const LOCAL_REAUTH_WINDOW_MS = 10 * 60 * 1000;

export interface LocalReauthRecord {
  playerId: string;
  at: number;
}

type ReauthSession = { session?: { localReauth?: LocalReauthRecord } };

/** Pure: is `record` a proof for `playerId` from the last 10 minutes? */
export function isReauthRecordFresh(
  record: LocalReauthRecord | null | undefined,
  playerId: string,
  now: number = Date.now()
): boolean {
  if (!record || record.playerId !== playerId || typeof record.at !== 'number') return false;
  const age = now - record.at;
  return age >= 0 && age <= LOCAL_REAUTH_WINDOW_MS;
}

export function markLocalReauth(req: Request, playerId: string): void {
  const session = (req as Request & ReauthSession).session;
  if (session) session.localReauth = { playerId, at: Date.now() };
}

export function isLocalReauthFresh(req: Request, playerId: string): boolean {
  return isReauthRecordFresh((req as Request & ReauthSession).session?.localReauth, playerId);
}
