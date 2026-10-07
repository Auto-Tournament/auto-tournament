/**
 * Highlights: each player's best moments of a map, picked from its analysis
 * (./jobs.ts), and the clip the recorder (worker/, `at-worker record`) makes
 * of each.
 *
 * A moment is one player's kills in one round, however far apart (the
 * recorder cuts out the wait between them). It scores by kill count (an ace far above a double), a
 * clutch (the last of their side alive against two or more, and the round
 * won), and flair
 * (wallbangs, through smoke, headshots, the round's opening kill). The best
 * six per player per map are kept, if they score at all: each is a clip of
 * its own, and the recorder joins them into the player's reel of the map.
 *
 * The clip runs from 3 s before the first kill to 1.5 s after the last
 * (the recorder plays on past it for the slow motion, which starts as the
 * last enemy dies).
 *
 * Funny moments are picked apart from those, up to two per player: a team
 * mate killed with a grenade or fire, dying to your own grenade, an enemy
 * killed by a flashbang, smoke or decoy hitting them, and a knife kill. They
 * go in the tournament reel, not in the player's or the match's reels.
 */

import fs from 'fs';
import path from 'path';
import { DATA_DIR } from '../../../config/dataDir';
import { db } from '../../../config/database';
import { log } from '../../../utils/logger';
import type { DemoAnalysisPayload } from './jobs';

export const HIGHLIGHTS_DIR = path.join(DATA_DIR, 'highlights');

const TICKRATE = 64;
const LEAD_TICKS = 3 * TICKRATE;
const TAIL_TICKS = Math.round(1.5 * TICKRATE);
const PER_PLAYER = 6;
/** Below this a moment isn't worth a clip (a plain single kill scores 10). */
const MIN_SCORE = 30;
const MULTI_BONUS = [0, 0, 25, 60, 120, 250];
const FUNNY_PER_PLAYER = 2;
/** Enough to beat MIN_SCORE: a funny moment is worth a clip on its own. */
const FUNNY_SCORE = 35;
const EXPLOSIVE = /^(HE Grenade|Molotov|Incendiary Grenade)$/i;
const IMPACT = /^(Flashbang|Smoke Grenade|Decoy Grenade)$/i;
const KNIFE = /^Knife/i;
/** A recording that went quiet this long is handed out again. */
const STALE_SECONDS = 30 * 60;
const MAX_ATTEMPTS = 3;

interface KillRow {
  tick: number;
  round: number;
  attacker: string | null;
  victim: string;
  weapon?: string;
  headshot?: boolean;
  penetrated?: boolean;
  throughSmoke?: boolean;
  attackerSide?: string | null;
  victimSide?: string | null;
  opening?: boolean;
}

export interface Moment {
  playerId: string;
  kind: string;
  score: number;
  round: number;
  startTick: number;
  endTick: number;
  slowmoTick: number;
  killTicks: number[];
  title: string;
}

/**
 * Pick the best moments of a map (pure: tested on its own), up to
 * `perPlayer` for each player (the `highlights_per_player` setting).
 */
