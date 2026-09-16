import {
  Box,
  Card,
  CardContent,
  Typography,
  Chip,
  Grid,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
} from '@mui/material';
import {
  getStatusColor,
  getStatusLabel,
  isUnpairedSwissMatch,
  waitingForPairingLabel,
} from '../../utils/matchUtils';
import type { Match, MatchLiveStats, Team } from '../../types';
import { deriveSeriesScore } from '../../utils/matchScoreDisplay';
import { TeamNameLink } from '../team/TeamNameLink';
import { useTranslation } from 'react-i18next';

interface SwissViewProps {
  matches: Match[];
  teams: Team[];
  totalRounds: number;
  onMatchClick?: (match: Match) => void;
}

interface SwissTeamRecord {
  team: Team;
  wins: number;
  losses: number;
  roundsWon: number;
  roundsLost: number;
  roundDiff: number;
  buchholz: number;
  opponents: string[];
  opponentIds: string[];
}

export default function SwissView({ matches, teams, totalRounds, onMatchClick }: SwissViewProps) {
  const { t } = useTranslation();
  type SwissMatch = Match & { liveStats?: MatchLiveStats | null };

  // Calculate team records
  const calculateRecords = (): SwissTeamRecord[] => {
    const records: { [teamId: string]: SwissTeamRecord } = {};

    // Initialize
    teams.forEach((team) => {
      records[team.id] = {
        team,
        wins: 0,
        losses: 0,
        roundsWon: 0,
        roundsLost: 0,
        roundDiff: 0,
        buchholz: 0,
        opponents: [],
        opponentIds: [],
      };
    });

    // Byes: a completed match with a single team counts as a win.
    matches
      .filter((m) => m.status === 'completed' && Boolean(m.team1) !== Boolean(m.team2))
      .forEach((match) => {
        const solo = (match.team1 ?? match.team2)!;
        if (records[solo.id] && match.winner?.id === solo.id) records[solo.id].wins++;
      });

    // Process matches
    matches
      .filter((m) => m.status === 'completed' && m.team1 && m.team2)
      .forEach((match) => {
        const team1Id = match.team1!.id;
        const team2Id = match.team2!.id;

        if (records[team1Id] && records[team2Id]) {
          const team1Score = match.team1Score || 0;
          const team2Score = match.team2Score || 0;

          records[team1Id].roundsWon += team1Score;
          records[team1Id].roundsLost += team2Score;
          records[team1Id].opponents.push(match.team2!.name);
          records[team1Id].opponentIds.push(team2Id);

          records[team2Id].roundsWon += team2Score;
          records[team2Id].roundsLost += team1Score;
          records[team2Id].opponents.push(match.team1!.name);
          records[team2Id].opponentIds.push(team1Id);

          if (match.winner?.id === team1Id) {
            records[team1Id].wins++;
            records[team2Id].losses++;
          } else if (match.winner?.id === team2Id) {
            records[team2Id].wins++;
            records[team1Id].losses++;
          }
        }
      });

    // Calculate differential and Buchholz (sum of opponents' wins)
    Object.values(records).forEach((record) => {
      record.roundDiff = record.roundsWon - record.roundsLost;
      record.buchholz = record.opponentIds.reduce((sum, id) => sum + (records[id]?.wins ?? 0), 0);
    });

    // Same leading order the API uses to pick the champion: wins, losses,
    // Buchholz, then differential.
    return Object.values(records).sort((a, b) => {
      if (b.wins !== a.wins) return b.wins - a.wins;
      if (a.losses !== b.losses) return a.losses - b.losses;
      if (b.buchholz !== a.buchholz) return b.buchholz - a.buchholz;
      if (b.roundDiff !== a.roundDiff) return b.roundDiff - a.roundDiff;
      return b.roundsWon - a.roundsWon;
    });
  };

  const records = calculateRecords();

  // Group matches by round
  const matchesByRound: { [round: number]: Match[] } = {};
  matches.forEach((match) => {
    if (!matchesByRound[match.round]) {
      matchesByRound[match.round] = [];
    }
    matchesByRound[match.round].push(match);
  });

  return (
    <Box>
      <Grid container spacing={3}>
        {/* Leaderboard */}
        <Grid size={{ xs: 12, md: 5 }}>
          <Card>
            <CardContent>
              <Typography variant="h6" fontWeight={600} mb={2}>
                🏆 Current Leaderboard
              </Typography>
              <TableContainer>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell sx={{ fontWeight: 600 }}>#</TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>Team</TableCell>
                      <TableCell align="center" sx={{ fontWeight: 600 }}>
                        Record
                      </TableCell>
                      <TableCell align="center" sx={{ fontWeight: 600 }}>
                        RD
                      </TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {records.map((record, index) => (
                      <TableRow
                        key={record.team.id}
                        sx={{
                          bgcolor:
                            index < 2
                              ? 'success.main'
                              : index < 4
                              ? 'action.selected'
                              : 'transparent',
                          opacity: index < 4 ? 1 : 0.7,
                        }}
                      >
                        <TableCell>
                          <Typography fontWeight={index < 4 ? 700 : 400}>{index + 1}</Typography>
                        </TableCell>
                        <TableCell>
                          <TeamNameLink
                            teamId={record.team.id}
                            name={record.team.name}
                            tag={record.team.tag ?? null}
                            showTag={false}
                            variant="body2"
                            sx={{ fontWeight: index < 4 ? 600 : 400 }}
                          />
                        </TableCell>
                        <TableCell align="center">
                          <Typography variant="body2" fontWeight={600}>
                            {record.wins}-{record.losses}
                          </Typography>
                        </TableCell>
                        <TableCell align="center">
                          <Typography
                            variant="body2"
                            fontWeight={600}
                            color={
                              record.roundDiff > 0
                                ? 'success.main'
                                : record.roundDiff < 0
                                ? 'error.main'
                                : 'text.secondary'
                            }
                          >
                            {record.roundDiff > 0 ? '+' : ''}
                            {record.roundDiff}
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

        {/* Rounds */}
        <Grid size={{ xs: 12, md: 7 }}>
          <Box display="flex" flexDirection="column" gap={2}>
            {Array.from({ length: totalRounds }, (_, i) => i + 1).map((round) => {
              const roundMatches = matchesByRound[round] || [];
              const hasMatches = roundMatches.length > 0;

              return (
                <Card key={round}>
                  <CardContent>
                    <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
                      <Typography variant="h6" fontWeight={600}>
                        {t('rounds.roundN', { n: round })}
                      </Typography>
                      {!hasMatches && <Chip label={t('bracket.swiss.notGenerated')} size="small" color="default" />}
                    </Box>

                    {hasMatches ? (
                      <Box display="flex" flexDirection="column" gap={1}>
                        {roundMatches.map((match) => (
                          // Note: `useBracket` can attach `liveStats` onto matches.
                          // SwissView treats them as optional to show last-known series score.
                          (() => {
                            const m = match as SwissMatch;
                            const series = deriveSeriesScore(m, m.liveStats ?? null);
                            const isInProgress = m.status === 'loaded' || m.status === 'live';
                            const isNotStarted = m.status === 'pending' || m.status === 'ready';
                            const isUnknownZero =
                              series.source === 'default' &&
                              series.team1 === 0 &&
                              series.team2 === 0;
                            const showScore = m.status === 'completed' || isInProgress;
                            const left =
                              showScore && !(isNotStarted && isUnknownZero) ? series.team1 : null;
                            const right =
                              showScore && !(isNotStarted && isUnknownZero) ? series.team2 : null;

                            return (
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
                              <Box
                                display="flex"
                                justifyContent="space-between"
                                alignItems="center"
                              >
                                <Box display="flex" alignItems="center" gap={1} flex={1}>
                                  <Typography variant="body2" sx={{ minWidth: 120 }}>
                                    {match.team1?.name || 'TBD'}
                                  </Typography>
                                  {left !== null ? (
                                    <Typography variant="body2" fontWeight={600}>
                                      {left}
                                    </Typography>
                                  ) : (
                                    <Typography variant="body2" fontWeight={600} color="text.secondary">
                                      —
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
                                  {right !== null ? (
                                    <Typography variant="body2" fontWeight={600}>
                                      {right}
                                    </Typography>
                                  ) : (
                                    <Typography variant="body2" fontWeight={600} color="text.secondary">
                                      —
                                    </Typography>
                                  )}
                                  <Typography
                                    variant="body2"
                                    sx={{ minWidth: 120, textAlign: 'right' }}
                                  >
                                    {match.team2?.name ||
                                      (match.team1 && match.status === 'completed'
                                        ? t('bracket.swiss.bye')
                                        : 'TBD')}
                                  </Typography>
                                </Box>
                                <Chip
                                  label={
                                    isUnpairedSwissMatch(match)
                                      ? waitingForPairingLabel()
                                      : getStatusLabel(match.status)
                                  }
                                  size="small"
                                  color={getStatusColor(match.status)}
                                  sx={{ ml: 2, minWidth: 90 }}
                                />
                              </Box>
                            </CardContent>
                          </Card>
                            );
                          })()
                        ))}
                      </Box>
                    ) : (
                      <Typography
                        variant="body2"
                        color="text.secondary"
                        sx={{ fontStyle: 'italic' }}
                      >
                        {t('bracket.swiss.generatedAfter', { round: round - 1 })}
                      </Typography>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </Box>
        </Grid>
      </Grid>
    </Box>
  );
}
