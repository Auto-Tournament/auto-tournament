/**
 * Demo analysis jobs: one per stored demo map (cs2_demo_jobs). The worker
 * container (worker/ in this repo) claims a job, downloads the demo, reads it
 * and reports back here; the numbers land in cs2_player_map_stats next to
 * what Ready Up sent live, and the 2D replay's frames in a gzip file under
 * DATA_DIR/demo-replays.
 *
 * A job is queued when a demo is linked to its map (../utils/demoFiles.ts),
 * and a claim with nothing queued picks up one stored demo that never had a
 * job, so older demos are analyzed too, one at a time.
 */

import fs from 'fs';
import path from 'path';
import { DATA_DIR } from '../../../config/dataDir';
import { db } from '../../../config/database';
import { log } from '../../../utils/logger';
import { atRating } from '../rating';
import { pickMoments, saveMoments } from './highlights';

/** Replays, under DATA_DIR so they survive container recreates. */
export const REPLAYS_DIR = path.join(DATA_DIR, 'demo-replays');
/** A running job whose worker went quiet this long is handed out again. */
const STALE_SECONDS = 15 * 60;
/** After this many failures a job stays failed. */
const MAX_ATTEMPTS = 3;

export interface DemoJob {
  matchSlug: string;
  mapNumber: number;
  /** The map's name as the platform knows it (de_mirage), for the worker. */
  mapName?: string | null;
}

/** The worker's per-player numbers (worker/stats.go `PlayerStats`). */
export interface DemoPlayerStats {
  name: string;
  roundsPlayed: number;
  kills: number;
  deaths: number;
  assists: number;
  damage: number;
  headshotKills: number;
  openingKills: number;
  openingDeaths: number;
  tradeKills: number;
  tradedDeaths: number;
  clutchesPlayed: number;
  clutchesWon: number;
  multiKills: number[];
  ctRounds: number;
  ctRoundsWon: number;
  tRounds: number;
  tRoundsWon: number;
  moneySpent: number;
  shots: number;
  hits: number;
  sprayShots: number;
  sprayHits: number;
  crosshairAngleSum: number;
  crosshairSamples: number;
  enemiesFlashed: number;
  friendliesFlashed: number;
  utilityDamage: number;
  kastRounds?: number;
  timeToDamageSum?: number;
  timeToDamageSamples?: number;
}

export interface DemoAnalysisPayload {
  analyzerVersion: number;
  map: string;
  rounds: Array<{
    number: number;
    startTick: number;
    endTick: number;
    winner: string | null;
    reason: string | null;
  }>;
  kills: Array<
    Record<string, unknown> & { round: number; attacker: string | null; victim: string }
  >;
  players: Record<string, DemoPlayerStats>;
}

const now = () => Math.floor(Date.now() / 1000);
const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/** Queue (or re-queue, for a new file) the analysis of a map's demo. */
export async function enqueueDemoJob(
  matchSlug: string,
  mapNumber: number,
  demoPath: string
): Promise<void> {
  try {
    await db.runAsync(
      `INSERT INTO cs2_demo_jobs (match_slug, map_number, demo_path) VALUES (?, ?, ?)
       ON CONFLICT (match_slug, map_number) DO UPDATE SET
         demo_path = EXCLUDED.demo_path, status = 'pending', attempts = 0, error = NULL
       WHERE cs2_demo_jobs.demo_path <> EXCLUDED.demo_path`,
      [matchSlug, mapNumber, demoPath]
    );
  } catch (error) {
    log.warn(`[DEMO-JOBS] Could not queue ${matchSlug} map ${mapNumber}`, {
      error: (error as Error).message,
    });
  }
}

/**
 * Hand the worker the oldest queued job (or one whose worker went quiet).
 * With nothing queued, queue one stored demo that never had a job.
 */
