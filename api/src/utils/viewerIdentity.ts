/**
 * Viewer identity resolution.
 *
 * Every player-facing endpoint (veto, team match pages, "your turn" CTAs) needs
 * to answer one question: *which Steam user is this request acting as?*
 *
 * There are two answers:
 *  - **real**: who actually signed in (Passport session or signed player cookie)
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
}

/**
 * Resolve the Steam ID of the actually-authenticated user, ignoring any
 * impersonation. Prefers the Passport session, falling back to the signed
 * player_steam_id cookie.
 */
export function getRealViewerSteamId(req: Request): string | null {
  const anyReq = req as Request & { user?: { steamId?: string } };
  const sessionSteamId = anyReq.user?.steamId;
  if (typeof sessionSteamId === 'string' && sessionSteamId.trim().length > 0) {
    return sessionSteamId.trim();
  }

  return getVerifiedPlayerSteamId(req.headers.cookie);
}

async function isAdminSteamId(steamId: string): Promise<boolean> {
  const row = await db.queryOneAsync<{ is_admin?: number }>(
    'SELECT is_admin FROM players WHERE id = ?',
    [steamId]
  );
  return row?.is_admin === 1;
}

/**
 * Resolve both the real and effective identity for a request.
 *
 * An impersonation cookie is only honoured when the real user is an admin, so a
 * leaked or replayed cookie is inert for everyone else.
 */
export async function resolveViewerIdentity(req: Request): Promise<ViewerIdentity> {
  const realSteamId = getRealViewerSteamId(req);

  if (!realSteamId) {
    return {
      realSteamId: null,
      effectiveSteamId: null,
      isImpersonating: false,
      isRealAdmin: false,
    };
  }

  const impersonatedSteamId = getSignedImpersonatedSteamId(req.headers.cookie);

  if (!impersonatedSteamId || impersonatedSteamId === realSteamId) {
    return {
      realSteamId,
      effectiveSteamId: realSteamId,
      isImpersonating: false,
      isRealAdmin: await isAdminSteamId(realSteamId).catch(() => false),
    };
  }

  const isRealAdmin = await isAdminSteamId(realSteamId).catch(() => false);

  if (!isRealAdmin) {
    // Cookie present but the requester is not an admin – ignore it entirely.
    return {
      realSteamId,
      effectiveSteamId: realSteamId,
      isImpersonating: false,
      isRealAdmin: false,
    };
  }

  return {
    realSteamId,
    effectiveSteamId: impersonatedSteamId,
    isImpersonating: true,
    isRealAdmin: true,
  };
}

/**
 * Convenience wrapper for endpoints that only care about "who am I acting as".
 */
export async function getEffectiveViewerSteamId(req: Request): Promise<string | null> {
  const identity = await resolveViewerIdentity(req);
  return identity.effectiveSteamId;
}
