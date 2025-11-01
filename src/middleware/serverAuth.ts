import { Request, Response, NextFunction } from 'express';
import { log } from '../utils/logger';

/**
 * Middleware to validate server token from MatchZy webhooks
 * MatchZy sends custom headers that we can use for authentication
 */
export function validateServerToken(req: Request, res: Response, next: NextFunction): void {
  const serverToken = req.headers['x-matchzy-token'] as string | undefined;
  const validToken = process.env.SERVER_TOKEN;

  if (!validToken) {
    log.error('SERVER_TOKEN not set in environment variables!');
    res.status(500).json({
      success: false,
      error: 'Server configuration error',
    });
    return;
  }

  if (!serverToken || serverToken !== validToken) {
    log.authFailed('/api/events', 'Invalid or missing server token');
    res.status(401).json({
      success: false,
      error: 'Unauthorized - Invalid or missing server token',
    });
    return;
  }

  next();
}
