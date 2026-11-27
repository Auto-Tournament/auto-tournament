import { useMemo } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { useTranslation } from 'react-i18next';
import { Row, SectionHead } from '../../common/ui';
import { mono, textSize, tokens } from '../../../theme/tokens';

/** One rating history row, as the profile holds it. */
export interface MonthRatingEntry {
  eloBefore: number;
  eloAfter: number;
  matchResult: 'win' | 'loss';
  /** Unix seconds. */
  createdAt: number;
}

/** Green up, red down, grey for no change. */
function changeColour(change: number): string {
  if (change > 0) return tokens.color.live;
  if (change < 0) return tokens.color.ban;
  return 'text.secondary';
}

/** The Matches tab's rating month by month (the site has no seasons; a month is one). */
export function RatingByMonth({ history }: { history: MonthRatingEntry[] }) {
  const { t, i18n } = useTranslation();
  const months = useMemo(() => {
    const asc = [...history].sort((a, b) => a.createdAt - b.createdAt);
    const by = new Map<string, MonthRatingEntry[]>();
    for (const e of asc) {
      const d = new Date(e.createdAt * 1000);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      by.set(key, [...(by.get(key) ?? []), e]);
    }
    return [...by.entries()]
      .map(([key, rows]) => ({
        key,
        at: rows[0].createdAt,
        matches: rows.length,
        wins: rows.filter((r) => r.matchResult === 'win').length,
        start: rows[0].eloBefore,
        end: rows[rows.length - 1].eloAfter,
        peak: Math.max(...rows.map((r) => r.eloAfter)),
      }))
      .reverse();
  }, [history]);

  if (months.length === 0) return null;
  const peak = months.reduce((a, b) => (b.peak > a.peak ? b : a));
  const monthName = (at: number) =>
    new Date(at * 1000).toLocaleDateString(i18n.language, { month: 'long', year: 'numeric' });
  const cols = 'minmax(9rem, 1.6fr) repeat(6, minmax(4.5rem, 1fr))';
  const num = { textAlign: 'right' as const, fontVariantNumeric: 'tabular-nums' };

  return (
    <Box component="section" aria-labelledby="profile-months" sx={{ mt: 5 }}>
      <SectionHead
        id="profile-months"
        title={t('playerPage.months.title')}
        action={
          <Typography component="span" sx={{ color: tokens.color.muted, fontSize: textSize.sm }}>
            {t('playerPage.months.peak', { rating: peak.peak, month: monthName(peak.at) })}
          </Typography>
        }
      />
      <Box sx={{ overflowX: 'auto' }}>
        <Box sx={{ minWidth: 640 }} role="table" aria-labelledby="profile-months">
          <Row
            columns={cols}
            role="row"
            sx={{
              py: 1,
              ...mono,
              fontSize: textSize.xs,
              color: 'text.secondary',
              textTransform: 'uppercase',
            }}
          >
            <span role="columnheader">{t('playerPage.months.month')}</span>
            <Box role="columnheader" sx={num}>
              {t('playerPage.stats.matches')}
            </Box>
            <span role="columnheader">{t('playerPage.months.record')}</span>
            <Box role="columnheader" sx={num}>
              {t('playerPage.months.start')}
            </Box>
            <Box role="columnheader" sx={num}>
              {t('playerPage.months.end')}
            </Box>
            <Box role="columnheader" sx={num}>
              {t('playerPage.months.change')}
            </Box>
            <Box role="columnheader" sx={num}>
              {t('playerPage.months.peakColumn')}
            </Box>
          </Row>
          {months.map((m) => {
            const change = m.end - m.start;
            return (
              <Row
                key={m.key}
                columns={cols}
                role="row"
                sx={{ py: 1.5, borderTop: `1px solid ${tokens.color.rule}` }}
              >
                <Box role="cell" sx={{ fontWeight: 600 }}>
                  {monthName(m.at)}
                </Box>
                <Box role="cell" sx={num}>
                  {m.matches}
                </Box>
                <Box role="cell" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                  <Box component="span" sx={{ color: tokens.color.live, fontWeight: 600 }}>
                    {m.wins}
                  </Box>
                  {' – '}
                  <Box component="span" sx={{ color: tokens.color.ban, fontWeight: 600 }}>
                    {m.matches - m.wins}
                  </Box>
                </Box>
                <Box role="cell" sx={num}>
                  {m.start}
                </Box>
                <Box role="cell" sx={{ ...num, fontWeight: 600 }}>
                  {m.end}
                </Box>
                <Box role="cell" sx={{ ...num, fontWeight: 600, color: changeColour(change) }}>
                  {change > 0 ? '+' : ''}
                  {change}
                </Box>
                <Box role="cell" sx={num}>
                  {m.peak}
                </Box>
              </Row>
            );
          })}
        </Box>
      </Box>
    </Box>
  );
}
