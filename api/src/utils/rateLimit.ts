/**
 * Small in-memory, per-IP fixed-window rate limiter.
 *
 * For public endpoints that fan out to a third party (Wikidata game search), so a
 * single client cannot burn the instance's upstream quota. In memory is enough:
 * one API process per instance, and a restart forgetting the counts is fine.
 *
 * `req.ip` honours `trust proxy` (set in index.ts), so behind the reverse proxy
 * this is the client's address, not the proxy's.
 */

import type { NextFunction, Request, RequestHandler, Response } from 'express';

export interface RateLimiter extends RequestHandler {
  reset(): void;
}

export function createRateLimiter(options: {
  windowMs: number;
  max: number;
  message?: string;
}): RateLimiter {
  const hits = new Map<string, { count: number; resetAt: number }>();

  const middleware = ((req: Request, res: Response, next: NextFunction) => {
    const now = Date.now();
    const key = req.ip || req.socket.remoteAddress || 'unknown';

    let entry = hits.get(key);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + options.windowMs };
      hits.set(key, entry);
    }
    entry.count += 1;

    // Drop expired entries now and then so the map cannot grow without bound.
    if (hits.size > 10_000) {
      for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k);
    }

    if (entry.count > options.max) {
      res.setHeader('Retry-After', String(Math.max(1, Math.ceil((entry.resetAt - now) / 1000))));
      res.status(429).json({
        success: false,
        error: options.message ?? 'Too many requests, slow down',
      });
      return;
    }
    next();
  }) as RateLimiter;

  middleware.reset = () => hits.clear();
  return middleware;
}
