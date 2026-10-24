/**
 * Viewer identity resolution.
 *
 * Every player-facing endpoint (veto, team match pages, "your turn" CTAs) needs
 * to answer one question: *which Steam user is this request acting as?*
 *
 * There are two answers:
 *  - **real**: who actually signed in (Passport session or signed player cookie;
 *    the cookie alone never makes them an admin)
 *  - **effective**: who they are acting as – identical to `real`, unless a
 *    verified admin has started an impersonation session.
 *
 * Admin authorization (`requireAuth`) always uses the *real* identity so that
 * impersonating a normal player never costs an admin their access.
 */

import type { Request } from 'express';
import { db } from '../config/database';
import { getVerifiedPlayerSteamId } from './signedPlayerCookie';
import { getSignedImpersonatedSteamId } from './impersonationCookie';

export interface ViewerIdentity {
  /** Steam ID of the human who actually authenticated, or null if anonymous. */
  realSteamId: string | null;
  /** Steam ID this request should be treated as (impersonation applied). */
  effectiveSteamId: string | null;
  /** True when an admin is currently viewing the site as another player. */
  isImpersonating: boolean;
  /** True when the real user is an admin. */
  isRealAdmin: boolean;
  /** True when the Passport session (not just the player cookie) names the real user. */
  hasSession: boolean;
}

/** The Steam ID of the Passport session, or null without one. */
function getSessionSteamId(req: Request): string | null {
  const sessionSteamId = (req as Request & { user?: { steamId?: string } }).user?.steamId;
  return typeof sessionSteamId === 'string' && sessionSteamId.trim().length > 0
    ? sessionSteamId.trim()
    : null;
}

/**
 * Resolve the Steam ID of the actually-authenticated user, ignoring any
 * impersonation. Prefers the Passport session, falling back to the signed
 * player_steam_id cookie. Only the session can make this user an admin.
 */
export function getRealViewerSteamId(req: Request): string | null {
  return getSessionSteamId(req) ?? getVerifiedPlayerSteamId(req.headers.cookie);
}

async function isAdminSteamId(steamId: string): Promise<boolean> {
  const row = await db.queryOneAsync<{ is_admin?: number }>(
    'SELECT is_admin FROM players WHERE id = ?',
    [steamId]
  );
  return row?.is_admin === 1;
}

/**
 * Whether changing how this account signs in or recovers needs the Passport
 * session: an admin, or an account with a local login.
 */
export async function accountNeedsSession(playerId: string): Promise<boolean> {
  if (await isAdminSteamId(playerId).catch(() => false)) return true;
  const local = await db
    .queryOneAsync<{ id: number }>('SELECT id FROM local_admins WHERE player_id = ?', [playerId])
    .catch(() => null);
  return !!local;
}

/**
 * Resolve both the real and effective identity for a request.
 *
 * An impersonation cookie is only honoured when the real user is an admin, so a
 * leaked or replayed cookie is inert for everyone else.
 */
export async function resolveViewerIdentity(req: Request): Promise<ViewerIdentity> {
  const realSteamId = getRealViewerSteamId(req);
  const hasSession = getSessionSteamId(req) !== null;
  const isAdmin = async (id: string) => hasSession && (await isAdminSteamId(id).catch(() => false));

  if (!realSteamId) {
    return {
      realSteamId: null,
      effectiveSteamId: null,
      isImpersonating: false,
      isRealAdmin: false,
      hasSession,
    };
  }

  const impersonatedSteamId = getSignedImpersonatedSteamId(req.headers.cookie);

  if (!impersonatedSteamId || impersonatedSteamId === realSteamId) {
    return {
      realSteamId,
      effectiveSteamId: realSteamId,
      isImpersonating: false,
      isRealAdmin: await isAdmin(realSteamId),
      hasSession,
    };
  }

  const isRealAdmin = await isAdmin(realSteamId);

  if (!isRealAdmin) {
    // Cookie present but the requester is not an admin – ignore it entirely.
    return {
      realSteamId,
      effectiveSteamId: realSteamId,
      isImpersonating: false,
      isRealAdmin: false,
      hasSession,
    };
  }

  return {
    realSteamId,
    effectiveSteamId: impersonatedSteamId,
    isImpersonating: true,
    isRealAdmin: true,
    hasSession,
  };
}

/**
 * Convenience wrapper for endpoints that only care about "who am I acting as".
 */
export async function getEffectiveViewerSteamId(req: Request): Promise<string | null> {
  const identity = await resolveViewerIdentity(req);
  return identity.effectiveSteamId;
}

/** Who a request is acting as, by account rather than by Steam ID. */
export interface ViewerAccount {
  /** `players.uid` of the account this request acts as, or null if anonymous. */
  uid: string | null;
  /** The same account's `players.id`; still the Steam ID in 3.0. */
  playerId: string | null;
  /** Whether the *real* signed-in user is an admin (impersonation never grants it). */
  isAdmin: boolean;
  /** True when an admin is viewing the site as another player. */
  isImpersonating: boolean;
}

/**
 * The account a request acts as, as a `players.uid` (3.0 phase D).
 *
 * Everything written from phase D onwards names an account by `players.uid`,
 * never by a Steam ID: a 3.1 account with no Steam account still has to be
 * able to captain a team and report a result. `resolveViewerIdentity` above
 * answers in Steam IDs, because that is what `players.id` is in 3.0, so this
 * is the one place that turns one into the other.
 *
 * When `players.id` stops being the Steam ID in 3.1, this function changes and
 * its callers do not.
 */
export async function resolveViewerAccount(req: Request): Promise<ViewerAccount> {
  const identity = await resolveViewerIdentity(req);
  const playerId = identity.effectiveSteamId;
  if (!playerId) {
    return {
      uid: null,
      playerId: null,
      isAdmin: identity.isRealAdmin,
      isImpersonating: identity.isImpersonating,
    };
  }
  const row = await db
    .queryOneAsync<{ uid: string }>('SELECT uid FROM players WHERE id = ?', [playerId])
    .catch(() => null);
  return {
    uid: row?.uid ?? null,
    playerId,
    isAdmin: identity.isRealAdmin,
    isImpersonating: identity.isImpersonating,
  };
}
