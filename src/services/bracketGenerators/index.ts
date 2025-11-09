/**
 * Bracket Generator Registry
 * Central registry for all bracket generation strategies
 */

import type { TournamentType } from '../../types/tournament.types';
import type { IBracketGenerator } from './types';
import { standardBracketGenerator } from '../standardBracketGenerator';
import { swissBracketGenerator } from '../swissBracketGenerator';

/**
 * Registry mapping tournament types to their bracket generators
 * Add new tournament types here to extend the system
 */
export const bracketGenerators: Record<TournamentType, IBracketGenerator> = {
  single_elimination: standardBracketGenerator,
  double_elimination: standardBracketGenerator,
  round_robin: standardBracketGenerator,
  swiss: swissBracketGenerator,
};

/**
 * Get the appropriate bracket generator for a tournament type
 * @param type - Tournament type
 * @returns Bracket generator instance
 */
export function getBracketGenerator(type: TournamentType): IBracketGenerator {
  const generator = bracketGenerators[type];

  if (!generator) {
    throw new Error(`No bracket generator found for tournament type: ${type}`);
  }

  return generator;
}

// Re-export types for convenience
export type { IBracketGenerator, BracketGeneratorResult } from './types';
