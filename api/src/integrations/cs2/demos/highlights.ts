import { isShown } from './shown';
import {
  KEEP_LABEL_ON_CLAIM,
  keptLabelSql,
  recordingWaiting,
  recordingFailureSql,
  renewRecordingLeases,
} from './recorderLeases';
import { recordingTargetFilter } from './recorderFleet';
import { standInsFor } from './standIns';
/**
 * Highlights: each player's best moments of a map, picked from its analysis
 * (./jobs.ts), and the clip the recorder (worker/, `at-worker record`) makes
 * of each.
 *
 * A moment is one player's kills in one round, however far apart (the
 * recorder cuts out the wait between them). It scores by kill count (an ace far above a double), a
 * clutch (the last of their side alive against two or more, and the round
 * won), and flair
 * (wallbangs, through smoke, one-taps, flicks, snap shots, collaterals,
 * quick-scopes, denied defuses, headshots, the round's opening kill). The best
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

import {
  qualityLabel,
  readHighlightQuality,
  readReelLimits,
  type HighlightQuality,
} from './highlightQuality';
import { notificationService } from '../../../services/notificationService';
import { emitHighlightsChanged } from '../../../services/socketService';
import fs from 'fs';
import path from 'path';
import { DATA_DIR } from '../../../config/dataDir';
import { db } from '../../../config/database';
import { wakeRecorders } from './recorderLink';
import { reelFailoverFilter } from './reelFailover';
import { log } from '../../../utils/logger';
import type { DemoAnalysisPayload } from './jobs';
import { runRedressQueue } from './redressQueue';
import type { Untrusted } from '../../../utils/untrusted';
import type { MomentKill } from './moments';

export const HIGHLIGHTS_DIR = path.join(DATA_DIR, 'highlights');

const TICKRATE = 64;
const LEAD_TICKS = 3 * TICKRATE;
const TAIL_TICKS = Math.round(1.5 * TICKRATE);
const PER_PLAYER = 6;
/** Below this a moment isn't worth a clip (a plain single kill scores 10). */
const MIN_SCORE = 30;
/**
 * A 1v1 has one kill a round, so nothing reaches MIN_SCORE: there a headshot
 * on the round's first kill (20) is worth a clip, best ones first.
 */
const DUEL_MIN_SCORE = 20;

/** Two players in all, one a side (they swap sides at half): a 1v1 aim duel. */
export function isDuel(
  kills: ReadonlyArray<Pick<KillRow, 'attacker' | 'victim' | 'attackerSide' | 'victimSide'>>
): boolean {
  const perSide = new Map<string, Set<string>>();
  for (const k of kills) {
    for (const [id, side] of [
      [k.attacker, k.attackerSide],
      [k.victim, k.victimSide],
    ] as const) {
      if (!id || !side) continue;
      const set = perSide.get(side) ?? new Set<string>();
      set.add(id);
      perSide.set(side, set);
    }
  }
  const players = new Set([...perSide.values()].flatMap((s) => [...s]));
  return perSide.size > 0 && players.size <= 2;
}
const MULTI_BONUS = [0, 0, 25, 60, 120, 250];
const FUNNY_PER_PLAYER = 2;
/** Enough to beat MIN_SCORE: a funny moment is worth a clip on its own. */
const FUNNY_SCORE = 35;
const EXPLOSIVE = /^(HE Grenade|Molotov|Incendiary Grenade)$/i;
const IMPACT = /^(Flashbang|Smoke Grenade|Decoy Grenade)$/i;
const KNIFE = /^Knife/i;
/** A recording that went quiet this long is handed out again. */
export const MAX_ATTEMPTS = 3;

/** A kill of the analysis (worker/stats.go `Kill`). */
type KillRow = MomentKill;

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
  /** A won 1vX (pickMoments); the matchmaking budget keeps these when asked to. */
  clutch?: boolean;
}

/** Per round, the last tick a clip of it may reach: the next round's start, else its end plus a tail. */
export function roundStops(
  rounds: ReadonlyArray<{ number: number; endTick: number; startTick?: number }>
): Map<number, number> {
  const byNumber = new Map(rounds.map((r) => [r.number, r]));
  return new Map(
    rounds.map((r) => {
      const next = byNumber.get(r.number + 1)?.startTick;
      const stop = typeof next === 'number' && next > r.endTick ? next : r.endTick + 5 * TICKRATE;
      return [r.number, stop];
    })
  );
}

/**
 * Pick the best moments of a map (pure: tested on its own), up to
 * `perPlayer` for each player (the `highlights_per_player` setting).
 */
export function pickMoments(
  analysis: Pick<DemoAnalysisPayload, 'kills' | 'rounds'>,
  perPlayer = PER_PLAYER,
  funnyPerPlayer = FUNNY_PER_PLAYER
): Moment[] {
  const kills = analysis.kills
    .filter((k) => k.attacker && k.attackerSide && k.attackerSide !== k.victimSide)
    .sort((a, b) => a.tick - b.tick);
  const all = analysis.kills.slice().sort((a, b) => a.tick - b.tick);
  // How far a clip of a round may run: into the time after the round ends
  // (the game keeps playing until the next round starts), so a round-ending
  // kill still gets its tail and slow-mo. Capping at the round's end tick
  // cut such clips off on the kill (clip 250, 2026-10-12).
  const roundEnd = roundStops(analysis.rounds);

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
      if (k.noScope) score += 15;
      if (k.attackerBlind) score += 20;
      if (k.inAir) score += 10;
      if (k.oneTap) score += 10;
      if (k.flick) score += 10;
      if (k.snap) score += 5;
      if (k.collateral) score += 15;
      if (k.quickScope) score += 10;
      if (k.victimDefusing) score += 10;
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
      clutch,
      title: `${n === 5 ? 'Ace' : `${n} kill${n === 1 ? '' : 's'}`}${clutch ? ' clutch' : ''}${weapons ? ` · ${weapons}` : ''} · round ${run[0]!.round}`,
    };
  });

  // The best six per player that score enough.
  const byPlayer = new Map<string, Moment[]>();
  const minScore = isDuel(kills) ? DUEL_MIN_SCORE : MIN_SCORE;
  for (const m of moments.filter((m) => m.score >= minScore).sort((a, b) => b.score - a.score)) {
    const list = byPlayer.get(m.playerId) ?? [];
    if (list.length < perPlayer) list.push(m);
    byPlayer.set(m.playerId, list);
  }
  return [...byPlayer.values()].flat().concat(funnyMoments(all, roundEnd, funnyPerPlayer));
}

/**
 * The funny ones, up to FUNNY_PER_PLAYER each: a team kill with a grenade or
 * fire, dying to your own (the analyzer gives no attacker then, so the clip
 * follows the victim), and a flashbang, smoke or decoy to an enemy's head.
 */
