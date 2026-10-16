/**
 * The matchmaking ladder, on Leaderboards' Matchmaking mode: players with
 * enough rated matches in the last 30 days, best rating first. Was its own
 * page at /play/leaderboard.
 */
import { useEffect, useState } from 'react';
import {
  Box,
  CircularProgress,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import { useTranslation } from 'react-i18next';
import { Panel } from '../common/ui';
import { PlayerChip } from '../player/PlayerChip';

interface Row {
  rank: number;
  id: string;
  name: string;
  elo: number;
  games: number;
  wins: number;
  level: number;
}

export function MatchmakingLeaderboard() {
  const { t } = useTranslation();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [minGames, setMinGames] = useState(10);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
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
  }, []);

  if (failed) {
    return (
      <Panel sx={{ p: 3 }}>
        <Typography>{t('matchmaking.play.unavailable')}</Typography>
      </Panel>
    );
  }
  if (!rows) {
    return (
      <Box display="flex" justifyContent="center" py={10}>
        <CircularProgress />
      </Box>
    );
  }
  if (rows.length === 0) {
    return (
      <Panel sx={{ p: 3 }} data-testid="mm-leaderboard-empty">
        <Typography>{t('matchmaking.leaderboard.empty', { count: minGames })}</Typography>
      </Panel>
    );
  }
  return (
    <>
      <Typography sx={{ color: 'text.secondary', mb: 2 }}>
        {t('matchmaking.leaderboard.subtitle', { count: minGames })}
      </Typography>
      <Panel sx={{ p: { xs: 1, sm: 2 }, overflowX: 'auto' }}>
        <Table
          size="small"
          aria-label={t('matchmaking.leaderboard.title')}
          data-testid="mm-leaderboard"
        >
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
                  <PlayerChip id={r.id} name={r.name} />
                </TableCell>
                <TableCell align="right">{r.level}</TableCell>
                <TableCell align="right" sx={{ fontWeight: 700 }}>
                  {r.elo}
                </TableCell>
                <TableCell align="right">{r.games}</TableCell>
                <TableCell align="right">
                  {r.games ? Math.round((r.wins / r.games) * 100) : 0}%
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Panel>
    </>
  );
}
