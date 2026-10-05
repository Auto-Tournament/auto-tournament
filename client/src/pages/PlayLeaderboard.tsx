/**
 * The matchmaking leaderboard (experimental): players with enough rated
 * matches in the last 30 days, best rating first.
 */
import { useEffect, useState } from 'react';
import { Box, CircularProgress, Container, Table, TableBody, TableCell, TableHead, TableRow, Typography } from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { TopNavBar } from '../components/layout/TopNavBar';
import { PageHead, Panel } from '../components/common/ui';
import { pageTitle } from '../utils/pageTitle';
import { playerProfilePath } from '../paths';

interface Row {
  rank: number;
  id: string;
  name: string;
  elo: number;
  games: number;
  wins: number;
  level: number;
}

export default function PlayLeaderboard() {
  const { t } = useTranslation();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [minGames, setMinGames] = useState(10);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    document.title = pageTitle(t('matchmaking.leaderboard.title'));
    let cancelled = false;
    void fetch('/api/matchmaking/leaderboard?mode=5v5', { credentials: 'same-origin' })
      .then(async (res) => {
        if (cancelled) return;
        if (!res.ok) {
          setFailed(true);
          return;
        }
        const body = (await res.json()) as { players: Row[]; minGames: number };
        setRows(body.players);
        setMinGames(body.minGames);
      })
      .catch(() => setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [t]);

  return (
    <Box minHeight="100vh">
      <TopNavBar />
      <Container maxWidth="md" sx={{ py: { xs: 3, md: 6 } }}>
        <PageHead title={t('matchmaking.leaderboard.title')} subtitle={t('matchmaking.leaderboard.subtitle', { count: minGames })} />
        {failed ? (
          <Panel sx={{ p: 3 }}>
            <Typography>{t('matchmaking.play.unavailable')}</Typography>
          </Panel>
        ) : !rows ? (
          <Box display="flex" justifyContent="center" py={10}>
            <CircularProgress />
          </Box>
        ) : rows.length === 0 ? (
          <Panel sx={{ p: 3 }} data-testid="mm-leaderboard-empty">
            <Typography>{t('matchmaking.leaderboard.empty', { count: minGames })}</Typography>
          </Panel>
        ) : (
          <Panel sx={{ p: { xs: 1, sm: 2 }, overflowX: 'auto' }}>
            <Table size="small" aria-label={t('matchmaking.leaderboard.title')} data-testid="mm-leaderboard">
              <TableHead>
                <TableRow>
                  <TableCell>#</TableCell>
                  <TableCell>{t('matchmaking.result.player')}</TableCell>
                  <TableCell align="right">{t('matchmaking.leaderboard.level')}</TableCell>
                  <TableCell align="right">{t('matchmaking.result.rating')}</TableCell>
                  <TableCell align="right">{t('matchmaking.leaderboard.games')}</TableCell>
                  <TableCell align="right">{t('matchmaking.leaderboard.winRate')}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>{r.rank}</TableCell>
                    <TableCell>
                      <Typography component={RouterLink} to={playerProfilePath(r.id)} sx={{ color: 'text.primary' }}>
                        {r.name}
                      </Typography>
                    </TableCell>
                    <TableCell align="right">{r.level}</TableCell>
                    <TableCell align="right" sx={{ fontWeight: 700 }}>
                      {r.elo}
                    </TableCell>
                    <TableCell align="right">{r.games}</TableCell>
                    <TableCell align="right">{r.games ? Math.round((r.wins / r.games) * 100) : 0}%</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Panel>
        )}
      </Container>
    </Box>
  );
}
