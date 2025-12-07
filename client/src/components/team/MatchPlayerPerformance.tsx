import React from 'react';
import { Box, Paper, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Typography } from '@mui/material';
import { getPlayerPageUrl } from '../../utils/playerLinks';
import type { MatchLiveStats } from '../../types';

type PlayerLine = NonNullable<MatchLiveStats['playerStats']>['team1'][number];

interface MatchPlayerPerformanceProps {
  playerStats: MatchLiveStats['playerStats'] | null | undefined;
  teamName?: string | null;
  opponentName?: string | null;
}

function formatKdDiff(kills: number, deaths: number): string {
  const diff = kills - deaths;
  if (diff === 0) return '0';
  return diff > 0 ? `+${diff}` : `${diff}`;
}

function formatAdr(player: PlayerLine): string {
  if (!player.roundsPlayed) return '—';
  const adr = player.damage / Math.max(1, player.roundsPlayed);
  return Math.round(adr).toString();
}

function formatKastValue(kast: number): string {
  if (!kast) return '—';
  const normalized = kast > 1 ? kast : kast * 100;
  return `${Math.round(normalized)}%`;
}

function renderTable(rows: PlayerLine[], accent: 'primary' | 'error') {
  return (
    <TableContainer component={Paper} variant="outlined">
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>Player</TableCell>
            <TableCell align="right">K</TableCell>
            <TableCell align="right">D</TableCell>
            <TableCell align="right">A</TableCell>
            <TableCell align="right">+/-</TableCell>
            <TableCell align="right">ADR</TableCell>
            <TableCell align="right">KAST</TableCell>
            <TableCell align="right">MVP</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={8} align="center">
                <Typography variant="body2" color="text.secondary">
                  Waiting for stats...
                </Typography>
              </TableCell>
            </TableRow>
          ) : (
            rows.map((player) => (
              <TableRow key={player.steamId}>
                <TableCell sx={{ fontWeight: 600 }}>
                  <Typography
                    variant="body2"
                    color={`${accent}.main`}
                    fontWeight={600}
                    component="a"
                    href={getPlayerPageUrl(player.steamId)}
                    target="_blank"
                    rel="noopener noreferrer"
                    sx={{
                      textDecoration: 'none',
                      cursor: 'pointer',
                      '&:hover': {
                        textDecoration: 'underline',
                      },
                    }}
                  >
                    {player.name}
                  </Typography>
                </TableCell>
                <TableCell align="right">{player.kills}</TableCell>
                <TableCell align="right">{player.deaths}</TableCell>
                <TableCell align="right">{player.assists}</TableCell>
                <TableCell align="right">{formatKdDiff(player.kills, player.deaths)}</TableCell>
                <TableCell align="right">{formatAdr(player)}</TableCell>
                <TableCell align="right">{formatKastValue(player.kast)}</TableCell>
                <TableCell align="right">{player.mvps ?? 0}</TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

export function MatchPlayerPerformance({
  playerStats,
  teamName,
  opponentName,
}: MatchPlayerPerformanceProps) {
  if (!playerStats || (!playerStats.team1.length && !playerStats.team2.length)) {
    return null;
  }

  return (
    <Box>
      <Typography variant="h6" fontWeight={600} mb={1}>
        Player Performance
      </Typography>
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
        <Box flex={1}>
          <Typography variant="subtitle2" color="text.secondary" mb={0.5}>
            {teamName || 'Your Team'}
          </Typography>
          {renderTable(playerStats.team1, 'primary')}
        </Box>
        <Box flex={1}>
          <Typography
            variant="subtitle2"
            color="text.secondary"
            mb={0.5}
            textAlign={{ xs: 'left', md: 'right' }}
          >
            {opponentName || 'Opponent'}
          </Typography>
          {renderTable(playerStats.team2, 'error')}
        </Box>
      </Stack>
    </Box>
  );
}

