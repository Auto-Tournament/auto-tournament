import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import DownloadIcon from '@mui/icons-material/Download';
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
  /** Where it was played: tournament and round, whichever are known. */
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
  onSelect: (slug: string) => void;
  /**
   * The footnote explaining the kills / deaths column. A game that measures
   * neither has no column, so the note would explain nothing (default: shown).
   */
  showStatsNote?: boolean;
}

/**
 * The profile's match list (the draft's `ul.row-list.panel`): W/L tile,
 * opponent, where it was played and the rating after it, kills/deaths, and
 * the demo when there is one. Assists, headshots and damage are in the match
 * details a click on the row opens.
 */
export function RecentMatches({
  matches,
  limit = 10,
  onSelect,
  showStatsNote = true,
}: RecentMatchesProps) {
  const { t } = useTranslation();

  if (matches.length === 0) {
    return (
      <Panel sx={{ px: 3, py: 2 }}>
        <Typography variant="body2" color="text.secondary" data-testid="profile-recent-matches-empty">
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
              onClick={openable ? () => onSelect(slug) : undefined}
              data-testid={openable ? `profile-recent-match-${slug}` : 'profile-recent-match-archived'}
              sx={{
                py: 1.5,
                fontSize: textSize.sm,
                cursor: openable ? 'pointer' : 'default',
                '&:hover': openable ? { bgcolor: 'action.hover' } : undefined,
                // The panel's rounded corners, for the hover fill.
                '&:first-of-type': { borderTopLeftRadius: 'inherit', borderTopRightRadius: 'inherit' },
                '&:last-of-type': {
                  borderBottomLeftRadius: 'inherit',
                  borderBottomRightRadius: 'inherit',
                },
              }}
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
                  color: match.wonMatch ? tokens.color.live : tokens.color.ban,
                }}
              >
                {match.wonMatch ? t('playerPage.win') : t('playerPage.loss')}
              </Box>
              <Box minWidth={0}>
                <Typography variant="body2" noWrap>
                  {match.title}
                </Typography>
                <Typography variant="caption" color="text.secondary" noWrap component="div">
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
              <Box sx={{ width: 32, display: 'flex', justifyContent: 'center' }}>
                {match.hasDemo && slug && (
                  <Tooltip title={t('playerPage.downloadDemo')}>
                    <IconButton
                      size="small"
                      component="a"
                      href={`/api/demos/${slug}/download`}
                      download
                      aria-label={t('playerPage.downloadDemo')}
                      data-testid={`profile-recent-match-demo-${slug}`}
                      onClick={(event) => event.stopPropagation()}
                    >
                      <DownloadIcon fontSize="inherit" />
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
