/**
 * The admin's Clips list: every match's clips and match reels, what each was
 * made at (cs2_highlights.made_with, cs2_match_reels.made_with), and which no
 * longer match the highlight settings, to make them again.
 *
 * Redoing a clip queues it like a new moment; its old video stays until the
 * new one replaces it. The reels it is in are made again once the redone clips
 * are recorded: they wait ('waiting') and queueMatchReelFor takes them up.
 */

import { db } from '../../../config/database';
import { qualityLabel, readHighlightQuality } from './highlightQuality';
import { SERIES_REEL } from './highlights';

/** How many matches the list shows, newest first. */
const MATCHES = 40;

export interface AdminClip {
  id: number;
  mapNumber: number;
  playerId: string;
  playerName: string;
  title: string;
  kind: string;
  status: string;
  madeWith: string | null;
  outdated: boolean;
}

export interface AdminReel {
  mapNumber: number;
  status: string;
  clips: number | null;
  madeWith: string | null;
  outdated: boolean;
}

export interface AdminMatch {
  slug: string;
  match: string;
  clips: AdminClip[];
  reels: AdminReel[];
}

/** A finished video made at something other than `current` (or at what no one kept). */
const isOutdated = (status: string, madeWith: string | null, current: string) =>
  status === 'done' && madeWith !== current;

export async function listClips(
  onlyOutdated = false
): Promise<{ current: string; outdated: number; matches: AdminMatch[] }> {
  const current = qualityLabel(await readHighlightQuality());
  const matches = await db.queryAsync<{
    slug: string;
    team1: string | null;
    team2: string | null;
    played_in: string | null;
  }>(
    `SELECT m.slug, t1.name AS team1, t2.name AS team2, m.played_in
       FROM matches m
       LEFT JOIN teams t1 ON t1.id = m.team1_id
       LEFT JOIN teams t2 ON t2.id = m.team2_id
      WHERE m.slug IN (SELECT match_slug FROM cs2_highlights GROUP BY match_slug ORDER BY MAX(id) DESC LIMIT ${MATCHES})`
  );
  const slugs = matches.map((m) => m.slug);
  if (slugs.length === 0) return { current, outdated: 0, matches: [] };
  const marks = slugs.map(() => '?').join(', ');
  const clips = await db.queryAsync<{
    id: number;
    match_slug: string;
    map_number: number;
    player_id: string;
    name: string | null;
    title: string;
    kind: string;
    status: string;
    made_with: string | null;
  }>(
    `SELECT h.id, h.match_slug, h.map_number, h.player_id, p.name, h.title, h.kind, h.status, h.made_with
       FROM cs2_highlights h LEFT JOIN players p ON p.id = h.player_id
      WHERE h.match_slug IN (${marks}) AND h.status <> 'skipped'
      ORDER BY h.map_number, h.round, h.id`,
    slugs
  );
  const reels = await db.queryAsync<{
    match_slug: string;
    map_number: number;
    status: string;
    clips: number | null;
    made_with: string | null;
  }>(
    `SELECT match_slug, map_number, status, clips, made_with FROM cs2_match_reels
      WHERE match_slug IN (${marks}) ORDER BY map_number`,
    slugs
  );
  let outdated = 0;
  const out: AdminMatch[] = [];
  // Newest first, as the list is ordered by the latest clip.
  const order = new Map(slugs.map((s, i) => [s, i]));
  for (const m of matches.sort((a, b) => (order.get(a.slug) ?? 0) - (order.get(b.slug) ?? 0))) {
    const own = clips
      .filter((c) => c.match_slug === m.slug)
      .map((c) => ({
        id: Number(c.id),
        mapNumber: Number(c.map_number),
        playerId: c.player_id,
        playerName: c.name ?? c.player_id,
        title: c.title,
        kind: c.kind,
        status: c.status,
        madeWith: c.made_with,
        outdated: isOutdated(c.status, c.made_with, current),
      }));
    const ownReels = reels
      .filter((r) => r.match_slug === m.slug)
      .map((r) => ({
        mapNumber: Number(r.map_number),
        status: r.status,
        clips: r.clips === null ? null : Number(r.clips),
        madeWith: r.made_with,
        outdated: isOutdated(r.status, r.made_with, current),
      }));
    const stale = own.filter((c) => c.outdated).length + ownReels.filter((r) => r.outdated).length;
    outdated += stale;
    if (onlyOutdated && stale === 0) continue;
    out.push({
      slug: m.slug,
      match: [m.team1 && m.team2 ? `${m.team1} vs ${m.team2}` : m.slug, m.played_in]
        .filter(Boolean)
        .join(' · '),
      clips: onlyOutdated ? own.filter((c) => c.outdated) : own,
      reels: onlyOutdated ? ownReels.filter((r) => r.outdated) : ownReels,
    });
  }
  return { current, outdated, matches: out };
}

