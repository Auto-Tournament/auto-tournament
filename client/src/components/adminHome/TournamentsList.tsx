import { Link as RouterLink } from 'react-router-dom';
import { Box, Button, Chip } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { GameMark } from '../common/GameMark';
import { EmptyPanel, LiveChip, Row, RowList, SectionHead } from '../common/ui';
import type { TournamentSummary } from '../../hooks/useTournamentList';
import { paths, tournamentTabPath } from '../../paths';
import { formatBadge } from '../../utils/tournamentSummary';
import { tokens, textSize } from '../../theme/tokens';

const { color } = tokens;

interface TournamentsListProps {
  tournaments: TournamentSummary[];
  loading: boolean;
}

type ActionKey = 'manage' | 'continueSetup' | 'view';

/** Status -> (chip label key, next action). */
function statusMeta(status: TournamentSummary['status']): { chipKey: string; actionKey: ActionKey } {
  switch (status) {
    case 'ready':
      return { chipKey: 'dashboard.tournaments.status.ready', actionKey: 'manage' };
    case 'in_progress':
      return { chipKey: 'dashboard.tournaments.status.inProgress', actionKey: 'manage' };
    case 'completed':
      return { chipKey: 'dashboard.tournaments.status.completed', actionKey: 'view' };
    case 'setup':
    default:
      return { chipKey: 'dashboard.tournaments.status.setup', actionKey: 'continueSetup' };
  }
}

/**
 * Admin home's tournament section (the draft's "Tournaments" row list).
 *
 * 3.0 hosts one tournament per site (multi-tournament is 3.1), so this is that
 * one row, titled in the singular, or an empty panel while there is none. The
 * row says where it stands with what the tournament record has: the matches
 * live while it runs, the entries before, the winner after. Never invented
 * detail.
 */
export function TournamentsList({ tournaments, loading }: TournamentsListProps) {
  const { t } = useTranslation();
  const current = tournaments[0];

  const stateLine = (tournament: TournamentSummary): string => {
    const { status, teamCount, winner, liveMatchCount } = tournament;
    const teams = t('dashboard.tournaments.state.teams', { count: teamCount });
    if (status === 'completed') {
      return winner
        ? [t('dashboard.tournaments.state.winner', { name: winner.name }), teams].join(' · ')
        : t('dashboard.tournaments.state.completed', { count: teamCount });
    }
    if (status === 'in_progress') {
      return [teams, liveMatchCount ? t('dashboard.tournaments.state.live', { count: liveMatchCount }) : null]
        .filter(Boolean)
        .join(' · ');
    }
    const format = [t(`tournament.typeSelector.types.${tournament.type}.label`), formatBadge(tournament.format)];
    if (status === 'ready') {
      return [t('dashboard.tournaments.state.entered', { count: teamCount }), ...format].join(' · ');
    }
    // 'setup': a draft, not started.
    return [
      teamCount > 0
        ? t('dashboard.tournaments.state.draftTeams', { count: teamCount })
        : t('dashboard.tournaments.state.draftEmpty'),
      ...format,
    ].join(' · ');
  };

  const actionHref = (tournament: TournamentSummary, actionKey: ActionKey): string => {
    if (actionKey === 'continueSetup') return paths.tournament;
    if (actionKey === 'view') return tournamentTabPath(tournament.id);
    return paths.manage;
  };

  if (loading) {
    return null;
  }

  return (
    <Box component="section" aria-labelledby="admin-home-tournament-title" data-testid="admin-home-tournaments">
      <SectionHead
        id="admin-home-tournament-title"
        title={t('dashboard.tournaments.title')}
        link={
          current
            ? {
                to: tournamentTabPath(current.id),
                label: t('dashboard.tournaments.eventPage'),
                'data-testid': 'admin-home-tournament-event-page',
              }
            : undefined
        }
      />
      {!current ? (
        <EmptyPanel
          level={3}
          title={t('dashboard.tournaments.emptyTitle')}
          description={t('dashboard.tournaments.empty')}
          data-testid="admin-home-tournaments-empty"
        />
      ) : (
        <RowList>
          {tournaments.map((tournament) => {
            const { chipKey, actionKey } = statusMeta(tournament.status);
            return (
              <Row
                key={tournament.id}
                columns={{ xs: 'auto minmax(0, 1fr)', sm: 'auto minmax(0, 1fr) auto auto' }}
                data-testid={`admin-home-tournament-${tournament.id}`}
              >
                <GameMark name={tournament.game ?? tournament.name} slug={tournament.game} size={36} />
                <Box sx={{ minWidth: 0 }}>
                  <Box component="b" sx={{ display: 'block', fontWeight: 600, overflowWrap: 'anywhere' }}>
                    {tournament.name}
                  </Box>
                  <Box component="small" sx={{ display: 'block', color: color.muted, fontSize: textSize.xs }}>
                    {stateLine(tournament)}
                  </Box>
                </Box>
                <Box sx={{ gridColumn: { xs: 2, sm: 'auto' }, justifySelf: 'start' }}>
                  {tournament.status === 'in_progress' ? (
                    <LiveChip label={t(chipKey)} />
                  ) : (
                    <Chip size="small" label={t(chipKey)} />
                  )}
                </Box>
                <Box sx={{ gridColumn: { xs: 2, sm: 'auto' }, justifySelf: 'start' }}>
                  <Button
                    variant={actionKey === 'manage' ? 'contained' : 'outlined'}
                    size="small"
                    component={RouterLink}
                    to={actionHref(tournament, actionKey)}
                    data-testid={`admin-home-tournament-${tournament.id}-action`}
                  >
                    {t(`dashboard.tournaments.actions.${actionKey}`)}
                  </Button>
                </Box>
              </Row>
            );
          })}
        </RowList>
      )}
    </Box>
  );
}
