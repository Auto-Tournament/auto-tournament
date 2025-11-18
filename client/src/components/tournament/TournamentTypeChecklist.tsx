import React from 'react';
import { Card, List, ListItem, ListItemIcon, ListItemText } from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CancelIcon from '@mui/icons-material/Cancel';
import { TOURNAMENT_TYPES } from '../../constants/tournament';

type TournamentType = (typeof TOURNAMENT_TYPES)[number];

interface TournamentTypeChecklistProps {
  tournamentName: string;
  tournamentType: TournamentType | undefined;
  format: string;
  teamCount: number;
  mapsCount: number;
}

export function TournamentTypeChecklist({
  tournamentName,
  tournamentType,
  format,
  teamCount,
  mapsCount,
}: TournamentTypeChecklistProps) {
  const requirements: Array<{
    label: string;
    met: boolean;
  }> = [];

  // Tournament name requirement
  requirements.push({
    label: 'Tournament name',
    met: tournamentName.trim().length > 0,
  });

  // Minimum teams requirement
  if (tournamentType?.minTeams) {
    requirements.push({
      label: `Minimum ${tournamentType.minTeams} team${tournamentType.minTeams !== 1 ? 's' : ''}`,
      met: teamCount >= tournamentType.minTeams,
    });
  }

  // Power of 2 requirement (only for veto formats: bo1, bo3, bo5)
  const isVetoFormat = ['bo1', 'bo3', 'bo5'].includes(format);
  if (isVetoFormat && tournamentType?.requirePowerOfTwo && tournamentType.validCounts) {
    const isValidCount = tournamentType.validCounts.includes(teamCount);
    requirements.push({
      label: 'Power of 2 team count',
      met: isValidCount,
    });
  }

  // Maps requirement
  if (isVetoFormat) {
    // Veto formats require exactly 7 maps
    requirements.push({
      label: '7 maps selected (for veto)',
      met: mapsCount === 7,
    });
  } else {
    // Other formats just need at least 1 map
    requirements.push({
      label: 'Maps selected',
      met: mapsCount > 0,
    });
  }

  const allMet = requirements.every((req) => req.met);

  return (
    <Card sx={{ p: 2 }}>
      <List dense sx={{ py: 0 }}>
        {requirements.map((requirement, index) => (
          <ListItem key={index} sx={{ px: 0, py: 0.25 }}>
            <ListItemIcon sx={{ minWidth: 28 }}>
              {requirement.met ? (
                <CheckCircleIcon color="success" fontSize="small" />
              ) : (
                <CancelIcon color="error" fontSize="small" />
              )}
            </ListItemIcon>
            <ListItemText
              primary={requirement.label}
              primaryTypographyProps={{
                variant: 'body2',
                sx: {
                  color: requirement.met ? 'text.primary' : 'text.secondary',
                  fontWeight: requirement.met ? 500 : 400,
                },
              }}
            />
          </ListItem>
        ))}
      </List>
    </Card>
  );
}