export function pickMoments(analysis: Pick<DemoAnalysisPayload, 'kills' | 'rounds'>, perPlayer = PER_PLAYER): Moment[] {
  const kills = (analysis.kills as unknown as KillRow[])
    .filter((k) => k.attacker && k.attackerSide && k.attackerSide !== k.victimSide)
    .sort((a, b) => a.tick - b.tick);
  const all = (analysis.kills as unknown as KillRow[]).slice().sort((a, b) => a.tick - b.tick);
  const roundEnd = new Map(analysis.rounds.map((r) => [r.number, r.endTick]));

  // One player's kills in one round.
  const runs: KillRow[][] = [];
  const open = new Map<string, KillRow[]>();
  for (const k of kills) {
    const key = `${k.attacker}:${k.round}`;
    const run = open.get(key);
    if (run) run.push(k);
    else {
      const fresh = [k];
      runs.push(fresh);
      open.set(key, fresh);
    }
  }

  const moments: Moment[] = runs.map((run) => {
    const player = run[0]!.attacker!;
    const side = run[0]!.attackerSide;
    const first = run[0]!.tick;
    const last = run[run.length - 1]!.tick;
    let score = run.length * 10 + (MULTI_BONUS[Math.min(run.length, 5)] ?? 0);
    for (const k of run) {
      if (k.headshot) score += 5;
      if (k.penetrated) score += 15;
      if (k.throughSmoke) score += 15;
      if (k.opening) score += 5;
    }
    // Clutch: before the run, everyone else on their side in this round died,
    // and two or more enemies were still up.
    const inRound = all.filter((k) => k.round === run[0]!.round);
    const before = inRound.filter((k) => k.tick < first);
    const sideDead = new Set(before.filter((k) => k.victimSide === side).map((k) => k.victim));
    const mates = new Set(
      inRound
        .flatMap((k) => [
          k.attackerSide === side ? k.attacker : null,
          k.victimSide === side ? k.victim : null,
        ])
        .filter((id): id is string => !!id && id !== player)
    );
    const enemiesSeen = new Set(
      inRound
        .flatMap((k) => [
          k.attackerSide && k.attackerSide !== side ? k.attacker : null,
          k.victimSide && k.victimSide !== side ? k.victim : null,
        ])
        .filter((id): id is string => !!id)
    );
    const enemiesDownBefore = new Set(
      before.filter((k) => k.victimSide !== side).map((k) => k.victim)
    );
    const won = analysis.rounds.find((r) => r.number === run[0]!.round)?.winner === side;
    const clutch =
      won &&
      mates.size > 0 &&
      [...mates].every((m) => sideDead.has(m)) &&
      enemiesSeen.size - enemiesDownBefore.size >= 2;
    if (clutch) score += 40 * run.length;

    const n = run.length;
    const kind = n >= 5 ? 'ace' : n >= 2 ? `${n}k` : clutch ? 'clutch' : 'flair';
    const end = Math.min(last + TAIL_TICKS, roundEnd.get(run[0]!.round) ?? last + TAIL_TICKS);
    const start = Math.max(0, first - LEAD_TICKS);
    const weapons = [...new Set(run.map((k) => k.weapon).filter(Boolean))].slice(0, 2).join(' / ');
    return {
      playerId: player,
      kind,
      score,
      round: run[0]!.round,
      startTick: start,
      endTick: end,
      slowmoTick: last,
      killTicks: run.map((k) => k.tick),
      title: `${n === 5 ? 'Ace' : `${n} kill${n === 1 ? '' : 's'}`}${clutch ? ' clutch' : ''}${weapons ? ` · ${weapons}` : ''} · round ${run[0]!.round}`,
    };
  });

  // The best six per player that score enough.
  const byPlayer = new Map<string, Moment[]>();
  for (const m of moments.filter((m) => m.score >= MIN_SCORE).sort((a, b) => b.score - a.score)) {
    const list = byPlayer.get(m.playerId) ?? [];
    if (list.length < perPlayer) list.push(m);
    byPlayer.set(m.playerId, list);
  }
  return [...byPlayer.values()].flat().concat(funnyMoments(all, roundEnd));
}

/**
 * The funny ones, up to FUNNY_PER_PLAYER each: a team kill with a grenade or
 * fire, dying to your own (the analyzer gives no attacker then, so the clip
 * follows the victim), and a flashbang, smoke or decoy to an enemy's head.
 */
export function funnyMoments(kills: KillRow[], roundEnd: Map<number, number>): Moment[] {
  const out: Moment[] = [];
  const count = new Map<string, number>();
  for (const k of kills) {
    const weapon = k.weapon ?? '';
    let player: string | null = null;
    let what = '';
    if (k.attacker && k.attackerSide && k.attackerSide === k.victimSide && (EXPLOSIVE.test(weapon) || IMPACT.test(weapon))) {
      player = k.attacker;
      what = 'Team kill';
    } else if (!k.attacker && EXPLOSIVE.test(weapon)) {
      player = k.victim;
      what = 'Own grenade';
    } else if (k.attacker && k.attackerSide && k.attackerSide !== k.victimSide && IMPACT.test(weapon)) {
      player = k.attacker;
      what = `${weapon} to the face`;
    } else if (k.attacker && k.attackerSide && k.attackerSide !== k.victimSide && KNIFE.test(weapon)) {
      player = k.attacker;
      what = 'Knife kill';
    }
    if (!player || (count.get(player) ?? 0) >= FUNNY_PER_PLAYER) continue;
    count.set(player, (count.get(player) ?? 0) + 1);
    out.push({
      playerId: player,
      kind: 'funny',
      score: FUNNY_SCORE,
      round: k.round,
      startTick: Math.max(0, k.tick - LEAD_TICKS),
      endTick: Math.min(k.tick + TAIL_TICKS, roundEnd.get(k.round) ?? k.tick + TAIL_TICKS),
      slowmoTick: k.tick,
      killTicks: [k.tick],
      title: what.endsWith('to the face') || what === 'Knife kill' ? `${what} · round ${k.round}` : `${what} · ${weapon} · round ${k.round}`,
    });
  }
  return out;
}

