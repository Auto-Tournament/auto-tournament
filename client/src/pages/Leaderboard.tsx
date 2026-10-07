import { useEffect, useState } from 'react';
import { Link as RouterLink, useSearchParams } from 'react-router-dom';
import { Alert, Box, CircularProgress, Container, MenuItem, Select, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { TopNavBar } from '../components/layout/TopNavBar';
import { EmptyPanel, PageHead, Row, RowList } from '../components/common/ui';
import { PlayerAvatar } from '../components/player/PlayerAvatar';
import { api } from '../utils/api';
import { pageTitle } from '../utils/pageTitle';
import { playerProfilePath } from '../paths';
import { tokens, fontMono, radii, textSize } from '../theme/tokens';

const { color } = tokens;

interface BoardGame {
  id: string;
  name: string;
  players: number;
}

interface BoardPlayer {
  rank: number;
  id: string;
  name: string;
  avatar: string;
  rating: number;
  matches: number;
  wins: number;
  losses: number;
}

interface Board {
  games: BoardGame[];
  game: string | null;
  players: BoardPlayer[];
}

/**
 * The platform's leaderboard (`/leaderboards`): players ranked by their
 * rating in one game, picked from a dropdown (ratings are per game). A
 * tournament's own standings are on its page.
 */
export default function Leaderboard() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const asked = params.get('game');
  const [board, setBoard] = useState<Board | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    document.title = pageTitle(t('leaderboard.title'));
  }, [t]);

  useEffect(() => {
    let cancelled = false;
    api
      .get<{ success: boolean } & Board>(`/api/leaderboard${asked ? `?game=${encodeURIComponent(asked)}` : ''}`)
      .then((res) => {
        if (cancelled) return;
        setError(false);
        setBoard(res.success ? res : { games: [], game: null, players: [] });
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [asked]);

  const columns = '3ch minmax(0, 1fr) 5.5rem 4.5rem 5.5rem';
  const head = (label: string, right = true) => (
    <Typography sx={{ fontFamily: fontMono, fontSize: textSize.xs, color: color.muted, textAlign: right ? 'right' : 'left' }}>
      {label}
    </Typography>
  );

  return (
    <Box minHeight="100vh" bgcolor="transparent" data-testid="leaderboard-page">
      <TopNavBar />
      <Container maxWidth="md" sx={{ py: { xs: 3, md: 6 } }}>
        <Box sx={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 2, flexWrap: 'wrap', mb: 3 }}>
          <PageHead title={t('leaderboard.title')} subtitle={t('leaderboard.subtitle')} sx={{ mb: 0 }} />
          {board && board.games.length > 0 && (
            <Select
              size="small"
              value={board.game ?? ''}
              onChange={(e) => setParams(e.target.value ? { game: String(e.target.value) } : {})}
              inputProps={{ 'aria-label': t('leaderboard.game') }}
              data-testid="leaderboard-game"
              sx={{ minHeight: 44, borderRadius: radii.pill, minWidth: 200 }}
            >
              {board.games.map((g) => (
                <MenuItem key={g.id} value={g.id}>
                  {g.name}
                </MenuItem>
              ))}
            </Select>
          )}
        </Box>

        {error ? (
          <Alert severity="error">{t('leaderboard.loadError')}</Alert>
        ) : !board ? (
          <Box display="flex" justifyContent="center" py={6}>
            <CircularProgress aria-label={t('leaderboard.loading')} />
          </Box>
        ) : board.players.length === 0 ? (
          <EmptyPanel
            title={t('leaderboard.emptyTitle')}
            description={t('leaderboard.emptyDescription')}
            data-testid="leaderboard-empty"
          />
        ) : (
          <RowList data-testid="leaderboard-list">
            <Row columns={columns} sx={{ py: 1.25 }} aria-hidden>
              {head('#', false)}
              {head(t('leaderboard.columns.player'), false)}
              {head(t('leaderboard.columns.rating'))}
              {head(t('leaderboard.columns.matches'))}
              {head(t('leaderboard.columns.winRate'))}
            </Row>
            {board.players.map((p) => (
              <Row key={p.id} columns={columns} data-testid="leaderboard-row">
                <Typography sx={{ fontFamily: fontMono, fontSize: textSize.sm, color: p.rank <= 3 ? color.accent : color.muted }}>
                  {p.rank}
                </Typography>
                <Box
                  component={RouterLink}
                  to={playerProfilePath(p.id)}
                  sx={{ display: 'flex', alignItems: 'center', gap: 1.5, minWidth: 0, color: 'text.primary', textDecoration: 'none', '&:hover .name': { textDecoration: 'underline' } }}
                >
                  <PlayerAvatar id={p.id} name={p.name} avatarUrl={p.avatar} size={32} />
                  <Typography className="name" noWrap sx={{ fontWeight: 600, minWidth: 0 }}>
                    {p.name}
                  </Typography>
                </Box>
                <Typography sx={{ fontFamily: fontMono, textAlign: 'right' }}>{p.rating}</Typography>
                <Typography sx={{ fontFamily: fontMono, textAlign: 'right', color: color.ink2 }}>{p.matches}</Typography>
                <Typography sx={{ fontFamily: fontMono, textAlign: 'right', color: color.ink2 }}>
                  {p.wins + p.losses > 0 ? `${Math.round((p.wins / (p.wins + p.losses)) * 100)}%` : '—'}
                </Typography>
              </Row>
            ))}
          </RowList>
        )}
      </Container>
    </Box>
  );
}
