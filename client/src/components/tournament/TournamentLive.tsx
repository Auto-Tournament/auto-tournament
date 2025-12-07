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
import { RestartTournamentButton } from '../dashboard/RestartTournamentButton';

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
            data-testid="tournament-status"
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
          <Tooltip
            title="View the tournament bracket and match details"
            PopperProps={{ style: { zIndex: 1200 } }}
            enterDelay={500}
          >
            <span style={{ flex: 1, minWidth: 200 }}>
              <Button
                data-testid="view-bracket-button"
                variant="contained"
                fullWidth
                startIcon={<VisibilityIcon />}
                onClick={onViewBracket}
              >
                View Bracket
              </Button>
            </span>
          </Tooltip>
          {tournament.status === 'in_progress' && (
            <Tooltip
              title="End all active matches on servers and reload them (useful for stuck matches)"
              PopperProps={{ style: { zIndex: 1200 } }}
              enterDelay={500}
            >
              <Box flex={1} minWidth={200}>
                <RestartTournamentButton fullWidth variant="outlined" size="medium" />
              </Box>
            </Tooltip>
          )}
          <Tooltip
            title="End all matches and reset tournament to setup mode (keeps tournament settings but clears all match data)"
            PopperProps={{ style: { zIndex: 1200 } }}
            enterDelay={500}
          >
            <span>
              <Button
                variant="outlined"
                color="error"
                startIcon={<RestartAltIcon />}
                onClick={onReset}
                disabled={saving}
              >
                Reset to Setup
              </Button>
            </span>
          </Tooltip>
          <Tooltip
            title="Permanently delete this tournament and all its data"
            PopperProps={{ style: { zIndex: 1200 } }}
            enterDelay={500}
          >
            <span>
              <Button
                variant="outlined"
                color="error"
                startIcon={<DeleteForeverIcon />}
                onClick={onDelete}
                disabled={saving}
              >
                Delete
              </Button>
            </span>
          </Tooltip>
        </Box>
      </CardContent>
    </Card>
  );
};