/** Replace a map's not-yet-recorded highlights with a fresh pick. */
export async function saveMoments(
  matchSlug: string,
  mapNumber: number,
  moments: Moment[]
): Promise<void> {
  try {
    await db.runAsync(
      "DELETE FROM cs2_highlights WHERE match_slug = ? AND map_number = ? AND status IN ('pending', 'failed', 'skipped')",
      [matchSlug, mapNumber]
    );
    for (const m of moments) {
      await db.runAsync(
        `INSERT INTO cs2_highlights (match_slug, map_number, player_id, kind, score, round, start_tick, end_tick,
                                     slowmo_tick, kill_ticks, title)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (match_slug, map_number, player_id, start_tick) DO NOTHING`,
        [
          matchSlug,
          mapNumber,
          m.playerId,
          m.kind,
          m.score,
          m.round,
          m.startTick,
          m.endTick,
          m.slowmoTick,
          JSON.stringify(m.killTicks),
          m.title,
        ]
      );
    }
  } catch (error) {
    log.warn(`[HIGHLIGHTS] Could not save the moments of ${matchSlug} map ${mapNumber}`, {
      error: (error as Error).message,
    });
  }
}

export interface RecordMoment {
  id: number;
  kind: string;
  title: string;
  round: number;
  score: number;
  startTick: number;
  endTick: number;
  slowmoTick: number;
  killTicks: number[];
}

/** One player's moments on one map: the recorder plays the demo once for them. */
export interface RecordJob {
  matchSlug: string;
  mapNumber: number;
  mapName: string | null;
  playerId: string;
  playerName: string;
  /** The caption's match line: "Team A vs Team B · Tournament" (recorders before the animated card). */
  match: string;
  /** "Team A vs Team B", or what is known of it. */
  teams: string;
  /** The tournament, for the clip's corner tag; null for a match outside one. */
  tournament: string | null;
  /** Where in it the match was: "Semi-final", "Upper round 2"; null when it has no name. */
  stage: string | null;
  /** The player's avatar (absolute, or a path on this platform), for the caption. */
  avatarUrl: string | null;
  /** The Auto Tournament logo on each video (an admin can turn it off). */
  watermark: boolean;
  moments: RecordMoment[];
  /** This player's clips of the map that earlier jobs recorded (the reel joins them in on a retry). */
  doneClips: Array<{ id: number; startTick: number; url: string }>;
}

interface MomentRow {
  id: number;
  match_slug: string;
  map_number: number;
  player_id: string;
  kind: string;
  title: string;
  round: number;
  score: number;
  start_tick: number;
  end_tick: number;
  slowmo_tick: number;
  kill_ticks: string;
}

/**
 * A match's place in its tournament, for the clip's corner tag: the last
 * rounds of an elimination bracket by name, the rest by number.
 */
export function stageLabel(
  type: string | null,
  bracket: string | null,
  round: number | null,
  lastRound: number | null
): string | null {
  if (round === null) return null;
  if (bracket === 'GF' || bracket === 'GF_RESET') return 'Grand final';
  if (type === 'double_elimination') {
    const side = bracket === 'LB' ? 'Lower' : 'Upper';
    return round === lastRound ? `${side} final` : `${side} round ${round}`;
  }
  if (type === 'single_elimination' && lastRound !== null) {
    if (round === lastRound) return 'Final';
    if (round === lastRound - 1) return 'Semi-final';
    if (round === lastRound - 2) return 'Quarter-final';
  }
  return `Round ${round}`;
}

/** "Team A vs Team B · Tournament", with what is known of it. */
export function matchLine(team1: string | null, team2: string | null, tournament: string | null): string {
  const teams = team1 && team2 ? `${team1} vs ${team2}` : (team1 ?? team2 ?? '');
  return [teams, tournament ?? ''].filter(Boolean).join(' · ');
}

