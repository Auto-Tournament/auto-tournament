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
  playerStats?: MatchPlayerStatsSnapshot | null;
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
    this.stats.set(matchSlug, next);
    return next;
  }

  clear(matchSlug: string): void {
    if (this.stats.delete(matchSlug)) {
      log.debug('Cleared live stats for match', { matchSlug });
    }
  }
}

export const matchLiveStatsService = new MatchLiveStatsService();


