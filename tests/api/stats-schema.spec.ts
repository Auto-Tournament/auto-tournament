import { test, expect } from '@playwright/test';
import { getIntegration } from '../../api/src/integrations/registry';
import {
  cs2PlayerStatsColumns,
  cs2PlayerStatsMetrics,
  metricsFromMatchZyStats,
} from '../../api/src/integrations/cs2/stats';
import {
  BALANCED_STATS_V1_WEIGHTS,
  PURE_WIN_LOSS_WEIGHTS,
  unknownWeightKeys,
  weightedStatSum,
  type EloTemplateWeights,
} from '../../api/src/utils/eloWeights';

/**
 * 3.0 phase C, PR 10: player stats and the rating stat adjustment go through
 * the integration's `statsSchema`. The core persists stat lines and weights
 * `metrics[key]`; CS2 maps them to and from the `player_match_stats` columns.
 *
 * The legacy functions below are the code this replaced, copied as it was.
 * The new path must give the same columns and bit-identical adjustments.
 *
 * @tag api
 * @tag regression
 */

// --- legacy reference (pre-PR 10) ------------------------------------------

type LegacyStats = Record<string, unknown>;

/** `persistPlayerMatchStats` insertRow, minus the core columns. */
function legacyColumns(raw: LegacyStats): Record<string, unknown> {
  const stats = raw as Record<string, number | undefined>;
  const roundsPlayed = stats.rounds_played ?? stats.roundsPlayed ?? 0;
  const adr = roundsPlayed > 0 ? ((stats.damage ?? 0) as number) / roundsPlayed : 0;
  return {
    adr: Math.round(adr * 100) / 100,
    total_damage: stats.damage || 0,
    kills: stats.kills || 0,
    deaths: stats.deaths || 0,
    assists: stats.assists || 0,
    headshots: stats.headshot_kills || stats.headshotKills || 0,
    flash_assists: stats.flash_assists || stats.flashAssists || 0,
    utility_damage: stats.utility_damage || stats.utilityDamage || 0,
    kast: stats.kast || 0,
    mvps: stats.mvp || stats.mvps || 0,
    score: stats.score || 0,
    rounds_played: roundsPlayed,
  };
}

