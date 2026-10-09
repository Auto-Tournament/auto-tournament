/**
 * Once a paid license has stopped (unpaid past its 14 days of grace,
 * Commercial License Terms section 8; its key replaced by a new one a day
 * ago; or the key belongs to another install), the platform stops for
 * everyone until it is sorted: every API call answers 503 `license_expired`
 * with the reason, and the client shows the "license expired" page.
 *
 * What keeps working: health, signing in, the license routes (so an admin can
 * see what's wrong and paste a renewed key), and the fleet links (machines
 * keep their connection, so everything is back the moment it is paid).
 * Running matches on the game servers are never touched.
 *
 * The standing is read at most once a minute.
 */

import type { NextFunction, Request, Response } from 'express';
import { licenseService } from '../services/license/licenseService';
import { expiredMessage, type LicenseStanding } from '../services/license/gate';

const OPEN = ['/api/health', '/api/auth', '/api/license', '/api/fleet', '/api/compat'];
const TTL_MS = 60_000;

let cached: { at: number; standing: LicenseStanding } | null = null;

async function current(): Promise<LicenseStanding | null> {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.standing;
  try {
    const standing = await licenseService.standing();
    cached = { at: Date.now(), standing };
    return standing;
  } catch {
    return cached?.standing ?? null;
  }
}

/** Forget the cached standing (a key was saved or the check-in brought news). */
export function licenseStandingChanged(): void {
  cached = null;
}

export async function licenseExpiredMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  if (
    !req.path.startsWith('/api/') ||
    OPEN.some((p) => req.path === p || req.path.startsWith(`${p}/`))
  ) {
    next();
    return;
  }
  const standing = await current();
  if (standing?.status !== 'expired') {
    next();
    return;
  }
  res.status(503).json({
    error: 'license_expired',
    message:
      standing.reason === 'unpaid'
        ? "This platform's license has expired. The organizer has been told; it works again as soon as it is paid."
        : expiredMessage(standing),
    reason: standing.reason,
    stopsOn: standing.stopsOn,
  });
}