/**
 * Hand the recorder the player and map with the best moment not yet
 * recorded, with all of that player's moments there that are still waiting.
 */
export async function claimRecordJob(recorder: string): Promise<RecordJob | null> {
  const now = Math.floor(Date.now() / 1000);
  const waiting = "(status = 'pending' OR (status = 'recording' AND claimed_at < ?))";
  const best = await db.queryOneAsync<{ match_slug: string; map_number: number; player_id: string }>(
    `SELECT match_slug, map_number, player_id FROM cs2_highlights
      WHERE ${waiting} ORDER BY score DESC, id LIMIT 1`,
    [now - STALE_SECONDS]
  );
  if (!best) return null;
  const rows = await db.queryAsync<MomentRow>(
    `UPDATE cs2_highlights SET status = 'recording', recorder = ?, claimed_at = ?, attempts = attempts + 1
      WHERE id IN (SELECT id FROM cs2_highlights
                    WHERE match_slug = ? AND map_number = ? AND player_id = ? AND ${waiting}
                    FOR UPDATE SKIP LOCKED)
      RETURNING id, match_slug, map_number, player_id, kind, title, round, score, start_tick, end_tick, slowmo_tick, kill_ticks`,
    [recorder.slice(0, 120), now, best.match_slug, best.map_number, best.player_id, now - STALE_SECONDS]
  );
  if (rows.length === 0) return null; // another recorder took them first
  return jobFor(best.match_slug, Number(best.map_number), best.player_id, rows);
}

/**
 * Hand the recorder every waiting moment of the map with the best one, all
 * players: one CS2 session records the whole map (recorders from version 4).
 */
export async function claimMapJob(recorder: string): Promise<MapRecordJob | null> {
  const now = Math.floor(Date.now() / 1000);
  const waiting = "(status = 'pending' OR (status = 'recording' AND claimed_at < ?))";
  const best = await db.queryOneAsync<{ match_slug: string; map_number: number }>(
    `SELECT match_slug, map_number FROM cs2_highlights WHERE ${waiting} ORDER BY score DESC, id LIMIT 1`,
    [now - STALE_SECONDS]
  );
  if (!best) return null;
  const rows = await db.queryAsync<MomentRow>(
    `UPDATE cs2_highlights SET status = 'recording', recorder = ?, claimed_at = ?, attempts = attempts + 1
      WHERE id IN (SELECT id FROM cs2_highlights
                    WHERE match_slug = ? AND map_number = ? AND ${waiting}
                    FOR UPDATE SKIP LOCKED)
      RETURNING id, match_slug, map_number, player_id, kind, title, round, score, start_tick, end_tick, slowmo_tick, kill_ticks`,
    [recorder.slice(0, 120), now, best.match_slug, best.map_number, now - STALE_SECONDS]
  );
  if (rows.length === 0) return null;
  const byPlayer = new Map<string, MomentRow[]>();
  for (const r of rows) byPlayer.set(r.player_id, [...(byPlayer.get(r.player_id) ?? []), r]);
  const players: RecordJob[] = [];
  for (const [playerId, own] of byPlayer) {
    players.push(await jobFor(best.match_slug, Number(best.map_number), playerId, own));
  }
  return { kind: 'map', matchSlug: best.match_slug, mapNumber: Number(best.map_number), players };
}

/** A whole map's waiting moments, per player, for one CS2 session. */
export interface MapRecordJob {
  kind: 'map';
  matchSlug: string;
  mapNumber: number;
  players: RecordJob[];
}

