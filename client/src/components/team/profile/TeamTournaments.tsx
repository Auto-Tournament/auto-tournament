import { Box, Chip, Link, Typography } from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { formatDate, getBracketMatchLabel } from '../../../utils/matchUtils';
import { LiveChip, Panel, Row, RowList, SectionHead } from '../../common/ui';
import { fontDisplay, mono, textSize, tokens } from '../../../theme/tokens';
import { paths } from '../../../paths';
import type { TeamMatchInfo, TeamMatchHistory, TeamStanding } from '../../../types';

export interface TeamTournamentInfo {
  id?: number;
  name: string;
  status: string;
  game?: string;
  gameName?: string;
}

interface TeamTournamentsProps {
  teamId: string;
  hasMatch: boolean;
  match: TeamMatchInfo | null;
  tournament: TeamTournamentInfo | null;
  standing: TeamStanding | null;
  recentResults: TeamMatchHistory[];
}

/** A quiet "Open" link on the right of a row. */
function RowLink({ to, label, testId }: { to: string; label: string; testId?: string }) {
  return (
    <Link
      component={RouterLink}
      to={to}
      underline="none"
      data-testid={testId}
      sx={{
        color: tokens.color.muted,
        fontSize: textSize.sm,
        whiteSpace: 'nowrap',
        '&:hover': { color: tokens.color.ink },
      }}
    >
      {label}
    </Link>
  );
}

/**
 * The team page's second column (the draft's "Tournaments"): the tournament
 * the team is in — live, upcoming or its placement — and its latest results.
 *
 * This instance runs one tournament at a time and keeps no record of
 * earlier ones beyond their matches, so the list is that tournament and the
 * results the match history still holds.
 */
export function TeamTournaments({
  teamId,
  hasMatch,
  match,
  tournament,
  standing,
  recentResults,
}: TeamTournamentsProps) {
  const { t } = useTranslation();

  const isLive = hasMatch && (match?.status === 'live' || match?.status === 'loaded');
  const isUpcoming = hasMatch && !isLive;

  const placement = standing
    ? tournament?.status === 'completed'
      ? t('teamProfile.tournaments.finalPlacement', {
          position: standing.position,
          total: standing.totalTeams,
        })
      : t('teamProfile.tournaments.placement', {
          position: standing.position,
          total: standing.totalTeams,
        })
    : null;

  // What the row says under the tournament's name: the game, then the match
  // or the placement.
  const detail = [
    tournament?.gameName,
    hasMatch && match?.opponent?.name
      ? t('teamProfile.tournaments.versus', { opponent: match.opponent.name })
      : placement,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <Box data-testid="team-profile-tournaments">
      {tournament ? (
        <RowList>
          <Row
            columns="auto minmax(0, 1fr) auto"
            data-testid="team-profile-current-tournament"
          >
            {isLive ? (
              <LiveChip label={t('teamProfile.tournaments.live')} />
            ) : isUpcoming ? (
              <Chip size="small" label={t('teamProfile.tournaments.upcoming')} />
            ) : standing ? (
              <Box
                component="span"
                sx={{
                  fontFamily: fontDisplay,
                  fontWeight: 700,
                  fontSize: textSize.lg,
                  fontVariantNumeric: 'tabular-nums',
                  minWidth: '2.5rem',
                  color:
                    tournament.status === 'completed' && standing.position === 1
                      ? tokens.color.accent
                      : tokens.color.ink,
                }}
              >
                #{standing.position}
              </Box>
            ) : (
              <Chip size="small" label={t(`teamProfile.tournaments.status.${tournament.status}`, {
                defaultValue: tournament.status,
              })} />
            )}
            <Box minWidth={0}>
              <Typography variant="body2" fontWeight={600} noWrap>
                {tournament.name}
              </Typography>
              {detail && (
                <Typography variant="caption" color="text.secondary" component="div" noWrap>
                  {detail}
                </Typography>
              )}
            </Box>
            {hasMatch ? (
              <RowLink
                to={paths.teamMatch.replace(':teamId', teamId)}
                label={t('teamProfile.tournaments.openMatch')}
                testId="team-profile-open-match"
              />
            ) : typeof tournament.id === 'number' ? (
              <RowLink
                to={paths.tournamentOverview.replace(':id', String(tournament.id))}
                label={t('teamProfile.tournaments.open')}
              />
            ) : null}
          </Row>
        </RowList>
      ) : (
        <Panel sx={{ px: 3, py: 2 }}>
          <Typography variant="body2" color="text.secondary">
            {t('teamProfile.tournaments.empty')}
          </Typography>
        </Panel>
      )}

      {recentResults.length > 0 && (
        <Box component="section" aria-labelledby="team-recent-results" sx={{ mt: 4 }}>
          <SectionHead
            id="team-recent-results"
            level={3}
            title={t('teamProfile.tournaments.recentResults')}
          />
          <RowList>
            {recentResults.map((result) => (
              <Row
                key={result.slug}
                columns="2.2rem minmax(0, 1fr) auto"
                data-testid="team-profile-result-row"
                sx={{ py: 1.5 }}
              >
                <Box
                  sx={{
                    ...mono,
                    fontWeight: 700,
                    fontSize: textSize.xs,
                    width: '2.2rem',
                    height: '1.6rem',
                    borderRadius: '6px',
                    display: 'grid',
                    placeItems: 'center',
                    bgcolor: tokens.color.paper3,
                    color: result.won ? tokens.color.live : tokens.color.ban,
                  }}
                >
                  {result.won ? t('teamProfile.tournaments.win') : t('teamProfile.tournaments.loss')}
                </Box>
                <Box minWidth={0}>
                  <Typography variant="body2" noWrap>
                    {t('teamProfile.tournaments.versus', {
                      opponent: result.opponent?.name || '—',
                    })}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" component="div" noWrap>
                    {getBracketMatchLabel(result) || formatDate(result.completedAt)}
                  </Typography>
                </Box>
                <Typography
                  variant="body2"
                  sx={{ ...mono, fontVariantNumeric: 'tabular-nums' }}
                  color="text.secondary"
                >
                  {result.teamScore}–{result.opponentScore}
                </Typography>
              </Row>
            ))}
          </RowList>
        </Box>
      )}
    </Box>
  );
}
