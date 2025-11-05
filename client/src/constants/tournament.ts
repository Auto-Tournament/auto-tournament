export const TOURNAMENT_TYPES: Array<{
  value: string;
  label: string;
  description?: string;
  minTeams?: number;
  maxTeams?: number;
  requirePowerOfTwo?: boolean;
  validCounts?: number[];
  disabled?: boolean;
}> = [
  {
    value: 'single_elimination',
    label: 'Single Elimination',
    description: "One loss and you're out.",
    minTeams: 2,
    maxTeams: 128,
    requirePowerOfTwo: true,
    validCounts: [2, 4, 8, 16, 32, 64, 128],
  },
  {
    value: 'double_elimination',
    label: 'Double Elimination',
    description: 'Two losses to be eliminated.',
    minTeams: 2,
    maxTeams: 128,
    requirePowerOfTwo: true,
    validCounts: [2, 4, 8, 16, 32, 64, 128],
  },
  {
    value: 'round_robin',
    label: 'Round Robin',
    description: 'Everyone plays everyone.',
    minTeams: 2,
    maxTeams: 32,
  },
  {
    value: 'swiss',
    label: 'Swiss System',
    description: 'Similar records face each other.',
    minTeams: 4,
    maxTeams: 64,
  },
];

export const MATCH_FORMATS = [
  { value: 'bo1', label: 'Best of 1' },
  { value: 'bo3', label: 'Best of 3' },
  { value: 'bo5', label: 'Best of 5' },
];

// Current CS2 competitive map pool (same as majors)
export const CS2_MAPS = [
  'de_ancient',
  'de_anubis',
  'de_dust2',
  'de_inferno',
  'de_mirage',
  'de_nuke',
  'de_vertigo',
];
