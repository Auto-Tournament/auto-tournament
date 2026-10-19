/**
 * Links to the platform's own pages in webhook deliveries. The platform's
 * address is the one emails use (emailService.siteUrl); without it there are no links.
 */
import { emailService } from '../emailService';

export async function platformOrigin(): Promise<string | null> {
  const base = await emailService.siteUrl().catch(() => null);
  try {
    return base ? new URL(base).origin : null;
  } catch {
    return null;
  }
}

/** A match's own page (admins manage it from there too). */
export function matchPageUrl(origin: string | null, slug: string): string | null {
  return origin ? `${origin}/match/${encodeURIComponent(slug)}` : null;
}
