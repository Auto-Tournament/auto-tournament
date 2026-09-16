import { Alert, AlertTitle, Box } from '@mui/material';
import EmojiEventsIcon from '@mui/icons-material/EmojiEvents';
import { useTranslation } from 'react-i18next';
import type { Tournament } from '../../types';
import { TeamNameLink } from '../team/TeamNameLink';

interface ChampionBannerProps {
  tournament: Pick<Tournament, 'status' | 'type' | 'winner'>;
}

/**
 * Shows the champion of a completed tournament. For round robin the
 * API leaves `winner` null when the top spot is shared, and shuffle
 * tournaments rank players rather than teams, so nothing is shown then.
 */
export function ChampionBanner({ tournament }: ChampionBannerProps) {
  const { t } = useTranslation();

  if (tournament.status !== 'completed' || !tournament.winner) {
    return null;
  }

  return (
    <Alert
      data-testid="tournament-champion"
      severity="success"
      icon={<EmojiEventsIcon fontSize="inherit" />}
      sx={{ mb: 3, alignItems: 'center' }}
    >
      <AlertTitle sx={{ mb: 0 }}>{t('tournament.champion.title')}</AlertTitle>
      <Box display="flex" alignItems="center" gap={1}>
        <TeamNameLink
          teamId={tournament.winner.id}
          name={tournament.winner.name}
          tag={tournament.winner.tag}
          variant="h6"
          sx={{ fontWeight: 700 }}
        />
      </Box>
    </Alert>
  );
}
