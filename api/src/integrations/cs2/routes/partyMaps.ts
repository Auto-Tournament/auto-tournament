/**
 * GET /api/game/cs2/party-maps?players=<steamId>,<steamId>,…
 *
 * A matchmaking party's map strength (the radar on /play): each member's
 * results per map, from every CS2 match they played (matchmaking and
 * tournaments, like the player profile's radar), added up over the party.
 * A map two members played together counts once per member. Also the
 * Active Duty pool's maps, which the radar marks.
 *
 * Public, like the player profiles it sums. Kept for a minute per party.
 */

import type { Request, Response } from 'express';
import { Router } from 'express';
import { db } from '../../../config/database';
import { log } from '../../../utils/logger';
import { ACTIVE_DUTY_POOL } from '../maps/mapSync';
import type { Untrusted } from '../../../utils/untrusted';

const router = Router();

const MAX_PLAYERS = 5;
const TTL_MS = 60_000;

interface PartyMaps {
  maps: Array<{ map: string; played: number; won: number; roundsWon: number; roundsLost: number }>;
  activeDuty: string[];
}

const cache = new Map<string, { at: number; value: PartyMaps }>();

const num = (v: number | string | null | undefined): number => {
  const n = typeof v === 'string' ? Number(v) : (v ?? 0);
  return Number.isFinite(n) ? (n as number) : 0;
};

function parseIds(raw: string): string[] {
  try {
    // Older rows: a comma list, or JSON that is not a list of names.
    const ids: Untrusted = JSON.parse(raw);
    return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return raw
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean);
  }
}

async function readPartyMaps(players: string[]): Promise<PartyMaps> {
  const rows = await db.queryAsync<{
    map_name: string;
    played: number | string;
    won: number | string;
    rounds_won: number | string | null;
    rounds_lost: number | string | null;
  }>(
    `SELECT
       mmr.map_name,
       COUNT(*) AS played,
       SUM(CASE WHEN mmr.winner_team = pms.team THEN 1 ELSE 0 END) AS won,
       SUM(CASE WHEN pms.team = 'team1' THEN mmr.team1_score ELSE mmr.team2_score END) AS rounds_won,
       SUM(CASE WHEN pms.team = 'team1' THEN mmr.team2_score ELSE mmr.team1_score END) AS rounds_lost
     FROM player_match_stats pms
     JOIN matches m ON pms.match_slug = m.slug
     JOIN match_map_results mmr ON mmr.match_slug = pms.match_slug
     WHERE pms.player_id IN (${players.map(() => '?').join(', ')})
       AND (m.game IS NULL OR m.game = 'cs2')
       AND mmr.map_name IS NOT NULL AND mmr.map_name <> ''
       AND mmr.winner_team IS NOT NULL
     GROUP BY mmr.map_name
     ORDER BY played DESC, mmr.map_name`,
    players
  );
  const pool = await db.queryOneAsync<{ map_ids: string }>(
    'SELECT map_ids FROM cs2_map_pools WHERE name = ? AND enabled = 1',
    [ACTIVE_DUTY_POOL]
  );
  return {
    maps: rows.map((r) => ({
      map: r.map_name,
      played: num(r.played),
      won: num(r.won),
      roundsWon: num(r.rounds_won),
      roundsLost: num(r.rounds_lost),
    })),
    activeDuty: pool ? parseIds(pool.map_ids) : [],
  };
}

router.get('/party-maps', async (req: Request, res: Response) => {
  const raw = typeof req.query.players === 'string' ? req.query.players : '';
  const players = [...new Set(raw.split(',').map((id) => id.trim()))].filter(Boolean);
  if (
    players.length === 0 ||
    players.length > MAX_PLAYERS ||
    !players.every((id) => /^\d{15,20}$/.test(id))
  ) {
    return res
      .status(400)
      .json({ success: false, error: `players: 1 to ${MAX_PLAYERS} Steam IDs, comma separated` });
  }
  const key = [...players].sort().join(',');
  try {
    const hit = cache.get(key);
    let value: PartyMaps;
    if (hit && Date.now() - hit.at < TTL_MS) {
      value = hit.value;
    } else {
      value = await readPartyMaps(players);
      if (cache.size > 500) cache.clear();
      cache.set(key, { at: Date.now(), value });
    }
    res.setHeader('Cache-Control', 'public, max-age=60');
    return res.json({ success: true, ...value });
  } catch (error) {
    log.error('[Cs2PartyMaps] Failed to read the party map stats', { error, players });
    return res.status(500).json({ success: false, error: 'Failed to read the party map stats' });
  }
});

export default router;
