import React from 'react';
import {
  Box,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import { PlayerName } from '../player/PlayerName';
import { getPlayerPageUrl } from '../../utils/playerLinks';
import type { MatchLiveStats } from '../../types';

type PlayerLine = NonNullable<MatchLiveStats['playerStats']>['team1'][number];

interface MatchPlayerPerformanceProps {
  playerStats: MatchLiveStats['playerStats'] | null | undefined;
  teamName?: string | null;
  opponentName?: string | null;
  // When true, team1 stats represent "your" team; when false, team2 does.
  // Defaults to true so existing callers (team page) keep current behaviour.
  yourTeamIsTeam1?: boolean;
  // Optional: when set, this Steam ID will be highlighted and not linked.
  highlightPlayerId?: string;
}

function getAdrValue(player: PlayerLine): number {
  if (!player.roundsPlayed) return 0;
  return player.damage / Math.max(1, player.roundsPlayed);
}

function formatAdr(player: PlayerLine): string {
  const adr = getAdrValue(player);
  if (!adr) return '—';
  return Math.round(adr).toString();
}

function renderTable(
  rows: PlayerLine[],
  accent: 'primary' | 'error',
  highlightPlayerId?: string
) {
  const sortedRows = [...rows].sort((a, b) => getAdrValue(b) - getAdrValue(a));

  return (
    <TableContainer component={Paper} variant="outlined">
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>Player</TableCell>
            <TableCell align="right">K</TableCell>
            <TableCell align="right">D</TableCell>
            <TableCell align="right">A</TableCell>
            <TableCell align="right">ADR</TableCell>
            <TableCell align="right">MVP</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={7} align="center">
                <Typography variant="body2" color="text.secondary">
                  Waiting for stats...
                </Typography>
              </TableCell>
            </TableRow>
          ) : (
            sortedRows.map((player) => {
              const isHighlighted = highlightPlayerId === player.steamId;

              return (
              <TableRow key={player.steamId}>
                <TableCell
                  sx={{
                    fontWeight: 600,
                    maxWidth: 180,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  <PlayerName
                    name={player.name}
                    // Live stats don’t yet surface isAdmin; this keeps base styling only.
                    variant="body2"
                    noWrap
                    sx={{
                      color: isHighlighted ? 'common.white' : `${accent}.main`,
                      fontWeight: 600,
                      textDecoration: 'none',
                      cursor: isHighlighted ? 'default' : 'pointer',
                      '&:hover': !isHighlighted
                        ? {
                            textDecoration: 'underline',
                          }
                        : undefined,
                    }}
                    component={isHighlighted ? 'span' : 'a'}
                    {...(!isHighlighted && {
                      href: getPlayerPageUrl(player.steamId),
                      target: '_blank',
                      rel: 'noopener noreferrer',
                    })}
                  />
                </TableCell>
                <TableCell align="right">{player.kills}</TableCell>
                <TableCell align="right">{player.deaths}</TableCell>
                <TableCell align="right">{player.assists}</TableCell>
                <TableCell align="right">{formatAdr(player)}</TableCell>
                <TableCell align="right">{player.mvps ?? 0}</TableCell>
              </TableRow>
              );
            })
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
  yourTeamIsTeam1 = true,
  highlightPlayerId,
}: MatchPlayerPerformanceProps) {
  if (!playerStats || (!playerStats.team1.length && !playerStats.team2.length)) {
    return null;
  }

  const yourTeamStats = yourTeamIsTeam1 ? playerStats.team1 : playerStats.team2;
  const opponentStats = yourTeamIsTeam1 ? playerStats.team2 : playerStats.team1;

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
          {renderTable(yourTeamStats, 'primary', highlightPlayerId)}
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
          {renderTable(opponentStats, 'error', highlightPlayerId)}
        </Box>
      </Stack>
    </Box>
  );
}

