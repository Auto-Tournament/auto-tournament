import React from 'react';
import { Box, Card, CardContent, Typography, Grid, Chip, IconButton, Tooltip } from '@mui/material';
import HistoryIcon from '@mui/icons-material/History';
import DownloadIcon from '@mui/icons-material/Download';
import { formatDate } from '../../utils/matchUtils';
import type { TeamMatchHistory } from '../../types';

interface TeamMatchHistoryProps {
  matchHistory: TeamMatchHistory[];
}

export function TeamMatchHistoryCard({ matchHistory }: TeamMatchHistoryProps) {
  if (matchHistory.length === 0) {
    return null;
  }

  return (
    <Box>
      <Box display="flex" alignItems="center" gap={1} mb={3}>
        <HistoryIcon color="primary" />
        <Typography variant="h6" fontWeight={600}>
          Match History
        </Typography>
      </Box>
      <Grid container spacing={2}>
        {matchHistory.map((historyMatch) => (
          <Grid size={{ xs: 12, sm: 6 }} key={historyMatch.slug}>
            <Card
              sx={{
                borderLeft: 4,
                borderColor: historyMatch.won ? 'success.main' : 'error.main',
                height: '100%',
              }}
            >
              <CardContent>
                <Box display="flex" justifyContent="space-between" alignItems="start" mb={1}>
                  <Box display="flex" gap={1} alignItems="center">
                    <Chip
                      label={historyMatch.won ? 'WIN' : 'LOSS'}
                      size="small"
                      color={historyMatch.won ? 'success' : 'error'}
                      sx={{ fontWeight: 600 }}
                    />
                    <Chip
                      label={`${historyMatch.teamScore} - ${historyMatch.opponentScore}`}
                      size="small"
                      variant="outlined"
                      sx={{ fontWeight: 600 }}
                    />
                  </Box>
                  <Tooltip title="Download match demo">
                    <IconButton
                      size="small"
                      onClick={() => {
                        const link = document.createElement('a');
                        link.href = `/api/demos/${historyMatch.slug}/download`;
                        link.download = '';
                        document.body.appendChild(link);
                        link.click();
                        document.body.removeChild(link);
                      }}
                      sx={{ color: 'primary.main' }}
                    >
                      <DownloadIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                </Box>
                <Typography variant="body2" fontWeight={600} gutterBottom>
                  vs {historyMatch.opponent?.name || 'Unknown'}
                </Typography>
                <Typography variant="caption" color="text.secondary" display="block">
                  Match #{historyMatch.matchNumber}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {formatDate(historyMatch.completedAt)}
                </Typography>
              </CardContent>
            </Card>
          </Grid>
        ))}
      </Grid>
    </Box>
  );
}

