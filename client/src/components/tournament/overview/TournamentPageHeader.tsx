import type { ReactNode } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { Box, Chip, Stack, Tab, Tabs, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import type { Tournament } from '../../../types';

export type TournamentPageTab = 'overview' | 'leaderboard';

interface TournamentPageHeaderProps {
  tournamentId: number;
  name: string;
  status: Tournament['status'];
  location?: string;
  tab: TournamentPageTab;
  /** Extra chips after the status (the leaderboard's format and round). */
  chips?: ReactNode;
}

/**
 * The top of a tournament's public pages: status, name, location and the
 * Overview / Leaderboard tabs. Both pages render it, so switching tab keeps
 * the same header and a way back — the leaderboard used to have a header
 * of its own and no tabs at all.
 */
export function TournamentPageHeader({
  tournamentId,
  name,
  status,
  location,
  tab,
  chips,
}: TournamentPageHeaderProps) {
  const { t } = useTranslation();
  const isLive = status === 'in_progress';
  const isComplete = status === 'completed';

  const statusLabel = isComplete
    ? t('overviewPage.status.completed')
    : isLive
      ? t('overviewPage.status.inProgress')
      : t('overviewPage.status.setup');

  return (
    <Box>
      <Stack spacing={1} sx={{ mb: 2 }}>
        <Box display="flex" alignItems="center" gap={1} flexWrap="wrap">
          <Chip
            label={statusLabel}
            color={isComplete ? 'primary' : isLive ? 'success' : 'default'}
            size="small"
            sx={{ fontWeight: 600 }}
          />
          {chips}
        </Box>
        <Typography variant="h3" fontWeight={700} sx={{ overflowWrap: 'anywhere' }}>
          {name}
        </Typography>
        {location && (
          <Typography variant="body2" color="text.secondary">
            {location}
          </Typography>
        )}
      </Stack>

      <Tabs
        value={tab}
        sx={{ borderBottom: 1, borderColor: 'divider' }}
        aria-label={name}
      >
        <Tab
          value="overview"
          label={t('overviewPage.tabs.overview')}
          component={RouterLink}
          to={`/tournament/${tournamentId}`}
        />
        <Tab
          value="leaderboard"
          label={t('overviewPage.tabs.leaderboard')}
          component={RouterLink}
          to={`/tournament/${tournamentId}/leaderboard`}
        />
      </Tabs>
    </Box>
  );
}