export function funnyMoments(
  kills: KillRow[],
  roundEnd: Map<number, number>,
  perPlayer = FUNNY_PER_PLAYER
): Moment[] {
  const out: Moment[] = [];
  const count = new Map<string, number>();
  for (const k of kills) {
    const weapon = k.weapon ?? '';
    let player: string | null = null;
    let what = '';
    if (
      k.attacker &&
      k.attackerSide &&
      k.attackerSide === k.victimSide &&
      (EXPLOSIVE.test(weapon) || IMPACT.test(weapon))
    ) {
      player = k.attacker;
      what = 'Team kill';
    } else if (!k.attacker && EXPLOSIVE.test(weapon)) {
      player = k.victim;
      what = 'Own grenade';
    } else if (
      k.attacker &&
      k.attackerSide &&
      k.attackerSide !== k.victimSide &&
      IMPACT.test(weapon)
    ) {
      player = k.attacker;
      what = `${weapon} to the face`;
    } else if (
      k.attacker &&
      k.attackerSide &&
      k.attackerSide !== k.victimSide &&
      KNIFE.test(weapon)
    ) {
      player = k.attacker;
      what = 'Knife kill';
    }
    if (!player || (count.get(player) ?? 0) >= perPlayer) continue;
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
      title:
        what.endsWith('to the face') || what === 'Knife kill'
          ? `${what} · round ${k.round}`
          : `${what} · ${weapon} · round ${k.round}`,
    });
  }
  return out;
}

/** Where a pick of moments came from: the demo file, and the first round it plays. */
export interface MomentSource {
  demoPath: string;
  firstRound: number;
}

/**
 * Replace a map's not-yet-recorded highlights with a fresh pick.
 *
 * With `source`, a newer demo of the map (after a restart or a restore)
 * also replaces the clips an older demo gave for the rounds it plays again:
 * those are marked `superseded` (kept on disk, out of every list and reel)
 * and the map's and the series' reels are made again with the new clips.
 * Clips from the same demo, a retried analysis, are kept.
 */
