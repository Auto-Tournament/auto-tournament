/**
 * A simulated match's stand-ins: in simulation Ready Up has a bot play each
 * roster player under their roster name (ready-up simulation.cpp). The demo
 * worker and the recorder take that bot as the player (worker standIn,
 * mapJob.StandIns), so the match gets the player's stats and clips.
 */
import { db } from '../../../config/database';
import type { Untrusted } from '../../../utils/untrusted';

/** SteamID64 -> roster name for a simulated match's players; null for a real match (pure). */
export function standInsOf(config: Untrusted): Record<string, string> | null {
  const c = config && typeof config === 'object' ? (config as Record<string, Untrusted>) : {};
  if (c.simulation !== true) return null;
  const out: Record<string, string> = {};
  for (const side of ['team1', 'team2']) {
    const team = c[side] as { players?: Untrusted } | undefined;
    const players = team?.players;
    if (!players || typeof players !== 'object' || Array.isArray(players)) continue;
    for (const [sid, name] of Object.entries(players as Record<string, Untrusted>)) {
      if (/^\d{17}$/.test(sid) && typeof name === 'string' && name) out[sid] = name;
    }
  }
  return Object.keys(out).length > 0 ? out : null;
}

export async function standInsFor(slug: string): Promise<Record<string, string> | null> {
  const row = await db.queryOneAsync<{ config: string | null }>(
    'SELECT config FROM matches WHERE slug = ?',
    [slug]
  );
  try {
    return standInsOf(row?.config ? (JSON.parse(row.config) as Untrusted) : null);
  } catch {
    return null;
  }
}
