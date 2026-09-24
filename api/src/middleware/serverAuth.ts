import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { log } from '../utils/logger';
import { checkAdminAccess } from './auth';

/**
 * Authentication for requests coming from CS2 game servers.
 *
 * The credential is `SERVER_TOKEN`, presented as `X-Auto-Tournament-Token`. MAT
 * configures the plugin to send it — see `getPluginWebhookCommands`, which
 * sets `at_remote_log_header_key`/`_value` alongside the webhook URL, and
 * `getPluginDemoUploadCommands`, which does the same for demo uploads.
 *
 * This is a different credential from the service tokens in `middleware/auth`:
 * one game server token is shared by the fleet and only unlocks the ingest
 * endpoints, whereas a service token is an admin credential for the whole API.
 */

/** Escape hatch, off by default. See `allowUnauthenticatedEvents`. */
function isTruthyEnv(raw: string | undefined): boolean {
  if (!raw) return false;
  const v = raw.trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

/**
 * Whether to accept game events that arrive with **no** token at all.
 *
 * Event ingest was unauthenticated until this was fixed, so a server that was
 * configured by an older MAT — or by hand, without the header — starts being
 * rejected on upgrade. The visible symptom is a match whose score stops
 * moving, which is a miserable thing to diagnose during a tournament.
 *
 * `ALLOW_UNAUTHENTICATED_EVENTS=true` buys an operator time to re-bootstrap
 * their servers. It is deliberately narrow: it accepts a *missing* token, never
 * a wrong one, so it is a compatibility shim rather than a way to turn the
 * check off. Every request it lets through is logged.
 */
export function allowUnauthenticatedEvents(): boolean {
  return isTruthyEnv(process.env.ALLOW_UNAUTHENTICATED_EVENTS);
}

/**
 * Compare two tokens without leaking, through timing, how much of a guess was
 * right. Digests are compared rather than the values so the buffers are always
 * the same length and the comparison never has to be skipped.
 */
function tokensMatch(presented: string, expected: string): boolean {
  const a = crypto.createHash('sha256').update(presented, 'utf8').digest();
  const b = crypto.createHash('sha256').update(expected, 'utf8').digest();
  return crypto.timingSafeEqual(a, b);
}

function presentedToken(req: Request): string | null {
  const raw = req.headers['x-auto-tournament-token'];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Require a valid `X-Auto-Tournament-Token`.
 *
 * Used by endpoints only a game server should reach: match reports, demo
 * uploads.
 */
export function validateServerToken(req: Request, res: Response, next: NextFunction): void {
  const validToken = process.env.SERVER_TOKEN;

  if (!validToken) {
    log.error('SERVER_TOKEN not set in environment variables!');
    res.status(500).json({
      success: false,
      error: 'Server configuration error',
    });
    return;
  }

  const presented = presentedToken(req);

  if (!presented || !tokensMatch(presented, validToken)) {
    log.authFailed(req.path, 'Invalid or missing server token');
    res.status(401).json({
      success: false,
      error: 'Unauthorized - Invalid or missing server token',
    });
    return;
  }

  next();
}

/**
 * Require a valid `X-Auto-Tournament-Token` on the game event webhooks.
 *
 * Same credential as `validateServerToken`, but it distinguishes a *missing*
 * token from a *wrong* one so the compatibility shim above can exist, and it
 * says what to do about a rejection: these events are what move the score, so
 * whoever reads the log is most likely staring at a match that has stopped
 * updating.
 *
 * On the retry behaviour: Auto Tournament CS2 queues events locally and retries 4xx
 * responses with backoff (30s, 1m, 2m … up to 20 attempts). A server rejected
 * here is therefore not losing events — it holds them, and they flush once the
 * token is configured. That is what makes enforcing this survivable mid-match.
 */
export function validateEventToken(req: Request, res: Response, next: NextFunction): void {
  const validToken = process.env.SERVER_TOKEN;

  if (!validToken) {
    log.error(
      '[EVENTS] SERVER_TOKEN is not set, so game events cannot be authenticated. ' +
        'Set SERVER_TOKEN and re-bootstrap your servers.'
    );
    res.status(500).json({
      success: false,
      error: 'Server configuration error',
    });
    return;
  }

  const presented = presentedToken(req);

  if (presented) {
    if (tokensMatch(presented, validToken)) {
      return next();
    }

    // A wrong token is never let through, shim or not: a server MAT configured
    // sends the right one, so this is either an attacker or a server pointed at
    // the wrong instance.
    log.authFailed(req.path, 'Game event rejected: X-Auto-Tournament-Token does not match SERVER_TOKEN');
    res.status(401).json({
      success: false,
      error: 'Unauthorized - Invalid server token',
    });
    return;
  }

  if (allowUnauthenticatedEvents()) {
    log.warn(
      '[EVENTS] Accepted a game event with no X-Auto-Tournament-Token because ' +
        'ALLOW_UNAUTHENTICATED_EVENTS is set. Anyone who can reach this API can forge ' +
        'events while that is on. Re-bootstrap this server and unset it.',
      { path: req.path, ip: req.ip ?? req.socket?.remoteAddress }
    );
    return next();
  }

  log.authFailed(
    req.path,
    'Game event rejected: no X-Auto-Tournament-Token. The server was configured without the ' +
      'webhook token — reconnect it so it re-fetches /api/servers/:id/bootstrap, or set ' +
      'ALLOW_UNAUTHENTICATED_EVENTS=true to accept these while you do.'
  );
  res.status(401).json({
    success: false,
    error: 'Unauthorized - Missing server token',
  });
}

/**
 * Guard for `GET /api/matches/:slug.json`, the match config Auto Tournament CS2 downloads.
 *
 * The config carries both rosters with their Steam IDs and the server's match
 * setup, and match slugs are guessable (`r1m1`), so it is not public. Two
 * callers are let through:
 *
 * - **A game server**, presenting `X-Auto-Tournament-Token: <SERVER_TOKEN>`. MAT sends
 *   the header name and value as extra arguments on the load command
 *   (`getPluginLoadMatchCommand`), and Auto Tournament CS2 adds them to its fetch. There
 *   is no per-server secret: this is the same fleet-wide token the event
 *   webhook and report upload use.
 * - **An admin**, by session or service token (read-only scope is enough) —
 *   the match details dialog shows the served config, and API tooling reads it.
 *
 * A wrong server token is refused even for an admin session: a request that
 * presents one is claiming to be a game server. Every refusal gets the same
 * 401 body, so it says nothing about which check failed or whether the slug
 * exists; the details go to the server log.
 */
/**
 * `res.locals` key set when a config fetch was authenticated as a game server
 * rather than an admin. Only such a fetch proves Auto Tournament CS2 accepted a load.
 */
export const MATCH_CONFIG_FETCHED_BY_SERVER = 'matchConfigFetchedByServer';

export async function requireMatchConfigAccess(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const validToken = process.env.SERVER_TOKEN;
  const presented = presentedToken(req);
  const refuse = (reason: string): void => {
    log.warn(`[MATCH CONFIG] Refused config fetch: ${reason}`, {
      slug: req.params?.slug,
      ip: req.ip ?? req.socket?.remoteAddress,
    });
    res.status(401).json({ success: false, error: 'Unauthorized' });
  };

  if (presented) {
    if (validToken && tokensMatch(presented, validToken)) {
      res.locals[MATCH_CONFIG_FETCHED_BY_SERVER] = true;
      return next();
    }
    return refuse(
      validToken
        ? 'X-Auto-Tournament-Token does not match SERVER_TOKEN'
        : 'SERVER_TOKEN is not set, so no game server can authenticate'
    );
  }

  const admin = await checkAdminAccess(req);
  if (admin.ok) {
    return next();
  }
  if (admin.status === 500) {
    log.error(admin.logReason, admin.cause as Error);
    res.status(500).json({ success: false, error: 'Failed to verify permissions' });
    return;
  }
  refuse(`no X-Auto-Tournament-Token and not an admin (${admin.logReason})`);
}
