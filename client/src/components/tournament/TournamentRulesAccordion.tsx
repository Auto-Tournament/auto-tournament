import React from 'react';
import {
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Typography,
  List,
  ListItem,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';

interface TournamentRulesAccordionProps {
  format?: 'bo1' | 'bo3' | 'bo5';
  maxRounds?: number;
  overtimeMode?: 'enabled' | 'disabled';
  overtimeSegments?: number;
}

export const TournamentRulesAccordion: React.FC<TournamentRulesAccordionProps> = ({
  format,
  maxRounds,
  overtimeMode,
  overtimeSegments,
}) => {
  const effectiveFormat = format || 'bo1';

  const formatDescription =
    effectiveFormat === 'bo3'
      ? 'Best of 3 maps – first team to win 2 maps wins the match.'
      : effectiveFormat === 'bo5'
      ? 'Best of 5 maps – first team to win 3 maps wins the match.'
      : 'Best of 1 map – the map winner wins the match.';

  const regulationDescription = maxRounds
    ? `Each map is played up to ${maxRounds} rounds. The team with more rounds at the end of regulation wins the map.`
    : 'Each map is played for a fixed number of rounds. The team with more rounds at the end of regulation wins the map.';

  let overtimeDescription: string;
  let tiebreakDescription: string;

  const hasOvertimeMode = typeof overtimeMode === 'string';
  const hasOvertimeSegments = typeof overtimeSegments === 'number';

  if (overtimeMode === 'disabled' && overtimeSegments === 0) {
    overtimeDescription = 'Overtime: disabled (regulation only).';
    tiebreakDescription =
      'If regulation ends with equal scores, the match does not go to overtime. Instead, the winner is decided by total team damage across the map. If total damage is also exactly equal, the result is a true draw.';
  } else if (overtimeMode === 'enabled' && hasOvertimeSegments && overtimeSegments! > 0) {
    overtimeDescription = `Overtime: enabled with up to ${overtimeSegments} overtime segment${
      overtimeSegments === 1 ? '' : 's'
    }.`;
    tiebreakDescription =
      'If the score is still tied after the configured overtime segments, the winner is decided by total team damage across the map. If total damage is also tied, the result is recorded as a draw.';
  } else if (overtimeMode === 'enabled') {
    overtimeDescription =
      'Overtime: enabled. Tied regulation scores will trigger overtime until one team finishes ahead.';
    tiebreakDescription =
      'In normal play, a higher final score decides the winner. Draws are rare and only occur if both score and damage remain exactly tied.';
  } else if (!hasOvertimeMode && hasOvertimeSegments && overtimeSegments === 0) {
    // Config coming primarily from segments but without explicit overtimeMode flag.
    overtimeDescription = 'Overtime: effectively disabled (regulation only).';
    tiebreakDescription =
      'If regulation ends with equal scores, the match does not go to overtime. The winner is decided by total team damage across the map; if damage is tied, the match is a draw.';
  } else if (!hasOvertimeMode && hasOvertimeSegments && overtimeSegments! > 0) {
    overtimeDescription = `Overtime: enabled with up to ${overtimeSegments} overtime segment${
      overtimeSegments === 1 ? '' : 's'
    } (implicit).`;
    tiebreakDescription =
      'If the score is still tied after the configured overtime segments, the winner is decided by total team damage. If damage is tied, the result is a draw.';
  } else {
    overtimeDescription = 'Overtime: standard settings. Tied regulation scores usually trigger overtime.';
    tiebreakDescription =
      'In most cases, the team with the higher final score wins. Only when both score and total damage are exactly tied is the result recorded as a true draw.';
  }

  return (
    <Accordion>
      <AccordionSummary expandIcon={<ExpandMoreIcon />}>
        <Typography variant="subtitle1" fontWeight={600}>
          About this tournament
        </Typography>
      </AccordionSummary>
      <AccordionDetails>
        <Typography variant="body2" color="text.secondary" paragraph>
          These are the core rules used to decide matches in this tournament.
        </Typography>
        <List dense sx={{ listStyleType: 'disc', pl: 3 }}>
          <ListItem sx={{ display: 'list-item', py: 0.25 }}>
            <Typography variant="body2">
              <strong>Match format:</strong> {formatDescription}
            </Typography>
          </ListItem>
          <ListItem sx={{ display: 'list-item', py: 0.25 }}>
            <Typography variant="body2">
              <strong>Regulation rounds:</strong> {regulationDescription}
            </Typography>
          </ListItem>
          <ListItem sx={{ display: 'list-item', py: 0.25 }}>
            <Typography variant="body2">
              <strong>Overtime:</strong> {overtimeDescription}
            </Typography>
          </ListItem>
          <ListItem sx={{ display: 'list-item', py: 0.25 }}>
            <Typography variant="body2">
              <strong>How ties are resolved:</strong> {tiebreakDescription}
            </Typography>
          </ListItem>
        </List>
      </AccordionDetails>
    </Accordion>
  );
};