export async function claimDemoJob(worker: string, analyzerVersion = 0): Promise<DemoJob | null> {
  for (let pass = 0; pass < 3; pass += 1) {
    const row = await db.queryOneAsync<{ match_slug: string; map_number: number }>(
      `UPDATE cs2_demo_jobs SET status = 'running', worker = ?, claimed_at = ?, attempts = attempts + 1
        WHERE (match_slug, map_number) = (
          SELECT match_slug, map_number FROM cs2_demo_jobs
           WHERE status = 'pending' OR (status = 'running' AND claimed_at < ?)
           ORDER BY created_at, match_slug, map_number
           LIMIT 1 FOR UPDATE SKIP LOCKED)
        RETURNING match_slug, map_number`,
      [worker, now(), now() - STALE_SECONDS]
    );
    if (row) {
      const map = await db.queryOneAsync<{ map_name: string | null }>(
        'SELECT map_name FROM match_map_results WHERE match_slug = ? AND map_number = ?',
        [row.match_slug, row.map_number]
      );
      return {
        matchSlug: row.match_slug,
        mapNumber: Number(row.map_number),
        mapName: map?.map_name ?? null,
      };
    }
    if (pass > 1) break;
    // A stored demo that never had a job: per map, or (older uploads) on the
    // match, its map from the `mapN/` folder it was stored under.
    const unseen = await db.queryOneAsync<{
      match_slug: string;
      map_number: number;
      demo_file_path: string;
    }>(
      `SELECT match_slug, map_number, demo_file_path FROM (
         SELECT r.match_slug, r.map_number, r.demo_file_path, r.completed_at AS at
           FROM match_map_results r
          WHERE r.demo_file_path IS NOT NULL AND r.demo_file_path <> ''
         UNION ALL
         SELECT m.slug, COALESCE(NULLIF(substring(m.demo_file_path from 'map([0-9]+)/'), '')::int - 1, 0),
                m.demo_file_path, COALESCE(m.completed_at, 0)
           FROM matches m
          WHERE m.demo_file_path IS NOT NULL AND m.demo_file_path <> ''
       ) d
       WHERE NOT EXISTS (SELECT 1 FROM cs2_demo_jobs j WHERE j.match_slug = d.match_slug AND j.map_number = d.map_number)
       ORDER BY at DESC LIMIT 1`
    );
    if (unseen) {
      await enqueueDemoJob(unseen.match_slug, Number(unseen.map_number), unseen.demo_file_path);
      continue;
    }
    // Nothing new: read again, one at a time, a map an older worker analyzed.
    const stale = analyzerVersion
      ? await db.runAsync(
          `UPDATE cs2_demo_jobs SET status = 'pending', attempts = 0
            WHERE (match_slug, map_number) = (
              SELECT match_slug, map_number FROM cs2_demo_jobs
               WHERE status = 'done' AND COALESCE(analyzer_version, 0) < ?
               ORDER BY finished_at DESC NULLS LAST LIMIT 1)`,
          [analyzerVersion]
        )
      : null;
    if (!stale?.changes) return null;
  }
  return null;
}

/** The worker could not read the demo: try again later, or give up. */
export async function failDemoJob(job: DemoJob, error: string): Promise<void> {
  await db.runAsync(
    `UPDATE cs2_demo_jobs
        SET status = CASE WHEN attempts >= ? THEN 'failed' ELSE 'pending' END, error = ?, finished_at = ?
      WHERE match_slug = ? AND map_number = ?`,
    [MAX_ATTEMPTS, error.slice(0, 500), now(), job.matchSlug, job.mapNumber]
  );
}

export function replayFile(job: DemoJob): string {
  return path.join(REPLAYS_DIR, encodeURIComponent(job.matchSlug), `${job.mapNumber}.json.gz`);
}

/** Store the replay frames (gzip JSON, as the worker sent them). */
export async function saveReplay(job: DemoJob, gz: Buffer): Promise<void> {
  const file = replayFile(job);
  await fs.promises.mkdir(path.dirname(file), { recursive: true });
  await fs.promises.writeFile(file, gz);
  await db.runAsync(
    'UPDATE cs2_demo_jobs SET replay_path = ? WHERE match_slug = ? AND map_number = ?',
    [path.relative(REPLAYS_DIR, file), job.matchSlug, job.mapNumber]
  );
}

/**
 * Which team (team1/team2) each player of a match is on: the core's stat
 * rows, then the teams' rosters, then the match config's players.
 */
