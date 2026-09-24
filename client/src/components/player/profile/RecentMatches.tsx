import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Typography from '@mui/material/Typography';
import { useTheme } from '@mui/material/styles';
import { useTranslation } from 'react-i18next';
import { mono } from '../../../theme/tokens';

export interface RecentMatchEntry {
  slug: string;
  wonMatch: boolean;
  opponentName: string;
  /** Human round/stage label, e.g. "Semifinals" — stands in for a tournament name. */
  roundLabel: string;
  kills?: number;
  deaths?: number;
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
 * Compact recent-matches list: W/L tile, opponent, round label, kills/deaths.
 * Per-map name and score are not shown here — they are not part of this
 * player's aggregated match-stats row, only of the full match record — click
 * a row to open the full match details modal (unchanged, further down).
 */
export function RecentMatches({
  matches,
  limit = 10,
  onSelect,
  showStatsNote = true,
}: RecentMatchesProps) {
  const { t } = useTranslation();
  const theme = useTheme();

  if (matches.length === 0) {
    return (
      <Card>
        <CardContent>
          <Typography variant="body2" color="text.secondary" data-testid="profile-recent-matches-empty">
            {t('playerPage.noMatchesYet')}
          </Typography>
        </CardContent>
      </Card>
    );
  }

  const shown = matches.slice(0, limit);

  return (
    <Card>
      <CardContent
        // MUI pads the last child's bottom; without the note, that is this.
        sx={{ p: 0, '&:last-child': { pb: 0 } }}
        data-testid="profile-recent-matches"
      >
        {shown.map((match) => (
          <Box
            key={match.slug}
            onClick={() => onSelect(match.slug)}
            data-testid={`profile-recent-match-${match.slug}`}
            sx={{
              display: 'grid',
              gridTemplateColumns: '2.2rem minmax(0, 1fr) auto',
              gap: 1.5,
              alignItems: 'center',
              px: 2,
              py: 1.25,
              fontSize: '0.875rem',
              cursor: 'pointer',
              borderBottom: '1px solid',
              borderColor: 'divider',
              '&:last-of-type': { borderBottom: 'none' },
              '&:hover': { bgcolor: 'action.hover' },
            }}
          >
            <Box
              sx={{
                ...mono,
                fontWeight: 700,
                fontSize: '0.75rem',
                width: '2.2rem',
                height: '1.6rem',
                borderRadius: '6px',
                display: 'grid',
                placeItems: 'center',
                bgcolor: 'background.surface2',
                color: match.wonMatch ? theme.palette.success.main : theme.palette.error.main,
              }}
            >
              {match.wonMatch ? t('playerPage.win') : t('playerPage.loss')}
            </Box>
            <Box minWidth={0}>
              <Typography variant="body2" noWrap>
                {t('teamMatchHistory.vs')} {match.opponentName}
              </Typography>
              <Typography variant="caption" color="text.secondary" noWrap component="div">
                {match.roundLabel}
              </Typography>
            </Box>
            <Typography variant="body2" sx={{ ...mono }} color="text.secondary" whiteSpace="nowrap">
              {typeof match.kills === 'number' && typeof match.deaths === 'number'
                ? `${match.kills} / ${match.deaths}`
                : ''}
            </Typography>
          </Box>
        ))}
      </CardContent>
      {showStatsNote && (
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ display: 'block', px: 2, pb: 1.5, pt: shown.length ? 0 : 1.5 }}
        >
          {t('playerPage.recentMatches.statsNote')}
        </Typography>
      )}
    </Card>
  );
}
