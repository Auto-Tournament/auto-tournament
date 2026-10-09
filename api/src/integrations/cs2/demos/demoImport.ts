/**
 * Import a match that was played somewhere else, from its demos.
 *
 * An admin uploads one demo per map (routes/demoImport.ts). The match is
 * created first with no teams, and each demo is stored and linked to its map
 * like a server's upload (utils/demoFiles.ts), which queues its analysis. When
 * a map's analysis comes back (jobs.ts `completeDemoJob`), `applyImportedMap`
 * fills in what only the demo knows: the two teams (their in-game names and
 * players, made on the platform when they are new), the map's score and, once
 * every map is in, the winner. From there the match is like any other played
 * match: stats, the 2D replay and the highlight recorder.
 *
 * `matches.source = 'import'`, status 'completed' from the start so nothing
 * ever tries to give it a server; `completed_at` is set when the last map is in.
 */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import fetch from 'node-fetch';
import { db } from '../../../config/database';
import { log } from '../../../utils/logger';
import { recordMapResult, getMapResults } from '../../../services/matchMapResultService';
import { settingsService } from '../../../services/settingsService';
import { DEMOS_DIR, ensureDemosDir, linkStoredDemo } from '../utils/demoFiles';
import type { DemoAnalysisPayload, DemoJob } from './jobs';

export const IMPORT_SOURCE = 'import';
export const IMPORT_MAX_MAPS = 5;

export class DemoImportError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
  }
}

interface ImportTeam {
  id?: string;
  name: string;
  players: Record<string, string>;
}

interface ImportConfig {
  team1: ImportTeam;
  team2: ImportTeam;
  num_maps: number;
  maplist: Array<string | null>;
  imported: true;
}

/** The analysis' teams (worker/analyze.go `TeamInfo`). */
export interface AnalysisTeam {
  name: string;
  startSide: string;
  score: number;
  players: string[];
}

const now = () => Math.floor(Date.now() / 1000);

/**
 * The map a CS2 demo was recorded on, from its file header: after the 16-byte
 * preamble ("PBDEMS2\0" and two offsets) comes the first command, the
 * header (varint command, tick and size), whose protobuf message
 * (CDemoFileHeader) has the map's name as field 5.
 */
export function mapFromDemoHeader(head: Buffer): string | null {
  let at = 16;
  const varint = (): number => {
    let value = 0;
    for (let shift = 0; shift < 35 && at < head.length; shift += 7) {
      const byte = head[at++];
      value += (byte & 0x7f) * 2 ** shift;
      if (byte < 0x80) return value;
    }
    return -1;
  };
  const command = varint();
  varint(); // tick
  const size = varint();
  if ((command & ~64) !== 1 || size <= 0) return null; // DEM_FileHeader, uncompressed
  const end = Math.min(head.length, at + size);
  while (at < end) {
    const key = varint();
    if (key < 0) return null;
    const field = Math.floor(key / 8);
    switch (key & 7) {
      case 0:
        varint();
        break;
      case 1:
        at += 8;
        break;
      case 5:
        at += 4;
        break;
      case 2: {
        const length = varint();
        if (length < 0) return null;
        if (field === 5) {
          const name = head.toString('utf8', at, at + length);
          return /^[a-z0-9_]{2,64}$/i.test(name) ? name.toLowerCase() : null;
        }
        at += length;
        break;
      }
      default:
        return null;
    }
  }
  return null;
}

/** Create the match an import fills in. `event`: where it was played (optional). */
export async function createImport(input: {
  event?: unknown;
  maps?: unknown;
}): Promise<{ slug: string }> {
  const maps = Number(input.maps);
  if (!Number.isInteger(maps) || maps < 1 || maps > IMPORT_MAX_MAPS) {
    throw new DemoImportError(400, `Upload 1 to ${IMPORT_MAX_MAPS} demos, one per map`);
  }
  const event = typeof input.event === 'string' ? input.event.trim().slice(0, 100) : '';
  const slug = `import-${crypto.randomBytes(5).toString('hex')}`;
  const config: ImportConfig = {
    team1: { name: 'Team 1', players: {} },
    team2: { name: 'Team 2', players: {} },
    num_maps: maps,
    maplist: Array.from({ length: maps }, () => null),
    imported: true,
  };
  await db.runAsync(
    `INSERT INTO matches (slug, tournament_id, played_in, round, match_number, config, game, source, status)
     VALUES (?, NULL, ?, 0, 0, ?, 'cs2', ?, 'completed')`,
    [slug, event || null, JSON.stringify(config), IMPORT_SOURCE]
  );
  log.info(`[IMPORT] Match ${slug} created for ${maps} demo(s)`);
  return { slug };
}

