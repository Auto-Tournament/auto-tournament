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
} from '@mui/material';
import EmojiEventsIcon from '@mui/icons-material/EmojiEvents';
import GroupsIcon from '@mui/icons-material/Groups';
import { useNavigate } from 'react-router-dom';
import { api } from '../utils/api';

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

const TOURNAMENT_TYPES: Array<{ value: string; label: string; disabled?: boolean }> = [
  { value: 'single_elimination', label: 'Single Elimination' },
  { value: 'double_elimination', label: 'Double Elimination' },
  { value: 'round_robin', label: 'Round Robin' },
  { value: 'swiss', label: 'Swiss System' },
];

const MATCH_FORMATS = [
  { value: 'bo1', label: 'Best of 1' },
  { value: 'bo3', label: 'Best of 3' },
  { value: 'bo5', label: 'Best of 5' },
];

export default function Tournament() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [tournament, setTournament] = useState<any>(null);
  const [teams, setTeams] = useState<any[]>([]);

  // Form state
  const [name, setName] = useState('');
  const [type, setType] = useState('single_elimination');
  const [format, setFormat] = useState('bo3');
  const [maps, setMaps] = useState<string[]>([]);
  const [selectedTeams, setSelectedTeams] = useState<string[]>([]);
  const [seedingMethod, setSeedingMethod] = useState('random');

  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    setError('');
    try {
      // Load teams
      const teamsResponse = await api.get('/api/teams');
      setTeams(teamsResponse.teams || []);

      // Try to load existing tournament
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
          setSeedingMethod(t.settings.seedingMethod);
        }
      } catch {
        // No tournament exists yet
        setTournament(null);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load data');
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    setError('');
    setSuccess('');
    setSaving(true);

    if (!name.trim()) {
      setError('Tournament name is required');
      setSaving(false);
      return;
    }

    if (selectedTeams.length < 2) {
      setError('At least 2 teams are required');
      setSaving(false);
      return;
    }

    if (maps.length === 0) {
      setError('At least one map is required');
      setSaving(false);
      return;
    }

    try {
      const payload = {
        name,
        type,
        format,
        maps,
        teamIds: selectedTeams,
        settings: {
          seedingMethod,
        },
      };

      const response = tournament
        ? await api.put('/api/tournament', payload)
        : await api.post('/api/tournament', payload);

      setTournament(response.tournament);
      setSuccess(
        tournament
          ? 'Tournament updated and bracket regenerated!'
          : 'Tournament created and bracket generated!'
      );
    } catch (err: any) {
      setError(err.message || 'Failed to save tournament');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (
      !(globalThis as any).confirm?.(
        'Are you sure you want to delete this tournament and all matches?'
      )
    ) {
      return;
    }

    setError('');
    setSuccess('');

    try {
      await api.delete('/api/tournament');
      setTournament(null);
      setName('');
      setSelectedTeams([]);
      setMaps([]);
      setSuccess('Tournament deleted');
    } catch (err: any) {
      setError(err.message || 'Failed to delete tournament');
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

  return (
    <Box>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={4}>
        <Box display="flex" alignItems="center" gap={2}>
          <EmojiEventsIcon sx={{ fontSize: 40, color: 'primary.main' }} />
          <Typography variant="h4" fontWeight={600}>
            Tournament
          </Typography>
          {tournament && (
            <Chip
              label={tournament.status.replace('_', ' ').toUpperCase()}
              color={
                tournament.status === 'setup'
                  ? 'default'
                  : tournament.status === 'ready'
                  ? 'info'
                  : tournament.status === 'in_progress'
                  ? 'warning'
                  : 'success'
              }
              sx={{ fontWeight: 600 }}
            />
          )}
        </Box>
        <Box display="flex" gap={2}>
          {tournament && canEdit && (
            <Button color="error" onClick={handleDelete}>
              Delete Tournament
            </Button>
          )}
        </Box>
      </Box>

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

      {tournament && !canEdit && (
        <Alert severity="info" sx={{ mb: 3 }}>
          <Typography variant="body2" fontWeight={600} gutterBottom>
            Tournament is Live
          </Typography>
          <Typography variant="body2">
            You can update the tournament name and maps, or replace teams (same count). Cannot change tournament type or format once started.
          </Typography>
        </Alert>
      )}

      {tournament && tournament.status !== 'setup' ? (
        <Card>
          <CardContent>
            <Typography variant="h6" gutterBottom>
              {tournament.name}
            </Typography>
            <Typography variant="body2" color="text.secondary" gutterBottom>
              {TOURNAMENT_TYPES.find((t) => t.value === tournament.type)?.label} •{' '}
              {MATCH_FORMATS.find((f) => f.value === tournament.format)?.label}
            </Typography>
            <Box mt={2}>
              <Typography variant="body2" fontWeight={600}>
                Teams:
              </Typography>
              <Box display="flex" flexWrap="wrap" gap={1} mt={1}>
                {tournament.teams.map((team: any) => (
                  <Chip key={team.id} label={team.name} size="small" />
                ))}
              </Box>
            </Box>
            <Box mt={2}>
              <Typography variant="body2" fontWeight={600}>
                Map Pool:
              </Typography>
              <Box display="flex" flexWrap="wrap" gap={1} mt={1}>
                {tournament.maps.map((map: string) => (
                  <Chip key={map} label={map} size="small" variant="outlined" />
                ))}
              </Box>
            </Box>
            <Box mt={3}>
              <Button variant="contained" href="/app/bracket" fullWidth>
                View Bracket
              </Button>
            </Box>
          </CardContent>
        </Card>
      ) : (
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
                      {TOURNAMENT_TYPES.map((option) => (
                        <MenuItem
                          key={option.value}
                          value={option.value}
                          disabled={option.disabled}
                        >
                          {option.label}
                        </MenuItem>
                      ))}
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

              <FormControl fullWidth>
                <InputLabel>Seeding Method</InputLabel>
                <Select
                  value={seedingMethod}
                  label="Seeding Method"
                  onChange={(e) => setSeedingMethod(e.target.value)}
                  disabled={!canEdit || saving}
                >
                  <MenuItem value="random">Random</MenuItem>
                  <MenuItem value="manual">Manual (Coming Soon)</MenuItem>
                </Select>
              </FormControl>

              {canEdit && (
                <Button
                  variant="contained"
                  onClick={handleSave}
                  disabled={saving}
                  fullWidth
                  size="large"
                >
                  {saving ? (
                    <CircularProgress size={24} />
                  ) : tournament ? (
                    'Update Tournament'
                  ) : (
                    'Create Tournament'
                  )}
                </Button>
              )}
            </Stack>
          </CardContent>
        </Card>
      )}
    </Box>
  );
}
