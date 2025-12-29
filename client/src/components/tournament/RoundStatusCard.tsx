import React from 'react';
import {
  Card,
  CardContent,
  Box,
  Typography,
  LinearProgress,
  Chip,
  Stack,
} from '@mui/material';
import MapIcon from '@mui/icons-material/Map';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ScheduleIcon from '@mui/icons-material/Schedule';

interface RoundStatus {
  roundNumber: number;
  totalMatches: number;
  completedMatches: number;
  pendingMatches: number;
  isComplete: boolean;
  map: string;
  // Optional finer‑grained breakdown for in‑progress rounds.
  // When provided, we render "X playing" for active matches and reserve
  // "pending" only for matches that haven't started / are waiting for a server.
  playingMatches?: number;
  waitingMatches?: number;
}

interface RoundStatusCardProps {
  roundStatus: RoundStatus;
  totalRounds: number;
  isActive?: boolean;
  allocationCountdownSeconds?: number | null;
}

export function RoundStatusCard({
  roundStatus,
  totalRounds,
  isActive = false,
  allocationCountdownSeconds,
}: RoundStatusCardProps) {
  const completionPercentage =
    roundStatus.totalMatches > 0
      ? (roundStatus.completedMatches / roundStatus.totalMatches) * 100
      : 0;

  const playingCount = roundStatus.playingMatches ?? 0;
  const waitingCount =
    roundStatus.waitingMatches !== undefined
      ? roundStatus.waitingMatches
      : roundStatus.pendingMatches;

  return (
    <Card variant="outlined" sx={{ mb: 2 }}>
      <CardContent>
        <Box display="flex" alignItems="center" justifyContent="space-between" mb={2}>
          <Box display="flex" alignItems="center" gap={1}>
            {roundStatus.isComplete ? (
              <CheckCircleIcon color="success" />
            ) : (
              <ScheduleIcon color={isActive ? 'primary' : 'action'} />
            )}
            <Typography variant="h6" fontWeight={600}>
              Round {roundStatus.roundNumber} of {totalRounds}
            </Typography>
            {roundStatus.isComplete && (
              <Chip label="Complete" size="small" color="success" />
            )}
            {isActive && !roundStatus.isComplete && (
              <Chip label="In Progress" size="small" color="primary" />
            )}
          </Box>
        </Box>

        <Stack spacing={2}>
          {/* Map Info */}
          <Box display="flex" alignItems="center" gap={1}>
            <MapIcon fontSize="small" color="action" />
            <Typography variant="body2" color="text.secondary">
              {roundStatus.map}
            </Typography>
          </Box>

          {/* Progress */}
          <Box>
            <Box display="flex" justifyContent="space-between" alignItems="center" mb={1}>
              <Typography variant="body2" color="text.secondary">
                Match Progress
              </Typography>
              <Typography variant="body2" fontWeight={600}>
                {roundStatus.completedMatches} / {roundStatus.totalMatches} completed
              </Typography>
            </Box>
            <LinearProgress
              variant="determinate"
              value={completionPercentage}
              sx={{
                height: 8,
                borderRadius: 1,
                bgcolor: 'action.disabledBackground',
              }}
              color={roundStatus.isComplete ? 'success' : 'primary'}
            />
          </Box>

          {/* Match Status Summary */}
          <Box display="flex" gap={2} flexWrap="wrap">
            <Chip
              label={`${roundStatus.completedMatches} completed`}
              size="small"
              color="success"
              variant="outlined"
            />
            {playingCount > 0 && (
              <Chip
                label={`${playingCount} playing`}
                size="small"
                color="primary"
                variant="outlined"
              />
            )}
            {waitingCount > 0 && (
              <Chip
                label={`${waitingCount} pending`}
                size="small"
                color="warning"
                variant="outlined"
              />
            )}
            {allocationCountdownSeconds !== null && allocationCountdownSeconds > 0 && (
              <Chip
                label={`Next servers in ${Math.max(0, allocationCountdownSeconds)}s`}
                size="small"
                color="info"
                variant="outlined"
              />
            )}
          </Box>

          {/* Previously displayed a generic "next round will begin automatically" message here.
              This has been removed to avoid confusion when tournaments are finished or when
              advancement is controlled manually. */}
        </Stack>
      </CardContent>
    </Card>
  );
}

