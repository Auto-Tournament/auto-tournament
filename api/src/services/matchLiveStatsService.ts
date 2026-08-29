import { log } from '../utils/logger';

export type LiveStatus = 'warmup' | 'knife' | 'live' | 'halftime' | 'postgame';

export interface PlayerStatLine {
  steamId: string;
  name: string;
  kills: number;
  deaths: number;
  assists: number;
  flashAssists: number;
  headshotKills: number;
  damage: number;
  utilityDamage: number;
  kast: number;
  mvps: number;
  score: number;
  roundsPlayed: number;
}

export interface MatchPlayerStatsSnapshot {
  team1: PlayerStatLine[];
  team2: PlayerStatLine[];
}

export interface MatchLiveStats {
  matchSlug: string;
  team1Score: number;
  team2Score: number;
  roundNumber: number;
  mapNumber: number;
  status: LiveStatus;
  lastEventAt: number;
  team1SeriesScore: number;
  team2SeriesScore: number;
  mapName?: string | null;
  totalMaps: number;
  /** Stats for the map currently being played. */
  playerStats?: MatchPlayerStatsSnapshot | null;
  /**
   * Per-map snapshots, keyed by map number.
   *
   * `round_end` carries stats cumulative *within the current map*, so each new
   * map overwrites `playerStats`. Keeping the finished maps here is what lets a
   * BO3/BO5 be totalled at series end instead of recording only the last map.
   */
  playerStatsByMap?: Record<number, MatchPlayerStatsSnapshot> | null;
}

/** Sum one player's line across maps. Rates are recomputed, not added. */
function mergeStatLines(lines: PlayerStatLine[]): PlayerStatLine {
  const total: PlayerStatLine = {
    steamId: lines[0].steamId,
    name: lines[lines.length - 1].name || lines[0].name,
    kills: 0,
    deaths: 0,
    assists: 0,
    flashAssists: 0,
    headshotKills: 0,
    damage: 0,
    utilityDamage: 0,
    kast: 0,
    mvps: 0,
    score: 0,
    roundsPlayed: 0,
  };

  let kastRoundsWeight = 0;
  for (const line of lines) {
    total.kills += line.kills;
    total.deaths += line.deaths;
    total.assists += line.assists;
    total.flashAssists += line.flashAssists;
    total.headshotKills += line.headshotKills;
    total.damage += line.damage;
    total.utilityDamage += line.utilityDamage;
    total.mvps += line.mvps;
    total.score += line.score;
    total.roundsPlayed += line.roundsPlayed;
    // KAST is a percentage, so it is averaged over the rounds it describes.
    kastRoundsWeight += line.kast * line.roundsPlayed;
  }

  total.kast = total.roundsPlayed > 0 ? kastRoundsWeight / total.roundsPlayed : 0;
  return total;
}

/**
 * Total each player across every map recorded for the series.
 *
 * Falls back to the current map when no per-map history exists, which covers
 * BO1 and any match that was already in progress before this was recorded.
 */
export function sumPlayerStatsAcrossMaps(
  stats: Pick<MatchLiveStats, 'playerStats' | 'playerStatsByMap'>
): MatchPlayerStatsSnapshot | null {
  const perMap = Object.values(stats.playerStatsByMap ?? {});
  if (perMap.length === 0) return stats.playerStats ?? null;

  const sumSide = (side: 'team1' | 'team2'): PlayerStatLine[] => {
    const bySteamId = new Map<string, PlayerStatLine[]>();
    for (const snapshot of perMap) {
      for (const line of snapshot[side]) {
        const existing = bySteamId.get(line.steamId);
        if (existing) existing.push(line);
        else bySteamId.set(line.steamId, [line]);
      }
    }
    return [...bySteamId.values()].map(mergeStatLines);
  };

  return { team1: sumSide('team1'), team2: sumSide('team2') };
}

class MatchLiveStatsService {
  private stats = new Map<string, MatchLiveStats>();

  getStats(matchSlug: string): MatchLiveStats | null {
    return this.stats.get(matchSlug) ?? null;
  }

  reset(matchSlug: string): MatchLiveStats {
    const entry: MatchLiveStats = {
      matchSlug,
      team1Score: 0,
      team2Score: 0,
      roundNumber: 0,
      mapNumber: 0,
      status: 'warmup',
      lastEventAt: Date.now(),
      team1SeriesScore: 0,
      team2SeriesScore: 0,
      mapName: null,
      totalMaps: 1,
      playerStats: null,
      playerStatsByMap: null,
    };
    this.stats.set(matchSlug, entry);
    return entry;
  }

  update(matchSlug: string, updates: Partial<Omit<MatchLiveStats, 'matchSlug'>>): MatchLiveStats {
    const current = this.stats.get(matchSlug) ?? this.reset(matchSlug);
    const next: MatchLiveStats = {
      ...current,
      ...updates,
      matchSlug,
      lastEventAt: Date.now(),
    };

    // File the incoming snapshot under the map it belongs to, so finished maps
    // survive the next map overwriting `playerStats`.
    if (updates.playerStats && !updates.playerStatsByMap) {
      const mapNumber = updates.mapNumber ?? current.mapNumber ?? 0;
      next.playerStatsByMap = {
        ...(current.playerStatsByMap ?? {}),
        [mapNumber]: updates.playerStats,
      };
    }

    this.stats.set(matchSlug, next);
    return next;
  }

  /** Series totals for a match, summed across every map played. */
  getSeriesPlayerStats(matchSlug: string): MatchPlayerStatsSnapshot | null {
    const current = this.stats.get(matchSlug);
    if (!current) return null;
    return sumPlayerStatsAcrossMaps(current);
  }

  clear(matchSlug: string): void {
    if (this.stats.delete(matchSlug)) {
      log.debug('Cleared live stats for match', { matchSlug });
    }
  }

  clearAll(): void {
    if (this.stats.size > 0) {
      this.stats.clear();
      log.debug('Cleared live stats for all matches');
    }
  }
}

export const matchLiveStatsService = new MatchLiveStatsService();


