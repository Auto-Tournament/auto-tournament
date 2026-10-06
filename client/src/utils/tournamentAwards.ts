import type { OverviewPlayer } from '../hooks/usePublicTournamentOverview';

export type AwardKey = 'mostKills' | 'bestAdr' | 'bestHeadshots' | 'mostFlashAssists' | 'mostUtility' | 'biggestGain';

export interface Award {
  key: AwardKey;
  player: OverviewPlayer;
  /** The number behind it, rounded for display. */
  value: number;
}

/** Below this many kills a headshot percentage says little. */
const MIN_KILLS_FOR_HEADSHOTS = 10;

/** The player with the highest score, or null when nobody has one above zero. */
function best(players: OverviewPlayer[], score: (p: OverviewPlayer) => number | null): OverviewPlayer | null {
  let top: OverviewPlayer | null = null;
  let topScore = 0;
  for (const player of players) {
    const value = score(player);
    if (value !== null && value > topScore) {
      top = player;
      topScore = value;
    }
  }
  return top;
}

/**
 * The finished tournament's awards, from the stats every match records. Each
 * goes to one player; an award nobody earned (no kills yet, no flash assists)
 * is left out.
 */
export function tournamentAwards(players: OverviewPlayer[]): Award[] {
  const headshotPct = (p: OverviewPlayer) =>
    (p.kills ?? 0) >= MIN_KILLS_FOR_HEADSHOTS ? ((p.headshots ?? 0) / (p.kills ?? 1)) * 100 : null;

  const picks: Array<[AwardKey, (p: OverviewPlayer) => number | null]> = [
    ['mostKills', (p) => p.kills ?? 0],
    ['bestAdr', (p) => p.averageAdr ?? 0],
    ['bestHeadshots', headshotPct],
    ['mostFlashAssists', (p) => p.flashAssists ?? 0],
    ['mostUtility', (p) => p.utilityDamage ?? 0],
    ['biggestGain', (p) => p.eloChange ?? 0],
  ];

  return picks.flatMap(([key, score]) => {
    const player = best(players, score);
    if (!player) return [];
    const value = score(player) ?? 0;
    return [{ key, player, value: key === 'bestAdr' || key === 'bestHeadshots' ? Math.round(value) : value }];
  });
}
