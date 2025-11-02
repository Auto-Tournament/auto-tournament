import React from 'react';
import {
  Box,
  Typography,
  Card,
  CardContent,
  Button,
  Chip,
  Alert,
  Grid,
  Tooltip,
} from '@mui/material';
import VisibilityIcon from '@mui/icons-material/Visibility';
import RestartAltIcon from '@mui/icons-material/RestartAlt';
import DeleteForeverIcon from '@mui/icons-material/DeleteForever';
import { TOURNAMENT_TYPES, MATCH_FORMATS } from '../../constants/tournament';

interface TournamentLiveProps {
  tournament: {
    name: string;
    type: string;
    format: string;
    status: string;
    teams: Array<{ id: string; name: string }>;
  };
  saving: boolean;
  onViewBracket: () => void;
  onReset: () => void;
  onDelete: () => void;
}

export const TournamentLive: React.FC<TournamentLiveProps> = ({
  tournament,
  saving,
  onViewBracket,
  onReset,
  onDelete,
}) => {
  return (
    <Card sx={{ mb: 3 }}>
      <CardContent>
        <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
          <Typography variant="h5" fontWeight={600}>
            {tournament.name}
          </Typography>
          <Chip
            label={tournament.status === 'in_progress' ? 'LIVE' : 'COMPLETED'}
            color={tournament.status === 'in_progress' ? 'warning' : 'success'}
          />
        </Box>

        <Alert severity="warning" sx={{ mb: 3 }}>
          <Typography variant="body2" fontWeight={600} gutterBottom>
            Tournament is {tournament.status === 'in_progress' ? 'Live' : 'Completed'}
          </Typography>
          <Typography variant="body2">
            {tournament.status === 'in_progress'
              ? 'Matches are currently running on servers. You cannot edit tournament settings while live.'
              : 'This tournament has finished all matches. Create a new tournament or reset this one to start over.'}
          </Typography>
        </Alert>

        <Grid container spacing={2} sx={{ mb: 3 }}>
          <Grid size={{ xs: 12, sm: 6 }}>
            <Typography variant="subtitle2" color="text.secondary">
              Format
            </Typography>
            <Typography variant="body2">
              {TOURNAMENT_TYPES.find((t) => t.value === tournament.type)?.label} •{' '}
              {MATCH_FORMATS.find((f) => f.value === tournament.format)?.label}
            </Typography>
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <Typography variant="subtitle2" color="text.secondary">
              Teams
            </Typography>
            <Typography variant="body2">{tournament.teams.length} teams competing</Typography>
          </Grid>
        </Grid>

        <Box display="flex" gap={2} flexWrap="wrap">
          <Button
            variant="contained"
            startIcon={<VisibilityIcon />}
            onClick={onViewBracket}
            sx={{ flex: 1, minWidth: 200 }}
          >
            View Bracket
          </Button>
          <Tooltip title="Reset tournament to setup mode (clears all match data)">
            <Button
              variant="outlined"
              color="error"
              startIcon={<RestartAltIcon />}
              onClick={onReset}
              disabled={saving}
            >
              Reset to Setup
            </Button>
          </Tooltip>
          <Tooltip title="Delete this tournament completely">
            <Button
              variant="outlined"
              color="error"
              startIcon={<DeleteForeverIcon />}
              onClick={onDelete}
              disabled={saving}
            >
              Delete
            </Button>
          </Tooltip>
        </Box>
      </CardContent>
    </Card>
  );
};