/** What to make again: clips by id, reels by match and map, or everything outdated. */
export interface RedoRequest {
  clipIds?: number[];
  reels?: { slug: string; mapNumber: number }[];
  outdated?: boolean;
}

/**
 * Queue clips and reels to be made again. Clips go back to 'pending'; the
 * reels of their maps (and the series reel) wait for them. A reel asked for
 * on its own is made again straight away when none of its clips is waiting.
 */
export async function redo(req: RedoRequest): Promise<{ clips: number; reels: number }> {
  const current = qualityLabel(await readHighlightQuality());
  let ids = (req.clipIds ?? []).filter((n) => Number.isInteger(n) && n > 0).slice(0, 500);
  let reels = (req.reels ?? [])
    .filter(
      (r) =>
        typeof r?.slug === 'string' &&
        r.slug &&
        Number.isInteger(r.mapNumber) &&
        r.mapNumber >= SERIES_REEL
    )
    .slice(0, 200);
  if (req.outdated) {
    const stale = await db.queryAsync<{ id: number }>(
      `SELECT id FROM cs2_highlights WHERE status = 'done' AND made_with IS DISTINCT FROM ?`,
      [current]
    );
    ids = [...new Set([...ids, ...stale.map((r) => Number(r.id))])];
    const staleReels = await db.queryAsync<{ match_slug: string; map_number: number }>(
      `SELECT match_slug, map_number FROM cs2_match_reels WHERE status = 'done' AND made_with IS DISTINCT FROM ?`,
      [current]
    );
    reels = [
      ...reels,
      ...staleReels.map((r) => ({ slug: r.match_slug, mapNumber: Number(r.map_number) })),
    ];
  }
  let clips = 0;
  if (ids.length) {
    const marks = ids.map(() => '?').join(', ');
    const touched = await db.queryAsync<{ match_slug: string; map_number: number }>(
      `UPDATE cs2_highlights SET status = 'pending', attempts = 0, error = NULL, claimed_at = NULL, recorder = NULL
        WHERE id IN (${marks}) AND status IN ('done', 'failed')
        RETURNING match_slug, map_number`,
      ids
    );
    clips = touched.length;
    // Their reels wait for them.
    for (const t of touched) {
      reels.push({ slug: t.match_slug, mapNumber: Number(t.map_number) });
      reels.push({ slug: t.match_slug, mapNumber: SERIES_REEL });
    }
  }
  const seen = new Set<string>();
  let reelCount = 0;
  for (const r of reels) {
    const key = `${r.slug}#${r.mapNumber}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const waiting = await db.queryOneAsync<{ n: number | string }>(
      `SELECT COUNT(*) AS n FROM cs2_highlights
        WHERE match_slug = ? AND (map_number = ? OR ? = ${SERIES_REEL}) AND status IN ('pending', 'recording')`,
      [r.slug, r.mapNumber, r.mapNumber]
    );
    const result = await db.runAsync(
      `UPDATE cs2_match_reels SET status = ?, attempts = 0, error = NULL
        WHERE match_slug = ? AND map_number = ? AND status IN ('done', 'failed', 'waiting', 'pending')`,
      [Number(waiting?.n ?? 0) > 0 ? 'waiting' : 'pending', r.slug, r.mapNumber]
    );
    reelCount += result.changes ?? 0;
  }
  return { clips, reels: reelCount };
}
