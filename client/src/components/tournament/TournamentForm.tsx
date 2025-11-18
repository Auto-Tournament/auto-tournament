import React from 'react';
import {
  Box,
  Typography,
  Card,
  CardContent,
  TextField,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Chip,
  Alert,
  Button,
  Stack,
  Autocomplete,
  Grid,
  Divider,
  Tooltip,
  CircularProgress,
} from '@mui/material';
import {
  Warning as WarningIcon,
  CheckCircle as CheckCircleIcon,
  DeleteForever as DeleteForeverIcon,
  Add as AddIcon,
} from '@mui/icons-material';
import { TOURNAMENT_TYPES, MATCH_FORMATS } from '../../constants/tournament';
import { isTournamentTypeValid, validateTeamCountForType } from '../../utils/tournamentValidation';
import { Team } from '../../types';
import SaveMapPoolModal from '../modals/SaveMapPoolModal';
import { api } from '../../utils/api';
import type {
  MapPool,
  MapPoolsResponse,
  MapsResponse,
  Map as MapType,
} from '../../types/api.types';

interface TournamentFormProps {
  name: string;
  type: string;
  format: string;
  selectedTeams: string[];
  maps: string[];
  teams: Team[];
  canEdit: boolean;
  saving: boolean;
  tournamentExists: boolean;
  hasChanges?: boolean;
  onNameChange: (name: string) => void;
  onTypeChange: (type: string) => void;
  onFormatChange: (format: string) => void;
  onTeamsChange: (teams: string[]) => void;
  onMapsChange: (maps: string[]) => void;
  onSave: () => void;
  onCancel?: () => void;
  onDelete: () => void;
}

