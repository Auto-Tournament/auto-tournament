/**
 * The notable moments of each analyzed map (./moments.ts finds them), kept in
 * cs2_moments for integrators: GET /api/integrations/highlights
 * (../routes/integrationHighlights.ts) reads them, oldest change first.
 *
 * - `id` is the same on every re-parse: a hash of the match row (slugs come
 *   back with every tournament, the row id does not), the map and the
 *   moment's key (kind, round and players, never the tick).
 * - `seq` goes up on every change: a new moment, a changed one, one revoked
 *   or back again. Changes are written one transaction at a time (an
 *   advisory lock), so a poller that reads `seq > cursor` never skips one
 *   that committed late.
 * - A moment a re-parse no longer finds is revoked, not deleted, and so are
 *   a deleted or forgotten match's: the integrator takes back what it gave.
 *
 * Written when an analysis comes back (./jobs.ts completeDemoJob) and by the
 * backfill (`backfillMoments`, POST /api/game/cs2/moments/backfill), which
 * reads the analyses already stored: no demo is read again for it.
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import type { PoolClient } from 'pg';
import { db } from '../../../config/database';
import { log } from '../../../utils/logger';
import {
  findMoments,
  type FoundMoment,
  type MomentKill,
  type MomentReplay,
  type MomentRound,
} from './moments';
import type { DemoJob } from './jobs';
import type { SqlValue } from '../../../config/database';
import type { JsonObject } from '../../../utils/json';

/** pg_advisory_xact_lock key: one writer of cs2_moments at a time. */
const LOCK_SQL = "SELECT pg_advisory_xact_lock(hashtext('cs2_moments'))";
const BUMP = "seq = nextval('cs2_moments_seq'), updated_at = EXTRACT(EPOCH FROM NOW())::BIGINT";

export function momentId(matchId: number, mapNumber: number, key: string): string {
  const hash = crypto.createHash('sha256').update(`${matchId}|${mapNumber}|${key}`).digest('hex');
  return `hl_${hash.slice(0, 24)}`;
}

export interface SyncResult {
  created: string[];
  updated: string[];
  revoked: string[];
  unchanged: number;
}

interface MatchFacts {
  id: number;
  slug: string;
  tournamentId: number | null;
  tournamentName: string | null;
  imported: boolean;
  mapName: string | null;
  /** Unix seconds the map ended; null when unknown (an import: its upload time). */
  mapEndedAt: number | null;
}

async function matchFacts(slug: string, mapNumber: number): Promise<MatchFacts | null> {
  const row = await db.queryOneAsync<{
    id: number;
    tournament_id: number | null;
    played_in_id: number | null;
    tournament_name: string | null;
    source: string | null;
    completed_at: number | null;
    map_name: string | null;
    map_completed_at: number | null;
  }>(
    `SELECT m.id, m.tournament_id, m.played_in_id, COALESCE(t.name, m.played_in) AS tournament_name,
            m.source, m.completed_at, r.map_name, r.completed_at AS map_completed_at
       FROM matches m
       LEFT JOIN tournament t ON t.id = m.tournament_id
       LEFT JOIN match_map_results r ON r.match_slug = m.slug AND r.map_number = ?
      WHERE m.slug = ?`,
    [mapNumber, slug]
  );
  if (!row) return null;
  const imported = row.source === 'import';
  const ended = row.map_completed_at ?? row.completed_at;
  return {
    id: Number(row.id),
    slug,
    tournamentId: row.tournament_id ?? row.played_in_id ?? null,
    tournamentName: row.tournament_name,
    imported,
    mapName: row.map_name,
    mapEndedAt: imported || ended === null ? null : Number(ended),
  };
}

/** The 2D replay of a map, for the moments (frames and bomb events); undefined when there is none. */
export async function readReplay(file: string): Promise<MomentReplay | undefined> {
  try {
    const gz = await fs.promises.readFile(file);
    return JSON.parse(zlib.gunzipSync(gz).toString('utf8')) as MomentReplay;
  } catch {
    return undefined;
  }
}

