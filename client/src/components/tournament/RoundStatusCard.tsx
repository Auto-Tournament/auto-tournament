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
}

interface RoundStatusCardProps {
  roundStatus: RoundStatus;
  totalRounds: number;
  isActive?: boolean;
}

export function RoundStatusCard({ roundStatus, totalRounds, isActive = false }: RoundStatusCardProps) {
  const completionPercentage = roundStatus.totalMatches > 0
    ? (roundStatus.completedMatches / roundStatus.totalMatches) * 100
    : 0;

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
          <Box display="flex" gap={2}>
            <Chip
              label={`${roundStatus.completedMatches} completed`}
              size="small"
              color="success"
              variant="outlined"
            />
            <Chip
              label={`${roundStatus.pendingMatches} pending`}
              size="small"
              color="warning"
              variant="outlined"
            />
          </Box>

          {roundStatus.isComplete && (
            <Typography variant="caption" color="success.main" sx={{ fontStyle: 'italic' }}>
              Round complete. Next round will begin automatically.
            </Typography>
          )}
        </Stack>
      </CardContent>
    </Card>
  );
}

