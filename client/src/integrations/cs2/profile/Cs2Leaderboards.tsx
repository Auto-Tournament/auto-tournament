/**
 * CS2's category rankings on the Leaderboards page (`leaderboardView`):
 * Performance, ADR, K/D, headshots, opening duels, clutches and KAST, over all
 * time or the last 30 or 90 days. Each says what it measures and who
 * qualifies; ties share a rank.
 */

import { useEffect, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { Box, CircularProgress, Typography } from '@mui/material';
import {
  api,
  links,
  mono,
  PlayerAvatar,
  Row,
  RowList,
  SectionHead,
  SegmentedControl,
  textSize,
  tokens,
  useModuleTranslation,
} from '../../../module-sdk';

const CATEGORIES = ['rating', 'adr', 'kd', 'hs', 'opening', 'clutch', 'kast'] as const;
type Category = (typeof CATEGORIES)[number];
type Range = 'all' | '90' | '30';

interface Leader {
  rank: number;
  playerId: string;
  name: string;
  avatarUrl: string | null;
  maps: number;
  rounds: number;
  value: number;
  sample: number;
}

interface Board {
  category: Category;
  minMaps: number;
  minRounds: number;
  players: Leader[];
  qualified: number;
}

export function Cs2Leaderboards() {
  const { t } = useModuleTranslation('cs2');
  const [category, setCategory] = useState<Category>('rating');
  const [range, setRange] = useState<Range>('all');
  const query = `category=${category}${range === 'all' ? '' : `&days=${range}`}`;
  const [loaded, setLoaded] = useState<{ query: string; board: Board | null } | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .get<Board>(`/api/game/cs2/leaderboards?${query}&limit=25`)
      .then((board) => !cancelled && setLoaded({ query, board }))
      .catch(() => !cancelled && setLoaded({ query, board: null }));
    return () => {
      cancelled = true;
    };
  }, [query]);
  const board = loaded?.query === query ? loaded.board : undefined;

  const value = (v: number) =>
    category === 'rating' || category === 'kd'
      ? v.toFixed(2)
      : category === 'adr'
        ? v.toFixed(1)
        : `${v}%`;
  const columns = '3ch minmax(0, 1fr) 5.5rem 5rem';

  return (
    <Box component="section" aria-labelledby="cs2-leaderboards" data-testid="cs2-leaderboards">
      <SectionHead id="cs2-leaderboards" title={t('leaderboards.title')} />
      <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap', mb: 1.5 }}>
        <SegmentedControl<Category>
          label={t('leaderboards.categoryLabel')}
          value={category}
          onChange={setCategory}
          options={CATEGORIES.map((c) => ({ value: c, label: t(`leaderboards.category.${c}`) }))}
          testId="cs2-leaderboards-category"
        />
        <SegmentedControl<Range>
          label={t('leaderboards.rangeLabel')}
          value={range}
          onChange={setRange}
          options={[
            { value: 'all', label: t('leaderboards.range.all') },
            { value: '90', label: t('leaderboards.range.days', { count: 90 }) },
            { value: '30', label: t('leaderboards.range.days', { count: 30 }) },
          ]}
          testId="cs2-leaderboards-range"
        />
      </Box>
      <Typography
        sx={{ fontSize: textSize.sm, color: tokens.color.muted, mb: 2, maxWidth: '70ch' }}
      >
        {t(`leaderboards.explain.${category}`)}{' '}
        {board && t('leaderboards.qualify', { maps: board.minMaps, rounds: board.minRounds })}
      </Typography>

      {board === undefined ? (
        <Box sx={{ display: 'grid', placeItems: 'center', py: 4 }}>
          <CircularProgress size={28} />
        </Box>
      ) : !board || board.players.length === 0 ? (
        <Typography
          sx={{ fontSize: textSize.sm, color: tokens.color.muted }}
          data-testid="cs2-leaderboards-empty"
        >
          {t('leaderboards.empty')}
        </Typography>
      ) : (
        <RowList data-testid="cs2-leaderboards-list">
          <Row columns={columns} sx={{ py: 1.25 }} aria-hidden>
            {[
              '#',
              t('leaderboards.player'),
              t(`leaderboards.category.${category}`),
              t('leaderboards.sample'),
            ].map((h, i) => (
              <Typography
                key={h}
                sx={{
                  ...mono,
                  fontSize: textSize.xs,
                  color: tokens.color.muted,
                  textAlign: i >= 2 ? 'right' : 'left',
                }}
              >
                {h}
              </Typography>
            ))}
          </Row>
          {board.players.map((p) => (
            <Row key={p.playerId} columns={columns} data-testid="cs2-leaderboards-row">
              <Typography
                sx={{
                  ...mono,
                  fontSize: textSize.sm,
                  color: p.rank <= 3 ? tokens.color.accent : tokens.color.muted,
                }}
              >
                {p.rank}
              </Typography>
              <Box
                component={RouterLink}
                to={links.playerProfile(p.playerId)}
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1.5,
                  minWidth: 0,
                  color: 'text.primary',
                  textDecoration: 'none',
                  '&:hover .name': { textDecoration: 'underline' },
                }}
              >
                <PlayerAvatar id={p.playerId} name={p.name} avatarUrl={p.avatarUrl} size={32} />
                <Typography className="name" noWrap sx={{ fontWeight: 600, minWidth: 0 }}>
                  {p.name}
                </Typography>
              </Box>
              <Typography sx={{ ...mono, textAlign: 'right', fontWeight: 600 }}>
                {value(p.value)}
              </Typography>
              <Typography
                sx={{
                  ...mono,
                  textAlign: 'right',
                  color: tokens.color.ink2,
                  fontSize: textSize.sm,
                }}
                title={t('leaderboards.sampleHint', { maps: p.maps, rounds: p.rounds })}
              >
                {t(`leaderboards.sampleOf.${category}`, { count: p.sample })}
              </Typography>
            </Row>
          ))}
        </RowList>
      )}
    </Box>
  );
}
