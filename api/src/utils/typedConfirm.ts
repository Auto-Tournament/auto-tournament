import type { NextFunction, Request, Response } from 'express';
import type { AuthedRequest } from '../middleware/auth';
import { isSameSiteRequest } from './accountConnections';
import type { Untrusted } from './untrusted';

/**
 * Guard for destructive admin actions (wipe the database, a table): a signed-in
 * browser session, never an API token; a same-site JSON request; and
 * `{ confirm }` in the body equal to what `expected` names for this request.
 */
export function requireTypedConfirm(expected: (req: Request) => string) {
  return function requireTypedConfirm(req: Request, res: Response, next: NextFunction): void {
    if ((req as AuthedRequest).serviceToken) {
      res.status(403).json({ success: false, error: 'Sign in in a browser to do this' });
      return;
    }
    if (!isSameSiteRequest(req)) {
      res.status(403).json({ success: false, error: 'Request refused' });
      return;
    }
    if (!req.is('application/json')) {
      res.status(415).json({ success: false, error: 'Send this request as JSON' });
      return;
    }
    const want = expected(req);
    if ((req.body as { confirm?: Untrusted } | undefined)?.confirm !== want) {
      res.status(400).json({ success: false, error: `Confirm with { "confirm": "${want}" }` });
      return;
    }
    next();
  };
}
