/**
 * Whether a match gets highlights at all: an organizer turns them off for a
 * tournament (`settings.cs2.highlights: false`) or for one match (its config's
 * `highlights: false`, from the manual match dialog). The map is still
 * analysed (stats, notable moments); only the clips and reels are skipped.
 */
import { db } from '../../../config/database';
import { storedCs2Settings } from '../tournamentSettings';

export async function recordsHighlights(matchSlug: string): Promise<boolean> {
  const row = await db
    .queryOneAsync<{ config: string | null; settings: string | null }>(
      `SELECT m.config, t.settings FROM matches m LEFT JOIN tournament t ON t.id = m.tournament_id
        WHERE m.slug = ?`,
      [matchSlug]
    )
    .catch(() => null);
  if (!row) return true;
  if (storedCs2Settings(row.settings)?.highlights === false) return false;
  try {
    return (JSON.parse(row.config ?? '{}') as { highlights?: unknown }).highlights !== false;
  } catch {
    return true;
  }
}
