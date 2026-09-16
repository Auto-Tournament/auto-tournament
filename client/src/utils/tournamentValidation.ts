import type { TFunction } from 'i18next';
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
  teamCount: number,
  t: TFunction
): { isValid: boolean; error?: string } => {
  const tournamentType = TOURNAMENT_TYPES.find((tt) => tt.value === type);

  if (!tournamentType) {
    return { isValid: false, error: t('tournament.teamValidation.invalidType') };
  }

  // Shuffle tournaments don't use teams, so skip validation
  if (type === 'shuffle') {
    return { isValid: true };
  }

  if (!isTournamentTypeValid(tournamentType, teamCount)) {
    const params = {
      type: t(`tournament.typeSelector.types.${tournamentType.value}.label`),
      selected: t('tournament.counts.teams', { count: teamCount }),
    };
    if (tournamentType.requirePowerOfTwo && tournamentType.validCounts) {
      return {
        isValid: false,
        error: t('tournament.teamValidation.powerOfTwo', {
          ...params,
          counts: tournamentType.validCounts.join(', '),
        }),
      };
    }
    if (tournamentType.minTeams && teamCount < tournamentType.minTeams) {
      return {
        isValid: false,
        error: t('tournament.teamValidation.minTeams', {
          ...params,
          min: tournamentType.minTeams,
        }),
      };
    }
    if (tournamentType.maxTeams && teamCount > tournamentType.maxTeams) {
      return {
        isValid: false,
        error: t('tournament.teamValidation.maxTeams', {
          ...params,
          max: tournamentType.maxTeams,
        }),
      };
    }
  }

  return { isValid: true };
};
