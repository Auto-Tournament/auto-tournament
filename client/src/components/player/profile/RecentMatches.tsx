import { InRowLink, OpponentName, RowCoverLink } from '../../team/MatchRowLinks';
import { matchPagePath, tournamentTabPath } from '../../../paths';
import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { DownloadSimpleIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { Panel, Row, RowList } from '../../common/ui';
import { mono, textSize, tokens } from '../../../theme/tokens';

export interface RecentMatchEntry {
  /** React key: the slug, or the history row's own key for a deleted match. */
  key: string;
  /**
   * The match's slug, or null when the match is gone (its tournament was
   * deleted and only the rating history remembers it). A row without one
   * opens nothing and has no demo.
   */
  slug: string | null;
  wonMatch: boolean;
  /** "vs Baltic Five", or the stored "Nordlys vs Baltic Five" of a deleted match. */
  title: string;
  /** The opponent, when the match is still here: "vs" and their name, linked to their team page. */
  opponent?: { id: string | null; name: string };
  /** The tournament, linked before `detail` when it is still here. */
  tournament?: { id: number; name: string } | null;
  /** Where it was played: the round (and the tournament's name when it is not linked). */
  detail: string;
  kills?: number;
  deaths?: number;
  /** The player's rating after this match, when the match was rated. */
  ratingAfter?: number;
  /** A recorded demo can be downloaded (only for a game that records demos). */
  hasDemo?: boolean;
}

export interface RecentMatchesProps {
  matches: RecentMatchEntry[];
  limit?: number;
  /**
   * The footnote explaining the kills / deaths column. A game that measures
   * neither has no column, so the note would explain nothing (default: shown).
   */
  showStatsNote?: boolean;
}

/**
 * The profile's match list (the draft's `ul.row-list.panel`): W/L tile,
 * opponent, where it was played and the rating after it, kills/deaths, and
 * the demo when there is one. A row opens the match's own page; the
 * opponent's name in it opens their team page.
 */
export function RecentMatches({ matches, limit = 10, showStatsNote = true }: RecentMatchesProps) {
  const { t } = useTranslation();

  if (matches.length === 0) {
    return (
      <Panel sx={{ px: 3, py: 2 }}>
        <Typography
          variant="body2"
          color="text.secondary"
          data-testid="profile-recent-matches-empty"
        >
          {t('playerPage.noMatchesYet')}
        </Typography>
      </Panel>
    );
  }

  const shown = matches.slice(0, limit);

  return (
    <>
      <RowList data-testid="profile-recent-matches">
        {shown.map((match) => {
          const slug = match.slug;
          const openable = slug !== null;
          const hasKd = typeof match.kills === 'number' && typeof match.deaths === 'number';
          return (
            <Row
              key={match.key}
              columns="2.2rem minmax(0, 1fr) auto auto"
              data-testid={
                openable ? `profile-recent-match-${slug}` : 'profile-recent-match-archived'
              }
              sx={{
                position: 'relative',
                py: 1.5,
                fontSize: textSize.sm,
                '&:hover': openable ? { bgcolor: 'action.hover' } : undefined,
                // The panel's rounded corners, for the hover fill.
                '&:first-of-type': {
                  borderTopLeftRadius: 'inherit',
                  borderTopRightRadius: 'inherit',
                },
                '&:last-of-type': {
                  borderBottomLeftRadius: 'inherit',
                  borderBottomRightRadius: 'inherit',
                },
              }}
            >
              {openable && (
                <RowCoverLink
                  to={matchPagePath(slug)}
                  label={t('teamProfile.tournaments.openMatch')}
                />
              )}
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
                  color: match.wonMatch ? tokens.color.live : tokens.color.ban,
                }}
              >
                {match.wonMatch ? t('playerPage.win') : t('playerPage.loss')}
              </Box>
              <Box minWidth={0}>
                <Typography variant="body2" noWrap>
                  {match.opponent ? (
                    <>
                      {t('teamMatchHistory.vs')}{' '}
                      <OpponentName id={match.opponent.id} name={match.opponent.name} />
                    </>
                  ) : (
                    match.title
                  )}
                </Typography>
                <Typography variant="caption" color="text.secondary" noWrap component="div">
                  {match.tournament && (
                    <>
                      <InRowLink to={tournamentTabPath(match.tournament.id)}>
                        {match.tournament.name}
                      </InRowLink>
                      {match.detail || typeof match.ratingAfter === 'number' ? ' · ' : ''}
                    </>
                  )}
                  {typeof match.ratingAfter === 'number'
                    ? t('playerPage.recentMatches.roundAndRating', {
                        round: match.detail,
                        rating: match.ratingAfter,
                      })
                    : match.detail}
                </Typography>
              </Box>
              <Typography
                variant="body2"
                sx={{ ...mono, fontVariantNumeric: 'tabular-nums' }}
                color="text.secondary"
                whiteSpace="nowrap"
              >
                {!hasKd
                  ? ''
                  : match.kills === 0 && match.deaths === 0
                    ? // No kills and no deaths: nothing was recorded for this player.
                      '—'
                    : `${match.kills} / ${match.deaths}`}
              </Typography>
              <Box
                sx={{
                  width: 32,
                  display: 'flex',
                  justifyContent: 'center',
                  position: 'relative',
                  zIndex: 1,
                }}
              >
                {match.hasDemo && slug && (
                  <Tooltip title={t('playerPage.downloadDemo')}>
                    <IconButton
                      size="small"
                      component="a"
                      href={`/api/demos/${slug}/download`}
                      download
                      aria-label={t('playerPage.downloadDemo')}
                      data-testid={`profile-recent-match-demo-${slug}`}
                    >
                      <DownloadSimpleIcon size="1em" />
                    </IconButton>
                  </Tooltip>
                )}
              </Box>
            </Row>
          );
        })}
      </RowList>
      {showStatsNote && (
        <Typography
          variant="caption"
          color="text.secondary"
          component="p"
          sx={{ mt: 1, fontSize: textSize.xs }}
        >
          {t('playerPage.recentMatches.statsNote')}
        </Typography>
      )}
    </>
  );
}
