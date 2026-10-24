import type { NextFunction, Request, Response } from 'express';
import type { Untrusted } from './untrusted';

/** True when ENABLE_TEST_ENDPOINTS is explicitly on, whatever NODE_ENV says. */
export function testEndpointsFlag(): boolean {
  const enabled = (process.env.ENABLE_TEST_ENDPOINTS ?? '').toLowerCase();
  return enabled === '1' || enabled === 'true' || enabled === 'yes';
}

/** 127.0.0.0/8 and ::1, IPv4-mapped included. */
export function isLoopbackAddress(address: string | undefined): boolean {
  if (!address) return false;
  const v4 = address.startsWith('::ffff:') ? address.slice(7) : address;
  return address === '::1' || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(v4);
}

/**
 * Only a peer on this machine: the socket's address, never X-Forwarded-For.
 * A guard for source runs only: behind the image's Caddy every request comes
 * from loopback, so there ENABLE_TEST_ENDPOINTS is the only gate.
 */
export function requireLoopback(req: Request, res: Response, next: NextFunction): void {
  const peer: { socket?: Request['socket'] } = req;
  if (!isLoopbackAddress(peer.socket?.remoteAddress)) {
    res.status(403).json({ success: false, error: 'Test helper is loopback only' });
    return;
  }
  next();
}

/** Boot: say loudly that the test helpers are on in a production process. */
export function warnIfTestEndpointsInProduction(warn: (message: string) => void): void {
  if (process.env.NODE_ENV === 'production' && testEndpointsFlag()) {
    warn(
      'ENABLE_TEST_ENDPOINTS is on with NODE_ENV=production: the /api/test helpers are reachable. Never run a public instance like this.'
    );
  }
}

/**
 * Gate for test-only routes: both tiers require ENABLE_TEST_ENDPOINTS; `flag`
 * answers 404, `production` answers 403 with `body`.
 */
export function requireTestEndpoints(
  gate: { tier: 'flag' } | { tier: 'production'; body: Record<string, Untrusted> }
) {
  return function requireTestEndpoints(_req: Request, res: Response, next: NextFunction): void {
    if (!testEndpointsFlag()) {
      if (gate.tier === 'flag') res.status(404).json({ success: false, error: 'Not found' });
      else res.status(403).json(gate.body);
      return;
    }
    next();
  };
}
