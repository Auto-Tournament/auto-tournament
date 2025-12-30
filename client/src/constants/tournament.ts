export interface TournamentType {
  value: string;
  label: string;
  description: string;
  category: 'professional' | 'party';
  icon?: string; // Material-UI icon name
  minTeams?: number;
  maxTeams?: number;
  requirePowerOfTwo?: boolean;
  validCounts?: number[];
  disabled?: boolean;
}

export const TOURNAMENT_TYPES: TournamentType[] = [
  {
    value: 'single_elimination',
    label: 'Single Elimination',
    description: "One loss and you're out. Classic bracket format used in professional tournaments.",
    category: 'professional',
    icon: 'EmojiEvents',
    minTeams: 2,
    maxTeams: 128,
    requirePowerOfTwo: true,
    validCounts: [2, 4, 8, 16, 32, 64, 128],
  },
  {
    value: 'double_elimination',
    label: 'Double Elimination',
    description: 'Two losses to be eliminated. Teams get a second chance in the lower bracket.',
    category: 'professional',
    icon: 'WorkspacePremium',
    minTeams: 2,
    maxTeams: 128,
    requirePowerOfTwo: true,
    validCounts: [2, 4, 8, 16, 32, 64, 128],
  },
  {
    value: 'round_robin',
    label: 'Round Robin',
    description: 'Everyone plays everyone. Perfect for league-style competitions.',
    category: 'professional',
    icon: 'Groups',
    minTeams: 2,
    maxTeams: 32,
  },
  {
    value: 'swiss',
    label: 'Swiss System',
    description: 'Similar records face each other. Balanced matchups throughout the tournament.',
    category: 'professional',
    icon: 'Shuffle',
    minTeams: 4,
    maxTeams: 64,
  },
  {
    value: 'shuffle',
    label: 'Shuffle Tournament',
    description: 'Players are dynamically shuffled into balanced teams each round. Individual player competition with ELO-based team balancing.',
    category: 'party',
    icon: 'Casino',
    minTeams: 0, // Not team-based, player-based
    maxTeams: 0, // Not team-based, player-based
    requirePowerOfTwo: false,
  },
];

export const TOURNAMENT_CATEGORIES = [
  {
    id: 'professional',
    label: 'Professional Series',
    description: 'Traditional tournament formats used in competitive play',
  },
  {
    id: 'party',
    label: 'Party & Fun',
    description: 'Casual formats for community events and fun competitions',
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