async function teamsOf(matchSlug: string): Promise<Map<string, 'team1' | 'team2'>> {
  const out = new Map<string, 'team1' | 'team2'>();
  const match = await db.queryOneAsync<{
    team1_id: string | null;
    team2_id: string | null;
    config: string | null;
  }>('SELECT team1_id, team2_id, config FROM matches WHERE slug = ?', [matchSlug]);
  try {
    const config = match?.config
      ? (JSON.parse(match.config) as Record<string, { players?: unknown }>)
      : {};
    for (const team of ['team1', 'team2'] as const) {
      const players = config[team]?.players;
      const ids = Array.isArray(players)
        ? players.map((p) => (typeof p === 'string' ? p : (p as { steamId?: string })?.steamId))
        : players && typeof players === 'object'
          ? Object.keys(players)
          : [];
      for (const id of ids) if (typeof id === 'string') out.set(id, team);
    }
  } catch {
    // A config without players leaves the rosters to the rows below.
  }
  for (const [team, id] of [
    ['team1', match?.team1_id],
    ['team2', match?.team2_id],
  ] as const) {
    if (!id) continue;
    const row = await db.queryOneAsync<{ players: string }>(
      'SELECT players FROM teams WHERE id = ?',
      [id]
    );
    try {
      for (const p of JSON.parse(row?.players ?? '[]') as Array<{ steamId?: string }>) {
        if (p.steamId) out.set(p.steamId, team);
      }
    } catch {
      // Malformed roster: nothing from it.
    }
  }
  for (const row of await db.queryAsync<{ player_id: string; team: string }>(
    'SELECT player_id, team FROM player_match_stats WHERE match_slug = ?',
    [matchSlug]
  )) {
    if (row.team === 'team1' || row.team === 'team2') out.set(row.player_id, row.team);
  }
  return out;
}

/** Apply a finished analysis: the players' numbers, the rounds and the kills. */
export async function completeDemoJob(job: DemoJob, analysis: DemoAnalysisPayload): Promise<void> {
  const teams = await teamsOf(job.matchSlug);
  // Players the match doesn't list: on the team their round-one side shares
  // with listed players.
  const firstSide = new Map<string, string>();
  for (const kill of analysis.kills) {
    for (const [id, side] of [
      [kill.attacker, kill.attackerSide],
      [kill.victim, kill.victimSide],
    ] as const) {
      if (typeof id === 'string' && typeof side === 'string' && !firstSide.has(id))
        firstSide.set(id, side);
    }
  }
  const teamForSide = new Map<string, 'team1' | 'team2'>();
  for (const [id, side] of firstSide) {
    const team = teams.get(id);
    if (team && !teamForSide.has(side)) teamForSide.set(side, team);
  }

  for (const [playerId, s] of Object.entries(analysis.players)) {
    if (!/^\d{17}$/.test(playerId)) continue;
    const team = teams.get(playerId) ?? teamForSide.get(firstSide.get(playerId) ?? '') ?? null;
    if (!team) continue;
    const multi = Array.isArray(s.multiKills) ? s.multiKills : [];
    // Numbers only the demo has: always the demo's.
    const demoOnly = {
      demo_analyzed: 1,
      traded_deaths: n(s.tradedDeaths),
      clutches_played: n(s.clutchesPlayed),
      utility_damage: n(s.utilityDamage),
      money_spent: n(s.moneySpent),
      shots: n(s.shots),
      hits: n(s.hits),
      spray_shots: n(s.sprayShots),
      spray_hits: n(s.sprayHits),
      crosshair_angle_sum: n(s.crosshairAngleSum),
      crosshair_samples: n(s.crosshairSamples),
      time_to_damage_sum: n(s.timeToDamageSum),
      time_to_damage_samples: n(s.timeToDamageSamples),
    };
    // Numbers Ready Up also sends live: the demo's only for a map without them.
    const both = {
      team,
      map_name: analysis.map,
      rounds_played: n(s.roundsPlayed),
      kills: n(s.kills),
      deaths: n(s.deaths),
      assists: n(s.assists),
      damage: n(s.damage),
      headshot_kills: n(s.headshotKills),
      entry_kills: n(s.openingKills),
      entry_deaths: n(s.openingDeaths),
      trade_kills: n(s.tradeKills),
      clutches_won: n(s.clutchesWon),
      enemies_flashed: n(s.enemiesFlashed),
      friendlies_flashed: n(s.friendliesFlashed),
      multi_1k: n(multi[0]),
      multi_2k: n(multi[1]),
      multi_3k: n(multi[2]),
      multi_4k: n(multi[3]),
      multi_5k: n(multi[4]),
      ct_rounds: n(s.ctRounds),
      ct_rounds_won: n(s.ctRoundsWon),
      t_rounds: n(s.tRounds),
      t_rounds_won: n(s.tRoundsWon),
      kast_rounds: n(s.kastRounds),
    };
    const cols = { ...both, ...demoOnly, source: 'demo' };
    const names = Object.keys(cols);
    const fleetKeeps = new Set([...Object.keys(both), 'source']);
    await db.runAsync(
      `INSERT INTO cs2_player_map_stats (match_slug, map_number, player_id, ${names.join(', ')})
       VALUES (?, ?, ?, ${names.map(() => '?').join(', ')})
       ON CONFLICT (match_slug, map_number, player_id) DO UPDATE SET
         ${names
           .map((c) =>
             fleetKeeps.has(c)
               ? `${c} = CASE WHEN cs2_player_map_stats.source = 'fleet' THEN cs2_player_map_stats.${c} ELSE EXCLUDED.${c} END`
               : `${c} = EXCLUDED.${c}`
           )
           .join(', ')}`,
      [job.matchSlug, job.mapNumber, playerId, ...Object.values(cols)]
    );
  }

  await db.runAsync(
    `UPDATE cs2_demo_jobs SET status = 'done', finished_at = ?, error = NULL, analyzer_version = ?,
        map_name = ?, rounds = ?, kills = ?
      WHERE match_slug = ? AND map_number = ?`,
    [
      now(),
      n(analysis.analyzerVersion),
      analysis.map,
      JSON.stringify(analysis.rounds ?? []),
      JSON.stringify(analysis.kills ?? []),
      job.matchSlug,
      job.mapNumber,
    ]
  );
  // The map's best moments, for the highlight recorder.
  await saveMoments(job.matchSlug, job.mapNumber, pickMoments(analysis));
  log.info(
    `[DEMO-JOBS] ${job.matchSlug} map ${job.mapNumber}: analyzed (${Object.keys(analysis.players).length} players)`
  );
}

