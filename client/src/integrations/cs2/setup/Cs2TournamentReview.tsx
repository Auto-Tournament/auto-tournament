import { Box, Typography } from '@mui/material';
import { useModuleTranslation } from '../../../module-sdk';
import type { TournamentSettingsStepProps } from '../../types';
import { cs2SettingsOf } from './cs2TournamentSettings';
import { useCs2MapData } from './useCs2MapData';

/**
 * The maps line of the review of a tournament not created yet, by display
 * name, which needs the map catalogue. One `dt`/`dd` pair inside the core
 * review's list.
 */
export function Cs2TournamentReview({ settings }: TournamentSettingsStepProps) {
  const { t } = useModuleTranslation('cs2');
  const { availableMaps } = useCs2MapData();
  const { maps } = cs2SettingsOf(settings);
  const name = (id: string) => availableMaps.find((m) => m.id === id)?.displayName ?? id;

  return (
    <Box data-testid="tournament-review-maps">
      <Typography component="dt" variant="body2" fontWeight={600}>
        {t('tournament.wizard.mapsHeading', { total: maps.length })}
      </Typography>
      <Typography component="dd" variant="body2" sx={{ m: 0, color: 'text.secondary' }}>
        {maps.map(name).join(', ') || t('tournament.wizard.noMapsSelected')}
      </Typography>
    </Box>
  );
}