interface LegacyLine {
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

/** `ratingService` row -> PlayerStatLine. */
function legacyLineFromRow(stat: Record<string, number | null>): LegacyLine {
  const s = stat as Record<string, number>;
  const roundsPlayed =
    s.rounds_played || (s.adr > 0 && s.total_damage > 0 ? Math.round(s.total_damage / s.adr) : 0);
  return {
    kills: s.kills || 0,
    deaths: s.deaths || 0,
    assists: s.assists || 0,
    flashAssists: s.flash_assists || 0,
    headshotKills: s.headshots || 0,
    damage: s.total_damage || 0,
    utilityDamage: s.utility_damage || 0,
    kast: s.kast || 0,
    mvps: s.mvps || 0,
    score: s.score || 0,
    roundsPlayed,
  };
}

/** `eloTemplateService.applyTemplate`, the uncapped sum. */
function legacySum(weights: EloTemplateWeights, p: LegacyLine): number {
  const adr = p.roundsPlayed > 0 ? p.damage / p.roundsPlayed : 0;
  let adjustment = 0;
  if (weights.kills !== undefined) adjustment += (p.kills || 0) * weights.kills;
  if (weights.deaths !== undefined) adjustment += (p.deaths || 0) * weights.deaths;
  if (weights.assists !== undefined) adjustment += (p.assists || 0) * weights.assists;
  if (weights.flashAssists !== undefined) adjustment += (p.flashAssists || 0) * weights.flashAssists;
  if (weights.headshotKills !== undefined)
    adjustment += (p.headshotKills || 0) * weights.headshotKills;
  if (weights.damage !== undefined) adjustment += (p.damage || 0) * weights.damage;
  if (weights.utilityDamage !== undefined)
    adjustment += (p.utilityDamage || 0) * weights.utilityDamage;
  if (weights.kast !== undefined) adjustment += (p.kast || 0) * weights.kast;
  if (weights.mvps !== undefined) adjustment += (p.mvps || 0) * weights.mvps;
  if (weights.score !== undefined) adjustment += (p.score || 0) * weights.score;
  if (weights.adr !== undefined) adjustment += adr * weights.adr;
  return adjustment;
}

// --- helpers ---------------------------------------------------------------

/** Small deterministic PRNG (mulberry32). */
function rng(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const schema = getIntegration('cs2').statsSchema(null);

test.describe('CS2 stats through statsSchema', () => {
  test('MatchZy stats -> metrics -> columns matches the old insert', () => {
    const next = rng(1);
    const int = (max: number) => Math.floor(next() * max);
    const samples: LegacyStats[] = [
      {},
      { kills: 3 },
      { rounds_played: 0, damage: 500 },
      { roundsPlayed: 21, damage: 1733, headshotKills: 4, flashAssists: 2, utilityDamage: 90, mvps: 3 },
      { rounds_played: null, roundsPlayed: 13, damage: 999, mvp: 0, mvps: 2 },
    ];
    for (let i = 0; i < 500; i++) {
      const camel = next() < 0.5;
      const sample: LegacyStats = {
        kills: int(40),
        deaths: int(30),
        assists: int(15),
        damage: int(4000),
        kast: next() < 0.2 ? 0 : Math.round(next() * 10000) / 100,
        score: int(90),
      };
      if (next() < 0.9) sample[camel ? 'roundsPlayed' : 'rounds_played'] = int(40);
      sample[camel ? 'headshotKills' : 'headshot_kills'] = int(20);
      sample[camel ? 'flashAssists' : 'flash_assists'] = int(6);
      sample[camel ? 'utilityDamage' : 'utility_damage'] = int(400);
      sample[next() < 0.5 ? 'mvp' : 'mvps'] = int(8);
      samples.push(sample);
    }
    for (const raw of samples) {
      const columns = cs2PlayerStatsColumns(metricsFromMatchZyStats(raw));
      expect(columns).toEqual(legacyColumns(raw));
      expect(Object.keys(columns)).toEqual(Object.keys(legacyColumns(raw)));
    }
    // A player MatchZy reported nothing for.
    expect(cs2PlayerStatsColumns({})).toEqual(legacyColumns({}));
  });

  test('rating stat adjustment is bit-identical to the old template sum', () => {
    const next = rng(2);
    const int = (max: number) => Math.floor(next() * max);
    const templates: EloTemplateWeights[] = [
      PURE_WIN_LOSS_WEIGHTS,
      BALANCED_STATS_V1_WEIGHTS,
      { kills: 1, adr: 0.1 },
      { damage: 0.013, kast: -0.07, score: 0.21 },
      {},
    ];
    for (let i = 0; i < 20; i++) {
      const w: EloTemplateWeights = {};
      for (const key of Object.keys(BALANCED_STATS_V1_WEIGHTS)) {
        if (next() < 0.7) w[key] = Math.round((next() - 0.5) * 1000) / 1000;
      }
      templates.push(w);
    }

    const rows: Array<Record<string, number | null>> = [];
    for (let i = 0; i < 300; i++) {
      const rounds = int(40);
      const damage = int(4000);
      const row: Record<string, number | null> = {
        kills: int(40),
        deaths: int(30),
        assists: int(15),
        headshots: int(20),
        flash_assists: next() < 0.1 ? null : int(6),
        utility_damage: next() < 0.1 ? null : int(400),
        kast: next() < 0.1 ? null : Math.round(next() * 10000) / 100,
        mvps: next() < 0.1 ? null : int(8),
        score: next() < 0.1 ? null : int(90),
        total_damage: damage,
        adr: rounds > 0 ? Math.round((damage / rounds) * 100) / 100 : 0,
        // Older rows have no rounds_played; it is recovered from damage / ADR.
        rounds_played: next() < 0.3 ? null : rounds,
      };
      rows.push(row);
    }

    for (const weights of templates) {
      for (const row of rows) {
        const actual = weightedStatSum(weights, cs2PlayerStatsMetrics(row), schema);
        const expected = legacySum(weights, legacyLineFromRow(row));
        expect(Object.is(actual, expected)).toBe(true);
      }
    }
  });

  test('built-in ELO template weights all name CS2 statsSchema metrics', () => {
    expect(unknownWeightKeys(PURE_WIN_LOSS_WEIGHTS, schema)).toEqual([]);
    expect(unknownWeightKeys(BALANCED_STATS_V1_WEIGHTS, schema)).toEqual([]);
    expect(unknownWeightKeys({ kills: 1, notAStat: 2 }, schema)).toEqual(['notAStat']);
  });

  test('a weight on a metric that is not rating-weightable is ignored', () => {
    expect(weightedStatSum({ rounds_played: 5 }, { rounds_played: 20 }, schema)).toBe(0);
    expect(unknownWeightKeys({ rounds_played: 5 }, schema)).toEqual(['rounds_played']);
  });
});
