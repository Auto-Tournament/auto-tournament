import { TOURNAMENT_TYPES } from '../constants/tournament';

export const isTournamentTypeValid = (
  tournamentType: (typeof TOURNAMENT_TYPES)[number],
  teamCount: number
): boolean => {
  if (teamCount < (tournamentType.minTeams || 0)) return false;
  if (teamCount > (tournamentType.maxTeams || Infinity)) return false;
  if (tournamentType.requirePowerOfTwo && tournamentType.validCounts) {
    return tournamentType.validCounts.includes(teamCount);
  }
  return true;
};

export const validateTeamCountForType = (
  type: string,
  teamCount: number
): { isValid: boolean; error?: string } => {
  const tournamentType = TOURNAMENT_TYPES.find((t) => t.value === type);

  if (!tournamentType) {
    return { isValid: false, error: 'Invalid tournament type' };
  }

  // Shuffle tournaments don't use teams, so skip validation
  if (type === 'shuffle') {
    return { isValid: true };
  }

  if (!isTournamentTypeValid(tournamentType, teamCount)) {
    if (tournamentType.requirePowerOfTwo && tournamentType.validCounts) {
      return {
        isValid: false,
        error:
          `${
            tournamentType.label
          } requires a power-of-2 team count (${tournamentType.validCounts.join(', ')}). ` +
          `You selected ${teamCount} team(s).`,
      };
    }
    if (tournamentType.minTeams && teamCount < tournamentType.minTeams) {
      return {
        isValid: false,
        error:
          `${tournamentType.label} requires at least ${tournamentType.minTeams} teams. ` +
          `You selected ${teamCount} team(s).`,
      };
    }
    if (tournamentType.maxTeams && teamCount > tournamentType.maxTeams) {
      return {
        isValid: false,
        error:
          `${tournamentType.label} allows maximum ${tournamentType.maxTeams} teams. ` +
          `You selected ${teamCount} team(s).`,
      };
    }
  }

  return { isValid: true };
};
