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
import { useTranslation } from 'react-i18next';

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
  const { t } = useTranslation();
  const effectiveFormat = format || 'bo1';

  const formatDescription = t(`tournamentRules.format.${effectiveFormat}`);

  const regulationDescription = maxRounds
    ? t('tournamentRules.regulationWithRounds', { rounds: maxRounds })
    : t('tournamentRules.regulationGeneric');

  let overtimeDescription: string;
  let tiebreakDescription: string;

  const hasOvertimeMode = typeof overtimeMode === 'string';
  const hasOvertimeSegments = typeof overtimeSegments === 'number';

  if (overtimeMode === 'disabled' && overtimeSegments === 0) {
    overtimeDescription = t('tournamentRules.overtime.disabled');
    tiebreakDescription = t('tournamentRules.tiebreak.disabled');
  } else if (overtimeMode === 'enabled' && hasOvertimeSegments && overtimeSegments! > 0) {
    overtimeDescription = t('tournamentRules.overtime.enabledSegments', {
      count: overtimeSegments,
    });
    tiebreakDescription = t('tournamentRules.tiebreak.enabledSegments');
  } else if (overtimeMode === 'enabled') {
    overtimeDescription = t('tournamentRules.overtime.enabled');
    tiebreakDescription = t('tournamentRules.tiebreak.enabled');
  } else if (!hasOvertimeMode && hasOvertimeSegments && overtimeSegments === 0) {
    // Config coming primarily from segments but without explicit overtimeMode flag.
    overtimeDescription = t('tournamentRules.overtime.effectivelyDisabled');
    tiebreakDescription = t('tournamentRules.tiebreak.effectivelyDisabled');
  } else if (!hasOvertimeMode && hasOvertimeSegments && overtimeSegments! > 0) {
    overtimeDescription = t('tournamentRules.overtime.implicitSegments', {
      count: overtimeSegments,
    });
    tiebreakDescription = t('tournamentRules.tiebreak.implicitSegments');
  } else {
    overtimeDescription = t('tournamentRules.overtime.standard');
    tiebreakDescription = t('tournamentRules.tiebreak.standard');
  }

  return (
    <Accordion>
      <AccordionSummary expandIcon={<ExpandMoreIcon />}>
        <Typography variant="subtitle1" fontWeight={600}>
          {t('tournamentRules.title')}
        </Typography>
      </AccordionSummary>
      <AccordionDetails>
        <Typography variant="body2" color="text.secondary" paragraph>
          {t('tournamentRules.intro')}
        </Typography>
        <List dense sx={{ listStyleType: 'disc', pl: 3 }}>
          <ListItem sx={{ display: 'list-item', py: 0.25 }}>
            <Typography variant="body2">
              <strong>{t('tournamentRules.matchFormatLabel')}</strong> {formatDescription}
            </Typography>
          </ListItem>
          <ListItem sx={{ display: 'list-item', py: 0.25 }}>
            <Typography variant="body2">
              <strong>{t('tournamentRules.regulationLabel')}</strong> {regulationDescription}
            </Typography>
          </ListItem>
          <ListItem sx={{ display: 'list-item', py: 0.25 }}>
            <Typography variant="body2">
              <strong>{t('tournamentRules.overtimeLabel')}</strong> {overtimeDescription}
            </Typography>
          </ListItem>
          <ListItem sx={{ display: 'list-item', py: 0.25 }}>
            <Typography variant="body2">
              <strong>{t('tournamentRules.tiesLabel')}</strong> {tiebreakDescription}
            </Typography>
          </ListItem>
        </List>
      </AccordionDetails>
    </Accordion>
  );
};
