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
  Divider,
  Tooltip,
  CircularProgress,
} from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import RocketLaunchIcon from '@mui/icons-material/RocketLaunch';
import VisibilityIcon from '@mui/icons-material/Visibility';
import RefreshIcon from '@mui/icons-material/Refresh';
import DeleteForeverIcon from '@mui/icons-material/DeleteForever';
import { TOURNAMENT_TYPES, MATCH_FORMATS } from '../../constants/tournament';

interface TournamentReviewProps {
  tournament: {
    name: string;
    type: string;
    format: string;
    teams: Array<{ id: string; name: string }>;
    maps: string[];
  };
  starting: boolean;
  saving: boolean;
  onEdit?: () => void;
  onStart: () => void;
  onViewBracket: () => void;
  onRegenerate: () => void;
  onDelete: () => void;
}

export const TournamentReview: React.FC<TournamentReviewProps> = ({
  tournament,
  starting,
  saving,
  onEdit,
  onStart,
  onViewBracket,
  onRegenerate,
  onDelete,
}) => {
  return (
    <Card sx={{ mb: 3 }}>
      <CardContent>
        <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
          <Typography variant="h5" fontWeight={600}>
            Review Tournament
          </Typography>
          <Chip label="READY TO START" color="success" />
        </Box>

        <Alert severity="info" sx={{ mb: 3 }} icon={<CheckCircleIcon />}>
          <Typography variant="body2">
            Tournament is configured and brackets are generated. Review the details below, then
            click <strong>"Start Tournament"</strong> to allocate servers and begin matches.
          </Typography>
        </Alert>

        <Grid container spacing={3}>
          <Grid size={{ xs: 12, md: 6 }}>
            <Typography variant="subtitle2" color="text.secondary" gutterBottom>
              Tournament Name
            </Typography>
            <Typography variant="body1" fontWeight={600} mb={2}>
              {tournament.name}
            </Typography>

            <Typography variant="subtitle2" color="text.secondary" gutterBottom>
              Format
            </Typography>
            <Typography variant="body1" mb={2}>
              {TOURNAMENT_TYPES.find((t) => t.value === tournament.type)?.label} •{' '}
              {MATCH_FORMATS.find((f) => f.value === tournament.format)?.label}
            </Typography>
          </Grid>

          <Grid size={{ xs: 12, md: 6 }}>
            <Typography variant="subtitle2" color="text.secondary" gutterBottom>
              Teams ({tournament.teams.length})
            </Typography>
            <Box display="flex" flexWrap="wrap" gap={1} mb={2}>
              {tournament.teams.map((team) => (
                <Chip key={team.id} label={team.name} size="small" />
              ))}
            </Box>

            <Typography variant="subtitle2" color="text.secondary" gutterBottom>
              Map Pool ({tournament.maps.length})
            </Typography>
            <Box display="flex" flexWrap="wrap" gap={1}>
              {tournament.maps.map((map: string) => (
                <Chip key={map} label={map} size="small" variant="outlined" />
              ))}
            </Box>
          </Grid>
        </Grid>

        <Divider sx={{ my: 3 }} />

        <Box display="flex" gap={2} flexWrap="wrap">
          <Button
            variant="contained"
            color="success"
            size="large"
            startIcon={
              starting ? <CircularProgress size={20} color="inherit" /> : <RocketLaunchIcon />
            }
            onClick={onStart}
            disabled={starting || saving}
            sx={{ flex: 1, minWidth: 200 }}
          >
            {starting ? 'Starting...' : 'Start Tournament'}
          </Button>
          {onEdit && (
            <Tooltip title="Edit tournament settings">
              <Button variant="outlined" onClick={onEdit} disabled={starting || saving}>
                Edit
              </Button>
            </Tooltip>
          )}
          <Tooltip title="View the bracket structure">
            <Button variant="outlined" startIcon={<VisibilityIcon />} onClick={onViewBracket}>
              View Bracket
            </Button>
          </Tooltip>
          <Tooltip title="Recreate brackets with same settings">
            <Button
              variant="outlined"
              color="warning"
              startIcon={<RefreshIcon />}
              onClick={onRegenerate}
              disabled={saving}
            >
              Regenerate
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
