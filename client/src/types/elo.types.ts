/**
 * ELO Calculation Template Types
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
}

export interface EloCalculationTemplate {
  id: string;
  name: string;
  description?: string;
  enabled: boolean;
  weights: EloTemplateWeights;
  maxAdjustment?: number;
  minAdjustment?: number;
  createdAt: number;
  updatedAt: number;
}

export interface CreateEloTemplateInput {
  name: string;
  description?: string;
  enabled?: boolean;
  weights?: EloTemplateWeights;
  maxAdjustment?: number;
  minAdjustment?: number;
}

export interface UpdateEloTemplateInput {
  name?: string;
  description?: string;
  enabled?: boolean;
  weights?: EloTemplateWeights;
  maxAdjustment?: number;
  minAdjustment?: number;
}

