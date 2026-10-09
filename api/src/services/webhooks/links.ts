/**
 * Links to the platform's own pages in webhook deliveries. The platform's
 * address is the one in Settings (webhook URL); without it there are no links.
 */
import { settingsService } from '../settingsService';

export async function platformOrigin(): Promise<string | null> {
  const base = await settingsService.getWebhookUrl().catch(() => null);
  try {
    return base ? new URL(base).origin : null;
  } catch {
    return null;
  }
}

/** A match on the admin pages. */
export function matchPageUrl(origin: string | null, slug: string): string | null {
  return origin ? `${origin}/manage/matches?match=${encodeURIComponent(slug)}` : null;
}
