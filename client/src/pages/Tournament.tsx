import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Card,
  CardContent,
  Button,
  TextField,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Chip,
  Alert,
  CircularProgress,
  Stack,
  Autocomplete,
  Grid,
  Stepper,
  Step,
  StepLabel,
  Divider,
  Tooltip,
} from '@mui/material';
import EmojiEventsIcon from '@mui/icons-material/EmojiEvents';
import GroupsIcon from '@mui/icons-material/Groups';
import RefreshIcon from '@mui/icons-material/Refresh';
import RestartAltIcon from '@mui/icons-material/RestartAlt';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import WarningIcon from '@mui/icons-material/Warning';
import DeleteForeverIcon from '@mui/icons-material/DeleteForever';
import RocketLaunchIcon from '@mui/icons-material/RocketLaunch';
import VisibilityIcon from '@mui/icons-material/Visibility';
import { useNavigate } from 'react-router-dom';
import { api } from '../utils/api';
import TournamentChangePreviewModal from '../components/modals/TournamentChangePreviewModal';
import ConfirmDialog from '../components/modals/ConfirmDialog';
import { Team } from '../types';

interface TournamentDetailed {
  id: number;
  name: string;
  type: 'single_elimination' | 'double_elimination' | 'round_robin' | 'swiss';
  format: 'bo1' | 'bo3' | 'bo5';
  status: 'setup' | 'ready' | 'in_progress' | 'completed';
  teamIds: string[];
  teams: Team[];
  maps: string[];
  createdAt: number;
  settings: {
    seedingMethod: 'seeded' | 'random';
    thirdPlaceMatch?: boolean;
  };
}

interface TournamentChange {
  field: string;
  label?: string;
  oldValue?: string | string[];
  newValue?: string | string[];
  from?: string | string[];
  to?: string | string[];
}

const CS2_MAPS = [
  'de_ancient',
  'de_anubis',
  'de_dust2',
  'de_inferno',
  'de_mirage',
  'de_nuke',
  'de_overpass',
  'de_vertigo',
];

const TOURNAMENT_TYPES: Array<{
  value: string;
  label: string;
  description?: string;
  minTeams?: number;
  maxTeams?: number;
  requirePowerOfTwo?: boolean;
  validCounts?: number[];
  disabled?: boolean;
}> = [
  {
    value: 'single_elimination',
    label: 'Single Elimination',
    description: "One loss and you're out.",
    minTeams: 2,
    maxTeams: 128,
    requirePowerOfTwo: true,
    validCounts: [2, 4, 8, 16, 32, 64, 128],
  },
  {
    value: 'double_elimination',
    label: 'Double Elimination',
    description: 'Two losses to be eliminated.',
    minTeams: 2,
    maxTeams: 128,
    requirePowerOfTwo: true,
    validCounts: [2, 4, 8, 16, 32, 64, 128],
  },
  {
    value: 'round_robin',
    label: 'Round Robin',
    description: 'Everyone plays everyone.',
    minTeams: 2,
    maxTeams: 32,
  },
  {
    value: 'swiss',
    label: 'Swiss System',
    description: 'Similar records face each other.',
    minTeams: 4,
    maxTeams: 64,
  },
];

const MATCH_FORMATS = [
  { value: 'bo1', label: 'Best of 1' },
  { value: 'bo3', label: 'Best of 3' },
  { value: 'bo5', label: 'Best of 5' },
];

// Helper function to check if a tournament type is valid for the given team count
const isTournamentTypeValid = (
  tournamentType: (typeof TOURNAMENT_TYPES)[number],
  teamCount: number
): boolean => {
  if (teamCount < (tournamentType.minTeams || 0)) return false;
  if (teamCount > (tournamentType.maxTeams || Infinity)) return false;
  if (tournamentType.requirePowerOfTwo && tournamentType.validCounts) {
    return tournamentType.validCounts.includes(teamCount);
  }
  return true;
};

