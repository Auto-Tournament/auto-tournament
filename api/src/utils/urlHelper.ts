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