const sameDetail = (a: string, b: JsonObject) => {
  try {
    return JSON.stringify(JSON.parse(a)) === JSON.stringify(b);
  } catch {
    return false;
  }
};

/**
 * Store a map's moments: new ones in, changed ones updated, ones no longer
 * found revoked. `names`: Steam ID → in-game name, for players the platform
 * has no name for.
 */
export async function syncMapMoments(
  job: DemoJob,
  found: FoundMoment[],
  opts: { names?: Map<string, string>; lastTick?: number; tickrate?: number } = {}
): Promise<SyncResult | null> {
  const facts = await matchFacts(job.matchSlug, job.mapNumber);
  if (!facts) return null;
  const mapName =
    facts.mapName ??
    (
      await db.queryOneAsync<{ map_name: string | null }>(
        'SELECT map_name FROM cs2_demo_jobs WHERE match_slug = ? AND map_number = ?',
        [job.matchSlug, job.mapNumber]
      )
    )?.map_name ??
    null;
  const tickrate = opts.tickrate && opts.tickrate > 0 ? opts.tickrate : 64;
  const playedAt = (tick: number) =>
    facts.mapEndedAt === null || opts.lastTick === undefined
      ? null
      : Math.round(facts.mapEndedAt - Math.max(0, opts.lastTick - tick) / tickrate);
  const name = (id: string | null) => (id ? (opts.names?.get(id) ?? null) : null);

  const result: SyncResult = { created: [], updated: [], revoked: [], unchanged: 0 };
  await db.withClient(async (client: PoolClient) => {
    await client.query('BEGIN');
    try {
      await client.query(LOCK_SQL);
      const existing = new Map(
        (
          await client.query<{
            id: string;
            tick: number;
            player_id: string;
            victim_id: string | null;
            weapon: string | null;
            detail: string;
            revoked: boolean;
          }>(
            'SELECT id, tick, player_id, victim_id, weapon, detail, revoked FROM cs2_moments WHERE match_id = $1 AND map_number = $2',
            [facts.id, job.mapNumber]
          )
        ).rows.map((r) => [r.id, r])
      );
      const seen = new Set<string>();
      for (const m of found) {
        const id = momentId(facts.id, job.mapNumber, m.key);
        if (seen.has(id)) continue;
        seen.add(id);
        const row = existing.get(id);
        const values = [
          m.round,
          m.tick,
          playedAt(m.tick),
          m.playerId,
          name(m.playerId),
          m.victimId,
          name(m.victimId),
          m.weapon,
          JSON.stringify(m.detail),
          facts.tournamentId,
          facts.tournamentName,
          mapName,
        ];
        if (!row) {
          await client.query(
            `INSERT INTO cs2_moments (id, match_id, match_slug, map_number, imported, kind, moment_key,
                round, tick, played_at, player_id, player_name, victim_id, victim_name, weapon, detail,
                tournament_id, tournament_name, map_name)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)`,
            [id, facts.id, job.matchSlug, job.mapNumber, facts.imported, m.kind, m.key, ...values]
          );
          result.created.push(id);
          continue;
        }
        const changed =
          row.revoked ||
          Number(row.tick) !== m.tick ||
          row.player_id !== m.playerId ||
          (row.victim_id ?? null) !== m.victimId ||
          (row.weapon ?? null) !== m.weapon ||
          !sameDetail(row.detail, m.detail);
        if (!changed) {
          result.unchanged += 1;
          continue;
        }
        await client.query(
          `UPDATE cs2_moments SET round = $2, tick = $3, played_at = $4, player_id = $5, player_name = $6,
              victim_id = $7, victim_name = $8, weapon = $9, detail = $10, tournament_id = $11,
              tournament_name = $12, map_name = $13, revoked = FALSE, revoked_reason = NULL, ${BUMP}
            WHERE id = $1`,
          [id, ...values]
        );
        result.updated.push(id);
      }
      for (const [id, row] of existing) {
        if (seen.has(id) || row.revoked) continue;
        await client.query(
          `UPDATE cs2_moments SET revoked = TRUE, revoked_reason = $2, ${BUMP} WHERE id = $1`,
          [id, 'not found when the demo was read again']
        );
        result.revoked.push(id);
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  });
  return result;
}

/** Revoke every moment matching `where` (a match deleted, forgotten, or gone). */
async function revokeWhere(where: string, params: SqlValue[], reason: string): Promise<number> {
  return db.withClient(async (client) => {
    await client.query('BEGIN');
    try {
      await client.query(LOCK_SQL);
      const r = await client.query(
        `UPDATE cs2_moments SET revoked = TRUE, revoked_reason = $1, ${BUMP}
          WHERE NOT revoked AND (${where})`,
        [reason, ...params]
      );
      await client.query('COMMIT');
      return r.rowCount ?? 0;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  });
}

/** These matches are gone (their tournament was reset or deleted): their moments are revoked. */
export async function revokeMomentsOfSlugs(slugs: string[]): Promise<number> {
  if (slugs.length === 0) return 0;
  return revokeWhere('match_slug = ANY($2::text[])', [slugs], 'the match was deleted');
}

/** Moments of match rows that no longer exist (a match deleted on its own). */
export async function revokeOrphanMoments(): Promise<number> {
  // Runs with every demo worker claim: look before taking the lock.
  const any = await db.queryOneAsync<{ id: string }>(
    `SELECT id FROM cs2_moments h
      WHERE NOT revoked AND NOT EXISTS (SELECT 1 FROM matches m WHERE m.id = h.match_id) LIMIT 1`
  );
  if (!any) return 0;
  return revokeWhere(
    'NOT EXISTS (SELECT 1 FROM matches m WHERE m.id = cs2_moments.match_id)',
    [],
    'the match was deleted'
  );
}

/** Names from the analysis' players, then the replay's. */
export function namesOf(
  players: Record<string, { name?: string }> | undefined,
  replay: MomentReplay | undefined
): Map<string, string> {
  const names = new Map<string, string>();
  for (const p of replay?.players ?? []) if (p.id && p.name) names.set(p.id, p.name);
  for (const [id, p] of Object.entries(players ?? {}))
    if (p?.name && p.name !== id) names.set(id, p.name);
  return names;
}

/** Find and store one map's moments from its analysis and replay. */
export async function momentsFromAnalysis(
  job: DemoJob,
  analysis: {
    rounds: ReadonlyArray<MomentRound>;
    kills: ReadonlyArray<MomentKill>;
    players?: Record<string, { name?: string }>;
  },
  replay: MomentReplay | undefined
): Promise<{ found: FoundMoment[]; sync: SyncResult | null }> {
  const found = findMoments(analysis, replay);
  const lastTick = analysis.rounds.length
    ? Math.max(...analysis.rounds.map((r) => r.endTick))
    : undefined;
  const sync = await syncMapMoments(job, found, {
    names: namesOf(analysis.players, replay),
    lastTick,
    tickrate: replay?.tickrate,
  });
  return { found, sync };
}

export interface BackfillOptions {
  /** Only this match (slug). */
  match?: string;
  /** Only this tournament's matches (and played matches kept from it). */
  tournament?: number;
  /** Only imported matches. */
  imported?: boolean;
  /** Find the moments, store nothing. */
  dryRun?: boolean;
}

export interface BackfillResult {
  maps: number;
  skipped: Array<{ matchSlug: string; mapNumber: number; reason: string }>;
  found: Record<string, number>;
  created: number;
  updated: number;
  revoked: number;
  unchanged: number;
  /** The knife kills found (the first trophy), to check by eye. */
  knifeKills: Array<{
    matchSlug: string;
    mapNumber: number;
    round: number;
    tick: number;
    playerId: string;
    victimId: string | null;
  }>;
}

/**
 * Find the moments of maps analyzed before (or again, after a rule changed),
 * from the kill feeds and replays already stored: no demo is read again.
 * Maps whose analysis never finished are skipped and listed.
 */
export async function backfillMoments(opts: BackfillOptions = {}): Promise<BackfillResult> {
  const { REPLAYS_DIR } = await import('./jobs');
  const where: string[] = [];
  const params: SqlValue[] = [];
  if (opts.match) {
    where.push('j.match_slug = ?');
    params.push(opts.match);
  }
  if (opts.tournament !== undefined) {
    where.push('(m.tournament_id = ? OR m.played_in_id = ?)');
    params.push(opts.tournament, opts.tournament);
  }
  if (opts.imported) where.push("m.source = 'import'");
  const jobs = await db.queryAsync<{
    match_slug: string;
    map_number: number;
    status: string;
    rounds: string | null;
    kills: string | null;
    replay_path: string | null;
  }>(
    `SELECT j.match_slug, j.map_number, j.status, j.rounds, j.kills, j.replay_path
       FROM cs2_demo_jobs j JOIN matches m ON m.slug = j.match_slug
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY m.id, j.map_number`,
    params
  );
  const out: BackfillResult = {
    maps: 0,
    skipped: [],
    found: {},
    created: 0,
    updated: 0,
    revoked: 0,
    unchanged: 0,
    knifeKills: [],
  };
  if (!opts.dryRun) out.revoked += await revokeOrphanMoments();
  for (const j of jobs) {
    const job = { matchSlug: j.match_slug, mapNumber: Number(j.map_number) };
    let rounds: MomentRound[];
    let kills: MomentKill[];
    try {
      rounds = JSON.parse(j.rounds ?? 'null') as MomentRound[];
      kills = JSON.parse(j.kills ?? 'null') as MomentKill[];
    } catch {
      out.skipped.push({ ...job, reason: 'the stored analysis is not readable' });
      continue;
    }
    if (j.status !== 'done' || !Array.isArray(rounds) || !Array.isArray(kills)) {
      out.skipped.push({ ...job, reason: `the analysis is ${j.status}` });
      continue;
    }
    const replay = j.replay_path
      ? await readReplay(path.join(REPLAYS_DIR, j.replay_path))
      : undefined;
    const analysis = { rounds, kills };
    try {
      const { found, sync } = opts.dryRun
        ? { found: findMoments(analysis, replay), sync: null }
        : await momentsFromAnalysis(job, analysis, replay);
      out.maps += 1;
      for (const m of found) {
        out.found[m.kind] = (out.found[m.kind] ?? 0) + 1;
        if (m.kind === 'knife_kill') {
          out.knifeKills.push({
            ...job,
            round: m.round,
            tick: m.tick,
            playerId: m.playerId,
            victimId: m.victimId,
          });
        }
      }
      if (sync) {
        out.created += sync.created.length;
        out.updated += sync.updated.length;
        out.revoked += sync.revoked.length;
        out.unchanged += sync.unchanged;
      }
    } catch (error) {
      log.warn(`[MOMENTS] ${job.matchSlug} map ${job.mapNumber}: backfill failed`, {
        error: (error as Error).message,
      });
      out.skipped.push({ ...job, reason: (error as Error).message });
    }
  }
  return out;
}

// --- reading ---------------------------------------------------------------

export const LIST_MAX = 1000;
export const LIST_DEFAULT = 500;

export interface MomentQuery {
  /** Return changes after this cursor (a `nextCursor` from before); from the start without. */
  since?: string;
  limit?: number;
  tournament?: number;
  match?: string;
  kinds?: string[];
}

export interface IntegrationHighlight {
  id: string;
  kind: string;
  matchSlug: string;
  tournament: { id: number | null; name: string } | null;
  /** 1-based, like the webhooks' maps. */
  mapNumber: number;
  map: string | null;
  round: number;
  tick: number;
  playedAt: string | null;
  player: { steamId64: string; name: string | null };
  victim: { steamId64: string; name: string | null } | null;
  weapon: string | null;
  detail: JsonObject;
  clipUrl: string | null;
  replayUrl: string | null;
  imported: boolean;
  revoked: boolean;
  revokedReason: string | null;
  updatedAt: string;
}

const iso = (seconds: number | string | null) =>
  seconds === null ? null : new Date(Number(seconds) * 1000).toISOString();

/** Changes in `seq` order after the cursor, with each moment's clip when one was recorded. */
export async function listMoments(
  q: MomentQuery,
  origin: string | null
): Promise<{ highlights: IntegrationHighlight[]; nextCursor: string; hasMore: boolean }> {
  const limit = Math.max(1, Math.min(LIST_MAX, Math.floor(q.limit ?? LIST_DEFAULT)));
  const since = q.since && /^\d{1,18}$/.test(q.since) ? q.since : '0';
  const where = ['h.seq > ?'];
  const params: SqlValue[] = [since];
  if (q.tournament !== undefined) {
    where.push('h.tournament_id = ?');
    params.push(q.tournament);
  }
  if (q.match) {
    where.push('h.match_slug = ?');
    params.push(q.match);
  }
  if (q.kinds?.length) {
    where.push(`h.kind IN (${q.kinds.map(() => '?').join(', ')})`);
    params.push(...q.kinds);
  }
  params.push(limit + 1);
  const rows = await db.queryAsync<{
    id: string;
    seq: string;
    kind: string;
    match_slug: string;
    map_number: number;
    map_name: string | null;
    tournament_id: number | null;
    tournament_name: string | null;
    imported: boolean;
    round: number;
    tick: number;
    played_at: string | null;
    player_id: string;
    player_name: string | null;
    victim_id: string | null;
    victim_name: string | null;
    weapon: string | null;
    detail: string;
    revoked: boolean;
    revoked_reason: string | null;
    updated_at: string;
    clip_id: number | null;
  }>(
    `SELECT h.*, COALESCE(p.name, h.player_name) AS player_name,
            COALESCE(v.name, h.victim_name) AS victim_name,
            (SELECT c.id FROM cs2_highlights c
              WHERE NOT h.revoked AND c.match_slug = h.match_slug AND c.map_number = h.map_number
                AND c.player_id = h.player_id AND c.round = h.round
                AND c.status = 'done' AND c.clip_path IS NOT NULL
              ORDER BY (c.kill_ticks::jsonb @> to_jsonb(h.tick)) DESC, c.score DESC
              LIMIT 1) AS clip_id
       FROM cs2_moments h
       LEFT JOIN players p ON p.id = h.player_id
       LEFT JOIN players v ON v.id = h.victim_id
      WHERE ${where.join(' AND ')}
      ORDER BY h.seq
      LIMIT ?`,
    params
  );
  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);
  const link = (p: string) => (origin ? `${origin}${p}` : p);
  const highlights = page.map((r) => {
    let detail: JsonObject = {};
    try {
      detail = JSON.parse(r.detail) as JsonObject;
    } catch {
      // Stored by this module: always JSON.
    }
    return {
      id: r.id,
      kind: r.kind,
      matchSlug: r.match_slug,
      tournament:
        r.tournament_id !== null || r.tournament_name
          ? {
              id: r.tournament_id === null ? null : Number(r.tournament_id),
              name: r.tournament_name ?? '',
            }
          : null,
      mapNumber: Number(r.map_number) + 1,
      map: r.map_name,
      round: Number(r.round),
      tick: Number(r.tick),
      playedAt: iso(r.played_at),
      player: { steamId64: r.player_id, name: r.player_name },
      victim: r.victim_id ? { steamId64: r.victim_id, name: r.victim_name } : null,
      weapon: r.weapon,
      detail,
      clipUrl: r.clip_id === null ? null : link(`/watch/clip/${Number(r.clip_id)}`),
      replayUrl: r.revoked
        ? null
        : link(
            `/analysis/${encodeURIComponent(r.match_slug)}/${Number(r.map_number)}?round=${Number(r.round)}`
          ),
      imported: Boolean(r.imported),
      revoked: Boolean(r.revoked),
      revokedReason: r.revoked_reason,
      updatedAt: iso(r.updated_at)!,
    };
  });
  const nextCursor = page.length ? String(page[page.length - 1]!.seq) : since;
  return { highlights, nextCursor, hasMore };
}