export default function Tournament() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [tournament, setTournament] = useState<TournamentDetailed | null>(null);
  const [teams, setTeams] = useState<Team[]>([]);

  // Form state
  const [name, setName] = useState('');
  const [type, setType] = useState('single_elimination');
  const [format, setFormat] = useState('bo3');
  const [maps, setMaps] = useState<string[]>([]);
  const [selectedTeams, setSelectedTeams] = useState<string[]>([]);

  const [saving, setSaving] = useState(false);
  const [showPreviewModal, setShowPreviewModal] = useState(false);
  const [pendingChanges, setPendingChanges] = useState<TournamentChange[]>([]);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showRegenerateConfirm, setShowRegenerateConfirm] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [showStartConfirm, setShowStartConfirm] = useState(false);
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    setError('');
    try {
      // Load teams
      const teamsResponse: { teams: Team[] } = await api.get('/api/teams');
      const loadedTeams = teamsResponse.teams || [];
      setTeams(loadedTeams);

      // Try to load existing tournament
      let tournamentExists = false;
      try {
        const tournamentResponse = await api.get('/api/tournament');
        if (tournamentResponse.success) {
          const t = tournamentResponse.tournament;
          setTournament(t);
          setName(t.name);
          setType(t.type);
          setFormat(t.format);
          setMaps(t.maps);
          setSelectedTeams(t.teamIds);
          tournamentExists = true;

          // Check if tournament is in broken state (setup with no matches)
          // This can happen if bracket generation failed in older versions
          if (t.status === 'setup') {
            try {
              const bracketResponse = await api.get('/api/tournament/bracket');
              if (!bracketResponse.matches || bracketResponse.matches.length === 0) {
                setError(
                  'Warning: Tournament exists but has no bracket. This may be from a failed bracket generation. ' +
                    'Consider deleting and recreating the tournament.'
                );
              }
            } catch {
              // Bracket endpoint failed, tournament might be broken
            }
          }
        }
      } catch {
        // No tournament exists yet
        setTournament(null);
      }
    } catch (err) {
      const error = err as Error;
      setError(error.message || 'Failed to load data');
    } finally {
      setLoading(false);
    }
  };

  const detectChanges = () => {
    if (!tournament) return [];

    const changes: TournamentChange[] = [];

    if (name !== tournament.name) {
      changes.push({
        field: 'name',
        label: 'Tournament Name',
        oldValue: tournament.name,
        newValue: name,
      });
    }

    if (type !== tournament.type) {
      changes.push({
        field: 'type',
        label: 'Tournament Type',
        oldValue:
          TOURNAMENT_TYPES.find((t) => t.value === tournament.type)?.label || tournament.type,
        newValue: TOURNAMENT_TYPES.find((t) => t.value === type)?.label || type,
      });
    }

    if (format !== tournament.format) {
      changes.push({
        field: 'format',
        label: 'Match Format',
        oldValue:
          MATCH_FORMATS.find((f) => f.value === tournament.format)?.label || tournament.format,
        newValue: MATCH_FORMATS.find((f) => f.value === format)?.label || format,
      });
    }

    if (JSON.stringify(maps) !== JSON.stringify(tournament.maps)) {
      changes.push({
        field: 'maps',
        label: 'Map Pool',
        oldValue: tournament.maps,
        newValue: maps,
      });
    }

    if (JSON.stringify(selectedTeams) !== JSON.stringify(tournament.teamIds)) {
      changes.push({
        field: 'teamIds',
        label: 'Teams',
        oldValue: tournament.teamIds.map(
          (id: string) => teams.find((t) => t.id === id)?.name || id
        ),
        newValue: selectedTeams.map((id) => teams.find((t) => t.id === id)?.name || id),
      });
    }

    return changes;
  };

  const handleSaveClick = () => {
    setError('');
    setSuccess('');

    if (!name.trim()) {
      setError('Tournament name is required');
      return;
    }

    if (selectedTeams.length < 2) {
      setError('At least 2 teams are required');
      return;
    }

    if (maps.length === 0) {
      setError('At least one map is required');
      return;
    }

    // Validate team count for tournament type
    const tournamentType = TOURNAMENT_TYPES.find((t) => t.value === type);
    if (tournamentType) {
      if (tournamentType.minTeams && selectedTeams.length < tournamentType.minTeams) {
        setError(
          `${tournamentType.label} requires at least ${tournamentType.minTeams} teams. ` +
            `You have ${selectedTeams.length} team(s).`
        );
        return;
      }
      if (tournamentType.maxTeams && selectedTeams.length > tournamentType.maxTeams) {
        setError(
          `${tournamentType.label} supports a maximum of ${tournamentType.maxTeams} teams. ` +
            `You have ${selectedTeams.length} team(s).`
        );
        return;
      }
      // Check power-of-2 requirement
      if (tournamentType.requirePowerOfTwo && tournamentType.validCounts) {
        if (!tournamentType.validCounts.includes(selectedTeams.length)) {
          const nextValid = tournamentType.validCounts.find((c) => c > selectedTeams.length);
          const prevValid = tournamentType.validCounts
            .slice()
            .reverse()
            .find((c) => c < selectedTeams.length);
          setError(
            `${
              tournamentType.label
            } requires a power-of-2 team count (${tournamentType.validCounts.join(', ')}). ` +
              `You have ${selectedTeams.length} team(s). ` +
              `Try ${prevValid || nextValid || 2} or ${nextValid || prevValid || 4} teams.`
          );
          return;
        }
      }
    }

    // For new tournaments, save directly
    if (!tournament) {
      handleSave();
      return;
    }

    // For existing tournaments, show preview
    const changes = detectChanges();
    if (changes.length === 0) {
      setError('No changes detected');
      return;
    }

    setPendingChanges(changes);
    setShowPreviewModal(true);
  };

  const handleSave = async () => {
    setShowPreviewModal(false);
    setSaving(true);

    try {
      const payload = {
        name,
        type,
        format,
        maps,
        teamIds: selectedTeams,
        settings: {
          seedingMethod: 'random',
        },
      };

      const response = tournament
        ? await api.put('/api/tournament', payload)
        : await api.post('/api/tournament', payload);

      setTournament(response.tournament);
      setSuccess(
        tournament
          ? 'Tournament updated successfully!'
          : 'Tournament created and bracket generated!'
      );
    } catch (err) {
      const error = err as Error;
      setError(error.message || 'Failed to save tournament');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteClick = () => {
    setShowDeleteConfirm(true);
  };

  const handleDelete = async () => {
    setShowDeleteConfirm(false);
    setError('');
    setSuccess('');

    try {
      await api.delete('/api/tournament');
      setTournament(null);
      setName('');
      setSelectedTeams([]);
      setMaps([]);
      setSuccess('Tournament deleted');
    } catch (err) {
      const error = err as Error;
      setError(error.message || 'Failed to delete tournament');
    }
  };

  const handleRegenerateClick = () => {
    setShowRegenerateConfirm(true);
  };

  const handleRegenerate = async () => {
    setShowRegenerateConfirm(false);
    setSaving(true);
    setError('');
    setSuccess('');

    try {
      const isLive = tournament?.status !== 'setup';
      const payload = isLive ? { force: true } : {};

      await api.post('/api/tournament/bracket/regenerate', payload);
      await loadData(); // Reload tournament data
      setSuccess('Bracket regenerated successfully!');
    } catch (err) {
      const error = err as Error;
      setError(error.message || 'Failed to regenerate bracket');
    } finally {
      setSaving(false);
    }
  };

  const handleResetClick = () => {
    setShowResetConfirm(true);
  };

  const handleReset = async () => {
    setShowResetConfirm(false);
    setSaving(true);
    setError('');
    setSuccess('');

    try {
      await api.post('/api/tournament/reset');
      await loadData(); // Reload tournament data
      setSuccess('Tournament reset to setup mode!');
    } catch (err) {
      const error = err as Error;
      setError(error.message || 'Failed to reset tournament');
    } finally {
      setSaving(false);
    }
  };

  const handleStartClick = () => {
    setShowStartConfirm(true);
  };

  const handleStart = async () => {
    setShowStartConfirm(false);
    setStarting(true);
    setError('');
    setSuccess('');

    try {
      const response = await api.post('/api/tournament/start');
      await loadData(); // Reload tournament data
      setSuccess(
        response.message ||
          `Tournament started! ${response.allocated} match(es) allocated to servers.`
      );
      // Navigate to bracket view to see the matches
      setTimeout(() => navigate('/bracket'), 2000);
    } catch (err) {
      const error = err as Error;
      setError(error.message || 'Failed to start tournament');
    } finally {
      setStarting(false);
    }
  };

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="80vh">
        <CircularProgress />
      </Box>
    );
  }

  // Check if there are enough teams
  if (teams.length < 2 && !tournament) {
    return (
      <Box>
        <Box display="flex" justifyContent="space-between" alignItems="center" mb={4}>
          <Box display="flex" alignItems="center" gap={2}>
            <EmojiEventsIcon sx={{ fontSize: 40, color: 'primary.main' }} />
            <Typography variant="h4" fontWeight={600}>
              Tournament
            </Typography>
          </Box>
        </Box>

        <Card sx={{ textAlign: 'center', py: 8 }}>
          <GroupsIcon sx={{ fontSize: 80, color: 'text.secondary', mb: 2 }} />
          <Typography variant="h6" color="text.secondary" gutterBottom>
            Not enough teams
          </Typography>
          <Typography variant="body2" color="text.secondary" mb={3}>
            {teams.length === 0
              ? 'You need to create at least 2 teams before starting a tournament'
              : `You have ${teams.length} team. Create at least one more to start a tournament`}
          </Typography>
          <Button variant="contained" onClick={() => navigate('/teams')}>
            Create Teams
          </Button>
        </Card>
      </Box>
    );
  }

  const canEdit = !tournament || tournament.status === 'setup';

  // Determine current step
  const getCurrentStep = () => {
    if (!tournament) return 0;
    if (tournament.status === 'setup') return 1;
    if (tournament.status === 'in_progress' || tournament.status === 'completed') return 2;
    return 1;
  };

  const currentStep = getCurrentStep();

  return (
    <Box>
      {/* Header */}
      <Box display="flex" alignItems="center" gap={2} mb={4}>
        <EmojiEventsIcon sx={{ fontSize: 40, color: 'primary.main' }} />
        <Typography variant="h4" fontWeight={600}>
          Tournament Management
        </Typography>
      </Box>

      {/* Progress Steps */}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Stepper activeStep={currentStep} alternativeLabel>
            <Step>
              <StepLabel>Create Tournament</StepLabel>
            </Step>
            <Step>
              <StepLabel>Review & Confirm</StepLabel>
            </Step>
            <Step>
              <StepLabel>Live Tournament</StepLabel>
            </Step>
          </Stepper>
        </CardContent>
      </Card>

      {error && (
        <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError('')}>
          {error}
        </Alert>
      )}

      {success && (
        <Alert severity="success" sx={{ mb: 3 }} onClose={() => setSuccess('')}>
          {success}
        </Alert>
      )}

      {/* STEP 2: Review & Start Tournament */}
      {tournament && tournament.status === 'setup' ? (
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

            {/* Action Buttons */}
            <Box display="flex" gap={2} flexWrap="wrap">
              <Button
                variant="contained"
                color="success"
                size="large"
                startIcon={
                  starting ? <CircularProgress size={20} color="inherit" /> : <RocketLaunchIcon />
                }
                onClick={handleStartClick}
                disabled={starting || saving}
                sx={{ flex: 1, minWidth: 200 }}
              >
                {starting ? 'Starting...' : 'Start Tournament'}
              </Button>
              <Tooltip title="View the bracket structure">
                <Button
                  variant="outlined"
                  startIcon={<VisibilityIcon />}
                  onClick={() => navigate('/bracket')}
                >
                  View Bracket
                </Button>
              </Tooltip>
              <Tooltip title="Recreate brackets with same settings">
                <Button
                  variant="outlined"
                  color="warning"
                  startIcon={<RefreshIcon />}
                  onClick={handleRegenerateClick}
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
                  onClick={handleDeleteClick}
                  disabled={saving}
                >
                  Delete
                </Button>
              </Tooltip>
            </Box>
          </CardContent>
        </Card>
      ) : tournament &&
        (tournament.status === 'in_progress' || tournament.status === 'completed') ? (
        /* STEP 3: Live Tournament */
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

            {/* Action Buttons */}
            <Box display="flex" gap={2} flexWrap="wrap">
              <Button
                variant="contained"
                startIcon={<VisibilityIcon />}
                onClick={() => navigate('/bracket')}
                sx={{ flex: 1, minWidth: 200 }}
              >
                View Bracket
              </Button>
              <Tooltip title="Reset tournament to setup mode (clears all match data)">
                <Button
                  variant="outlined"
                  color="error"
                  startIcon={<RestartAltIcon />}
                  onClick={handleResetClick}
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
                  onClick={handleDeleteClick}
                  disabled={saving}
                >
                  Delete
                </Button>
              </Tooltip>
            </Box>
          </CardContent>
        </Card>
      ) : (
        /* STEP 1: Create/Edit Tournament */
        <Card>
          <CardContent>
            <Typography variant="h6" gutterBottom>
              {tournament ? 'Edit Tournament' : 'Create Tournament'}
            </Typography>

            <Stack spacing={3} mt={3}>
              <TextField
                label="Tournament Name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={!canEdit || saving}
                fullWidth
                placeholder="e.g. NTLAN 2025 Spring Cup"
              />

              <Grid container spacing={2}>
                <Grid size={{ xs: 12, sm: 6 }}>
                  <FormControl fullWidth>
                    <InputLabel>Tournament Type</InputLabel>
                    <Select
                      value={type}
                      label="Tournament Type"
                      onChange={(e) => setType(e.target.value)}
                      disabled={!canEdit || saving}
                    >
                      {TOURNAMENT_TYPES.map((option) => {
                        const isValid = isTournamentTypeValid(option, selectedTeams.length);
                        return (
                          <MenuItem
                            key={option.value}
                            value={option.value}
                            disabled={option.disabled}
                          >
                            <Box display="flex" alignItems="center" gap={1} width="100%">
                              {isValid ? (
                                <CheckCircleIcon fontSize="small" sx={{ color: 'success.main' }} />
                              ) : (
                                <WarningIcon fontSize="small" sx={{ color: 'warning.main' }} />
                              )}
                              <Box flex={1}>
                                <Box display="flex" alignItems="center" gap={1}>
                                  <Typography variant="body1">{option.label}</Typography>
                                  {!isValid && (
                                    <Chip
                                      label="Not available"
                                      size="small"
                                      color="warning"
                                      sx={{ height: 20 }}
                                    />
                                  )}
                                </Box>
                                {option.description && (
                                  <Typography variant="caption" color="text.secondary">
                                    {option.description}
                                  </Typography>
                                )}
                              </Box>
                            </Box>
                          </MenuItem>
                        );
                      })}
                    </Select>
                  </FormControl>
                </Grid>

                <Grid size={{ xs: 12, sm: 6 }}>
                  <FormControl fullWidth>
                    <InputLabel>Match Format</InputLabel>
                    <Select
                      value={format}
                      label="Match Format"
                      onChange={(e) => setFormat(e.target.value)}
                      disabled={!canEdit || saving}
                    >
                      {MATCH_FORMATS.map((option) => (
                        <MenuItem key={option.value} value={option.value}>
                          {option.label}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                </Grid>
              </Grid>

              {/* Team Count Validation Alert */}
              {(() => {
                const tournamentType = TOURNAMENT_TYPES.find((t) => t.value === type);
                if (!tournamentType || selectedTeams.length === 0) return null;

                const teamCount = selectedTeams.length;
                const isValid = isTournamentTypeValid(tournamentType, teamCount);

                if (isValid) return null; // Only show warning, not success

                return (
                  <Alert severity="warning" sx={{ mt: 2, mb: 2 }} icon={<WarningIcon />}>
                    <Typography variant="body2">
                      <strong>{tournamentType.label}</strong> needs a team count that keeps
                      doubling—like 2, 4, 8, 16… You have <strong>{teamCount}</strong> team(s)
                      selected.
                    </Typography>
                  </Alert>
                );
              })()}

              <Box>
                <Box display="flex" alignItems="center" gap={1} mb={1}>
                  <Typography variant="subtitle2" fontWeight={600}>
                    Select Teams
                  </Typography>
                  <Chip
                    label={`${selectedTeams.length} / ${teams.length}`}
                    size="small"
                    color="primary"
                    variant="outlined"
                  />
                </Box>
                <Box display="flex" gap={1} alignItems="flex-start">
                  <Autocomplete
                    multiple
                    options={teams}
                    getOptionLabel={(option) => option.name}
                    value={teams.filter((team) => selectedTeams.includes(team.id))}
                    onChange={(_, newValue) => setSelectedTeams(newValue.map((t) => t.id))}
                    disabled={!canEdit || saving}
                    sx={{ flex: 1 }}
                    renderInput={(params) => (
                      <TextField {...params} placeholder="Choose teams..." />
                    )}
                    renderTags={(value, getTagProps) =>
                      value.map((option, index) => (
                        <Chip label={option.name} {...getTagProps({ index })} key={option.id} />
                      ))
                    }
                  />
                  <Button
                    variant="outlined"
                    onClick={() => setSelectedTeams(teams.map((t) => t.id))}
                    disabled={!canEdit || saving || teams.length === 0}
                    sx={{ mt: 1 }}
                  >
                    Add All
                  </Button>
                </Box>
              </Box>

              <Box>
                <Box display="flex" alignItems="center" gap={1} mb={1}>
                  <Typography variant="subtitle2" fontWeight={600}>
                    Map Pool
                  </Typography>
                  <Chip
                    label={`${maps.length} / ${CS2_MAPS.length}`}
                    size="small"
                    color="primary"
                    variant="outlined"
                  />
                </Box>
                <Box display="flex" gap={1} alignItems="flex-start">
                  <Autocomplete
                    multiple
                    options={CS2_MAPS}
                    value={maps}
                    onChange={(_, newValue) => setMaps(newValue)}
                    disabled={!canEdit || saving}
                    sx={{ flex: 1 }}
                    renderInput={(params) => <TextField {...params} placeholder="Choose maps..." />}
                    renderTags={(value, getTagProps) =>
                      value.map((option, index) => (
                        <Chip label={option} {...getTagProps({ index })} key={option} />
                      ))
                    }
                  />
                  <Button
                    variant="outlined"
                    onClick={() => setMaps([...CS2_MAPS])}
                    disabled={!canEdit || saving || CS2_MAPS.length === 0}
                    sx={{ mt: 1 }}
                  >
                    Add All
                  </Button>
                </Box>
              </Box>

              {/* Action Buttons */}
              {canEdit && (
                <>
                  <Divider sx={{ my: 2 }} />
                  <Box display="flex" gap={2} flexWrap="wrap">
                    <Button
                      variant="contained"
                      onClick={handleSaveClick}
                      disabled={saving}
                      size="large"
                      sx={{ flex: 1, minWidth: 200 }}
                    >
                      {saving ? (
                        <CircularProgress size={24} />
                      ) : tournament ? (
                        'Save & Generate Brackets'
                      ) : (
                        'Create Tournament'
                      )}
                    </Button>
                    {tournament && (
                      <Tooltip title="Permanently delete this tournament and all its data">
                        <Button
                          variant="outlined"
                          color="error"
                          startIcon={<DeleteForeverIcon />}
                          onClick={handleDeleteClick}
                          disabled={saving}
                        >
                          Delete
                        </Button>
                      </Tooltip>
                    )}
                  </Box>
                </>
              )}
            </Stack>
          </CardContent>
        </Card>
      )}

      {/* Change Preview Modal */}
      <TournamentChangePreviewModal
        open={showPreviewModal}
        changes={pendingChanges}
        isLive={tournament?.status !== 'setup'}
        onConfirm={handleSave}
        onCancel={() => setShowPreviewModal(false)}
      />

      {/* Delete Confirmation */}
      <ConfirmDialog
        open={showDeleteConfirm}
        title="🗑️ Delete Tournament"
        message={`Are you sure you want to permanently DELETE "${tournament?.name}"?\n\n⚠️ This will:\n• Remove the tournament completely\n• Delete all matches and brackets\n• Delete all match data and statistics\n• Cannot be undone\n\nNote: If you just want to start over with the same tournament settings, use "Reset to Setup" instead.`}
        confirmLabel="Delete Permanently"
        cancelLabel="Cancel"
        onConfirm={handleDelete}
        onCancel={() => setShowDeleteConfirm(false)}
        confirmColor="error"
      />

      {/* Regenerate Brackets Confirmation */}
      <ConfirmDialog
        open={showRegenerateConfirm}
        title="🔄 Regenerate Brackets"
        message={
          tournament?.status !== 'setup'
            ? `⚠️ WARNING: The tournament is ${tournament?.status.toUpperCase()}!\n\nRegenerating brackets will DELETE ALL existing match data, including scores, statistics, and event history. This action cannot be undone.\n\nAre you absolutely sure you want to proceed?`
            : `This will delete all existing matches and regenerate the bracket with the same settings.\n\nContinue?`
        }
        confirmLabel={tournament?.status !== 'setup' ? 'YES, DELETE EVERYTHING' : 'Regenerate'}
        cancelLabel="Cancel"
        onConfirm={handleRegenerate}
        onCancel={() => setShowRegenerateConfirm(false)}
        confirmColor="error"
      />

      {/* Reset Tournament Confirmation */}
      <ConfirmDialog
        open={showResetConfirm}
        title="🔄 Reset to Setup"
        message={`Reset "${tournament?.name}" back to SETUP mode?\n\nThis will:\n• Clear tournament status (back to setup)\n• Delete all matches and brackets\n• Delete all match data and statistics\n• Keep tournament settings (name, teams, format)\n• Allow you to edit settings again\n\nAfter resetting, you'll need to save again to regenerate brackets.\n\nNote: To completely remove the tournament, use "Delete" instead.`}
        confirmLabel="Reset to Setup"
        cancelLabel="Cancel"
        onConfirm={handleReset}
        onCancel={() => setShowResetConfirm(false)}
        confirmColor="warning"
      />

      {/* Start Tournament Confirmation */}
      <ConfirmDialog
        open={showStartConfirm}
        title="Start Tournament"
        message={`🚀 Ready to start the tournament?\n\nThis will:\n• Check all available servers\n• Automatically allocate servers to ready matches\n• Load matches on servers via RCON\n• Set servers to warmup mode\n• Change tournament status to IN PROGRESS\n\nMake sure all servers are online and ready before proceeding.`}
        confirmLabel="Start Tournament"
        cancelLabel="Cancel"
        onConfirm={handleStart}
        onCancel={() => setShowStartConfirm(false)}
        confirmColor="success"
      />
    </Box>
  );
}
