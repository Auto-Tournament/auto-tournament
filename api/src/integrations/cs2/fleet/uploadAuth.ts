/**
 * Authentication for game-server uploads (demos) that accepts either
 * credential a CS2 server can hold:
 *
 * - the old per-deployment `SERVER_TOKEN` in `X-Auto-Tournament-Token`
 *   (MatchZy Enhanced / RCON servers) - handled by `validateServerToken`, unchanged;
 * - a fleet server token `rus_<id>_<secret>` (Ready Up servers), verified with
 *   `registry.verifyServerToken`, the same check the fleet gateway runs on the
 *   WebSocket upgrade (hash compare, revoked/expired, server still enrolled).
 *
 * Ready Up is told which header to use via `ru_demo_upload_header_key/_value`;
 * it normally sets `X-Auto-Tournament-Token: rus_...`. `Authorization: Bearer
 * rus_...` is accepted too. Only a value with the `rus_` prefix is routed to
 * the fleet check, so a SERVER_TOKEN can never be mistaken for one.
 */

import type { NextFunction, Request, Response } from 'express';
import { log } from '../../../utils/logger';
import { validateServerToken } from '../../../middleware/serverAuth';
import { verifyServerToken, type TokenCheck } from './registry';

/** `res.locals` key: the fleet server id when the upload was authenticated with a fleet token. */
export const FLEET_UPLOAD_SERVER_ID = 'fleetUploadServerId';

const FLEET_TOKEN_PREFIX = 'rus_';

function firstString(value: string | string[] | undefined): string | null {
  const v = Array.isArray(value) ? value[0] : value;
  if (typeof v !== 'string') return null;
  const trimmed = v.trim();
  return trimmed === '' ? null : trimmed;
}

/** The presented fleet token, or null when the request carries no `rus_` credential. */
export function presentedFleetToken(req: Pick<Request, 'headers'>): string | null {
  const direct = firstString(req.headers['x-auto-tournament-token']);
  if (direct?.startsWith(FLEET_TOKEN_PREFIX)) return direct;
  const auth = firstString(req.headers['authorization']);
  const bearer = auth?.match(/^Bearer\s+(\S+)$/i)?.[1];
  if (bearer?.startsWith(FLEET_TOKEN_PREFIX)) return bearer;
  return null;
}

export function createServerOrFleetTokenGuard(
  verify: (token: string) => Promise<TokenCheck> = verifyServerToken
) {
  return async function validateServerOrFleetToken(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    const fleetToken = presentedFleetToken(req);
    if (!fleetToken) {
      // Old behavior, byte for byte.
      validateServerToken(req, res, next);
      return;
    }
    try {
      const check = await verify(fleetToken);
      if (!check.ok) {
        log.authFailed(req.path, `Fleet server token rejected (${check.reason})`);
        res.status(401).json({
          success: false,
          error: 'Unauthorized - Invalid or missing server token',
        });
        return;
      }
      res.locals[FLEET_UPLOAD_SERVER_ID] = check.server.id;
      next();
    } catch (error) {
      log.error('[Demo Upload] Fleet token verification failed', error as Error);
      res.status(500).json({ success: false, error: 'Failed to verify server token' });
    }
  };
}

export const validateServerOrFleetToken = createServerOrFleetTokenGuard();

/**
 * The 0-based map number MAT stores.
 *
 * MAT (and MatchZy Enhanced) number maps from 0. Ready Up numbers them from
 * 1, so an upload authenticated with a fleet token is shifted down by one.
 * Returns NaN for a non-numeric header (callers skip the per-map update then).
 */
export function demoMapNumber(raw: string, viaFleetToken: boolean): number {
  const n = parseInt(raw, 10);
  if (isNaN(n)) return NaN;
  return viaFleetToken ? Math.max(0, n - 1) : n;
}