/** One player's job: their moments on the map and everything their clips show. */
async function jobFor(matchSlug: string, mapNumber: number, playerId: string, rows: MomentRow[]): Promise<RecordJob> {
  const best = { match_slug: matchSlug, map_number: mapNumber, player_id: playerId };
  const extra = await db.queryOneAsync<{
    map_name: string | null;
    name: string | null;
    avatar_url: string | null;
    team1: string | null;
    team2: string | null;
    tournament: string | null;
    type: string | null;
    bracket: string | null;
    round: number | null;
    last_round: number | null;
  }>(
    `SELECT (SELECT map_name FROM cs2_demo_jobs WHERE match_slug = ? AND map_number = ?) AS map_name,
            (SELECT name FROM players WHERE id = ?) AS name,
            (SELECT avatar_url FROM players WHERE id = ?) AS avatar_url,
            t1.name AS team1, t2.name AS team2, COALESCE(tr.name, m.played_in) AS tournament,
            tr.type, m.bracket, m.round,
            (SELECT MAX(o.round) FROM matches o
              WHERE o.tournament_id = m.tournament_id AND COALESCE(o.bracket, 'WB') = COALESCE(m.bracket, 'WB')) AS last_round
       FROM (SELECT 1) one
       LEFT JOIN matches m ON m.slug = ?
       LEFT JOIN teams t1 ON t1.id = m.team1_id
       LEFT JOIN teams t2 ON t2.id = m.team2_id
       LEFT JOIN tournament tr ON tr.id = m.tournament_id`,
    [best.match_slug, best.map_number, best.player_id, best.player_id, best.match_slug]
  );
  const { settingsService } = await import('../../../services/settingsService');
  const watermark = (await settingsService.getSetting('highlights_watermark'))?.trim() !== '0';
  const done = await db.queryAsync<{ id: number; start_tick: number }>(
    `SELECT id, start_tick FROM cs2_highlights
      WHERE match_slug = ? AND map_number = ? AND player_id = ? AND status = 'done' AND kind <> 'funny'
      ORDER BY start_tick`,
    [best.match_slug, best.map_number, best.player_id]
  );
  return {
    matchSlug: best.match_slug,
    mapNumber: Number(best.map_number),
    mapName: extra?.map_name ?? null,
    playerId: best.player_id,
    playerName: extra?.name ?? best.player_id,
    avatarUrl: extra?.avatar_url ?? null,
    match: matchLine(extra?.team1 ?? null, extra?.team2 ?? null, extra?.tournament ?? null),
    teams: matchLine(extra?.team1 ?? null, extra?.team2 ?? null, null),
    tournament: extra?.tournament ?? null,
    stage: extra?.tournament
      ? stageLabel(
          extra.type,
          extra.bracket,
          extra.round === null ? null : Number(extra.round),
          extra.last_round === null ? null : Number(extra.last_round)
        )
      : null,
    watermark,
    moments: rows
      .map((r) => ({
        id: Number(r.id),
        kind: r.kind,
        title: r.title,
        round: Number(r.round),
        score: Number(r.score),
        startTick: Number(r.start_tick),
        endTick: Number(r.end_tick),
        slowmoTick: Number(r.slowmo_tick),
        killTicks: JSON.parse(r.kill_ticks) as number[],
      }))
      .sort((a, b) => a.startTick - b.startTick),
    doneClips: done.map((d) => ({
      id: Number(d.id),
      startTick: Number(d.start_tick),
      url: `/api/game/cs2/highlights/${Number(d.id)}.mp4`,
    })),
  };
}

export function clipFile(id: number): string {
  return path.join(HIGHLIGHTS_DIR, `${id}.mp4`);
}

/** Where a clip's kills and slow motion are, in seconds of the video (the player's scrubber). */
export interface ClipMarkers {
  duration: number;
  kills: number[];
  slowmo: [number, number] | null;
}

/** The recorder's `X-AT-Markers` header, checked; null when absent or wrong. */
export function parseMarkers(raw: unknown): ClipMarkers | null {
  if (typeof raw !== 'string' || raw.length > 4000) return null;
  try {
    const m = JSON.parse(raw) as Partial<ClipMarkers>;
    const num = (n: unknown) => typeof n === 'number' && Number.isFinite(n) && n >= 0;
    if (!num(m.duration) || !Array.isArray(m.kills) || !m.kills.every(num)) return null;
    const slowmo =
      Array.isArray(m.slowmo) && m.slowmo.length === 2 && m.slowmo.every(num) ? (m.slowmo as [number, number]) : null;
    const r = (n: number) => Math.round(n * 100) / 100;
    return { duration: r(m.duration!), kills: m.kills.slice(0, 30).map(r), slowmo: slowmo ? [r(slowmo[0]), r(slowmo[1])] : null };
  } catch {
    return null;
  }
}

/** The recorder's `X-AT-Clips` header: the highlight ids a reel joins, in order. */
export function parseClipIds(raw: unknown): number[] | null {
  if (typeof raw !== 'string' || !/^\d+(,\d+){0,63}$/.test(raw)) return null;
  return raw.split(',').map(Number);
}