export async function saveMoments(
  matchSlug: string,
  mapNumber: number,
  moments: Moment[],
  source?: MomentSource
): Promise<void> {
  try {
    await db.runAsync(
      "DELETE FROM cs2_highlights WHERE match_slug = ? AND map_number = ? AND status IN ('pending', 'failed', 'skipped')",
      [matchSlug, mapNumber]
    );
    if (source) {
      const replaced = await db.queryAsync<{ id: number }>(
        `UPDATE cs2_highlights SET status = 'superseded', error = 'the round was played again'
          WHERE match_slug = ? AND map_number = ? AND status IN ('done', 'recording')
            AND demo_path IS DISTINCT FROM ? AND round >= ?
          RETURNING id`,
        [matchSlug, mapNumber, source.demoPath, source.firstRound]
      );
      if (replaced.length) {
        log.info(
          `[HIGHLIGHTS] ${matchSlug} map ${mapNumber}: ${replaced.length} clip(s) from rounds played again replaced`
        );
        // The reels are made again once the new clips are recorded.
        const { redo } = await import('./clipsAdmin');
        await redo({
          reels: [
            { slug: matchSlug, mapNumber },
            { slug: matchSlug, mapNumber: SERIES_REEL },
          ],
        });
      }
    }
    for (const m of moments) {
      await db.runAsync(
        `INSERT INTO cs2_highlights (match_slug, map_number, player_id, kind, score, round, start_tick, end_tick,
                                     slowmo_tick, kill_ticks, title, demo_path)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
          source?.demoPath ?? null,
        ]
      );
    }
    // Open match pages show them as being recorded; linked recorders start now.
    emitHighlightsChanged(matchSlug);
    wakeRecorders();
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
  /** false: record without TrueView (the review's "weapon missing" redo). */
  trueView?: boolean;
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
  /** The player's own team and who they played, for the caption (null when unknown). */
  team: string | null;
  opponent: string | null;
  /** The tournament, for the clip's corner tag; null for a match outside one. */
  tournament: string | null;
  /** Where in it the match was: "Semi-final", "Upper round 2"; null when it has no name. */
  stage: string | null;
  /** The player's avatar (absolute, or a path on this platform), for the caption. */
  avatarUrl: string | null;
  moments: RecordMoment[];
  /** This player's clips of the map that earlier jobs recorded (the reel joins them in on a retry). */
  doneClips: Array<{ id: number; startTick: number; url: string; markers: ClipMarkers | null }>;
}

export interface MomentRow {
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
  /** 0: record without TrueView (an admin's "weapon missing"); 1 or absent: with. */
  true_view?: number;
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
  // Imported and manual matches are round 0: no stage, not "Round 0".
  if (round === null || round <= 0) return null;
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
export function matchLine(
  team1: string | null,
  team2: string | null,
  tournament: string | null
): string {
  const teams = team1 && team2 ? `${team1} vs ${team2}` : (team1 ?? team2 ?? '');
  return [teams, tournament ?? ''].filter(Boolean).join(' · ');
}

/**
 * Hand the recorder the player and map with the best moment not yet
 * recorded, with all of that player's moments there that are still waiting.
 */
/**
 * Lowering "clips per player per map" also applies to moments still waiting:
 * on this map, a player's moments past that many (best first) are skipped
 * before a recorder takes any. Funny moments keep their own count.
 */
async function trimToPerPlayer(matchSlug: string, mapNumber: number): Promise<void> {
  const { settingsService } = await import('../../../services/settingsService');
  const perPlayer = Number(await settingsService.getSetting('highlights_per_player')) || PER_PLAYER;
  await db.runAsync(
    `UPDATE cs2_highlights SET status = 'skipped', error = 'Past the clips per player setting'
      WHERE id IN (SELECT id FROM (SELECT id, status,
                                          ROW_NUMBER() OVER (PARTITION BY player_id ORDER BY score DESC, id) AS rank
                                     FROM cs2_highlights
                                    WHERE match_slug = ? AND map_number = ? AND kind <> 'funny') r
                    WHERE r.rank > ? AND r.status = 'pending')`,
    [matchSlug, mapNumber, perPlayer]
  );
}

export async function claimRecordJob(recorder: string): Promise<RecordJob | null> {
  const now = Math.floor(Date.now() / 1000);
  const failover = await reelFailoverFilter(recorder, 'cs2_highlights.match_slug');
  const waiting = `${recordingWaiting()} AND ${failover.sql}`;
  const best = await db.queryOneAsync<{
    match_slug: string;
    map_number: number;
    player_id: string;
  }>(
    `SELECT match_slug, map_number, player_id FROM cs2_highlights
      WHERE ${waiting} AND ${recordingTargetFilter('cs2_highlights.match_slug')} ORDER BY score DESC, id LIMIT 1`,
    [recorder.slice(0, 120), ...failover.params, recorder]
  );
  if (!best) return null;
  await trimToPerPlayer(best.match_slug, Number(best.map_number));
  const rows = await db.queryAsync<MomentRow>(
    `UPDATE cs2_highlights SET status = 'recording', recorder = ?, ${KEEP_LABEL_ON_CLAIM} made_with = ?, claimed_at = ?, claim_started_at = EXTRACT(EPOCH FROM NOW())::INTEGER, retry_until = NULL, attempts = attempts + 1
      WHERE id IN (SELECT id FROM cs2_highlights
                    WHERE match_slug = ? AND map_number = ? AND player_id = ? AND ${waiting}
                    FOR UPDATE SKIP LOCKED)
      RETURNING id, match_slug, map_number, player_id, kind, title, round, score, start_tick, end_tick, slowmo_tick, kill_ticks, true_view`,
    [
      recorder.slice(0, 120),
      qualityLabel(await readHighlightQuality()),
      now,
      best.match_slug,
      best.map_number,
      best.player_id,
      recorder.slice(0, 120),
      ...failover.params,
    ]
  );
  if (rows.length === 0) return null; // another recorder took them first
  return jobFor(best.match_slug, Number(best.map_number), best.player_id, rows);
}

/**
 * Recorders asking for work, by name, with when they last asked and found
 * none: a recorder that polls is idle (a busy one only asks again when it
 * is done). A map's players are shared among the idle recorders, so at a
 * LAN, where many maps finish at once, every recorder gets some.
 */
const idleRecorders = new Map<string, number>();
/** A recorder that has not asked for this long is busy or gone. */
const IDLE_WINDOW_MS = 90_000;

/** How many recorders are idle right now, `recorder` included. */
export function idleRecorderCount(recorder: string, nowMs = Date.now()): number {
  idleRecorders.set(recorder, nowMs);
  for (const [name, at] of idleRecorders) {
    if (nowMs - at > IDLE_WINDOW_MS) idleRecorders.delete(name);
  }
  return Math.max(1, idleRecorders.size);
}

/** The recorder took a job: it is busy until it asks again. */
export function recorderBusy(recorder: string): void {
  idleRecorders.delete(recorder);
}

/** How many of a map's `players` one of `idle` recorders takes: an even share, rounded up. */
export function playersPerRecorder(players: number, idle: number): number {
  return Math.max(1, Math.ceil(players / Math.max(1, idle)));
}

/**
 * The next player of a map for a recorder (pure: tested on its own): the
 * best waiting player, all of their waiting moments. `rows` are the map's
 * waiting moments, best player first and each player's best first. One player
 * a claim: a recorder keeps the map's demo loaded between jobs (the worker's
 * liveGame), so a faster recorder simply asks more often, and a map never
 * has more recorders on it than players waiting.
 */
export function nextPlayer(rows: { id: number; playerId: string }[]): number[] {
  const first = rows[0]?.playerId;
  return first === undefined ? [] : rows.filter((r) => r.playerId === first).map((r) => r.id);
}

/** The map a claim says the recorder has loaded, or null. */
export function loadedMapOf(raw: Untrusted): { matchSlug: string; mapNumber: number } | null {
  const l = raw as { matchSlug?: Untrusted; mapNumber?: Untrusted } | null | undefined;
  if (!l || typeof l.matchSlug !== 'string' || !l.matchSlug) return null;
  const mapNumber = Number(l.mapNumber);
  return Number.isInteger(mapNumber) && mapNumber >= 0
    ? { matchSlug: l.matchSlug.slice(0, 200), mapNumber }
    : null;
}

/**
 * Hand the recorder the next player of a map, recorded in the CS2 session it
 * keeps (recorders from version 4). The map is the one the recorder has
 * loaded while it has players waiting; otherwise the newest match's (a
 * tournament's before an imported one), so players see their clips soon
 * after their match, map by map. A recorder whose map has no one left
 * waiting gets the next map and loads it, while the others finish theirs.
 */
export async function claimMapJob(
  recorder: string,
  loaded: { matchSlug: string; mapNumber: number } | null = null
): Promise<MapRecordJob | null> {
  const now = Math.floor(Date.now() / 1000);
  const failover = await reelFailoverFilter(recorder, 'h.match_slug');
  const waiting = `${recordingWaiting('h')} AND ${failover.sql}`;
  // A moment this recorder gave back (its CS2 would not start) goes to
  // another recorder first (demos/recorders.ts recorderFault).
  // The map the recorder has loaded comes first while it has anyone waiting.
  const best = await db.queryOneAsync<{ match_slug: string; map_number: number }>(
    `SELECT h.match_slug, h.map_number FROM cs2_highlights h
       LEFT JOIN matches m ON m.slug = h.match_slug
      WHERE ${waiting} AND ${recordingTargetFilter('h.match_slug')}
      ORDER BY (h.avoid_recorder IS NOT NULL AND h.avoid_recorder = ?),
               (h.match_slug = ? AND h.map_number = ?) DESC,
               (m.tournament_id IS NOT NULL) DESC,
               (SELECT MAX(x.id) FROM cs2_highlights x WHERE x.match_slug = h.match_slug) DESC,
               h.map_number, h.score DESC, h.id
      LIMIT 1`,
    [
      recorder.slice(0, 120),
      ...failover.params,
      recorder,
      recorder.slice(0, 120),
      loaded?.matchSlug ?? '',
      loaded?.mapNumber ?? -2,
    ]
  );
  if (!best) return null;
  await trimToPerPlayer(best.match_slug, Number(best.map_number));
  const mapRows = await db.queryAsync<{ id: number; player_id: string }>(
    `SELECT id, player_id FROM cs2_highlights h WHERE match_slug = ? AND map_number = ? AND ${waiting}
      ORDER BY MAX(score) OVER (PARTITION BY player_id) DESC, player_id, score DESC, id`,
    [best.match_slug, best.map_number, recorder.slice(0, 120), ...failover.params]
  );
  const ids = nextPlayer(mapRows.map((r) => ({ id: Number(r.id), playerId: r.player_id })));
  if (ids.length === 0) return null;
  const quality = await readHighlightQuality();
  const rows = await db.queryAsync<MomentRow>(
    `UPDATE cs2_highlights SET status = 'recording', recorder = ?, ${KEEP_LABEL_ON_CLAIM} made_with = ?, claimed_at = ?, claim_started_at = EXTRACT(EPOCH FROM NOW())::INTEGER, retry_until = NULL, attempts = attempts + 1
      WHERE id IN (SELECT id FROM cs2_highlights h
                    WHERE id IN (${ids.map(() => '?').join(', ')}) AND ${waiting}
                    FOR UPDATE SKIP LOCKED)
      RETURNING id, match_slug, map_number, player_id, kind, title, round, score, start_tick, end_tick, slowmo_tick, kill_ticks, true_view`,
    [
      recorder.slice(0, 120),
      qualityLabel(quality),
      now,
      ...ids,
      recorder.slice(0, 120),
      ...failover.params,
    ]
  );
  if (rows.length === 0) return null;
  const byPlayer = new Map<string, MomentRow[]>();
  for (const r of rows) byPlayer.set(r.player_id, [...(byPlayer.get(r.player_id) ?? []), r]);
  const players: RecordJob[] = [];
  for (const [playerId, own] of byPlayer) {
    players.push(await jobFor(best.match_slug, Number(best.map_number), playerId, own));
  }
  const { settingsService } = await import('../../../services/settingsService');
  return {
    kind: 'map',
    matchSlug: best.match_slug,
    mapNumber: Number(best.map_number),
    quality,
    // Keep each clip's clean twin and overlay recipe (worker/overlay.go): reels
    // are then made from the clean clips with their own overlay, and the clips
    // can be dressed again. Off: roughly half the storage, reels join the
    // dressed clips.
    keepClean: (await settingsService.getSetting('highlights_keep_clean'))?.trim() !== '0',
    players,
    standIns: await standInsFor(best.match_slug),
  };
}

/** A whole map's waiting moments, per player, for one CS2 session. */
export interface MapRecordJob {
  kind: 'map';
  matchSlug: string;
  mapNumber: number;
  /** The size and frame rate to record at (the admin's highlight settings). */
  quality: HighlightQuality;
  /** Upload each clip's clean twin and overlay recipe too. */
  keepClean: boolean;
  players: RecordJob[];
  /** A simulated match: SteamID64 -> the roster name its bot plays under (standIns.ts). */
  standIns?: Record<string, string> | null;
}

/** One player's job: their moments on the map and everything their clips show. */
/** Whether a team's roster (teams.players, JSON) has this SteamID64. */
function onRoster(players: string | null | undefined, playerId: string): boolean {
  try {
    const list = JSON.parse(players ?? '[]') as Array<{ steamId?: string; steam_id?: string }>;
    return list.some((p) => String(p.steamId ?? p.steam_id ?? '') === playerId);
  } catch {
    return false;
  }
}

/** The player's team and the other one, by the rosters; nulls when on neither. */
function ownTeam(
  playerId: string,
  m: {
    team1: string | null;
    team2: string | null;
    team1_players: string | null;
    team2_players: string | null;
  } | null
): { team: string | null; opponent: string | null } {
  if (m && onRoster(m.team1_players, playerId)) return { team: m.team1, opponent: m.team2 };
  if (m && onRoster(m.team2_players, playerId)) return { team: m.team2, opponent: m.team1 };
  return { team: null, opponent: null };
}

export async function jobFor(
  matchSlug: string,
  mapNumber: number,
  playerId: string,
  rows: MomentRow[]
): Promise<RecordJob> {
  const best = { match_slug: matchSlug, map_number: mapNumber, player_id: playerId };
  const extra = await db.queryOneAsync<{
    map_name: string | null;
    name: string | null;
    avatar_url: string | null;
    team1: string | null;
    team2: string | null;
    team1_players: string | null;
    team2_players: string | null;
    tournament: string | null;
    type: string | null;
    bracket: string | null;
    round: number | null;
    last_round: number | null;
  }>(
    `SELECT (SELECT map_name FROM cs2_demo_jobs WHERE match_slug = ? AND map_number = ?) AS map_name,
            (SELECT name FROM players WHERE id = ?) AS name,
            (SELECT avatar_url FROM players WHERE id = ?) AS avatar_url,
            t1.name AS team1, t2.name AS team2, t1.players AS team1_players, t2.players AS team2_players,
            COALESCE(tr.name, m.played_in) AS tournament, tr.type, m.bracket, m.round,
            (SELECT MAX(o.round) FROM matches o
              WHERE o.tournament_id = m.tournament_id AND COALESCE(o.bracket, 'WB') = COALESCE(m.bracket, 'WB')) AS last_round
       FROM (SELECT 1) one
       LEFT JOIN matches m ON m.slug = ?
       LEFT JOIN teams t1 ON t1.id = m.team1_id
       LEFT JOIN teams t2 ON t2.id = m.team2_id
       LEFT JOIN tournament tr ON tr.id = m.tournament_id`,
    [best.match_slug, best.map_number, best.player_id, best.player_id, best.match_slug]
  );
  const done = await db.queryAsync<{ id: number; start_tick: number; markers: string | null }>(
    `SELECT id, start_tick, markers FROM cs2_highlights
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
    ...ownTeam(best.player_id, extra ?? null),
    tournament: extra?.tournament ?? null,
    stage: extra?.tournament
      ? stageLabel(
          extra.type,
          extra.bracket,
          extra.round === null ? null : Number(extra.round),
          extra.last_round === null ? null : Number(extra.last_round)
        )
      : null,
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
        ...(Number(r.true_view ?? 1) === 0 ? { trueView: false } : {}),
      }))
      .sort((a, b) => a.startTick - b.startTick),
    doneClips: done.map((d) => ({
      id: Number(d.id),
      startTick: Number(d.start_tick),
      url: `/api/game/cs2/highlights/${Number(d.id)}.mp4`,
      markers: parseMarkers(d.markers),
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
  /** The kills the crowd reacts to (seconds in, how impressive): the reel's crowd track. */
  reactions?: { t: number; score: number; aww?: boolean }[];
  /** For each of `kills`, whether it was a headshot (absent: not known). */
  headshots?: boolean[];
  /**
   * The clip itself starts this far into its clean twin (worker/standalone.go:
   * on its own it skips the caption card's opening). The times above are the
   * twin's, which reels are joined from; `markersOnItsOwn` shifts them.
   */
  start?: number;
}

/** A clip's markers as the clip itself plays (from `start` into its clean twin). */
export function markersOnItsOwn(m: ClipMarkers | null): ClipMarkers | null {
  if (!m || !m.start) return m;
  const at = m.start;
  const r = (n: number) => Math.round(n * 100) / 100;
  const reactions = (m.reactions ?? [])
    .filter((x) => x.t >= at)
    .map((x) => ({ ...x, t: r(x.t - at) }));
  const kept = m.kills.map((k) => k >= at);
  return {
    duration: r(Math.max(0, m.duration - at)),
    kills: m.kills.filter((_k, i) => kept[i]).map((k) => r(k - at)),
    slowmo: m.slowmo ? [r(Math.max(0, m.slowmo[0] - at)), r(Math.max(0, m.slowmo[1] - at))] : null,
    ...(reactions.length ? { reactions } : {}),
    ...(m.headshots ? { headshots: m.headshots.filter((_h, i) => kept[i]) } : {}),
  };
}

/** The recorder's `X-AT-Markers` header, checked; null when absent or wrong. */
export function parseMarkers(raw: Untrusted): ClipMarkers | null {
  if (typeof raw !== 'string' || raw.length > 4000) return null;
  try {
    const m = JSON.parse(raw) as Partial<ClipMarkers>;
    const num = (n: Untrusted) => typeof n === 'number' && Number.isFinite(n) && n >= 0;
    if (!num(m.duration) || !Array.isArray(m.kills) || !m.kills.every(num)) return null;
    const slowmo =
      Array.isArray(m.slowmo) && m.slowmo.length === 2 && m.slowmo.every(num)
        ? (m.slowmo as [number, number])
        : null;
    const r = (n: number) => Math.round(n * 100) / 100;
    const reactions = Array.isArray(m.reactions)
      ? m.reactions
          .filter((x) => x && num(x.t) && num(x.score))
          .slice(0, 30)
          .map((x) => ({ t: r(x.t), score: r(x.score), ...(x.aww === true ? { aww: true } : {}) }))
      : [];
    const start = num(m.start) && m.start! < m.duration! ? r(m.start!) : 0;
    const kills = m.kills.slice(0, 30);
    const headshots =
      Array.isArray(m.headshots) &&
      m.headshots.length === m.kills.length &&
      m.headshots.every((h) => typeof h === 'boolean')
        ? (m.headshots.slice(0, 30) as boolean[])
        : null;
    return {
      duration: r(m.duration!),
      kills: kills.map(r),
      slowmo: slowmo ? [r(slowmo[0]), r(slowmo[1])] : null,
      ...(reactions.length ? { reactions } : {}),
      ...(headshots ? { headshots } : {}),
      ...(start > 0 ? { start } : {}),
    };
  } catch {
    return null;
  }
}

/** The recorder's `X-AT-Clips` header: the highlight ids a reel joins, in order. */
export function parseClipIds(raw: Untrusted): number[] | null {
  if (typeof raw !== 'string' || !/^\d+(,\d+){0,63}$/.test(raw)) return null;
  return raw.split(',').map(Number);
}

/**
 * The recorder's `X-AT-Starts` header: where each clip of `X-AT-Clips` starts
 * in the reel, in seconds (after its intro, across its joins).
 */
export function parseClipStarts(raw: Untrusted, clips: number): number[] | null {
  if (typeof raw !== 'string' || !/^\d+(\.\d+)?(,\d+(\.\d+)?){0,63}$/.test(raw)) return null;
  const starts = raw.split(',').map(Number);
  if (
    starts.length !== clips ||
    starts.some((s, i) => !(s < 36_000) || (i > 0 && s < starts[i - 1]!))
  )
    return null;
  return starts.map((s) => Math.round(s * 100) / 100);
}

/** Store a finished clip (an MP4 the recorder streamed up). */
export async function saveClip(
  id: number,
  body: NodeJS.ReadableStream,
  markers: ClipMarkers | null = null,
  recordSeconds: number | null = null
): Promise<number> {
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
  await removeTwins(file);
  await db.runAsync(
    `UPDATE cs2_highlights SET status = 'done', clip_path = ?, clip_bytes = ?, markers = ?, error = NULL,
            review = NULL, review_note = NULL, reviewed_by = NULL, reviewed_at = NULL,
            record_seconds = ?, done_at = ? WHERE id = ?`,
    [
      path.basename(file),
      size,
      markers ? JSON.stringify(markers) : null,
      recordSeconds,
      Math.floor(Date.now() / 1000),
      id,
    ]
  );
  await queueMatchReelFor([id]);
  await noticeHighlightReady(id);
  const owner = await db.queryOneAsync<{ match_slug: string }>(
    'SELECT match_slug FROM cs2_highlights WHERE id = ?',
    [id]
  );
  if (owner) emitHighlightsChanged(owner.match_slug);
  return size;
}

/**
 * A recorder at a job says it still is (worker/runlog.go heartbeat): what it
 * claimed stays its own until the job deadline. Every claimed clip or reel
 * needs a heartbeat within the lease window; a heartbeat cannot extend the
 * absolute deadline.
 */
export async function renewClaims(recorder: string): Promise<number> {
  return renewRecordingLeases(recorder);
}

/**
 * Tell the player their clip is ready (a player's own moment; reels belong to
 * no one player), and the players it shows with them: on a killfeed line of
 * the clip's player inside the clip (killed by them, assisted them, killed
 * them). Someone elsewhere on the map at the time is not in it.
 */
async function noticeHighlightReady(id: number): Promise<void> {
  const row = await db.queryOneAsync<{
    player_id: string;
    title: string;
    kind: string;
    match_slug: string;
    map_number: number;
    start_tick: number;
    end_tick: number;
  }>(
    'SELECT player_id, title, kind, match_slug, map_number, start_tick, end_tick FROM cs2_highlights WHERE id = ?',
    [id]
  );
  if (!row || !/^\d{15,20}$/.test(row.player_id)) return;
  const data = {
    highlightId: id,
    title: row.title,
    kind: row.kind,
    matchSlug: row.match_slug,
    // Where the notice opens (the clip's watch page) and its still.
    url: `/watch/clip/${id}`,
    video: `/api/game/cs2/highlights/${id}.mp4`,
  };
  await notificationService.notify(row.player_id, 'highlight', data, `highlight:${id}`);

  const featured = await clipFeatures(row);
  if (featured.size === 0) return;
  const owner = await db.queryOneAsync<{ name: string | null }>(
    'SELECT name FROM players WHERE id = ?',
    [row.player_id]
  );
  for (const [playerId, role] of featured) {
    await notificationService.notify(
      playerId,
      'highlight',
      { ...data, role, by: row.player_id, byName: owner?.name ?? null },
      `highlight:${id}`
    );
  }
}

/** Who else a clip shows, and how: the other names on its player's killfeed lines inside it. */
async function clipFeatures(row: {
  player_id: string;
  match_slug: string;
  map_number: number;
  start_tick: number;
  end_tick: number;
}): Promise<Map<string, 'victim' | 'assist' | 'killer'>> {
  const out = new Map<string, 'victim' | 'assist' | 'killer'>();
  const job = await db.queryOneAsync<{ kills: string | null }>(
    'SELECT kills FROM cs2_demo_jobs WHERE match_slug = ? AND map_number = ?',
    [row.match_slug, row.map_number]
  );
  let kills: Array<KillRow & { assister?: string | null }> = [];
  try {
    kills = job?.kills ? JSON.parse(job.kills) : [];
  } catch {
    return out;
  }
  const add = (who: string | null | undefined, role: 'victim' | 'assist' | 'killer') => {
    if (!who || who === row.player_id || !/^\d{15,20}$/.test(who) || out.has(who)) return;
    out.set(who, role);
  };
  for (const k of kills) {
    if (k.tick < row.start_tick || k.tick > row.end_tick) continue;
    if (k.attacker === row.player_id) {
      add(k.victim, 'victim');
      add(k.assister, 'assist');
    } else if (k.victim === row.player_id) {
      add(k.attacker, 'killer');
    }
  }
  return out;
}

/** The recorder could not record these moments: try again later, up to MAX_ATTEMPTS. */
export async function failRecordJob(ids: number[], error: string): Promise<void> {
  if (ids.length === 0) return;
  await db.runAsync(
    `UPDATE cs2_highlights SET ${recordingFailureSql}${keptLabelSql('cs2_highlights')}
      WHERE id IN (${ids.map(() => '?').join(', ')}) AND status = 'recording'`,
    [error.slice(0, 500), ...ids]
  );
  await queueMatchReelFor(ids);
  // Open match pages count it as no longer being recorded.
  const slugs = await db.queryAsync<{ match_slug: string }>(
    `SELECT DISTINCT match_slug FROM cs2_highlights WHERE id IN (${ids.map(() => '?').join(', ')})`,
    ids
  );
  for (const r of slugs) emitHighlightsChanged(r.match_slug);
}

/**
 * What the recorder keeps next to a clip or reel (worker/overlay.go): its crowd
 * track (reels), its clean twin (as recorded: no caption card, kill feed or
 * logo) and its overlay's recipe, from which the dressed video can be made
 * again. Each arrives after the video itself; a new video drops the old ones.
 */
export type VideoTwin = 'crowd' | 'clean' | 'overlay';

const TWIN_SUFFIX: Record<VideoTwin, string> = {
  crowd: '.crowd.m4a',
  clean: '.clean.mp4',
  overlay: '.overlay.json',
};

export const TWIN_CONTENT_TYPE: Record<VideoTwin, string> = {
  crowd: 'audio/mp4',
  clean: 'video/mp4',
  overlay: 'application/json',
};

export function twinFileOf(video: string, twin: VideoTwin): string {
  return video.replace(/\.mp4$/, TWIN_SUFFIX[twin]);
}

/** Where a reel's crowd track (the recorder's, uploaded after it) is kept: next to it. */
export function crowdFileOf(reel: string): string {
  return twinFileOf(reel, 'crowd');
}

/**
 * A lower quality the recorder cut from a video (its highest), kept next to it
 * as `<video>.<height>p<fps>.mp4`: "1080p120".
 */
export const CUT_NAME = /^\d{3,4}p\d{2,3}$/;

export function cutFileOf(video: string, cut: string): string {
  return video.replace(/\.mp4$/, `.${cut}.mp4`);
}

/** A video's lower qualities, highest first, as the player lists them. */
export interface VideoCut {
  height: number;
  fps: number;
  url: string;
}

// The cut files in HIGHLIGHTS_DIR, listed once for many videos (a page of
// clips asks for each); a new or removed cut lists them again.
let cutList = { at: 0, names: [] as string[] };
function cutNames(): string[] {
  if (Date.now() - cutList.at > 10_000) {
    let names: string[] = [];
    try {
      names = fs.readdirSync(HIGHLIGHTS_DIR).filter((n) => /\.\d{3,4}p\d{2,3}\.mp4$/.test(n));
    } catch {
      // no highlights yet
    }
    cutList = { at: Date.now(), names };
  }
  return cutList.names;
}

/** The cut files changed on disk outside saveCut and removeTwins: list them again. */
export function forgetCutList(): void {
  cutList.at = 0;
}

export function cutsOf(clipPath: string | null): VideoCut[] {
  if (!clipPath) return [];
  const base = path.basename(clipPath).replace(/\.mp4$/, '');
  return cutNames()
    .flatMap((n) => {
      const m = /^(.+)\.(\d{3,4})p(\d{2,3})\.mp4$/.exec(n);
      return m && m[1] === base
        ? [
            {
              height: Number(m[2]),
              fps: Number(m[3]),
              url: `/api/game/cs2/highlights/${encodeURIComponent(n)}`,
            },
          ]
        : [];
    })
    .sort((a, b) => b.height - a.height || b.fps - a.fps);
}

async function streamTo(file: string, body: NodeJS.ReadableStream): Promise<string> {
  const tmp = `${file}.part`;
  await new Promise<void>((resolve, reject) => {
    const out = fs.createWriteStream(tmp);
    body.pipe(out);
    out.on('finish', () => resolve());
    out.on('error', reject);
    body.on('error', reject);
  });
  return tmp;
}

/** Store a lower quality of a video (the recorder streams it up after the video). */
export async function saveCut(
  video: string,
  cut: string,
  body: NodeJS.ReadableStream
): Promise<number> {
  const file = cutFileOf(video, cut);
  const tmp = await streamTo(file, body);
  const { size } = await fs.promises.stat(tmp);
  await fs.promises.rename(tmp, file);
  cutList.at = 0;
  return size;
}

/** Store one of a video's twins (the recorder streams it up). */
export async function saveTwin(
  video: string,
  twin: VideoTwin,
  body: NodeJS.ReadableStream
): Promise<number> {
  const file = twinFileOf(video, twin);
  const tmp = await streamTo(file, body);
  const { size } = await fs.promises.stat(tmp);
  if (twin === 'overlay') {
    // A recipe the redress can read, or nothing.
    try {
      JSON.parse(await fs.promises.readFile(tmp, 'utf8'));
    } catch {
      await fs.promises.rm(tmp, { force: true });
      throw new Error('The overlay is not JSON');
    }
  }
  await fs.promises.rename(tmp, file);
  return size;
}

/** Store a reel's crowd track (an AAC file the recorder streamed up). */
export async function saveCrowd(reel: string, body: NodeJS.ReadableStream): Promise<number> {
  return saveTwin(reel, 'crowd', body);
}

/** A new video: the twins and lower qualities of the one it replaces no longer match it. */
export async function removeTwins(video: string): Promise<void> {
  const cuts = cutsOf(path.basename(video)).map((c) => cutFileOf(video, `${c.height}p${c.fps}`));
  await Promise.all(
    [...(Object.keys(TWIN_SUFFIX) as VideoTwin[]).map((t) => twinFileOf(video, t)), ...cuts].map(
      (f) => fs.promises.rm(f, { force: true })
    )
  );
  cutList.at = 0;
}

/** A reel's crowd track for the player, when the recorder made one. */
export function crowdUrlOf(clipPath: string | null): string | null {
  if (!clipPath) return null;
  const file = crowdFileOf(path.join(HIGHLIGHTS_DIR, clipPath));
  return fs.existsSync(file)
    ? `/api/game/cs2/highlights/${encodeURIComponent(path.basename(file))}`
    : null;
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
  clipIds: number[] | null = null,
  clipStarts: number[] | null = null
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
  // A crowd track from an earlier make of this reel would not match it.
  await removeTwins(file);
  // Made again after its clips were redressed (redress.ts): done.
  await runRedressQueue('DELETE FROM cs2_redress_queue WHERE file = ?', [path.basename(file)]);
  const moments = await db.queryOneAsync<{ n: number | string }>(
    "SELECT COUNT(*) AS n FROM cs2_highlights WHERE match_slug = ? AND map_number = ? AND player_id = ? AND status = 'done'",
    [matchSlug, mapNumber, playerId]
  );
  await db.runAsync(
    `INSERT INTO cs2_highlight_reels (match_slug, map_number, player_id, moments, clip_path, clip_bytes, clip_ids, clip_starts)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (match_slug, map_number, player_id) DO UPDATE SET
       moments = EXCLUDED.moments, clip_path = EXCLUDED.clip_path, clip_bytes = EXCLUDED.clip_bytes,
       clip_ids = EXCLUDED.clip_ids, clip_starts = EXCLUDED.clip_starts, created_at = EXTRACT(EPOCH FROM NOW())::INTEGER`,
    [
      matchSlug,
      mapNumber,
      playerId,
      clipIds?.length ?? Number(moments?.n ?? 0),
      path.basename(file),
      size,
      clipIds ? JSON.stringify(clipIds) : null,
      clipStarts ? JSON.stringify(clipStarts) : null,
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
 * The map number of a series' own reel (cs2_match_reels): the best plays of
 * every map of a match played over more than one, after the maps' reels.
 */
export const SERIES_REEL = -1;

/**
 * A moment a reel could use: recorded, still waiting to be, or failed (not
 * skipped or funny). A failed one it would take holds the reel back until it is
 * redone or dropped (Clips tab): a reel made without a match's best plays is
 * wrong (2026-10-09: a series reel from map 3 alone, 75 clips of maps 0-2 failed).
 */
export interface ReelCandidate {
  id: number;
  playerId: string;
  score: number;
  mapNumber: number;
  at: number;
  done: boolean;
}

/**
 * A map reel's clips among its candidates (pure: tested on its own): each
 * player's best `perPlayer`, as bestClipPerPlayer takes them once recorded.
 */
export function pickMapClips<T extends ReelCandidate>(c: T[], perPlayer: number): T[] {
  const taken = new Map<string, number>();
  return c
    .slice()
    .sort((a, b) => b.score - a.score || a.id - b.id)
    .filter((x) => {
      const n = taken.get(x.playerId) ?? 0;
      if (n >= perPlayer) return false;
      taken.set(x.playerId, n + 1);
      return true;
    });
}

/**
 * Whether a reel can be made now (pure: tested on its own): every clip it
 * will take is recorded, from enough players. Moments it would not take may
 * still be waiting: a reel does not wait for them (the series reel takes the
 * best 16 of 40, so it is made once those 16 are in).
 */
export function reelReady(picked: ReelCandidate[]): boolean {
  return (
    picked.length > 0 &&
    picked.every((c) => c.done) &&
    new Set(picked.map((c) => c.playerId)).size >= MATCH_REEL_MIN_PLAYERS
  );
}

/**
 * Whether a series' reel can be made (pure: tested on its own): more than one
 * map, no map whose every clip failed (that holds it back until they are
 * redone: a series reel of the other maps alone is not the match), and its
 * picks recorded (reelReady).
 */
export function seriesReelReady(
  candidates: ReelCandidate[],
  maps: { mapNumber: number; usable: boolean }[],
  max: number,
  perPlayer: number
): boolean {
  if (maps.length < 2 || maps.some((m) => !m.usable)) return false;
  return reelReady(pickSeriesClips(candidates, max, perPlayer));
}

/** A match's moments a reel could use (failed ones too: they hold it), and its maps (usable: one recorded or still waiting). */
async function reelCandidates(
  matchSlug: string
): Promise<{ candidates: ReelCandidate[]; maps: { mapNumber: number; usable: boolean }[] }> {
  const rows = await db.queryAsync<{
    id: number;
    player_id: string;
    score: number;
    map_number: number;
    slowmo_tick: number;
    status: string;
    kind: string;
  }>(
    `SELECT id, player_id, score, map_number, slowmo_tick, status, kind FROM cs2_highlights
      WHERE match_slug = ? AND map_number >= 0 AND status <> 'skipped'`,
    [matchSlug]
  );
  const candidates: ReelCandidate[] = [];
  const maps = new Map<number, boolean>();
  for (const r of rows) {
    const mapNumber = Number(r.map_number);
    const usable = ['done', 'pending', 'recording'].includes(r.status);
    maps.set(mapNumber, (maps.get(mapNumber) ?? false) || usable);
    if ((!usable && r.status !== 'failed') || r.kind === 'funny') continue;
    candidates.push({
      id: Number(r.id),
      playerId: r.player_id,
      score: Number(r.score),
      mapNumber,
      at: Number(r.slowmo_tick),
      done: r.status === 'done',
    });
  }
  return { candidates, maps: [...maps].map(([mapNumber, usable]) => ({ mapNumber, usable })) };
}

/**
 * Queue the reels these highlights count for, as soon as the clips each will
 * take are recorded: a map's reel once every player's best is in, the
 * series' once its best (seriesReelMax) are. Clips it would not take may
 * still be waiting.
 */
export async function queueMatchReelFor(highlightIds: number[]): Promise<void> {
  if (highlightIds.length === 0) return;
  try {
    const maps = await db.queryAsync<{ match_slug: string; map_number: number }>(
      `SELECT DISTINCT match_slug, map_number FROM cs2_highlights
        WHERE id IN (${highlightIds.map(() => '?').join(', ')})`,
      highlightIds
    );
    const limits = await readReelLimits();
    const queue = async (slug: string, mapNumber: number) => {
      await db.runAsync(
        `INSERT INTO cs2_match_reels (match_slug, map_number) VALUES (?, ?)
         ON CONFLICT (match_slug, map_number) DO UPDATE SET status = 'pending', attempts = 0, error = NULL
           WHERE cs2_match_reels.status IN ('failed', 'waiting')`,
        [slug, mapNumber]
      );
      wakeRecorders();
    };
    for (const slug of new Set(maps.map((m) => m.match_slug))) {
      const { candidates, maps: all } = await reelCandidates(slug);
      for (const m of maps.filter((x) => x.match_slug === slug)) {
        const mapNumber = Number(m.map_number);
        const picked = pickMapClips(
          candidates.filter((c) => c.mapNumber === mapNumber),
          limits.mapReelPerPlayer
        );
        if (reelReady(picked)) await queue(slug, mapNumber);
      }
      // A series (more than one map): its own reel too.
      if (seriesReelReady(candidates, all, limits.seriesReelMax, limits.seriesReelPerPlayer))
        await queue(slug, SERIES_REEL);
    }
  } catch (error) {
    log.warn('[HIGHLIGHTS] Could not queue a match reel', { error: (error as Error).message });
  }
  // And the match's team reels, once all of it is recorded.
  const { queueTeamReelsFor } = await import('./teamReels');
  await queueTeamReelsFor(highlightIds);
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
  /** Its kills and the crowd's reactions, for the reel's crowd track. */
  markers: ClipMarkers | null;
  /**
   * Its match and map, when a reel spans several (team and tournament reels):
   * the same player again on the same map comes in without a second caption
   * card entrance.
   */
  matchSlug?: string;
  mapNumber?: number;
}

/**
 * What a reel opens with (the recorder's intro): a kicker, the title, a line
 * of details, the map and the date. The recorder draws it over a grid of the
 * reel's clips.
 */
export interface ReelIntro {
  kicker: string;
  title: string;
  meta: string;
  /** The map's catalogue name (de_dust2); the recorder shows it as "Dust II". */
  map: string;
  /** "7 October 2026", or "17–18 October 2026" for a tournament. */
  date: string;
}

/** A day as the intro shows it: "7 October 2026". */
export function reelDate(epochSeconds: number | null | undefined): string {
  if (!epochSeconds) return '';
  return new Date(epochSeconds * 1000).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

export interface MatchReelJob {
  kind: 'match_reel';
  intro: ReelIntro;
  matchSlug: string;
  mapNumber: number;
  match: string;
  quality: HighlightQuality;
  clips: MatchReelClip[];
  /** Where the recorder sends the reel, and where it says it could not. */
  upload: string;
  fail: string;
}

/** Each player's best recorded highlights of a map (the map reel's per player), in the order they happened. */
export async function bestClipPerPlayer(
  matchSlug: string,
  mapNumber: number
): Promise<MatchReelClip[]> {
  const rows = await db.queryAsync<{
    id: number;
    player_id: string;
    title: string;
    slowmo_tick: number;
    name: string | null;
    avatar_url: string | null;
    team: string | null;
    markers: string | null;
  }>(
    `SELECT b.id, b.player_id, b.title, b.slowmo_tick, b.markers, p.name, p.avatar_url,
            (SELECT t.name FROM matches m JOIN teams t ON t.id IN (m.team1_id, m.team2_id)
              WHERE m.slug = b.match_slug
                AND EXISTS (SELECT 1 FROM jsonb_array_elements(t.players::jsonb) e WHERE e->>'steamId' = b.player_id)
              LIMIT 1) AS team
       FROM (SELECT id, player_id, title, slowmo_tick, match_slug, markers,
                    ROW_NUMBER() OVER (PARTITION BY player_id ORDER BY score DESC, id) AS rank
               FROM cs2_highlights
              WHERE match_slug = ? AND map_number = ? AND status = 'done' AND kind <> 'funny') b
       LEFT JOIN players p ON p.id = b.player_id
      WHERE b.rank <= ?
      ORDER BY b.slowmo_tick`,
    [matchSlug, mapNumber, (await readReelLimits()).mapReelPerPlayer]
  );
  return rows.map((r) => ({
    highlightId: Number(r.id),
    playerId: r.player_id,
    playerName: r.name ?? r.player_id,
    team: r.team,
    avatarUrl: r.avatar_url,
    title: r.title,
    url: `/api/game/cs2/highlights/${Number(r.id)}.mp4`,
    markers: parseMarkers(r.markers),
  }));
}

/**
 * A series reel's clips (pure: tested on its own): the best plays across every
 * map, at most `perPlayerMax` of one player and `max` in all (the settings'
 * series reel sizes), shown in the order they were played.
 */
export function pickSeriesClips<
  T extends { playerId: string; score: number; mapNumber: number; at: number },
>(clips: T[], max = 16, perPlayerMax = 2): T[] {
  const perPlayer = new Map<string, number>();
  const chosen: T[] = [];
  for (const c of clips
    .slice()
    .sort((a, b) => b.score - a.score || a.mapNumber - b.mapNumber || a.at - b.at)) {
    if (chosen.length >= max) break;
    const n = perPlayer.get(c.playerId) ?? 0;
    if (n >= perPlayerMax) continue;
    perPlayer.set(c.playerId, n + 1);
    chosen.push(c);
  }
  return chosen.sort((a, b) => a.mapNumber - b.mapNumber || a.at - b.at);
}

/** The recorded clips a series reel picks from, and the ones it takes. */
export async function seriesClips(matchSlug: string): Promise<MatchReelClip[]> {
  const rows = await db.queryAsync<{
    id: number;
    player_id: string;
    title: string;
    slowmo_tick: number;
    map_number: number;
    score: number;
    name: string | null;
    avatar_url: string | null;
    team: string | null;
    markers: string | null;
  }>(
    `SELECT h.id, h.player_id, h.title, h.slowmo_tick, h.map_number, h.score, h.markers, p.name, p.avatar_url,
            (SELECT t.name FROM matches m JOIN teams t ON t.id IN (m.team1_id, m.team2_id)
              WHERE m.slug = h.match_slug
                AND EXISTS (SELECT 1 FROM jsonb_array_elements(t.players::jsonb) e WHERE e->>'steamId' = h.player_id)
              LIMIT 1) AS team
       FROM cs2_highlights h
       LEFT JOIN players p ON p.id = h.player_id
      WHERE h.match_slug = ? AND h.map_number >= 0 AND h.status = 'done' AND h.kind <> 'funny'`,
    [matchSlug]
  );
  const limits = await readReelLimits();
  const picked = pickSeriesClips(
    rows.map((r) => ({
      ...r,
      playerId: r.player_id,
      score: Number(r.score),
      mapNumber: Number(r.map_number),
      at: Number(r.slowmo_tick),
    })),
    limits.seriesReelMax,
    limits.seriesReelPerPlayer
  );
  return picked.map((r) => ({
    highlightId: Number(r.id),
    playerId: r.player_id,
    playerName: r.name ?? r.player_id,
    team: r.team,
    avatarUrl: r.avatar_url,
    title: r.title,
    url: `/api/game/cs2/highlights/${Number(r.id)}.mp4`,
    markers: parseMarkers(r.markers),
  }));
}

/** Hand the recorder a match reel to join, if one is waiting. */
export async function claimMatchReel(recorder: string): Promise<MatchReelJob | null> {
  const now = Math.floor(Date.now() / 1000);
  const failover = await reelFailoverFilter(recorder, 'cs2_match_reels.match_slug');
  const row = await db.queryOneAsync<{ match_slug: string; map_number: number }>(
    `UPDATE cs2_match_reels SET status = 'recording', recorder = ?, ${KEEP_LABEL_ON_CLAIM} made_with = ?, claimed_at = ?, claim_started_at = EXTRACT(EPOCH FROM NOW())::INTEGER, retry_until = NULL, attempts = attempts + 1
      WHERE (match_slug, map_number) = (
        SELECT match_slug, map_number FROM cs2_match_reels
         WHERE ${recordingWaiting()} AND ${failover.sql} AND ${recordingTargetFilter('cs2_match_reels.match_slug')}
         ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED)
      RETURNING match_slug, map_number`,
    [
      recorder.slice(0, 120),
      qualityLabel(await readHighlightQuality()),
      now,
      recorder.slice(0, 120),
      ...failover.params,
      recorder,
    ]
  );
  if (!row) return null;
  const series = Number(row.map_number) === SERIES_REEL;
  const clips = series
    ? await seriesClips(row.match_slug)
    : await bestClipPerPlayer(row.match_slug, Number(row.map_number));
  const extra = await db.queryOneAsync<{
    team1: string | null;
    team2: string | null;
    tournament: string | null;
    map_name: string | null;
    played_at: number | string | null;
  }>(
    `SELECT t1.name AS team1, t2.name AS team2, COALESCE(tr.name, m.played_in) AS tournament,
            (SELECT j.map_name FROM cs2_demo_jobs j WHERE j.match_slug = m.slug AND j.map_number = ?) AS map_name,
            (SELECT MAX(r.completed_at) FROM match_map_results r WHERE r.match_slug = m.slug AND (r.map_number = ? OR ? = ${SERIES_REEL})) AS played_at
       FROM matches m
       LEFT JOIN teams t1 ON t1.id = m.team1_id
       LEFT JOIN teams t2 ON t2.id = m.team2_id
       LEFT JOIN tournament tr ON tr.id = m.tournament_id
      WHERE m.slug = ?`,
    [Number(row.map_number), Number(row.map_number), Number(row.map_number), row.match_slug]
  );
  return {
    kind: 'match_reel',
    intro: {
      kicker: series ? 'Series highlights' : 'Match highlights',
      title: matchLine(extra?.team1 ?? null, extra?.team2 ?? null, null) || 'Match highlights',
      meta: extra?.tournament ?? '',
      map: extra?.map_name ?? '',
      date: reelDate(extra?.played_at ? Number(extra.played_at) : null),
    },
    matchSlug: row.match_slug,
    mapNumber: Number(row.map_number),
    match: matchLine(extra?.team1 ?? null, extra?.team2 ?? null, extra?.tournament ?? null),
    quality: await readHighlightQuality(),
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
  clipIds: number[] | null = null,
  clipStarts: number[] | null = null
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
  // A crowd track from an earlier make of this reel would not match it.
  await removeTwins(file);
  await db.runAsync(
    `INSERT INTO cs2_match_reels (match_slug, map_number, status, clips, clip_path, clip_bytes, clip_ids, clip_starts, done_at)
     VALUES (?, ?, 'done', ?, ?, ?, ?, ?, EXTRACT(EPOCH FROM NOW())::INTEGER)
     ON CONFLICT (match_slug, map_number) DO UPDATE SET status = 'done', error = NULL,
       clips = EXCLUDED.clips, clip_path = EXCLUDED.clip_path, clip_bytes = EXCLUDED.clip_bytes,
       clip_ids = EXCLUDED.clip_ids, clip_starts = EXCLUDED.clip_starts, done_at = EXCLUDED.done_at`,
    [
      matchSlug,
      mapNumber,
      clipIds?.length ?? clips,
      path.basename(file),
      size,
      clipIds ? JSON.stringify(clipIds) : null,
      clipStarts ? JSON.stringify(clipStarts) : null,
    ]
  );
  emitHighlightsChanged(matchSlug);
  return size;
}

export async function failMatchReel(
  matchSlug: string,
  mapNumber: number,
  error: string
): Promise<void> {
  await db.runAsync(
    `UPDATE cs2_match_reels SET ${recordingFailureSql}${keptLabelSql('cs2_match_reels')}
      WHERE match_slug = ? AND map_number = ? AND status = 'recording'`,
    [error.slice(0, 500), matchSlug, mapNumber]
  );
}

/**
 * A match's reels per map, and whether each is still being made: a map whose
 * highlights the recorder has not finished shows as `recording` before its
 * reel is even queued.
 */
export async function matchReels(matchSlug: string) {
  const rows = await db.queryAsync<{
    map_number: number;
    status: string;
    clips: number | null;
    clip_path: string | null;
  }>(
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
    video:
      isShown(r.status, r.clip_path) && r.clip_path
        ? `/api/game/cs2/highlights/${encodeURIComponent(r.clip_path)}`
        : null,
  }));
}
