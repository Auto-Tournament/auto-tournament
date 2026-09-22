import { Link as RouterLink } from 'react-router-dom';
import { Box, Button, Card, Chip, List, ListItem, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { GameMark } from '../common/GameMark';
import type { TournamentSummary } from '../../hooks/useTournamentList';

interface TournamentsListProps {
  tournaments: TournamentSummary[];
  loading: boolean;
}

type ChipColor = 'default' | 'success' | 'info' | 'warning';

/** Status -> (chip label key, chip colour, next-action). */
function statusMeta(status: TournamentSummary['status']): {
  chipKey: string;
  chipColor: ChipColor;
  actionKey: string;
} {
  switch (status) {
    case 'setup':
      return { chipKey: 'dashboard.tournaments.status.setup', chipColor: 'default', actionKey: 'continueSetup' };
    case 'ready':
      return { chipKey: 'dashboard.tournaments.status.ready', chipColor: 'info', actionKey: 'manage' };
    case 'in_progress':
      return { chipKey: 'dashboard.tournaments.status.inProgress', chipColor: 'success', actionKey: 'manage' };
    case 'completed':
      return { chipKey: 'dashboard.tournaments.status.completed', chipColor: 'default', actionKey: 'view' };
    default:
      return { chipKey: 'dashboard.tournaments.status.setup', chipColor: 'default', actionKey: 'continueSetup' };
  }
}

/**
 * Admin home's Tournaments list: one row per tournament this instance knows
 * about (0 or 1 today — see `useTournamentList`), with a one-line state and
 * the next action (Manage / Continue setup / View). All of it is real data:
 * team counts and the winner come straight off the tournament record, never
 * invented match/round detail we don't have from this hook.
 */
export function TournamentsList({ tournaments, loading }: TournamentsListProps) {
  const { t } = useTranslation();

  const stateLine = (tournament: TournamentSummary): string => {
    const { status, teamCount, winner } = tournament;
    if (status === 'completed') {
      return winner
        ? t('dashboard.tournaments.state.winner', { name: winner.name })
        : t(
            teamCount === 1
              ? 'dashboard.tournaments.state.completedTeams'
              : 'dashboard.tournaments.state.completedTeamsPlural',
            { count: teamCount }
          );
    }
    if (status === 'in_progress') {
      return t(
        teamCount === 1
          ? 'dashboard.tournaments.state.inProgressTeams'
          : 'dashboard.tournaments.state.inProgressTeamsPlural',
        { count: teamCount }
      );
    }
    if (status === 'ready') {
      return t(
        teamCount === 1 ? 'dashboard.tournaments.state.readyTeams' : 'dashboard.tournaments.state.readyTeamsPlural',
        { count: teamCount }
      );
    }
    // 'setup' (draft, not yet published)
    return teamCount > 0
      ? t(
          teamCount === 1 ? 'dashboard.tournaments.state.draftTeams' : 'dashboard.tournaments.state.draftTeamsPlural',
          { count: teamCount }
        )
      : t('dashboard.tournaments.state.draftEmpty');
  };

  const actionHref = (tournament: TournamentSummary, actionKey: string): string => {
    if (actionKey === 'continueSetup') return '/tournament';
    if (actionKey === 'view') return `/tournament/${tournament.id}`;
    return '/manage';
  };

  if (loading) {
    return null;
  }

  return (
    <Box component="section" data-testid="admin-home-tournaments">
      <Typography variant="h5" fontWeight={700} mb={2}>
        {t('dashboard.tournaments.title')}
      </Typography>
      {tournaments.length === 0 ? (
        <Card variant="outlined" sx={{ p: 3 }}>
          <Typography variant="body2" color="text.secondary" data-testid="admin-home-tournaments-empty">
            {t('dashboard.tournaments.empty')}
          </Typography>
        </Card>
      ) : (
        <List
          disablePadding
          sx={{ border: 1, borderColor: 'divider', borderRadius: 2, overflow: 'hidden' }}
        >
          {tournaments.map((tournament) => {
            const { chipKey, chipColor, actionKey } = statusMeta(tournament.status);
            return (
              <ListItem
                key={tournament.id}
                divider
                data-testid={`admin-home-tournament-${tournament.id}`}
                sx={{
                  display: 'flex',
                  gap: 2,
                  alignItems: 'center',
                  flexWrap: 'wrap',
                }}
              >
                <GameMark name={tournament.game ?? tournament.name} slug={tournament.game} size={36} />
                <Box sx={{ minWidth: 0, flex: 1 }}>
                  <Typography variant="subtitle1" fontWeight={600} noWrap>
                    {tournament.name}
                  </Typography>
                  <Typography variant="body2" color="text.secondary" noWrap>
                    {stateLine(tournament)}
                  </Typography>
                </Box>
                <Chip size="small" color={chipColor} label={t(chipKey)} sx={{ fontWeight: 600 }} />
                <Button
                  variant={actionKey === 'manage' ? 'contained' : 'outlined'}
                  size="small"
                  component={RouterLink}
                  to={actionHref(tournament, actionKey)}
                  data-testid={`admin-home-tournament-${tournament.id}-action`}
                >
                  {t(`dashboard.tournaments.actions.${actionKey}`)}
                </Button>
              </ListItem>
            );
          })}
        </List>
      )}
    </Box>
  );
}
