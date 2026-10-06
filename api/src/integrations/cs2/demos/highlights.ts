/**
 * Highlights: each player's best moments of a map, picked from its analysis
 * (./jobs.ts), and the clip the recorder (worker/, `at-worker record`) makes
 * of each.
 *
 * A moment is a run of one player's kills in one round with at most 10 s
 * between them. It scores by kill count (an ace far above a double), a
 * clutch (the last of their side alive against two or more, and the round
 * won), and flair
 * (wallbangs, through smoke, headshots, the round's opening kill). The best
 * three per player per map are kept, if they score at all.
 *
 * The clip runs from 3 s before the first kill to 1.5 s after the last,
 * at most 10 s; its slow motion lands on the last kill.
 */

import fs from 'fs';
import path from 'path';
import { DATA_DIR } from '../../../config/dataDir';
import { db } from '../../../config/database';
import { log } from '../../../utils/logger';
import type { DemoAnalysisPayload } from './jobs';

export const HIGHLIGHTS_DIR = path.join(DATA_DIR, 'highlights');

const TICKRATE = 64;
const GAP_TICKS = 10 * TICKRATE;
const LEAD_TICKS = 3 * TICKRATE;
const TAIL_TICKS = Math.round(1.5 * TICKRATE);
const MAX_TICKS = 10 * TICKRATE;
const PER_PLAYER = 3;
/** Below this a moment isn't worth a clip (a plain single kill scores 10). */
const MIN_SCORE = 30;
const MULTI_BONUS = [0, 0, 25, 60, 120, 250];
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

/** Pick the best moments of a map (pure: tested on its own). */
export function pickMoments(analysis: Pick<DemoAnalysisPayload, 'kills' | 'rounds'>): Moment[] {
  const kills = (analysis.kills as unknown as KillRow[])
    .filter((k) => k.attacker && k.attackerSide && k.attackerSide !== k.victimSide)
    .sort((a, b) => a.tick - b.tick);
  const all = (analysis.kills as unknown as KillRow[]).slice().sort((a, b) => a.tick - b.tick);
  const roundEnd = new Map(analysis.rounds.map((r) => [r.number, r.endTick]));

  // Runs of one player's kills in one round, gaps of at most 10 s.
  const runs: KillRow[][] = [];
  const open = new Map<string, KillRow[]>();
  for (const k of kills) {
    const key = `${k.attacker}:${k.round}`;
    const run = open.get(key);
    if (run && k.tick - run[run.length - 1]!.tick <= GAP_TICKS) run.push(k);
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
    const start = Math.max(first - LEAD_TICKS, end - MAX_TICKS);
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

  // The best three per player that score enough.
  const byPlayer = new Map<string, Moment[]>();
  for (const m of moments.filter((m) => m.score >= MIN_SCORE).sort((a, b) => b.score - a.score)) {
    const list = byPlayer.get(m.playerId) ?? [];
    if (list.length < PER_PLAYER) list.push(m);
    byPlayer.set(m.playerId, list);
  }
  return [...byPlayer.values()].flat();
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

export interface RecordJob {
  id: number;
  matchSlug: string;
  mapNumber: number;
  mapName: string | null;
  playerId: string;
  playerName: string;
  kind: string;
  title: string;
  startTick: number;
  endTick: number;
  slowmoTick: number;
  killTicks: number[];
}

/** Hand the recorder the best moment not yet recorded. */
export async function claimRecordJob(recorder: string): Promise<RecordJob | null> {
  const now = Math.floor(Date.now() / 1000);
  const row = await db.queryOneAsync<{
    id: number;
    match_slug: string;
    map_number: number;
    player_id: string;
    kind: string;
    title: string;
    start_tick: number;
    end_tick: number;
    slowmo_tick: number;
    kill_ticks: string;
  }>(
    `UPDATE cs2_highlights SET status = 'recording', recorder = ?, claimed_at = ?, attempts = attempts + 1
      WHERE id = (SELECT id FROM cs2_highlights
                   WHERE status = 'pending' OR (status = 'recording' AND claimed_at < ?)
                   ORDER BY score DESC, id LIMIT 1 FOR UPDATE SKIP LOCKED)
      RETURNING id, match_slug, map_number, player_id, kind, title, start_tick, end_tick, slowmo_tick, kill_ticks`,
    [recorder.slice(0, 120), now, now - STALE_SECONDS]
  );
  if (!row) return null;
  const extra = await db.queryOneAsync<{ map_name: string | null; name: string | null }>(
    `SELECT (SELECT map_name FROM cs2_demo_jobs WHERE match_slug = ? AND map_number = ?) AS map_name,
            (SELECT name FROM players WHERE id = ?) AS name`,
    [row.match_slug, row.map_number, row.player_id]
  );
  return {
    id: Number(row.id),
    matchSlug: row.match_slug,
    mapNumber: Number(row.map_number),
    mapName: extra?.map_name ?? null,
    playerId: row.player_id,
    playerName: extra?.name ?? row.player_id,
    kind: row.kind,
    title: row.title,
    startTick: Number(row.start_tick),
    endTick: Number(row.end_tick),
    slowmoTick: Number(row.slowmo_tick),
    killTicks: JSON.parse(row.kill_ticks) as number[],
  };
}

export function clipFile(id: number): string {
  return path.join(HIGHLIGHTS_DIR, `${id}.mp4`);
}

/** Store a finished clip (an MP4 the recorder streamed up). */
export async function saveClip(id: number, body: NodeJS.ReadableStream): Promise<number> {
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
    "UPDATE cs2_highlights SET status = 'done', clip_path = ?, clip_bytes = ?, error = NULL WHERE id = ?",
    [path.basename(file), size, id]
  );
  return size;
}

export async function failRecordJob(id: number, error: string): Promise<void> {
  await db.runAsync(
    `UPDATE cs2_highlights SET status = CASE WHEN attempts >= ? THEN 'failed' ELSE 'pending' END, error = ?
      WHERE id = ?`,
    [MAX_ATTEMPTS, error.slice(0, 500), id]
  );
}

/** A player's finished highlights, best first, for their profile. */
export async function playerHighlights(playerId: string) {
  const rows = await db.queryAsync<{
    id: number;
    match_slug: string;
    map_number: number;
    kind: string;
    title: string;
    score: number;
    status: string;
    created_at: number;
    map_name: string | null;
  }>(
    `SELECT h.id, h.match_slug, h.map_number, h.kind, h.title, h.score, h.status, h.created_at, j.map_name
       FROM cs2_highlights h
       LEFT JOIN cs2_demo_jobs j ON j.match_slug = h.match_slug AND j.map_number = h.map_number
      WHERE h.player_id = ? AND h.status IN ('done', 'pending', 'recording')
      ORDER BY (h.status = 'done') DESC, h.score DESC, h.id DESC
      LIMIT 24`,
    [playerId]
  );
  return rows.map((r) => ({
    id: Number(r.id),
    matchSlug: r.match_slug,
    mapNumber: Number(r.map_number),
    map: r.map_name,
    kind: r.kind,
    title: r.title,
    score: Number(r.score),
    status: r.status,
    video: r.status === 'done' ? `/api/game/cs2/highlights/${r.id}.mp4` : null,
    createdAt: Number(r.created_at),
  }));
}
