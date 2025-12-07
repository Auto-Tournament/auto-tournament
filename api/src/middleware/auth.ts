import { Request, Response, NextFunction } from 'express';
import { log } from '../utils/logger';

/**
 * Simple token-based authentication middleware
 * In production, use a more robust solution like JWT
 */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const token = req.headers.authorization?.replace('Bearer ', '');
  const validToken = process.env.API_TOKEN;

  if (!validToken) {
    log.error('API_TOKEN not set in environment variables!');
    res.status(500).json({
      success: false,
      error: 'Server configuration error',
    });
    return;
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
