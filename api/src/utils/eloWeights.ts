/**
 * ELO template weights and the stat adjustment sum, kept free of database
 * access so specs can check them directly. `services/eloTemplateService`
 * stores templates and applies them.
 */

import type { StatsSchema } from '../integrations/types';

/**
 * Weights by stat. The keys are the match's integration's `statsSchema`
 * metrics that are `ratingWeightable`, under their `ratingWeightKey` (else
 * `key`). The named keys are the CS2 ones, which built-in templates use and
 * the admin UI edits.
 */
export interface EloTemplateWeights {
  kills?: number;
  deaths?: number;
  assists?: number;
  flashAssists?: number;
  headshotKills?: number;
  damage?: number;
  utilityDamage?: number;
  kast?: number;
  mvps?: number;
  score?: number;
  adr?: number;
  [weightKey: string]: number | undefined;
}

/** Built-in "Pure Win/Loss": every weight 0. */
export const PURE_WIN_LOSS_WEIGHTS: EloTemplateWeights = {
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
  adr: 0,
};

/** Built-in "Balanced Stats v1" weights. */
export const BALANCED_STATS_V1_WEIGHTS: EloTemplateWeights = {
  kills: 0.4,
  deaths: -0.4,
  assists: 0.2,
  flashAssists: 0.15,
  headshotKills: 0.2,
  damage: 0,
  utilityDamage: 0.02,
  kast: 0.05,
  mvps: 1.5,
  score: 0,
  adr: 0.05,
};

/** The template weight key of each rating-weightable metric, in schema order. */
function weightableMetrics(schema: StatsSchema): Array<{ key: string; weightKey: string }> {
  return schema.metrics
    .filter((m) => m.ratingWeightable)
    .map((m) => ({ key: m.key, weightKey: m.ratingWeightKey ?? m.key }));
}

/**
 * Weight keys of a template that name no rating-weightable metric of the
 * schema. Such weights are ignored when the template is applied.
 */
export function unknownWeightKeys(weights: EloTemplateWeights, schema: StatsSchema): string[] {
  const known = new Set(weightableMetrics(schema).map((m) => m.weightKey));
  return Object.keys(weights).filter((k) => !known.has(k));
}

/**
 * The uncapped stat adjustment: the sum of `metrics[key] * weight` over the
 * schema's rating-weightable metrics that the template weights, in schema
 * order. A metric the line does not carry counts as 0.
 */
export function weightedStatSum(
  weights: EloTemplateWeights,
  metrics: Record<string, number>,
  schema: StatsSchema
): number {
  let adjustment = 0;
  for (const { key, weightKey } of weightableMetrics(schema)) {
    const weight = weights[weightKey];
    if (weight !== undefined) {
      adjustment += (metrics[key] ?? 0) * weight;
    }
  }
  return adjustment;
}
