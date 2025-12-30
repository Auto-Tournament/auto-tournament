import React, { useEffect, useState } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  IconButton,
  Box,
  Typography,
  Stack,
  Chip,
  Divider,
  CircularProgress,
  Alert,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import EmojiEventsIcon from '@mui/icons-material/EmojiEvents';
import { formatDate, getRoundLabel } from '../../utils/matchUtils';
import { MapAccordion } from './MapAccordion';
import type { Match, PlayerStats, TeamMatchHistory } from '../../types';

interface TeamMatchHistoryModalProps {
  matchHistory: TeamMatchHistory | null;
  teamId?: string;
  onClose: () => void;
}

export function TeamMatchHistoryModal({
  matchHistory,
  teamId,
  onClose,
}: TeamMatchHistoryModalProps) {
  const [match, setMatch] = useState<Match | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!matchHistory) {
      setMatch(null);
      return;
    }

    const fetchMatchDetails = async () => {
      setLoading(true);
      setError(null);

      try {
        const response = await fetch(`/api/matches/${matchHistory.slug}`);
        if (!response.ok) {
          throw new Error('Failed to fetch match details');
        }

        const data = await response.json();
        setMatch(data.match);
      } catch (err) {
        console.error('Error fetching match details:', err);
        setError(err instanceof Error ? err.message : 'Failed to load match details');
      } finally {
        setLoading(false);
      }
    };

    fetchMatchDetails();
  }, [matchHistory, teamId]);

  if (!matchHistory) {
    return null;
  }

  // Determine if the viewing team is team1 (undefined if match not loaded yet)
  const isTeam1 = teamId && match ? match.team1?.id === teamId : undefined;

  // Use matchHistory scores (already in correct perspective: team vs opponent)
  // Or calculate from match map results if available
  let team1Score = matchHistory.teamScore;
  let team2Score = matchHistory.opponentScore;

  // If we have match data and know which team is which, swap scores if needed
  if (match && teamId) {
    const calculatedSeriesScore = match.mapResults
      ? match.mapResults.reduce(
          (acc, result) => {
            if (result.team1Score > result.team2Score) {
              acc.team1 += 1;
            } else if (result.team2Score > result.team1Score) {
              acc.team2 += 1;
            }
            return acc;
          },
          { team1: 0, team2: 0 }
        )
      : null;

    if (calculatedSeriesScore) {
      // Match data has accurate series score
      team1Score = isTeam1 ? calculatedSeriesScore.team1 : calculatedSeriesScore.team2;
      team2Score = isTeam1 ? calculatedSeriesScore.team2 : calculatedSeriesScore.team1;
    }
  }

  const hasPlayerStats =
    match?.team1Players && match.team1Players.length > 0 && match.team2Players && match.team2Players.length > 0;

  const renderPlayerTable = (rows: PlayerStats[], accent: 'primary' | 'error') => {
    if (!rows.length) return null;

    const sortedRows = [...rows].sort((a, b) => b.damage - a.damage);

    return (
      <TableContainer component={Paper} variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
                <TableCell>Player</TableCell>
              <TableCell align="right">K</TableCell>
              <TableCell align="right">D</TableCell>
              <TableCell align="right">A</TableCell>
              <TableCell align="right">Damage</TableCell>
              <TableCell align="right">HS</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {sortedRows.map((player) => (
              <TableRow key={player.steamId}>
                  <TableCell
                    sx={{
                      fontWeight: 600,
                      color: `${accent}.main`,
                      maxWidth: 180,
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {player.name}
                  </TableCell>
                <TableCell align="right">{player.kills}</TableCell>
                <TableCell align="right">{player.deaths}</TableCell>
                <TableCell align="right">{player.assists}</TableCell>
                <TableCell align="right">{player.damage}</TableCell>
                <TableCell align="right">{player.headshots}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    );
  };

  return (
    <Dialog open={!!matchHistory} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>
        <Box display="flex" alignItems="center" justifyContent="space-between">
          <Typography variant="h6" fontWeight={600}>
            Match Details
          </Typography>
          <IconButton onClick={onClose} size="small">
            <CloseIcon />
          </IconButton>
        </Box>
      </DialogTitle>
      <DialogContent>
        {loading && (
          <Box display="flex" justifyContent="center" p={4}>
            <CircularProgress />
          </Box>
        )}

        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}

        {!loading && !error && match && (
          <Stack spacing={3}>
            {/* Match Header */}
            <Box>
              <Stack direction="row" spacing={2} alignItems="center" mb={2}>
                <Chip
                  icon={<EmojiEventsIcon />}
                  label={matchHistory.won ? 'VICTORY' : 'DEFEAT'}
                  color={matchHistory.won ? 'success' : 'error'}
                  sx={{ fontWeight: 600 }}
                />
                <Chip
                  label={`Match #${matchHistory.matchNumber}`}
                  variant="outlined"
                />
                <Chip
                  label={getRoundLabel(matchHistory.round)}
                  variant="outlined"
                />
              </Stack>

              {/* Teams */}
              <Box mb={2}>
                <Typography variant="h6" gutterBottom>
                  {match.team1?.name || 'Team 1'}
                  {match.team1?.tag && ` (${match.team1.tag})`} vs{' '}
                  {match.team2?.name || 'Team 2'}
                  {match.team2?.tag && ` (${match.team2.tag})`}
                </Typography>
              </Box>

              {/* Series Score */}
              <Box
                sx={{
                  p: 2,
                  borderRadius: 2,
                  bgcolor: 'background.default',
                  border: '1px solid',
                  borderColor: 'divider',
                }}
              >
                <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                  Final Series Score
                </Typography>
                <Typography variant="h4" fontWeight={700} textAlign="center">
                  {team1Score} - {team2Score}
                </Typography>
              </Box>

              {/* Match Date */}
              <Typography variant="body2" color="text.secondary" mt={2}>
                Completed: {formatDate(matchHistory.completedAt)}
              </Typography>
            </Box>

            <Divider />

            {/* Maps Accordion */}
            {match.maps && match.maps.length > 0 && (
              <Box>
                <Typography variant="subtitle1" fontWeight={600} gutterBottom>
                  Maps Played
                </Typography>
                <Stack spacing={1}>
                  {match.maps.map((mapName, index) => {
                    const mapResult = match.mapResults?.find((mr) => mr.mapNumber === index);
                    const previousMapResult =
                      index > 0 ? match.mapResults?.find((mr) => mr.mapNumber === index - 1) : undefined;

                    const viewingTeamIsTeam1 =
                      teamId && match.team1?.id && match.team1.id === teamId
                        ? true
                        : teamId && match.team2?.id && match.team2.id === teamId
                        ? false
                        : undefined;

                    const viewingTeamName =
                      viewingTeamIsTeam1 === undefined
                        ? undefined
                        : viewingTeamIsTeam1
                        ? match.team1?.name
                        : match.team2?.name;

                    const opponentTeamName =
                      viewingTeamIsTeam1 === undefined
                        ? undefined
                        : viewingTeamIsTeam1
                        ? match.team2?.name
                        : match.team1?.name;

                    return (
                      <MapAccordion
                        key={index}
                        mapNumber={index}
                        mapName={mapName}
                        mapResult={mapResult}
                        matchSlug={match.slug}
                        matchLoadedAt={match.loadedAt}
                        previousMapCompletedAt={previousMapResult?.completedAt}
                        viewingTeamName={viewingTeamName}
                        opponentTeamName={opponentTeamName}
                        viewingTeamIsTeam1={viewingTeamIsTeam1}
                      />
                    );
                  })}
                </Stack>
              </Box>
            )}

            {(!match.maps || match.maps.length === 0) && (
              <Alert severity="info">No maps available for this match.</Alert>
            )}

            {/* Aggregated player stats across the match/series */}
            {hasPlayerStats && match.team1 && match.team2 && (
              <Box>
                <Typography variant="subtitle1" fontWeight={600} gutterBottom>
                  Player Stats (All Maps)
                </Typography>
                <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
                  <Box flex={1}>
                    <Typography variant="subtitle2" color="text.secondary" mb={0.5}>
                      {match.team1.name}
                    </Typography>
                    {renderPlayerTable(match.team1Players ?? [], 'primary')}
                  </Box>
                  <Box flex={1}>
                    <Typography
                      variant="subtitle2"
                      color="text.secondary"
                      mb={0.5}
                      textAlign={{ xs: 'left', md: 'right' }}
                    >
                      {match.team2.name}
                    </Typography>
                    {renderPlayerTable(match.team2Players ?? [], 'error')}
                  </Box>
                </Stack>
              </Box>
            )}
          </Stack>
        )}
      </DialogContent>
    </Dialog>
  );
}

