/**
 * The tournament page's banner: one wide image per tournament, shown behind
 * the page header. The bytes live in `tournament_banner`; the tournament row
 * keeps only `banner_updated_at`, which versions the public URL so a new
 * banner is never served from a cache.
 */

import { db } from '../config/database';
import { logoMediaType } from './teamSelfService';

/** Banners: PNG, JPEG or WEBP, at most 2 MB. */
export const BANNER_MAX_BYTES = 2 * 1024 * 1024;

export class BannerError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
  }
}

/** `/api/tournament/1/banner?v=…`, or null when the tournament has no banner. */
export function bannerUrl(tournamentId: number, updatedAt: number | null | undefined): string | null {
  return updatedAt ? `/api/tournament/${tournamentId}/banner?v=${updatedAt}` : null;
}

export const tournamentBannerService = {
  /** Stores the banner, or removes it when `data` is null. */
  async set(tournamentId: number, data: Buffer | null): Promise<void> {
    const exists = await db.queryOneAsync<{ id: number }>('SELECT id FROM tournament WHERE id = ?', [
      tournamentId,
    ]);
    if (!exists) throw new BannerError(404, 'There is no tournament yet.');

    if (data === null) {
      await db.runAsync('DELETE FROM tournament_banner WHERE tournament_id = ?', [tournamentId]);
      await db.runAsync('UPDATE tournament SET banner_updated_at = NULL WHERE id = ?', [
        tournamentId,
      ]);
      return;
    }

    if (data.length > BANNER_MAX_BYTES) {
      throw new BannerError(413, 'The banner must be 2 MB or smaller.');
    }
    const mediaType = logoMediaType(data);
    if (!mediaType) throw new BannerError(415, 'The banner must be a PNG, JPEG or WEBP image.');

    await db.runAsync(
      `INSERT INTO tournament_banner (tournament_id, data, media_type) VALUES (?, ?, ?)
       ON CONFLICT (tournament_id) DO UPDATE SET data = EXCLUDED.data, media_type = EXCLUDED.media_type`,
      [tournamentId, data, mediaType]
    );
    await db.runAsync(
      'UPDATE tournament SET banner_updated_at = EXTRACT(EPOCH FROM NOW())::INTEGER WHERE id = ?',
      [tournamentId]
    );
  },

  async get(tournamentId: number): Promise<{ data: Buffer; type: string } | null> {
    const row = await db.queryOneAsync<{ data: Buffer | null; media_type: string | null }>(
      'SELECT data, media_type FROM tournament_banner WHERE tournament_id = ?',
      [tournamentId]
    );
    return row?.data && row.media_type ? { data: row.data, type: row.media_type } : null;
  },
};
