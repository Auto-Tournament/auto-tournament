/**
 * Which highlights a match gets. An organizer turns them off for a tournament
 * (`settings.cs2.highlights: false`) or for one match (its config's
 * `highlights: false`, from the manual match dialog): the map is still
 * analysed (stats, notable moments), only the clips and reels are skipped.
 * Every match keeps only plays of the admin's smallest play (`highlights_mm_min_kills`) or a
 * clutch (`highlights_mm_clutch`); matchmaking matches (`matches.source = 'matchmaking'`) also get
 * the admin's clip budget (`highlights_mm_clips`): a few of their best plays, not every one.
 */
import { db } from '../../../config/database';
import { settingsService } from '../../../services/settingsService';
import { storedCs2Settings } from '../tournamentSettings';
import type { Moment } from './highlights';
import type { Untrusted } from '../../../utils/untrusted';

/** A matchmaking match's clips: how many (0: every one), the fewest kills, and whether a clutch always counts. */
export interface MatchmakingBudget {
  clips: number;
  minKills: number;
  clutch: boolean;
}

/** The smallest play that becomes a clip: kills in one round, or any won clutch. */
export type PlayMinimum = Pick<MatchmakingBudget, 'minKills' | 'clutch'>;

export interface HighlightPlan {
  record: boolean;
  /** Set for a matchmaking match. */
  budget: MatchmakingBudget | null;
  /** Set for any other match that records. */
  minimum: PlayMinimum | null;
}

// The choices of services/highlights/settings.ts (MM_CLIPS, MM_MIN_KILLS, oneOf): the module
// can't import core code its bridge doesn't export, so these mirror them.
const MM_CLIPS = [0, 1, 2, 3, 5, 10];
const MM_MIN_KILLS = [2, 3, 4, 5];
/** A stored choice as a number, its fallback when unset (Number(null) is 0, the "all" choice). */
function oneOf(
  raw: string | null | undefined,
  options: readonly number[],
  fallback: number
): number {
  const n = raw === null || raw === undefined || raw.trim() === '' ? NaN : Number(raw);
  return options.includes(n) ? n : fallback;
}

const get = (key: string) => settingsService.getSetting(key);

async function playMinimum(): Promise<PlayMinimum> {
  return {
    minKills: oneOf(await get('highlights_mm_min_kills'), MM_MIN_KILLS, 3),
    clutch: (await get('highlights_mm_clutch'))?.trim() !== '0',
  };
}

async function matchmakingBudget(): Promise<MatchmakingBudget | null> {
  if ((await get('highlights_mm'))?.trim() === '0') return null;
  return { clips: oneOf(await get('highlights_mm_clips'), MM_CLIPS, 3), ...(await playMinimum()) };
}

export async function highlightPlan(matchSlug: string): Promise<HighlightPlan> {
  const row = await db
    .queryOneAsync<{ config: string | null; source: string | null; settings: string | null }>(
      `SELECT m.config, m.source, t.settings FROM matches m LEFT JOIN tournament t ON t.id = m.tournament_id
        WHERE m.slug = ?`,
      [matchSlug]
    )
    .catch(() => null);
  if (!row) return { record: true, budget: null, minimum: await playMinimum() };
  if (row.source === 'matchmaking') {
    const budget = await matchmakingBudget();
    return { record: budget !== null, budget, minimum: null };
  }
  const off = { record: false, budget: null, minimum: null };
  if (storedCs2Settings(row.settings)?.highlights === false) return off;
  try {
    if ((JSON.parse(row.config ?? '{}') as { highlights?: Untrusted }).highlights === false)
      return off;
  } catch {
    // An unreadable config records, as before.
  }
  return { record: true, budget: null, minimum: await playMinimum() };
}

/** A play of `minKills` or more, or a won clutch when they count. */
function bigEnough(m: Moment, min: PlayMinimum): boolean {
  return m.killTicks.length >= min.minKills || (min.clutch && m.clutch === true);
}

/**
 * A map's moments without the small plays (pure: tested on its own): a 2k or a single
 * wallbang is no highlight when the smallest play is 3 kills. Funny moments stay: they are
 * no play, and never go into a reel.
 */
export function bigPlaysOnly(moments: Moment[], min: PlayMinimum): Moment[] {
  return moments.filter((m) => m.kind === 'funny' || bigEnough(m, min));
}

/**
 * A matchmaking map's moments cut to the budget (pure: tested on its own):
 * only plays of `minKills` or more (or a clutch, when they count), best
 * first, as many as the match has room for after `already` (its other maps'
 * clips). Funny moments aren't a play, so they're left out.
 */
export function withinBudget(
  moments: Moment[],
  budget: MatchmakingBudget,
  already: number
): Moment[] {
  const plays = moments
    .filter((m) => m.kind !== 'funny')
    .filter((m) => bigEnough(m, budget))
    .sort((a, b) => b.score - a.score);
  if (budget.clips === 0) return plays;
  return plays.slice(0, Math.max(0, budget.clips - already));
}