export const TournamentForm: React.FC<TournamentFormProps> = ({
  name,
  type,
  format,
  selectedTeams,
  maps,
  teams,
  canEdit,
  saving,
  tournamentExists,
  hasChanges = true,
  onNameChange,
  onTypeChange,
  onFormatChange,
  onTeamsChange,
  onMapsChange,
  onSave,
  onCancel,
  onDelete,
}) => {
  const [serverCount, setServerCount] = React.useState<number>(0);
  const [loadingServers, setLoadingServers] = React.useState(true);
  const [mapPools, setMapPools] = React.useState<MapPool[]>([]);
  const [availableMaps, setAvailableMaps] = React.useState<MapType[]>([]);
  const [selectedMapPool, setSelectedMapPool] = React.useState<string>('active-duty');
  const [saveMapPoolModalOpen, setSaveMapPoolModalOpen] = React.useState(false);
  const [loadingMaps, setLoadingMaps] = React.useState(true);

  // Load server count, map pools, and maps
  React.useEffect(() => {
    const loadData = async () => {
      try {
        // Load servers
        const serversResponse = await fetch('/api/servers', {
          headers: {
            Authorization: `Bearer ${localStorage.getItem('api_token')}`,
          },
        });
        const serversData = await serversResponse.json();
        const enabledServers = (serversData.servers || []).filter(
          (s: { enabled: boolean }) => s.enabled
        );
        setServerCount(enabledServers.length);

        // Load map pools
        const poolsResponse = await api.get<MapPoolsResponse>('/api/map-pools');
        const loadedPools = poolsResponse.mapPools || [];
        setMapPools(loadedPools);

        // Load available maps
        const mapsResponse = await api.get<MapsResponse>('/api/maps');
        setAvailableMaps(mapsResponse.maps || []);

        // Initialize map pool selection based on current maps
        if (maps.length > 0) {
          // Check if maps match Active Duty pool
          const activeDutyPool = loadedPools.find((p) => p.isDefault);
          if (
            activeDutyPool &&
            JSON.stringify([...maps].sort()) === JSON.stringify([...activeDutyPool.mapIds].sort())
          ) {
            setSelectedMapPool('active-duty');
          } else {
            // Check if maps match any custom pool
            const matchingPool = loadedPools.find(
              (p) =>
                !p.isDefault &&
                JSON.stringify([...maps].sort()) === JSON.stringify([...p.mapIds].sort())
            );
            if (matchingPool) {
              setSelectedMapPool(matchingPool.id.toString());
            } else {
              // Custom selection
              setSelectedMapPool('custom');
            }
          }
        }
      } catch (err) {
        console.error('Failed to load data:', err);
      } finally {
        setLoadingServers(false);
        setLoadingMaps(false);
      }
    };
    loadData();
  }, [maps.length]); // Re-run when maps change

  // Calculate required servers for first round
  const getRequiredServers = (teamCount: number): number => {
    if (teamCount < 2) return 0;
    // First round typically requires teamCount/2 matches running concurrently
    return Math.ceil(teamCount / 2);
  };

  const requiredServers = getRequiredServers(selectedTeams.length);
  const hasEnoughServers = serverCount >= requiredServers;

  // Handle map pool selection
  const handleMapPoolChange = (poolId: string) => {
    setSelectedMapPool(poolId);

    if (poolId === 'custom') {
      // Keep current maps when switching to custom
      return;
    } else if (poolId === 'active-duty') {
      // Load Active Duty map pool
      const activeDutyPool = mapPools.find((p) => p.isDefault);
      if (activeDutyPool) {
        onMapsChange(activeDutyPool.mapIds);
      }
    } else {
      // Load selected map pool
      const pool = mapPools.find((p) => p.id.toString() === poolId);
      if (pool) {
        onMapsChange(pool.mapIds);
      }
    }
  };

  // Get map display names
  const getMapDisplayName = (mapId: string): string => {
    const map = availableMaps.find((m) => m.id === mapId);
    return map ? map.displayName : mapId;
  };

  // Get all available map IDs
  const allMapIds = availableMaps.map((m) => m.id);

  return (
    <Card>
      <CardContent>
        <Typography variant="h6" gutterBottom>
          {tournamentExists ? 'Edit Tournament' : 'Create Tournament'}
        </Typography>

        <Stack spacing={3}>
          {/* Step 1: Tournament Name */}
          <Box>
            <Typography variant="overline" color="primary" fontWeight={600}>
              Step 1
            </Typography>
            <Typography variant="subtitle2" fontWeight={600} mb={1}>
              Tournament Name
            </Typography>
            <TextField
              label="Tournament Name"
              value={name}
              onChange={(e) => onNameChange(e.target.value)}
              disabled={!canEdit || saving}
              fullWidth
              required
              placeholder="e.g., NTLAN 2025 Spring Tournament"
            />
          </Box>

          <Divider />

          {/* Step 2: Select Teams */}
          <Box>
            <Typography variant="overline" color="primary" fontWeight={600}>
              Step 2
            </Typography>
            <Box display="flex" alignItems="center" gap={1} mb={1}>
              <Typography variant="subtitle2" fontWeight={600}>
                Select Teams
              </Typography>
              <Chip
                label={`${selectedTeams.length} / ${teams.length}`}
                size="small"
                color={selectedTeams.length >= 2 ? 'success' : 'default'}
                variant="outlined"
              />
            </Box>

            {/* Not Enough Teams Alert */}
            {teams.length < 2 && (
              <Alert
                severity="error"
                icon={<WarningIcon />}
                sx={{ mb: 2 }}
                action={
                  <Button
                    color="inherit"
                    size="small"
                    startIcon={<AddIcon />}
                    onClick={() => (window.location.href = '/teams')}
                  >
                    Create Team
                  </Button>
                }
              >
                <Typography variant="body2">
                  You need at least <strong>2 teams</strong> to create a tournament. You currently
                  have <strong>{teams.length}</strong> team(s).
                </Typography>
              </Alert>
            )}

            <Box display="flex" gap={1} alignItems="flex-start">
              <Autocomplete
                multiple
                options={teams}
                getOptionLabel={(option) => option.name}
                value={teams.filter((team) => selectedTeams.includes(team.id))}
                onChange={(_, newValue) => onTeamsChange(newValue.map((t) => t.id))}
                disabled={!canEdit || saving}
                sx={{ flex: 1 }}
                renderInput={(params) => <TextField {...params} placeholder="Choose teams..." />}
                renderTags={(value, getTagProps) =>
                  value.map((option, index) => (
                    <Chip label={option.name} {...getTagProps({ index })} key={option.id} />
                  ))
                }
              />
              <Button
                variant="outlined"
                onClick={() => onTeamsChange(teams.map((t) => t.id))}
                disabled={!canEdit || saving || teams.length === 0}
                sx={{ mt: 1 }}
              >
                Add All
              </Button>
            </Box>
          </Box>

          <Divider />

          {/* Step 3: Map Pool */}
          <Box>
            <Typography variant="overline" color="primary" fontWeight={600}>
              Step 3
            </Typography>
            <Box display="flex" alignItems="center" gap={1} mb={1}>
              <Typography variant="subtitle2" fontWeight={600}>
                Map Pool
              </Typography>
              <Chip
                label={`${maps.length} map${maps.length !== 1 ? 's' : ''}`}
                size="small"
                color={maps.length > 0 ? 'success' : 'default'}
                variant="outlined"
              />
            </Box>
            <Typography variant="body2" color="text.secondary" mb={2}>
              {['bo1', 'bo3', 'bo5'].includes(format)
                ? 'Select exactly 7 maps for veto system (BO1/BO3/BO5 requires all 7 competitive maps)'
                : 'Maps for the tournament (used for rotation in Round Robin/Swiss)'}
            </Typography>

            {/* Map Pool Selection Dropdown */}
            <FormControl fullWidth sx={{ mb: 2 }}>
              <InputLabel>Choose a map pool</InputLabel>
              <Select
                value={selectedMapPool}
                label="Choose a map pool"
                onChange={(e) => handleMapPoolChange(e.target.value)}
                disabled={!canEdit || saving || loadingMaps}
              >
                <MenuItem value="active-duty">Active Duty</MenuItem>
                {mapPools
                  .filter((p) => !p.isDefault)
                  .map((pool) => (
                    <MenuItem key={pool.id} value={pool.id.toString()}>
                      {pool.name}
                    </MenuItem>
                  ))}
                <MenuItem value="custom">Custom</MenuItem>
              </Select>
            </FormControl>

            {/* Map Pool Validation for Veto Formats */}
            {['bo1', 'bo3', 'bo5'].includes(format) && maps.length !== 7 && (
              <Alert severity="warning" icon={<WarningIcon />} sx={{ mb: 2 }}>
                <Typography variant="body2">
                  <strong>Map veto requires exactly 7 maps.</strong> You have selected {maps.length}
                  .
                </Typography>
              </Alert>
            )}

            {/* Custom Map Selection (only shown when Custom is selected) */}
            {selectedMapPool === 'custom' && (
              <Box>
                <Box display="flex" gap={1} alignItems="flex-start" mb={1}>
                  <Autocomplete
                    multiple
                    options={allMapIds}
                    value={maps}
                    onChange={(_, newValue) => onMapsChange(newValue)}
                    disabled={!canEdit || saving || loadingMaps}
                    sx={{ flex: 1 }}
                    getOptionLabel={(option) => getMapDisplayName(option)}
                    renderInput={(params) => <TextField {...params} placeholder="Choose maps..." />}
                    renderTags={(value, getTagProps) =>
                      value.map((option, index) => (
                        <Chip
                          label={getMapDisplayName(option)}
                          {...getTagProps({ index })}
                          key={option}
                        />
                      ))
                    }
                  />
                  <Button
                    variant="outlined"
                    onClick={() => onMapsChange([...allMapIds])}
                    disabled={!canEdit || saving || allMapIds.length === 0 || loadingMaps}
                    sx={{ mt: 1 }}
                  >
                    Add All ({allMapIds.length})
                  </Button>
                </Box>
                {maps.length > 0 && (
                  <Button
                    variant="outlined"
                    color="primary"
                    onClick={() => setSaveMapPoolModalOpen(true)}
                    disabled={!canEdit || saving}
                    sx={{ mt: 1 }}
                  >
                    Save Map Pool
                  </Button>
                )}
              </Box>
            )}
          </Box>

          <Divider />

          {/* Step 4: Tournament Type & Format */}
          <Box>
            <Typography variant="overline" color="primary" fontWeight={600}>
              Step 4
            </Typography>
            <Typography variant="subtitle2" fontWeight={600} mb={2}>
              Tournament Type & Format
            </Typography>

            {/* Team Count Validation Alert */}
            {(() => {
              if (selectedTeams.length === 0) return null;

              const validation = validateTeamCountForType(type, selectedTeams.length);

              if (validation.isValid) return null;

              return (
                <Alert severity="warning" icon={<WarningIcon />} sx={{ mb: 2 }}>
                  <Typography variant="body2">{validation.error}</Typography>
                </Alert>
              );
            })()}

            {/* Not Enough Servers Alert */}
            {!loadingServers && selectedTeams.length >= 2 && !hasEnoughServers && (
              <Alert
                severity="warning"
                icon={<WarningIcon />}
                sx={{ mb: 2 }}
                action={
                  <Button
                    color="inherit"
                    size="small"
                    startIcon={<AddIcon />}
                    onClick={() => (window.location.href = '/servers')}
                  >
                    Add Server
                  </Button>
                }
              >
                <Typography variant="body2">
                  The first round will have <strong>{requiredServers}</strong> concurrent match
                  {requiredServers !== 1 ? 'es' : ''}, but you only have{' '}
                  <strong>{serverCount}</strong> enabled server{serverCount !== 1 ? 's' : ''}. Add
                  more servers or matches will queue.
                </Typography>
              </Alert>
            )}

            <Grid container spacing={2}>
              <Grid size={{ xs: 12, sm: 6 }}>
                <FormControl fullWidth>
                  <InputLabel>Tournament Type</InputLabel>
                  <Select
                    value={type}
                    label="Tournament Type"
                    onChange={(e) => onTypeChange(e.target.value)}
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
                    onChange={(e) => onFormatChange(e.target.value)}
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
          </Box>

          {canEdit && (
            <>
              <Divider />
              <Box display="flex" gap={2} flexWrap="wrap">
                {
                  <Button
                    variant="contained"
                    onClick={onSave}
                    disabled={
                      saving ||
                      !hasChanges ||
                      (['bo1', 'bo3', 'bo5'].includes(format) && maps.length !== 7)
                    }
                    size="large"
                    sx={{ flex: 1, minWidth: 200 }}
                  >
                    {saving ? (
                      <CircularProgress size={24} />
                    ) : tournamentExists ? (
                      'Save & Generate Brackets'
                    ) : (
                      'Create Tournament'
                    )}
                  </Button>
                }
                {tournamentExists && onCancel && (
                  <Button variant="outlined" onClick={onCancel} disabled={saving}>
                    Cancel
                  </Button>
                )}
                {tournamentExists && (
                  <Tooltip title="Permanently delete this tournament and all its data">
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
                )}
              </Box>
            </>
          )}
        </Stack>
      </CardContent>

      <SaveMapPoolModal
        open={saveMapPoolModalOpen}
        mapIds={maps}
        onClose={() => setSaveMapPoolModalOpen(false)}
        onSave={async () => {
          // Reload map pools after saving
          try {
            const poolsResponse = await api.get<MapPoolsResponse>('/api/map-pools');
            setMapPools(poolsResponse.mapPools || []);
          } catch (err) {
            console.error('Failed to reload map pools:', err);
          }
        }}
      />
    </Card>
  );
};