/** Store a finished clip (an MP4 the recorder streamed up). */
export async function saveClip(id: number, body: NodeJS.ReadableStream, markers: ClipMarkers | null = null): Promise<number> {
  await fs.promises.mkdir(HIGHLIGHTS_DIR, { recursive: true });
  const file = clipFile(id);
  const tmp = `${file}.part`;
  await new Promise<void>((resolve, reject) => {
    const out = fs.createWriteStream(tmp);
    body.pipe(out);
    out.on('finish', () => resolve());
    out.on('error', reject);
    body.on('error', reject);
  });
  const { size } = await fs.promises.stat(tmp);
  await fs.promises.rename(tmp, file);
  await db.runAsync(
    "UPDATE cs2_highlights SET status = 'done', clip_path = ?, clip_bytes = ?, markers = ?, error = NULL WHERE id = ?",
    [path.basename(file), size, markers ? JSON.stringify(markers) : null, id]
  );
  await queueMatchReelFor([id]);
  return size;
}

/** The recorder could not record these moments: try again later, up to MAX_ATTEMPTS. */
export async function failRecordJob(ids: number[], error: string): Promise<void> {
  if (ids.length === 0) return;
  await db.runAsync(
    `UPDATE cs2_highlights SET status = CASE WHEN attempts >= ? THEN 'failed' ELSE 'pending' END, error = ?
      WHERE id IN (${ids.map(() => '?').join(', ')}) AND status = 'recording'`,
    [MAX_ATTEMPTS, error.slice(0, 500), ...ids]
  );
  await queueMatchReelFor(ids);
}

export function reelFile(matchSlug: string, mapNumber: number, playerId: string): string {
  const safe = `${matchSlug}-${mapNumber}-${playerId}`.replace(/[^A-Za-z0-9_.-]/g, '_');
  return path.join(HIGHLIGHTS_DIR, `reel-${safe}.mp4`);
}

/** Store a player's reel of a map (an MP4 the recorder streamed up). */
export async function saveReel(
  matchSlug: string,
  mapNumber: number,
  playerId: string,
  body: NodeJS.ReadableStream,
  clipIds: number[] | null = null
): Promise<number> {
  await fs.promises.mkdir(HIGHLIGHTS_DIR, { recursive: true });
  const file = reelFile(matchSlug, mapNumber, playerId);
  const tmp = `${file}.part`;
  await new Promise<void>((resolve, reject) => {
    const out = fs.createWriteStream(tmp);
    body.pipe(out);
    out.on('finish', () => resolve());
    out.on('error', reject);
    body.on('error', reject);
  });
  const { size } = await fs.promises.stat(tmp);
  await fs.promises.rename(tmp, file);
  const moments = await db.queryOneAsync<{ n: number | string }>(
    "SELECT COUNT(*) AS n FROM cs2_highlights WHERE match_slug = ? AND map_number = ? AND player_id = ? AND status = 'done'",
    [matchSlug, mapNumber, playerId]
  );
  await db.runAsync(
    `INSERT INTO cs2_highlight_reels (match_slug, map_number, player_id, moments, clip_path, clip_bytes, clip_ids)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (match_slug, map_number, player_id) DO UPDATE SET
       moments = EXCLUDED.moments, clip_path = EXCLUDED.clip_path, clip_bytes = EXCLUDED.clip_bytes,
       clip_ids = EXCLUDED.clip_ids, created_at = EXTRACT(EPOCH FROM NOW())::INTEGER`,
    [
      matchSlug,
      mapNumber,
      playerId,
      clipIds?.length ?? Number(moments?.n ?? 0),
      path.basename(file),
      size,
      clipIds ? JSON.stringify(clipIds) : null,
    ]
  );
  return size;
}

// ---------------------------------------------------------------------------
// Match reels: each player's best highlight of a map, one after the other
// ---------------------------------------------------------------------------

/** A match reel needs this many players with a recorded highlight. */
const MATCH_REEL_MIN_PLAYERS = 2;

/**
 * Queue the match reel of each map these highlights belong to, once none of
 * the map's highlights is still waiting to be recorded.
 */
