import type { Request } from 'express';
import { publicOrigin } from './publicOrigin';

/**
 * Get base URL from request (for match configs, etc.): FRONTEND_BASE_URL when
 * set, else the request's proxy-aware origin (utils/publicOrigin.ts).
 */
export function getBaseUrl(req: Request): string {
  return publicOrigin(req);
}
