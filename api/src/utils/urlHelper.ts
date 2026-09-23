import { Request } from 'express';
import { settingsService } from '../services/settingsService';

/**
 * Get the base URL for webhook configuration
 *
 * Requires webhook URL to be configured in Settings.
 * This is the URL where MatchZy servers will send webhook events.
 *
 * Examples:
 * - Development: http://localhost:3000
 * - Production: https://yourdomain.com
 *
 * Only for routes that are CS2 by construction (`POST /api/matches` takes a
 * raw MatchZy config). Anything that serves whatever game a tournament or
 * match belongs to asks the integration instead, through
 * `scheduler.resolveBaseUrl` / `resolveBaseUrlForMatch`, so that a game with
 * no servers does not need a webhook URL.
 *
 * @throws Error if no webhook URL has been configured
 */
export async function getWebhookBaseUrl(_req: Request): Promise<string> {
  return await settingsService.requireWebhookUrl();
}

/**
 * Get base URL from request (for match configs, etc.)
 */
export function getBaseUrl(req: Request): string {
  const protocol = req.protocol;
  const host = req.get('host');
  return `${protocol}://${host}`;
}