async function importConfig(slug: string): Promise<ImportConfig | null> {
  const row = await db.queryOneAsync<{ config: string; source: string | null }>(
    'SELECT config, source FROM matches WHERE slug = ?',
    [slug]
  );
  if (!row || row.source !== IMPORT_SOURCE) return null;
  try {
    return JSON.parse(row.config) as ImportConfig;
  } catch {
    return null;
  }
}

/** A demo larger than this is refused. */
export const IMPORT_MAX_BYTES = 2 * 1024 ** 3;

/**
 * Store a piece of one map's demo; the last piece links it, which queues its
 * analysis. Pieces come in order (`offset`: where this one starts, `total`:
 * the whole file's size), so an upload fits under a proxy's request limit
 * (Cloudflare's is 100 MB). `mapNumber` is 0-based. The map's name comes
 * from the demo's header.
 */
export async function storeImportedChunk(
  slug: string,
  mapNumber: number,
  offset: number,
  total: number,
  chunk: Buffer
): Promise<{ received: number; done: boolean; map: string | null }> {
  const config = await importConfig(slug);
  if (!config) throw new DemoImportError(404, 'No imported match with that id');
  if (!Number.isInteger(mapNumber) || mapNumber < 0 || mapNumber >= config.num_maps) {
    throw new DemoImportError(400, `Map number must be 0 to ${config.num_maps - 1}`);
  }
  if (!Number.isInteger(total) || total < 1024 || total > IMPORT_MAX_BYTES) {
    throw new DemoImportError(400, 'A demo is 1 KB to 2 GB');
  }
  if (
    !Buffer.isBuffer(chunk) ||
    chunk.length === 0 ||
    !Number.isInteger(offset) ||
    offset < 0 ||
    offset + chunk.length > total
  ) {
    throw new DemoImportError(400, 'Send the next piece of the .dem file as the request body');
  }
  ensureDemosDir();
  const folder = path.join(DEMOS_DIR, slug);
  fs.mkdirSync(folder, { recursive: true });
  const part = path.join(folder, `map${mapNumber + 1}.part`);
  if (offset === 0) {
    if (chunk.subarray(0, 8).toString('latin1') !== 'PBDEMS2\0') {
      throw new DemoImportError(400, 'That is not a CS2 demo');
    }
    fs.writeFileSync(part, chunk);
  } else {
    const have = fs.existsSync(part) ? fs.statSync(part).size : 0;
    if (have !== offset) {
      throw new DemoImportError(409, `Expected the piece at byte ${have}`);
    }
    fs.appendFileSync(part, chunk);
  }
  const received = offset + chunk.length;
  if (received < total) return { received, done: false, map: null };

  const fd = fs.openSync(part, 'r');
  const head = Buffer.alloc(Math.min(total, 64 * 1024));
  fs.readSync(fd, head, 0, head.length, 0);
  fs.closeSync(fd);
  const map = mapFromDemoHeader(head);
  const filename = `map${mapNumber + 1}${map ? `-${map}` : ''}.dem`;
  fs.renameSync(part, path.join(folder, filename));

  // The map's row, so the demo has somewhere to link; the score comes with
  // the analysis.
  await recordMapResult({
    matchSlug: slug,
    mapNumber,
    mapName: map,
    winnerTeam: null,
    completedAt: now(),
  });
  config.maplist[mapNumber] = map;
  await db.runAsync('UPDATE matches SET config = ? WHERE slug = ?', [JSON.stringify(config), slug]);
  await linkStoredDemo(slug, path.join(slug, filename), mapNumber, '[IMPORT]');
  log.info(`[IMPORT] ${slug} map ${mapNumber + 1}: ${map ?? 'unknown map'}, ${total} bytes`);
  return { received, done: true, map };
}

