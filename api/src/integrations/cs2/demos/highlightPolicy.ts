/**
 * Which highlights a match gets. An organizer turns them off for a tournament
 * (`settings.cs2.highlights: false`) or for one match (its config's
 * `highlights: false`, from the manual match dialog): the map is still
 * analysed (stats, notable moments), only the clips and reels are skipped.
 * Matchmaking matches (`matches.source = 'matchmaking'`) get the admin's
 * budget instead (`highlights_mm*`): a few of their best plays, not every one.
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

export interface HighlightPlan {
  record: boolean;
  /** Set for a matchmaking match. */
  budget: MatchmakingBudget | null;
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

async function matchmakingBudget(): Promise<MatchmakingBudget | null> {
  const get = (key: string) => settingsService.getSetting(key);
  if ((await get('highlights_mm'))?.trim() === '0') return null;
  return {
    clips: oneOf(await get('highlights_mm_clips'), MM_CLIPS, 3),
    minKills: oneOf(await get('highlights_mm_min_kills'), MM_MIN_KILLS, 3),
    clutch: (await get('highlights_mm_clutch'))?.trim() !== '0',
  };
}

export async function highlightPlan(matchSlug: string): Promise<HighlightPlan> {
  const row = await db
    .queryOneAsync<{ config: string | null; source: string | null; settings: string | null }>(
      `SELECT m.config, m.source, t.settings FROM matches m LEFT JOIN tournament t ON t.id = m.tournament_id
        WHERE m.slug = ?`,
      [matchSlug]
    )
    .catch(() => null);
  if (!row) return { record: true, budget: null };
  if (row.source === 'matchmaking') {
    const budget = await matchmakingBudget();
    return { record: budget !== null, budget };
  }
  if (storedCs2Settings(row.settings)?.highlights === false) return { record: false, budget: null };
  try {
    const off = (JSON.parse(row.config ?? '{}') as { highlights?: Untrusted }).highlights === false;
    return { record: !off, budget: null };
  } catch {
    return { record: true, budget: null };
  }
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
    .filter((m) => m.killTicks.length >= budget.minKills || (budget.clutch && m.clutch === true))
    .sort((a, b) => b.score - a.score);
  if (budget.clips === 0) return plays;
  return plays.slice(0, Math.max(0, budget.clips - already));
}