export async function queueMatchReelFor(highlightIds: number[]): Promise<void> {
  if (highlightIds.length === 0) return;
  try {
    const maps = await db.queryAsync<{ match_slug: string; map_number: number }>(
      `SELECT DISTINCT match_slug, map_number FROM cs2_highlights
        WHERE id IN (${highlightIds.map(() => '?').join(', ')})`,
      highlightIds
    );
    for (const m of maps) {
      const state = await db.queryOneAsync<{ waiting: number | string; players: number | string }>(
        `SELECT COUNT(*) FILTER (WHERE status IN ('pending', 'recording')) AS waiting,
                COUNT(DISTINCT player_id) FILTER (WHERE status = 'done') AS players
           FROM cs2_highlights WHERE match_slug = ? AND map_number = ?`,
        [m.match_slug, m.map_number]
      );
      if (Number(state?.waiting ?? 1) > 0 || Number(state?.players ?? 0) < MATCH_REEL_MIN_PLAYERS) continue;
      await db.runAsync(
        `INSERT INTO cs2_match_reels (match_slug, map_number) VALUES (?, ?)
         ON CONFLICT (match_slug, map_number) DO UPDATE SET status = 'pending', attempts = 0, error = NULL
           WHERE cs2_match_reels.status IN ('failed')`,
        [m.match_slug, m.map_number]
      );
    }
  } catch (error) {
    log.warn('[HIGHLIGHTS] Could not queue a match reel', { error: (error as Error).message });
  }
}

export interface MatchReelClip {
  highlightId: number;
  playerId: string;
  playerName: string;
  team: string | null;
  avatarUrl: string | null;
  title: string;
  /** Where the recorder downloads it from (this platform). */
  url: string;
}

export interface MatchReelJob {
  kind: 'match_reel';
  matchSlug: string;
  mapNumber: number;
  match: string;
  watermark: boolean;
  clips: MatchReelClip[];
  /** Where the recorder sends the reel, and where it says it could not. */
  upload: string;
  fail: string;
}

/** Each player's best recorded highlight of a map, in the order they happened. */
export async function bestClipPerPlayer(matchSlug: string, mapNumber: number): Promise<MatchReelClip[]> {
  const rows = await db.queryAsync<{
    id: number;
    player_id: string;
    title: string;
    slowmo_tick: number;
    name: string | null;
    avatar_url: string | null;
    team: string | null;
  }>(
    `SELECT b.id, b.player_id, b.title, b.slowmo_tick, p.name, p.avatar_url,
            (SELECT t.name FROM matches m JOIN teams t ON t.id IN (m.team1_id, m.team2_id)
              WHERE m.slug = b.match_slug
                AND EXISTS (SELECT 1 FROM jsonb_array_elements(t.players::jsonb) e WHERE e->>'steamId' = b.player_id)
              LIMIT 1) AS team
       FROM (SELECT DISTINCT ON (player_id) id, player_id, title, slowmo_tick, match_slug
               FROM cs2_highlights
              WHERE match_slug = ? AND map_number = ? AND status = 'done' AND kind <> 'funny'
              ORDER BY player_id, score DESC, id) b
       LEFT JOIN players p ON p.id = b.player_id
      ORDER BY b.slowmo_tick`,
    [matchSlug, mapNumber]
  );
  return rows.map((r) => ({
    highlightId: Number(r.id),
    playerId: r.player_id,
    playerName: r.name ?? r.player_id,
    team: r.team,
    avatarUrl: r.avatar_url,
    title: r.title,
    url: `/api/game/cs2/highlights/${Number(r.id)}.mp4`,
  }));
}

/** Hand the recorder a match reel to join, if one is waiting. */
export async function claimMatchReel(recorder: string): Promise<MatchReelJob | null> {
  const now = Math.floor(Date.now() / 1000);
  const row = await db.queryOneAsync<{ match_slug: string; map_number: number }>(
    `UPDATE cs2_match_reels SET status = 'recording', recorder = ?, claimed_at = ?, attempts = attempts + 1
      WHERE (match_slug, map_number) = (
        SELECT match_slug, map_number FROM cs2_match_reels
         WHERE status = 'pending' OR (status = 'recording' AND claimed_at < ?)
         ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED)
      RETURNING match_slug, map_number`,
    [recorder.slice(0, 120), now, now - STALE_SECONDS]
  );
  if (!row) return null;
  const clips = await bestClipPerPlayer(row.match_slug, Number(row.map_number));
  const extra = await db.queryOneAsync<{ team1: string | null; team2: string | null; tournament: string | null }>(
    `SELECT t1.name AS team1, t2.name AS team2, COALESCE(tr.name, m.played_in) AS tournament
       FROM matches m
       LEFT JOIN teams t1 ON t1.id = m.team1_id
       LEFT JOIN teams t2 ON t2.id = m.team2_id
       LEFT JOIN tournament tr ON tr.id = m.tournament_id
      WHERE m.slug = ?`,
    [row.match_slug]
  );
  const { settingsService } = await import('../../../services/settingsService');
  return {
    kind: 'match_reel',
    matchSlug: row.match_slug,
    mapNumber: Number(row.map_number),
    match: matchLine(extra?.team1 ?? null, extra?.team2 ?? null, extra?.tournament ?? null),
    watermark: (await settingsService.getSetting('highlights_watermark'))?.trim() !== '0',
    clips,
    upload: `/api/game/cs2/recorder/match-reels/${encodeURIComponent(row.match_slug)}/${Number(row.map_number)}`,
    fail: `/api/game/cs2/recorder/match-reels/${encodeURIComponent(row.match_slug)}/${Number(row.map_number)}/fail`,
  };
}

