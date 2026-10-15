/**
 * Surf, bhop and kz records (movement/records.ts), for the Leaderboards page.
 *
 * Public:
 *   GET /api/game/cs2/movement/maps
 *       The maps with records, latest run first: mode, courses, players and the record.
 *   GET /api/game/cs2/movement/records   ?map=<name>&mode=surf|bhop|kz&course=<n>&limit=<n>
 *       A map's board: each player's best, fastest first. Ties share a rank.
 */

import { Router, type Request, type Response } from 'express';
import { db } from '../../../config/database';
import { log } from '../../../utils/logger';

const router = Router();

const MODES = new Set(['surf', 'bhop', 'kz']);

interface MapRow {
  map: string;
  mode: string;
  course: number;
  players: number;
  last_at: string | number;
}

router.get('/movement/maps', async (_req: Request, res: Response): Promise<void> => {
  try {
    const rows = await db.queryAsync<MapRow>(
      `SELECT map, mode, course, COUNT(*)::int AS players, MAX(updated_at) AS last_at
         FROM cs2_movement_records
        GROUP BY map, mode, course`
    );
    const best = await db.queryAsync<{
      map: string;
      mode: string;
      steamid64: string;
      name: string;
      player_name: string | null;
      time_ms: number;
    }>(
      `SELECT DISTINCT ON (r.map, r.mode) r.map, r.mode, r.steamid64, r.name, p.name AS player_name, r.time_ms
         FROM cs2_movement_records r
         LEFT JOIN players p ON p.id = r.steamid64
        WHERE r.course = 0
        ORDER BY r.map, r.mode, r.time_ms, r.finished_at`
    );
    const maps = new Map<
      string,
      {
        map: string;
        mode: string;
        courses: number[];
        players: number;
        lastAt: number;
        record: { playerId: string; name: string; timeMs: number } | null;
      }
    >();
    for (const r of rows) {
      const key = `${r.map}\u0000${r.mode}`;
      const m = maps.get(key) ?? {
        map: r.map,
        mode: r.mode,
        courses: [],
        players: 0,
        lastAt: 0,
        record: null,
      };
      m.courses.push(Number(r.course));
      if (Number(r.course) === 0) m.players = Number(r.players);
      m.lastAt = Math.max(m.lastAt, Number(r.last_at) || 0);
      maps.set(key, m);
    }
    for (const b of best) {
      const m = maps.get(`${b.map}\u0000${b.mode}`);
      if (m) {
        m.record = {
          playerId: b.steamid64,
          name: b.player_name || b.name || b.steamid64,
          timeMs: Number(b.time_ms),
        };
      }
    }
    const list = [...maps.values()]
      .map((m) => ({ ...m, courses: m.courses.sort((a, b) => a - b) }))
      .sort((a, b) => b.lastAt - a.lastAt || a.map.localeCompare(b.map));
    res.json({ success: true, maps: list });
  } catch (error) {
    log.error('[MOVEMENT] maps failed', error);
    res.status(500).json({ success: false, error: 'Failed to read the movement records' });
  }
});

router.get('/movement/records', async (req: Request, res: Response): Promise<void> => {
  const map = String(req.query.map ?? '').toLowerCase();
  const mode = String(req.query.mode ?? '');
  const course = Number(req.query.course ?? 0);
  const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
  if (!map || map.length > 128 || !MODES.has(mode) || !Number.isInteger(course) || course < 0) {
    res
      .status(400)
      .json({ success: false, error: 'map, mode (surf, bhop, kz) and course are required' });
    return;
  }
  try {
    const rows = await db.queryAsync<{
      steamid64: string;
      name: string;
      player_name: string | null;
      avatar_url: string | null;
      time_ms: number;
      teleports: number;
      finished_at: string | number;
      runs: number;
      rank: string | number;
    }>(
      `SELECT r.steamid64, r.name, p.name AS player_name, p.avatar_url, r.time_ms, r.teleports,
              r.finished_at, r.runs, RANK() OVER (ORDER BY r.time_ms) AS rank
         FROM cs2_movement_records r
         LEFT JOIN players p ON p.id = r.steamid64
        WHERE r.map = ? AND r.mode = ? AND r.course = ?
        ORDER BY r.time_ms, r.finished_at
        LIMIT ?`,
      [map, mode, course, limit]
    );
    const total = await db.queryOneAsync<{ n: number }>(
      'SELECT COUNT(*)::int AS n FROM cs2_movement_records WHERE map = ? AND mode = ? AND course = ?',
      [map, mode, course]
    );
    res.json({
      success: true,
      map,
      mode,
      course,
      total: Number(total?.n ?? 0),
      records: rows.map((r) => ({
        rank: Number(r.rank),
        playerId: r.steamid64,
        name: r.player_name || r.name || r.steamid64,
        avatarUrl: r.avatar_url,
        timeMs: Number(r.time_ms),
        teleports: Number(r.teleports),
        finishedAt: Number(r.finished_at),
        runs: Number(r.runs),
      })),
    });
  } catch (error) {
    log.error('[MOVEMENT] records failed', error);
    res.status(500).json({ success: false, error: 'Failed to read the movement records' });
  }
});

export default router;
