import type { TournamentType } from '../types/tournament.types';

export const calculateTotalRounds = (teamCount: number, type: TournamentType): number => {
  switch (type) {
    case 'single_elimination':
      return Math.ceil(Math.log2(teamCount));
    case 'double_elimination': {
      // Winners bracket rounds + Losers bracket rounds + Grand finals
      const wbRounds = Math.ceil(Math.log2(teamCount));
      const lbRounds = wbRounds * 2 - 2;
      return wbRounds + lbRounds + 1;
    }
    case 'round_robin':
      // Each team plays every other team once
      return teamCount % 2 === 0 ? teamCount - 1 : teamCount;
    case 'swiss':
      // Typically 4-7 rounds depending on team count
      return Math.ceil(Math.log2(teamCount));
    default:
      return 0;
  }
};

export const isPowerOfTwo = (n: number): boolean => {
  return n > 0 && (n & (n - 1)) === 0;
};

export const validateTeamCount = (type: string, count: number): void => {
  switch (type) {
    case 'single_elimination':
    case 'double_elimination':
      if (!isPowerOfTwo(count)) {
        const validCounts = [2, 4, 8, 16, 32, 64, 128].filter((n) => n >= count);
        throw new Error(
          `${
            type === 'single_elimination' ? 'Single' : 'Double'
          } Elimination requires a power-of-2 team count. ` +
            `Valid options: ${validCounts.join(', ')}`
        );
      }
      if (count < 2 || count > 128) {
        throw new Error(`Team count must be between 2 and 128`);
      }
      break;
    case 'round_robin':
      if (count < 2 || count > 32) {
        throw new Error(`Round Robin requires 2-32 teams. You have ${count} teams.`);
      }
      break;
    case 'swiss':
      if (count < 4 || count > 64) {
        throw new Error(`Swiss System requires 4-64 teams. You have ${count} teams.`);
      }
      break;
    default:
      throw new Error(`Unknown tournament type: ${type}`);
  }
};
