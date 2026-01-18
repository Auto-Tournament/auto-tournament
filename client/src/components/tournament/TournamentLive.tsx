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
  IconButton,
  TextField,
} from '@mui/material';
import VisibilityIcon from '@mui/icons-material/Visibility';
import RestartAltIcon from '@mui/icons-material/RestartAlt';
import DeleteForeverIcon from '@mui/icons-material/DeleteForever';
import EmojiEventsIcon from '@mui/icons-material/EmojiEvents';
import EditIcon from '@mui/icons-material/Edit';
import CheckIcon from '@mui/icons-material/Check';
import CloseIcon from '@mui/icons-material/Close';
import { TOURNAMENT_TYPES, MATCH_FORMATS } from '../../constants/tournament';
import { RestartTournamentButton } from '../dashboard/RestartTournamentButton';
import { api } from '../../utils/api';
import type { Map } from '../../types/api.types';
import { getMapDisplayName } from '../../constants/maps';

interface TournamentLiveProps {
  tournament: {
    name: string;
    type: string;
    format: string;
    status: string;
    teams: Array<{ id: string; name: string }>;
    maps: string[];
    mapSequence?: string[];
    teamSize?: number;
    maxRounds?: number;
    overtimeMode?: 'enabled' | 'disabled';
    overtimeSegments?: number;
    eloTemplateId?: string;
  };
  tournamentId: number;
  onRename: (newName: string) => Promise<void> | void;
  saving: boolean;
  onViewBracket: () => void;
  onReset: () => void;
  onDelete: () => void;
  playerCount?: number;
}