/** The analysis of one map, for the match page: status, rounds and kills. */
export async function readDemoAnalysis(job: DemoJob) {
  const row = await db.queryOneAsync<{
    status: string;
    map_name: string | null;
    rounds: string | null;
    kills: string | null;
    replay_path: string | null;
    finished_at: number | null;
  }>(
    'SELECT status, map_name, rounds, kills, replay_path, finished_at FROM cs2_demo_jobs WHERE match_slug = ? AND map_number = ?',
    [job.matchSlug, job.mapNumber]
  );
  if (!row) return null;
  const parse = (v: string | null) => {
    try {
      return v ? (JSON.parse(v) as unknown[]) : [];
    } catch {
      return [];
    }
  };
  const players = await db.queryAsync<Record<string, unknown>>(
    `SELECT s.*, p.name AS player_name, p.avatar_url AS avatar
       FROM cs2_player_map_stats s LEFT JOIN players p ON p.id = s.player_id
      WHERE s.match_slug = ? AND s.map_number = ?
      ORDER BY s.team, s.kills DESC`,
    [job.matchSlug, job.mapNumber]
  );
  return {
    players: players.map((r) => playerLine(r)),
    status: row.status,
    map: row.map_name,
    rounds: parse(row.rounds),
    kills: parse(row.kills),
    hasReplay: Boolean(row.replay_path),
    analyzedAt: row.finished_at === null ? null : Number(row.finished_at),
  };
}

/** A player's line on the analyzer page, from their map row. */
function playerLine(r: Record<string, unknown>) {
  const rounds = n(Number(r.rounds_played));
  const num = (k: string) => n(Number(r[k]));
  return {
    id: String(r.player_id),
    name: (r.player_name as string | null) ?? String(r.player_id),
    avatar: (r.avatar as string | null) ?? null,
    team: r.team as string,
    rating: atRating({
      rounds_played: rounds,
      kills: num('kills'),
      deaths: num('deaths'),
      assists: num('assists'),
      damage: num('damage'),
      kast_rounds: num('kast_rounds'),
    }),
    kills: num('kills'),
    deaths: num('deaths'),
    assists: num('assists'),
    adr: rounds ? Math.round(num('damage') / rounds) : null,
    kast: rounds ? Math.round((num('kast_rounds') / rounds) * 100) : null,
    headshotPct: num('kills') ? Math.round((num('headshot_kills') / num('kills')) * 100) : null,
    openingKills: num('entry_kills'),
    openingDeaths: num('entry_deaths'),
    tradeKills: num('trade_kills'),
    tradedDeaths: num('traded_deaths'),
    clutchesWon: num('clutches_won'),
    clutchesPlayed: num('clutches_played'),
    multiKills: [num('multi_2k'), num('multi_3k'), num('multi_4k'), num('multi_5k')],
    utilityDamage: num('utility_damage'),
    enemiesFlashed: num('enemies_flashed'),
    friendliesFlashed: num('friendlies_flashed'),
    moneySpent: num('money_spent'),
    accuracy: num('shots') ? num('hits') / num('shots') : null,
    crosshairDegrees: num('crosshair_samples')
      ? Math.round((num('crosshair_angle_sum') / num('crosshair_samples')) * 10) / 10
      : null,
    timeToDamageMs: num('time_to_damage_samples')
      ? Math.round(num('time_to_damage_sum') / num('time_to_damage_samples'))
      : null,
  };
}