function overlap(a: Record<string, string>, ids: string[]): number {
  return ids.filter((id) => id in a).length;
}

/** The platform team for a demo team: one with the same name, else a new one. */
async function platformTeam(name: string, roster: Record<string, string>): Promise<string> {
  const existing = await db.queryOneAsync<{ id: string }>(
    'SELECT id FROM teams WHERE LOWER(name) = LOWER(?) ORDER BY created_at LIMIT 1',
    [name]
  );
  if (existing) return existing.id;
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40) || 'team';
  const id = `${base}-${crypto.randomBytes(3).toString('hex')}`;
  const players = Object.entries(roster).map(([steamId, playerName]) => ({
    steamId,
    name: playerName,
  }));
  await db.runAsync("INSERT INTO teams (id, name, players, game) VALUES (?, ?, ?, 'cs2')", [
    id,
    name.slice(0, 100),
    JSON.stringify(players),
  ]);
  log.info(`[IMPORT] Team "${name}" created (${id})`);
  return id;
}

/** Steam names and pictures by Steam ID, when a Steam Web API key is set. */
async function steamProfiles(
  ids: string[]
): Promise<Map<string, { name: string; avatar: string }>> {
  const out = new Map<string, { name: string; avatar: string }>();
  const key = await settingsService.getSteamApiKey().catch(() => null);
  if (!key || ids.length === 0) return out;
  try {
    const res = await fetch(
      `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v0002/?key=${encodeURIComponent(key)}&steamids=${ids.slice(0, 100).join(',')}`,
      { timeout: 10_000 }
    );
    const body = (await res.json()) as {
      response?: {
        players?: Array<{ steamid: string; personaname?: string; avatarfull?: string }>;
      };
    };
    for (const p of body.response?.players ?? []) {
      out.set(p.steamid, { name: p.personaname ?? '', avatar: p.avatarfull ?? '' });
    }
  } catch (error) {
    log.warn('[IMPORT] Could not read Steam profiles', { error: (error as Error).message });
  }
  return out;
}

/**
 * Players the demo names, under the name they play under there (a pro's
 * handle; their Steam name can be anything: the EWC 2026 final's zont1x was
 * "198572"), with their Steam picture. A player who never signed in takes the
 * demo's name again on every import; one who signed in keeps their own.
 */
async function ensurePlayers(roster: Record<string, string>): Promise<void> {
  const ids = Object.keys(roster);
  if (ids.length === 0) return;
  const known = new Map(
    (
      await db.queryAsync<{
        id: string;
        avatar_url: string | null;
        last_sign_in_at: number | null;
      }>(
        `SELECT id, avatar_url, last_sign_in_at FROM players WHERE id IN (${ids.map(() => '?').join(', ')})`,
        ids
      )
    ).map((r) => [r.id, r] as const)
  );
  for (const id of ids) {
    const row = known.get(id);
    const name = (roster[id] ?? '').trim();
    if (row && row.last_sign_in_at === null && name && name !== id) {
      await db.runAsync('UPDATE players SET name = ? WHERE id = ? AND last_sign_in_at IS NULL', [
        name.slice(0, 100),
        id,
      ]);
    }
  }
  const missing = ids.filter((id) => !known.get(id)?.avatar_url);
  if (missing.length === 0) return;
  const steam = await steamProfiles(missing);
  for (const id of missing) {
    const profile = steam.get(id);
    const demoName = (roster[id] ?? '').trim();
    await db.runAsync(
      `INSERT INTO players (id, name, avatar_url) VALUES (?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET avatar_url = COALESCE(players.avatar_url, EXCLUDED.avatar_url)`,
      [
        id,
        ((demoName && demoName !== id ? demoName : profile?.name) || id).slice(0, 100),
        profile?.avatar || null,
      ]
    );
  }
}

/**
 * A map of an imported match was analyzed: set its teams (the first map
 * analyzed decides which is team 1), the map's score and, with every map
 * in, the result. A no-op for any other match.
 */