export function matchReelFile(matchSlug: string, mapNumber: number): string {
  const safe = `${matchSlug}-${mapNumber}`.replace(/[^A-Za-z0-9_.-]/g, '_');
  return path.join(HIGHLIGHTS_DIR, `match-${safe}.mp4`);
}

/** Store a map's match reel (an MP4 the recorder streamed up). */
export async function saveMatchReel(
  matchSlug: string,
  mapNumber: number,
  clips: number,
  body: NodeJS.ReadableStream,
  clipIds: number[] | null = null
): Promise<number> {
  await fs.promises.mkdir(HIGHLIGHTS_DIR, { recursive: true });
  const file = matchReelFile(matchSlug, mapNumber);
  const tmp = `${file}.part`;
  await new Promise<void>((resolve, reject) => {
    const out = fs.createWriteStream(tmp);
    body.pipe(out);
    out.on('finish', () => resolve());
    out.on('error', reject);
    body.on('error', reject);
  });
  const { size } = await fs.promises.stat(tmp);
  await fs.promises.rename(tmp, file);
  await db.runAsync(
    `INSERT INTO cs2_match_reels (match_slug, map_number, status, clips, clip_path, clip_bytes, clip_ids)
     VALUES (?, ?, 'done', ?, ?, ?, ?)
     ON CONFLICT (match_slug, map_number) DO UPDATE SET status = 'done', error = NULL,
       clips = EXCLUDED.clips, clip_path = EXCLUDED.clip_path, clip_bytes = EXCLUDED.clip_bytes,
       clip_ids = EXCLUDED.clip_ids`,
    [matchSlug, mapNumber, clipIds?.length ?? clips, path.basename(file), size, clipIds ? JSON.stringify(clipIds) : null]
  );
  return size;
}

export async function failMatchReel(matchSlug: string, mapNumber: number, error: string): Promise<void> {
  await db.runAsync(
    `UPDATE cs2_match_reels SET status = CASE WHEN attempts >= ? THEN 'failed' ELSE 'pending' END, error = ?
      WHERE match_slug = ? AND map_number = ? AND status = 'recording'`,
    [MAX_ATTEMPTS, error.slice(0, 500), matchSlug, mapNumber]
  );
}

/**
 * A match's reels per map, and whether each is still being made: a map whose
 * highlights the recorder has not finished shows as `recording` before its
 * reel is even queued.
 */
export async function matchReels(matchSlug: string) {
  const rows = await db.queryAsync<{ map_number: number; status: string; clips: number | null; clip_path: string | null }>(
    `SELECT map_number, status, clips, clip_path FROM cs2_match_reels WHERE match_slug = ?
     UNION ALL
     SELECT DISTINCT h.map_number, 'recording'::text, NULL::integer, NULL::text FROM cs2_highlights h
      WHERE h.match_slug = ? AND h.status IN ('pending', 'recording')
        AND NOT EXISTS (SELECT 1 FROM cs2_match_reels r WHERE r.match_slug = h.match_slug AND r.map_number = h.map_number)
     ORDER BY map_number`,
    [matchSlug, matchSlug]
  );
  return rows.map((r) => ({
    mapNumber: Number(r.map_number),
    status: r.status,
    clips: r.clips === null ? null : Number(r.clips),
    video: r.status === 'done' && r.clip_path ? `/api/game/cs2/highlights/${encodeURIComponent(r.clip_path)}` : null,
  }));
}
