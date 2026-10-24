import express, { type NextFunction, type Request, type Response } from 'express';
import {
  authenticateServiceToken,
  checkAdminAccess,
  requireAuth,
  requireIntegratorAuth,
} from '../middleware/auth';

/** Default limits for every request body, read before anyone is authenticated. */
export const JSON_LIMIT = '1mb';
export const URLENCODED_LIMIT = '100kb';
export const URLENCODED_PARAMETER_LIMIT = 100;

/**
 * Admin routes whose JSON bodies carry files (base64 images, pack icons, a
 * demo analysis). The default parser skips them; `largeJsonAfterAuth` reads
 * them with their own limit once the caller is known to be an admin (or, with
 * `integrator`, an integrator token too).
 */
export const LARGE_JSON_ROUTES: ReadonlyArray<{
  method: string;
  path: RegExp;
  limit: string;
  integrator?: boolean;
}> = [
  { method: 'POST', path: /^\/api\/maps\/[^/]+\/upload-image$/, limit: '10mb' },
  { method: 'PUT', path: /^\/api\/game\/cs2\/radars\/[^/]+\/[^/]+$/, limit: '12mb' },
  {
    method: 'POST',
    path: /^\/api\/game\/cs2\/demo-worker\/jobs\/[^/]+\/[^/]+\/result$/,
    limit: '50mb',
  },
  { method: 'POST', path: /^\/api\/packs$/, limit: '4mb' },
  { method: 'POST', path: /^\/api\/players\/import$/, limit: '10mb', integrator: true },
  { method: 'POST', path: /^\/api\/players\/bulk-import$/, limit: '10mb' },
];

function largeRoute(req: Request) {
  return LARGE_JSON_ROUTES.find((r) => r.method === req.method && r.path.test(req.path));
}

const json = express.json({ limit: JSON_LIMIT });
const urlencoded = express.urlencoded({
  extended: true,
  limit: URLENCODED_LIMIT,
  parameterLimit: URLENCODED_PARAMETER_LIMIT,
});

/** Global JSON and form parsers; the large routes are left unread. */
export function defaultBodies(req: Request, res: Response, next: NextFunction): void {
  if (largeRoute(req)) return next();
  json(req, res, (err?: unknown) => (err ? next(err) : urlencoded(req, res, next)));
}

const largeParsers = new Map(
  LARGE_JSON_ROUTES.map((r) => [r.limit, express.json({ limit: r.limit })])
);

/**
 * The large routes: an admin first, then the body with that route's limit. A
 * refused body is drained unread before the answer, so a proxy in front gets it.
 */
export function largeJsonAfterAuth(req: Request, res: Response, next: NextFunction): void {
  const route = largeRoute(req);
  if (!route) return next();
  const integratorToken = () => {
    const token = route.integrator
      ? authenticateServiceToken(req, { allowIntegrator: true })
      : null;
    return token?.ok === true;
  };
  const refuse = route.integrator ? requireIntegratorAuth : requireAuth;
  (integratorToken() ? Promise.resolve({ ok: true }) : checkAdminAccess(req))
    .then((access) => {
      if (access.ok) return (largeParsers.get(route.limit) ?? json)(req, res, next);
      req.on('end', () => void refuse(req, res, next));
      req.resume();
    })
    .catch(next);
}
