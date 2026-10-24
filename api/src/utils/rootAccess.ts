import type { Request } from 'express';
import { checkAdminAccess, requestActorId, type AuthedRequest } from '../middleware/auth';
import { isLocalPlayerId } from '../services/localAccountSteamLink';
import { isSavedAdminSteamId } from './adminSteamIds';

/**
 * Root (FLEET.md D10: `exec`): an admin-scope API token, the local admin
 * account (created on /setup by whoever runs the instance), or a signed-in
 * admin whose Steam ID is in Settings -> Sign-in -> Admin Steam IDs (the
 * instance's operators). Other admins drive matches but cannot run raw
 * console commands on a Ready Up server.
 */
export function isRootRequest(req: Request): boolean {
  const token = (req as AuthedRequest).serviceToken;
  if (token) return token.scope === 'admin';
  const actor = requestActorId(req);
  return !!actor && adminIsRoot(actor);
}

/** Whether this player is root once an admin: a local account, or a listed Admin Steam ID. */
export function adminIsRoot(playerId: string): boolean {
  return isLocalPlayerId(playerId) || isSavedAdminSteamId(playerId);
}

/** 403 body when a non-root admin tries to change who is root. */
export const ROOT_ONLY = 'Only a root admin can change who has root access';

/** isRootRequest for a route without requireAuth (/api/auth/me): an admin first. */
export async function viewerIsRoot(req: Request): Promise<boolean> {
  const access = await checkAdminAccess(req);
  if (!access.ok) return false;
  if (access.serviceToken) (req as AuthedRequest).serviceToken = access.serviceToken;
  return isRootRequest(req);
}
