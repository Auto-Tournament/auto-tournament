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
  Accordion,
  AccordionSummary,
  AccordionDetails,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import EmojiEventsIcon from '@mui/icons-material/EmojiEvents';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import { formatDate, getRoundLabel } from '../../utils/matchUtils';
import { MapAccordion } from './MapAccordion';
import type { Match, TeamMatchHistory } from '../../types';

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

  // Determine if the viewing team is team1 (once match is loaded)
  const isTeam1 = teamId && match ? match.team1?.id === teamId : true;

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
                    const mapResult = match.mapResults?.find(
                      (mr) => mr.mapNumber === index
                    );
                    const previousMapResult = index > 0
                      ? match.mapResults?.find((mr) => mr.mapNumber === index - 1)
                      : undefined;

                    return (
                      <MapAccordion
                        key={index}
                        mapNumber={index}
                        mapName={mapName}
                        mapResult={mapResult}
                        matchSlug={match.slug}
                        matchLoadedAt={match.loadedAt}
                        previousMapCompletedAt={previousMapResult?.completedAt}
                      />
                    );
                  })}
                </Stack>
              </Box>
            )}

            {(!match.maps || match.maps.length === 0) && (
              <Alert severity="info">No maps available for this match.</Alert>
            )}
          </Stack>
        )}
      </DialogContent>
    </Dialog>
  );
}

