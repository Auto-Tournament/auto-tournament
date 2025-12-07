import React from 'react';
import {
  Card,
  CardContent,
  Typography,
  List,
  ListItem,
  ListItemText,
  Chip,
  Box,
  Stack,
  Divider,
} from '@mui/material';
import { SportsEsports as MatchIcon } from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import type { MatchListItem } from '../../types';
import { formatDate } from '../../utils/matchUtils';

interface RecentMatchesListProps {
  matches: MatchListItem[];
  maxItems?: number;
}

export default function RecentMatchesList({ matches, maxItems = 10 }: RecentMatchesListProps) {
  const navigate = useNavigate();

  // Get recent matches sorted by most recent first
  const recentMatches = matches
    .filter((m) => m.status === 'completed' || m.status === 'live' || m.status === 'loaded')
    .sort((a, b) => {
      const aTime = a.completedAt || a.loadedAt || 0;
      const bTime = b.completedAt || b.loadedAt || 0;
      return bTime - aTime;
    })
    .slice(0, maxItems);

  const getStatusColor = (status: string): 'default' | 'primary' | 'success' | 'warning' | 'error' => {
    switch (status) {
      case 'completed':
        return 'default';
      case 'live':
        return 'success';
      case 'loaded':
        return 'warning';
      default:
        return 'default';
    }
  };

  const getStatusLabel = (status: string): string => {
    switch (status) {
      case 'completed':
        return 'Completed';
      case 'live':
        return 'Live';
      case 'loaded':
        return 'Warmup';
      default:
        return status.toUpperCase();
    }
  };

  if (recentMatches.length === 0) {
    return (
      <Card variant="outlined" sx={{ height: '100%' }}>
        <CardContent>
          <Box display="flex" alignItems="center" gap={1} mb={2}>
            <MatchIcon color="primary" />
            <Typography component="h2" variant="subtitle2" sx={{ fontWeight: 600 }}>
              Recent Matches
            </Typography>
          </Box>
          <Typography variant="body2" color="text.secondary">
            No matches available yet.
          </Typography>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card variant="outlined" sx={{ height: '100%' }}>
      <CardContent>
        <Box display="flex" alignItems="center" gap={1} mb={2}>
          <MatchIcon color="primary" />
          <Typography component="h2" variant="subtitle2" sx={{ fontWeight: 600 }}>
            Recent Matches
          </Typography>
        </Box>
        <List sx={{ py: 0 }}>
          {recentMatches.map((match, index) => (
            <React.Fragment key={match.id}>
              <ListItem
                sx={{
                  px: 0,
                  py: 1.5,
                  cursor: 'pointer',
                  '&:hover': {
                    bgcolor: 'action.hover',
                    borderRadius: 1,
                  },
                }}
                onClick={() => navigate('/matches')}
              >
                <ListItemText
                  primary={
                    <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
                      <Typography variant="body2" fontWeight={600}>
                        {match.team1?.name || 'TBD'} vs {match.team2?.name || 'TBD'}
                      </Typography>
                      <Chip
                        label={getStatusLabel(match.status)}
                        size="small"
                        color={getStatusColor(match.status)}
                        sx={{ fontSize: '0.7rem', height: 20 }}
                      />
                    </Stack>
                  }
                  secondary={
                    <Box mt={0.5}>
                      <Typography variant="caption" color="text.secondary">
                        {match.roundLabel || `Round ${match.round}`}
                        {match.completedAt && ` • ${formatDate(match.completedAt)}`}
                        {match.loadedAt && !match.completedAt && ` • Started ${formatDate(match.loadedAt)}`}
                      </Typography>
                    </Box>
                  }
                />
              </ListItem>
              {index < recentMatches.length - 1 && <Divider />}
            </React.Fragment>
          ))}
        </List>
      </CardContent>
    </Card>
  );
}