export const TournamentLive: React.FC<TournamentLiveProps> = ({
  tournament,
  tournamentId,
  onRename,
  saving,
  onViewBracket,
  onReset,
  onDelete,
  playerCount,
}) => {
  const [isRenaming, setIsRenaming] = React.useState(false);
  const [nameInput, setNameInput] = React.useState(tournament.name);
  const [availableMaps, setAvailableMaps] = React.useState<Map[]>([]);

  React.useEffect(() => {
    setNameInput(tournament.name);
  }, [tournament.name]);

  React.useEffect(() => {
    const loadMaps = async () => {
      try {
        const response = await api.get<{ maps: Map[] }>('/api/maps');
        if (response.maps) {
          setAvailableMaps(response.maps);
        }
      } catch (err) {
        console.error('Error loading maps for live tournament view:', err);
      }
    };
    loadMaps();
  }, []);

  const isShuffle = tournament.type === 'shuffle';
  const teamSize = tournament.teamSize || 5;
  const maxRounds = tournament.maxRounds || 24;
  const overtimeMode = tournament.overtimeMode ?? 'enabled';
  const overtimeSegments = tournament.overtimeSegments;

  const resolveDisplayName = (mapId: string): string => {
    const map = availableMaps.find((m) => m.id === mapId);
    return map ? map.displayName : getMapDisplayName(mapId);
  };

  const shuffleMaps: string[] =
    (tournament.mapSequence && tournament.mapSequence.length > 0
      ? tournament.mapSequence
      : tournament.maps) || [];

  const handleStartRename = () => {
    setNameInput(tournament.name);
    setIsRenaming(true);
  };

  const handleCancelRename = () => {
    setNameInput(tournament.name);
    setIsRenaming(false);
  };

  const handleConfirmRename = async () => {
    const trimmed = nameInput.trim();

    if (!trimmed || trimmed === tournament.name) {
      setNameInput(tournament.name);
      setIsRenaming(false);
      return;
    }

    try {
      await onRename(trimmed);
      setIsRenaming(false);
    } catch {
      // Error handling is managed by caller (snackbar), keep edit state
    }
  };

  return (
    <Card sx={{ mb: 3 }}>
      <CardContent>
        <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
          <Box display="flex" alignItems="center" gap={1} sx={{ flex: 1, minWidth: 0 }}>
            {isRenaming ? (
              <>
                <TextField
                  value={nameInput}
                  onChange={(event) => setNameInput(event.target.value)}
                  size="small"
                  variant="outlined"
                  autoFocus
                  slotProps={{
                    htmlInput: { maxLength: 100 },
                  }}
                  sx={{ maxWidth: 360 }}
                />
                <IconButton
                  aria-label="Save tournament name"
                  color="primary"
                  size="small"
                  onClick={handleConfirmRename}
                  disabled={saving}
                >
                  <CheckIcon fontSize="small" />
                </IconButton>
                <IconButton
                  aria-label="Cancel tournament rename"
                  size="small"
                  onClick={handleCancelRename}
                  disabled={saving}
                >
                  <CloseIcon fontSize="small" />
                </IconButton>
              </>
            ) : (
              <>
                <Typography variant="h5" fontWeight={600} noWrap sx={{ mr: 1 }}>
                  {tournament.name}
                </Typography>
                <Tooltip
                  title="Rename tournament"
                  PopperProps={{ style: { zIndex: 1200 } }}
                  enterDelay={500}
                >
                  <span>
                    <IconButton
                      aria-label="Edit tournament name"
                      size="small"
                      onClick={handleStartRename}
                      disabled={saving}
                    >
                      <EditIcon fontSize="small" />
                    </IconButton>
                  </span>
                </Tooltip>
              </>
            )}
          </Box>
          <Chip
            data-testid="tournament-status"
            label={tournament.status === 'in_progress' ? 'LIVE' : 'COMPLETED'}
          // Use the same pastel red/pink accent as other LIVE indicators,
          // and mint green for completed tournaments.
          color={tournament.status === 'in_progress' ? 'error' : 'success'}
          />
        </Box>

        <Alert severity={tournament.status === 'in_progress' ? 'warning' : 'success'} sx={{ mb: 3 }}>
          <Typography variant="body2" fontWeight={600} gutterBottom>
            Tournament is {tournament.status === 'in_progress' ? 'Live' : 'Completed'}
          </Typography>
          <Typography variant="body2">
            {tournament.status === 'in_progress'
              ? 'Matches are currently running on servers. You cannot edit tournament settings while live (except the tournament name).'
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
          {!isShuffle && (
            <Grid size={{ xs: 12, sm: 6 }}>
              <Typography variant="subtitle2" color="text.secondary">
                Teams
              </Typography>
              <Typography variant="body2">{tournament.teams.length} teams competing</Typography>
            </Grid>
          )}
          {isShuffle && (
            <Grid size={{ xs: 12, sm: 6 }}>
              <Typography variant="subtitle2" color="text.secondary">
                Players
              </Typography>
              <Typography variant="body2">
                {typeof playerCount === 'number'
                  ? `${playerCount} player${playerCount === 1 ? '' : 's'} competing`
                  : 'Players competing'}
              </Typography>
            </Grid>
          )}
          {!isShuffle && (
            <Grid size={{ xs: 12, sm: 6 }}>
              <Typography variant="subtitle2" color="text.secondary">
                Maps
              </Typography>
              <Box display="flex" flexWrap="wrap" gap={1} mt={0.5}>
                {tournament.maps.map((mapId: string) => (
                  <Chip
                    key={mapId}
                    label={resolveDisplayName(mapId)}
                    size="small"
                    variant="outlined"
                  />
                ))}
              </Box>
            </Grid>
          )}
          {!isShuffle && (
            <Grid size={{ xs: 12, sm: 6 }}>
              <Typography variant="subtitle2" color="text.secondary">
                Match Rules
              </Typography>
              <Typography variant="body2">
                Max {maxRounds} rounds per map; winner is first to {Math.floor(maxRounds / 2) + 1}{' '}
                rounds.
              </Typography>
            </Grid>
          )}
          {isShuffle && (
            <>
              <Grid size={{ xs: 12, sm: 6 }}>
                <Typography variant="subtitle2" color="text.secondary">
                  Shuffle Settings
                </Typography>
                <Typography variant="body2">
                  Team Size: {teamSize}v{teamSize}
                </Typography>
                <Typography variant="body2">Max Rounds per Map: {maxRounds}</Typography>
                <Typography variant="body2">
                  Overtime:{' '}
                  {overtimeMode === 'enabled' ? 'Enabled' : 'Disabled (No Overtime)'}
                </Typography>
                {overtimeMode === 'enabled' && typeof overtimeSegments === 'number' && (
                  <Typography variant="body2">
                    Overtime Segments:{' '}
                    {overtimeSegments > 0
                      ? `${overtimeSegments} ${
                          overtimeSegments === 1 ? 'segment' : 'segments'
                        }`
                      : 'MatchZy default'}
                  </Typography>
                )}
                {tournament.eloTemplateId && (
                  <Typography variant="body2">
                    ELO Template: {tournament.eloTemplateId}
                  </Typography>
                )}
              </Grid>
              <Grid size={{ xs: 12, sm: 6 }}>
                <Typography variant="subtitle2" color="text.secondary">
                  Map Sequence (Rounds)
                </Typography>
                <Box display="flex" flexWrap="wrap" gap={1} mt={0.5}>
                  {shuffleMaps.length > 0 ? (
                    shuffleMaps.map((mapId: string, index: number) => (
                      <Chip
                        key={`${mapId}-${index}`}
                        label={`${index + 1}. ${resolveDisplayName(mapId)}`}
                        size="small"
                        variant="outlined"
                      />
                    ))
                  ) : (
                    <Typography variant="body2" color="text.secondary">
                      No maps configured yet.
                    </Typography>
                  )}
                </Box>
              </Grid>
            </>
          )}
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
          <Tooltip
            title="Open the public leaderboard page to share with players"
            PopperProps={{ style: { zIndex: 1200 } }}
            enterDelay={500}
          >
            <span style={{ flex: 1, minWidth: 200 }}>
              <Button
                variant="outlined"
                fullWidth
                startIcon={<EmojiEventsIcon />}
                onClick={() => window.open(`/tournament/${tournamentId}/leaderboard`, '_blank')}
              >
                Leaderboard
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
