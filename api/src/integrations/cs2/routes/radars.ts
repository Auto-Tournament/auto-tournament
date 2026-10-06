/**
 * Map radars for the 2D replay (cs2_map_radars), sent by the worker from a
 * CS2 install's own files (worker/radar.go). Nothing of Valve's is in this
 * repository: an instance only has the radars its own game install has.
 *
 *   GET /api/game/cs2/radars                    every map and level with its texture CRC
 *   GET /api/game/cs2/radars/:map               a map's levels: position, scale, altitudes, image URL
 *   GET /api/game/cs2/radars/:map/:level.png    the image
 *   PUT /api/game/cs2/radars/:map/:level        the worker's upload (API token)
 */

import { Router, type Request, type Response } from 'express';
import { db } from '../../../config/database';
import { requireAuth } from '../../../middleware/auth';
import { log } from '../../../utils/logger';

const router = Router();
const NAME = /^[a-z0-9_]{1,64}$/;
const PNG_MAX_BYTES = 8 * 1024 * 1024;

router.get('/radars', async (_req: Request, res: Response) => {
  const rows = await db.queryAsync<{ map: string; level: string; crc: string | number }>(
    'SELECT map, level, crc FROM cs2_map_radars ORDER BY map, level'
  );
  return res.json({
    success: true,
    radars: rows.map((r) => ({ map: r.map, level: r.level, crc: Number(r.crc) })),
  });
});

router.get('/radars/:map', async (req: Request, res: Response) => {
  const map = req.params.map.toLowerCase();
  if (!NAME.test(map)) return res.status(400).json({ success: false, error: 'A map name' });
  const rows = await db.queryAsync<{
    level: string;
    pos_x: number;
    pos_y: number;
    scale: number;
    altitude_min: number | null;
    altitude_max: number | null;
    updated_at: number;
  }>(
    'SELECT level, pos_x, pos_y, scale, altitude_min, altitude_max, updated_at FROM cs2_map_radars WHERE map = ? ORDER BY level',
    [map]
  );
  if (rows.length === 0)
    return res.status(404).json({ success: false, error: 'No radar for this map' });
  return res.json({
    success: true,
    map,
    levels: rows.map((r) => ({
      level: r.level,
      posX: Number(r.pos_x),
      posY: Number(r.pos_y),
      scale: Number(r.scale),
      altitudeMin: r.altitude_min === null ? null : Number(r.altitude_min),
      altitudeMax: r.altitude_max === null ? null : Number(r.altitude_max),
      image: `/api/game/cs2/radars/${map}/${r.level}.png?v=${r.updated_at}`,
    })),
  });
});

router.get('/radars/:map/:file', async (req: Request, res: Response) => {
  const map = req.params.map.toLowerCase();
  const level = req.params.file.replace(/\.png$/, '').toLowerCase();
  if (!NAME.test(map) || !NAME.test(level)) return res.status(400).end();
  const row = await db.queryOneAsync<{ png: Buffer }>(
    'SELECT png FROM cs2_map_radars WHERE map = ? AND level = ?',
    [map, level]
  );
  if (!row) return res.status(404).end();
  res.setHeader('Content-Type', 'image/png');
  // The URL carries the update time, so the bytes behind one never change.
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  return res.send(row.png);
});

router.put('/radars/:map/:level', requireAuth, async (req: Request, res: Response) => {
  const map = req.params.map.toLowerCase();
  const level = req.params.level.toLowerCase();
  const b = req.body ?? {};
  const png = typeof b.png === 'string' ? Buffer.from(b.png, 'base64') : null;
  const isPng =
    png &&
    png.length > 8 &&
    png.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (!NAME.test(map) || !NAME.test(level) || !isPng || png.length > PNG_MAX_BYTES) {
    return res.status(400).json({ success: false, error: 'A map, a level and a PNG' });
  }
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  if (n(b.scale) === null || !n(b.scale))
    return res.status(400).json({ success: false, error: 'A scale' });
  try {
    await db.runAsync(
      `INSERT INTO cs2_map_radars (map, level, png, crc, pos_x, pos_y, scale, altitude_min, altitude_max, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, EXTRACT(EPOCH FROM NOW())::INTEGER)
       ON CONFLICT (map, level) DO UPDATE SET png = EXCLUDED.png, crc = EXCLUDED.crc, pos_x = EXCLUDED.pos_x,
         pos_y = EXCLUDED.pos_y, scale = EXCLUDED.scale, altitude_min = EXCLUDED.altitude_min,
         altitude_max = EXCLUDED.altitude_max, updated_at = EXCLUDED.updated_at`,
      [
        map,
        level,
        png,
        n(b.crc) ?? 0,
        n(b.posX) ?? 0,
        n(b.posY) ?? 0,
        n(b.scale),
        n(b.altitudeMin),
        n(b.altitudeMax),
      ]
    );
    return res.json({ success: true });
  } catch (error) {
    log.error('[RADARS] save failed', { error, map, level });
    return res.status(500).json({ success: false, error: 'Could not store the radar' });
  }
});

export default router;
