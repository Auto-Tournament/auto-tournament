import { Request } from 'express';

/**
 * Get the base URL for webhook configuration
 * 
 * Requires WEBHOOK_URL environment variable to be set.
 * This is the URL where MatchZy servers will send webhook events.
 * 
 * Examples:
 * - Development: WEBHOOK_URL=http://localhost:3000
 * - Production: WEBHOOK_URL=https://yourdomain.com
 * 
 * @throws Error if WEBHOOK_URL is not configured
 */
export function getWebhookBaseUrl(_req: Request): string {
  const webhookUrl = process.env.WEBHOOK_URL;
  
  if (!webhookUrl) {
    throw new Error(
      'WEBHOOK_URL environment variable is required. ' +
      'Set it to the URL where your API is accessible to CS2 servers ' +
      '(e.g., if on the same machine, WEBHOOK_URL=http://localhost:3000 or if on a different machine, WEBHOOK_URL=https://yourdomain.com)'
    );
  }

  // Remove trailing slash for consistency
  return webhookUrl.replace(/\/$/, '');
}

/**
 * Get base URL from request (for match configs, etc.)
 */
export function getBaseUrl(req: Request): string {
  const protocol = req.protocol;
  const host = req.get('host');
  return `${protocol}://${host}`;
}

