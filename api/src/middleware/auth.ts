import { Request, Response, NextFunction } from 'express';
import { log } from '../utils/logger';

/**
 * Simple token-based authentication middleware
 * In production, use a more robust solution like JWT.
 *
 * For local dev and tests, we default to a well-known token ("admin123")
 * so tests don't require manual API_TOKEN configuration.
 */
const DEFAULT_API_TOKEN = 'admin123';

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const token = req.headers.authorization?.replace('Bearer ', '');
  const validToken = process.env.API_TOKEN || DEFAULT_API_TOKEN;

  if (!process.env.API_TOKEN) {
    // Log once per process that we're falling back to default for visibility,
    // but don't treat it as an error for local/dev usage.
    log.debug('API_TOKEN not set, falling back to default token for auth');
  }

  if (!token || token !== validToken) {
    log.authFailed(req.path, 'Invalid or missing token');
    res.status(401).json({
      success: false,
      error: 'Unauthorized - Invalid or missing token',
    });
    return;
  }

  next();
}
