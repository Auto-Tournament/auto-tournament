import { db } from '../../config/database';
import { mapFromMatch } from './mapFromMatch';

/**
 * The map a matchmaking match is played on. A vetoed 5v5 lobby never gets `mm_lobbies.map`
 * from the draw: the veto decides it (match config maplist / veto picks), so display code
 * falls back to the match.
 */
export async function playedMapOf(matchSlug: string | null | undefined): Promise<string | null> {
  if (!matchSlug) return null;
  const m = await db.queryOneAsync<{ config: string | null; veto_state: string | null }>(
    'SELECT config, veto_state FROM matches WHERE slug = ?',
    [matchSlug]
  );
  if (!m) return null;
  return mapFromMatch(m) || null;
}
