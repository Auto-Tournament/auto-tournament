/**
 * Which player ids belong to real people: a player who has signed in here, or
 * whose Steam profile was looked up (an avatar). Placeholder roster players
 * (made-up Steam ids, trial teams) have neither, and bots have no player row.
 * They never count as someone to wait for and never get rewards.
 */
import { db } from '../config/database';

const STEAM_ID = /^\d{15,20}$/;

export async function realPlayerIds(ids: Iterable<string>): Promise<Set<string>> {
  const wanted = [...new Set(ids)].filter((id) => STEAM_ID.test(id));
  if (wanted.length === 0) return new Set();
  const rows = await db.queryAsync<{ id: string }>(
    `SELECT id FROM players
      WHERE id IN (${wanted.map(() => '?').join(', ')})
        AND (last_sign_in_at IS NOT NULL OR avatar_url IS NOT NULL)`,
    wanted
  );
  return new Set(rows.map((r) => r.id));
}
