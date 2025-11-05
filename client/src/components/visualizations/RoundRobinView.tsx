import React from 'react';
import {
  Box,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
  Card,
  CardContent,
  Chip,
  Grid,
} from '@mui/material';
import { getStatusColor, getStatusLabel } from '../../utils/matchUtils';
import type { Match, Team } from '../../types';

interface RoundRobinViewProps {
  matches: Match[];
  teams: Team[];
  onMatchClick?: (match: Match) => void;
}

interface RoundRobinTeamStats {
  team: Team;
  played: number;
  wins: number;
  losses: number;
  roundsWon: number;
  roundsLost: number;
  roundDiff: number;
}

export default function RoundRobinView({ matches, teams, onMatchClick }: RoundRobinViewProps) {
  // Calculate standings
  const calculateStandings = (): RoundRobinTeamStats[] => {
    const stats: { [teamId: string]: RoundRobinTeamStats } = {};

    // Initialize stats for all teams
    teams.forEach((team) => {
      stats[team.id] = {
        team,
        played: 0,
        wins: 0,
        losses: 0,
        roundsWon: 0,
        roundsLost: 0,
        roundDiff: 0,
      };
    });

    // Process completed matches
    matches
      .filter((m) => m.status === 'completed' && m.team1 && m.team2)
      .forEach((match) => {
        const team1Id = match.team1!.id;
        const team2Id = match.team2!.id;
        const team1Score = match.team1Score || 0;
        const team2Score = match.team2Score || 0;

        if (stats[team1Id]) {
          stats[team1Id].played++;
          stats[team1Id].roundsWon += team1Score;
          stats[team1Id].roundsLost += team2Score;
          if (match.winner?.id === team1Id) stats[team1Id].wins++;
          else stats[team1Id].losses++;
        }

        if (stats[team2Id]) {
          stats[team2Id].played++;
          stats[team2Id].roundsWon += team2Score;
          stats[team2Id].roundsLost += team1Score;
          if (match.winner?.id === team2Id) stats[team2Id].wins++;
          else stats[team2Id].losses++;
        }
      });

    // Calculate round differential
    Object.values(stats).forEach((stat) => {
      stat.roundDiff = stat.roundsWon - stat.roundsLost;
    });

    // Sort by wins, then round differential
    return Object.values(stats).sort((a, b) => {
      if (b.wins !== a.wins) return b.wins - a.wins;
      if (b.roundDiff !== a.roundDiff) return b.roundDiff - a.roundDiff;
      return b.roundsWon - a.roundsWon;
    });
  };

  const standings = calculateStandings();

  // Group matches by round
  const matchesByRound: { [round: number]: Match[] } = {};
  matches.forEach((match) => {
    if (!matchesByRound[match.round]) {
      matchesByRound[match.round] = [];
    }
    matchesByRound[match.round].push(match);
  });

  const rounds = Object.keys(matchesByRound)
    .map(Number)
    .sort((a, b) => a - b);

  return (
    <Box>
      <Grid container spacing={3}>
        {/* Standings Table */}
        <Grid size={{ xs: 12, md: 6 }}>
          <Card>
            <CardContent>
              <Typography variant="h6" fontWeight={600} mb={2}>
                📊 Standings
              </Typography>
              <TableContainer>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell sx={{ fontWeight: 600 }}>#</TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>Team</TableCell>
                      <TableCell align="center" sx={{ fontWeight: 600 }}>
                        W-L
                      </TableCell>
                      <TableCell align="center" sx={{ fontWeight: 600 }}>
                        Rounds
                      </TableCell>
                      <TableCell align="center" sx={{ fontWeight: 600 }}>
                        Diff
                      </TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {standings.map((stat, index) => (
                      <TableRow
                        key={stat.team.id}
                        sx={{
                          bgcolor: index === 0 ? 'action.selected' : 'transparent',
                        }}
                      >
                        <TableCell>
                          <Typography
                            fontWeight={index === 0 ? 700 : 400}
                            color={index === 0 ? 'primary' : 'text.primary'}
                          >
                            {index + 1}
                          </Typography>
                        </TableCell>
                        <TableCell>
                          <Typography
                            fontWeight={index === 0 ? 700 : 400}
                            color={index === 0 ? 'primary' : 'text.primary'}
                          >
                            {stat.team.name}
                          </Typography>
                        </TableCell>
                        <TableCell align="center">
                          <Typography variant="body2">
                            {stat.wins}-{stat.losses}
                          </Typography>
                        </TableCell>
                        <TableCell align="center">
                          <Typography variant="body2">
                            {stat.roundsWon}-{stat.roundsLost}
                          </Typography>
                        </TableCell>
                        <TableCell align="center">
                          <Typography
                            variant="body2"
                            color={
                              stat.roundDiff > 0
                                ? 'success.main'
                                : stat.roundDiff < 0
                                ? 'error.main'
                                : 'text.secondary'
                            }
                            fontWeight={600}
                          >
                            {stat.roundDiff > 0 ? '+' : ''}
                            {stat.roundDiff}
                          </Typography>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            </CardContent>
          </Card>
        </Grid>

        {/* Matches by Round */}
        <Grid size={{ xs: 12, md: 6 }}>
          <Box display="flex" flexDirection="column" gap={2}>
            {rounds.map((round) => (
              <Card key={round}>
                <CardContent>
                  <Typography variant="h6" fontWeight={600} mb={2}>
                    Round {round}
                  </Typography>
                  <Box display="flex" flexDirection="column" gap={1}>
                    {matchesByRound[round].map((match) => (
                      <Card
                        key={match.id}
                        variant="outlined"
                        sx={{
                          cursor: onMatchClick ? 'pointer' : 'default',
                          transition: 'all 0.2s',
                          '&:hover': onMatchClick
                            ? {
                                transform: 'translateY(-2px)',
                                boxShadow: 2,
                              }
                            : {},
                        }}
                        onClick={() => onMatchClick?.(match)}
                      >
                        <CardContent sx={{ p: 1.5, '&:last-child': { pb: 1.5 } }}>
                          <Box display="flex" justifyContent="space-between" alignItems="center">
                            <Box display="flex" alignItems="center" gap={1} flex={1}>
                              <Typography variant="body2" sx={{ minWidth: 120 }}>
                                {match.team1?.name || 'TBD'}
                              </Typography>
                              {match.status === 'completed' && (
                                <Typography variant="body2" fontWeight={600}>
                                  {match.team1Score || 0}
                                </Typography>
                              )}
                            </Box>
                            <Typography
                              variant="body2"
                              color="text.secondary"
                              sx={{ mx: 2, fontWeight: 600 }}
                            >
                              vs
                            </Typography>
                            <Box
                              display="flex"
                              alignItems="center"
                              justifyContent="flex-end"
                              gap={1}
                              flex={1}
                            >
                              {match.status === 'completed' && (
                                <Typography variant="body2" fontWeight={600}>
                                  {match.team2Score || 0}
                                </Typography>
                              )}
                              <Typography
                                variant="body2"
                                sx={{ minWidth: 120, textAlign: 'right' }}
                              >
                                {match.team2?.name || 'TBD'}
                              </Typography>
                            </Box>
                            <Chip
                              label={getStatusLabel(match.status)}
                              size="small"
                              color={getStatusColor(match.status)}
                              sx={{ ml: 2, minWidth: 90 }}
                            />
                          </Box>
                        </CardContent>
                      </Card>
                    ))}
                  </Box>
                </CardContent>
              </Card>
            ))}
          </Box>
        </Grid>
      </Grid>
    </Box>
  );
}
