import { Box, Card, CardContent, Chip, Divider, Stack, Typography } from '@mui/material';
import EmojiEventsIcon from '@mui/icons-material/EmojiEvents';
import { useTranslation } from 'react-i18next';
import { formatDate, getBracketMatchLabel } from '../../../utils/matchUtils';
import { tokens, radii } from '../../../theme/tokens';
import type { TeamMatchInfo, TeamMatchHistory, TeamStanding } from '../../../types';

interface TeamTournamentInfo {
  name: string;
  status: string;
}

interface TeamTournamentsProps {
  hasMatch: boolean;
  match: TeamMatchInfo | null;
  tournament: TeamTournamentInfo | null;
  standing: TeamStanding | null;
  recentResults: TeamMatchHistory[];
}

/**
 * The current tournament (if any) and recent completed results.
 *
 * This app runs a single tournament at a time, so "Tournaments" is really
 * "the current tournament's status, plus whatever match history the DB kept"
 * — there is no record of past, separate tournaments to list alongside it.
 */
export function TeamTournaments({
  hasMatch,
  match,
  tournament,
  standing,
  recentResults,
}: TeamTournamentsProps) {
  const { t } = useTranslation();

  if (!tournament && recentResults.length === 0) {
    return null;
  }

  const isLive = hasMatch && (match?.status === 'live' || match?.status === 'loaded');
  const isUpcoming = hasMatch && (match?.status === 'pending' || match?.status === 'ready');

  return (
    <Card data-testid="team-profile-tournaments">
      <CardContent>
        <Box display="flex" alignItems="center" gap={1} mb={2}>
          <EmojiEventsIcon color="primary" />
          <Typography variant="h6" fontWeight={600}>
            {t('teamProfile.tournaments.title')}
          </Typography>
        </Box>

        {tournament && (
          <Box
            data-testid="team-profile-current-tournament"
            sx={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 2,
              p: 1.5,
              borderRadius: radii.sm,
              border: 1,
              borderColor: 'divider',
              flexWrap: 'wrap',
            }}
          >
            <Box minWidth={0}>
              <Typography variant="body1" fontWeight={600} noWrap>
                {tournament.name}
              </Typography>
              {hasMatch && match?.opponent?.name && (
                <Typography variant="body2" color="text.secondary">
                  {t('teamProfile.tournaments.versus', { opponent: match.opponent.name })}
                </Typography>
              )}
            </Box>
            {isLive ? (
              <Chip
                size="small"
                color="success"
                label={t('teamProfile.tournaments.live')}
                sx={{ fontWeight: 700 }}
              />
            ) : isUpcoming ? (
              <Chip size="small" variant="outlined" label={t('teamProfile.tournaments.upcoming')} />
            ) : tournament.status === 'completed' && standing ? (
              <Chip
                size="small"
                label={t('teamProfile.tournaments.finalPlacement', {
                  position: standing.position,
                  total: standing.totalTeams,
                })}
              />
            ) : standing ? (
              <Chip
                size="small"
                variant="outlined"
                label={t('teamProfile.tournaments.placement', {
                  position: standing.position,
                  total: standing.totalTeams,
                })}
              />
            ) : null}
          </Box>
        )}

        {recentResults.length > 0 && (
          <>
            {tournament && <Divider sx={{ my: 2 }} />}
            <Typography variant="subtitle2" color="text.secondary" mb={1}>
              {t('teamProfile.tournaments.recentResults')}
            </Typography>
            <Stack spacing={1}>
              {recentResults.map((result) => (
                <Box
                  key={result.slug}
                  data-testid="team-profile-result-row"
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 2,
                    p: 1.25,
                    borderRadius: radii.sm,
                    border: 1,
                    borderColor: 'divider',
                    borderLeft: 4,
                    borderLeftColor: result.won ? tokens.color.live : tokens.color.ban,
                    flexWrap: 'wrap',
                  }}
                >
                  <Box minWidth={0}>
                    <Typography variant="body2" fontWeight={600} noWrap>
                      {t('teamProfile.tournaments.versus', {
                        opponent: result.opponent?.name || '—',
                      })}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {getBracketMatchLabel(result) || formatDate(result.completedAt)}
                    </Typography>
                  </Box>
                  <Chip
                    size="small"
                    label={`${result.won ? t('teamProfile.tournaments.win') : t('teamProfile.tournaments.loss')} ${result.teamScore}-${result.opponentScore}`}
                    color={result.won ? 'success' : 'error'}
                    variant="outlined"
                  />
                </Box>
              ))}
            </Stack>
          </>
        )}
      </CardContent>
    </Card>
  );
}