export async function applyImportedMap(job: DemoJob, analysis: DemoAnalysisPayload): Promise<void> {
  const config = await importConfig(job.matchSlug);
  if (!config) return;
  const teams = (analysis as DemoAnalysisPayload & { teams?: AnalysisTeam[] }).teams ?? [];
  if (teams.length !== 2) {
    log.warn(
      `[IMPORT] ${job.matchSlug} map ${job.mapNumber + 1}: the analysis has no two teams; update the worker`
    );
    return;
  }
  const named = (t: AnalysisTeam): Record<string, string> =>
    Object.fromEntries(t.players.map((id) => [id, analysis.players[id]?.name ?? id]));

  // Which demo team is team 1: the one sharing most players with it.
  let [a, b] = teams;
  const known = Object.keys(config.team1.players).length > 0;
  if (
    known &&
    overlap(config.team1.players, b.players) > overlap(config.team1.players, a.players)
  ) {
    [a, b] = [b, a];
  }
  for (const [slot, t] of [
    ['team1', a],
    ['team2', b],
  ] as const) {
    const roster = { ...config[slot].players, ...named(t) };
    const fallback = `Team ${analysis.players[t.players[0]]?.name ?? slot.slice(-1)}`;
    const name = config[slot].id ? config[slot].name : t.name.trim() || fallback;
    await ensurePlayers(roster);
    const id = config[slot].id ?? (await platformTeam(name, roster));
    config[slot] = { id, name, players: roster };
  }
  config.maplist[job.mapNumber] = analysis.map || config.maplist[job.mapNumber];
  await db.runAsync('UPDATE matches SET config = ?, team1_id = ?, team2_id = ? WHERE slug = ?', [
    JSON.stringify(config),
    config.team1.id,
    config.team2.id,
    job.matchSlug,
  ]);

  const winner = a.score > b.score ? 'team1' : b.score > a.score ? 'team2' : 'none';
  await recordMapResult({
    matchSlug: job.matchSlug,
    mapNumber: job.mapNumber,
    mapName: analysis.map || null,
    team1Score: a.score,
    team2Score: b.score,
    winnerTeam: winner,
    completedAt: now(),
  });

  // Every map in: the series result.
  const results = await getMapResults(job.matchSlug);
  const done = results.filter((r) => r.winnerTeam !== null);
  if (done.length >= config.num_maps) {
    const won1 = done.filter((r) => r.winnerTeam === 'team1').length;
    const won2 = done.filter((r) => r.winnerTeam === 'team2').length;
    const winnerId = won1 > won2 ? config.team1.id : won2 > won1 ? config.team2.id : null;
    await db.runAsync(
      'UPDATE matches SET winner_id = ?, completed_at = COALESCE(completed_at, ?) WHERE slug = ?',
      [winnerId ?? null, now(), job.matchSlug]
    );
    log.info(
      `[IMPORT] ${job.matchSlug} imported: ${config.team1.name} ${won1}-${won2} ${config.team2.name}`
    );
  }
}

/** An import's progress, for the import page: each map's demo and analysis. */
export async function importStatus(slug: string) {
  const config = await importConfig(slug);
  if (!config) throw new DemoImportError(404, 'No imported match with that id');
  const jobs = await db.queryAsync<{ map_number: number; status: string; error: string | null }>(
    'SELECT map_number, status, error FROM cs2_demo_jobs WHERE match_slug = ? ORDER BY map_number',
    [slug]
  );
  const results = await getMapResults(slug);
  return {
    slug,
    team1: config.team1.name,
    team2: config.team2.name,
    maps: Array.from({ length: config.num_maps }, (_, i) => {
      const job = jobs.find((j) => Number(j.map_number) === i);
      const result = results.find((r) => r.mapNumber === i);
      return {
        mapNumber: i,
        map: config.maplist[i] ?? null,
        uploaded: !!result?.demoFilePath,
        analysis: job?.status ?? null,
        error: job?.error ?? null,
        team1Score: result?.winnerTeam ? result.team1Score : null,
        team2Score: result?.winnerTeam ? result.team2Score : null,
      };
    }),
  };
}
