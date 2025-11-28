import React, { useState, useEffect } from 'react';
import {
  Box,
  Container,
  Typography,
  Card,
  CardContent,
  Button,
  Grid,
  IconButton,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Alert,
  Chip,
  Stack,
  CircularProgress,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Autocomplete,
  Divider,
} from '@mui/material';
import {
  Delete as DeleteIcon,
  Edit as EditIcon,
  Add as AddIcon,
  ContentCopy as CopyIcon,
} from '@mui/icons-material';
import { api } from '../utils/api';
import type { TournamentTemplate } from '../types/tournament.types';
import type { TournamentResponse } from '../types';
import { TOURNAMENT_TYPES, MATCH_FORMATS } from '../constants/tournament';
import type { Map, MapPool } from '../types/api.types';

const TOURNAMENT_TYPE_LABELS: Record<string, string> = {
  single_elimination: 'Single Elimination',
  double_elimination: 'Double Elimination',
  round_robin: 'Round Robin',
  swiss: 'Swiss',
};

const FORMAT_LABELS: Record<string, string> = {
  bo1: 'BO1',
  bo3: 'BO3',
  bo5: 'BO5',
};

export default function Templates() {
  const [templates, setTemplates] = useState<TournamentTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [templateToDelete, setTemplateToDelete] = useState<TournamentTemplate | null>(null);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<TournamentTemplate | null>(null);
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editType, setEditType] = useState<string>('');
  const [editFormat, setEditFormat] = useState<string>('');
  const [editMaps, setEditMaps] = useState<string[]>([]);
  const [tournamentStatus, setTournamentStatus] = useState<string | null>(null);
  const [availableMaps, setAvailableMaps] = useState<Map[]>([]);
  const [mapPools, setMapPools] = useState<MapPool[]>([]);
  const [selectedMapPool, setSelectedMapPool] = useState<string>('');
  const [loadingMaps, setLoadingMaps] = useState(false);

  useEffect(() => {
    document.title = 'Tournament Templates';
    loadTemplates();
    loadTournamentStatus();
    loadMaps();
    loadMapPools();
  }, []);

  const loadTournamentStatus = async () => {
    try {
      const response = await api.get<TournamentResponse>('/api/tournament');
      if (response.success && response.tournament) {
        setTournamentStatus(response.tournament.status);
      } else {
        setTournamentStatus(null);
      }
    } catch {
      // No tournament exists
      setTournamentStatus(null);
    }
  };

  const loadMaps = async () => {
    try {
      setLoadingMaps(true);
      const response = await api.get<{ maps: Map[] }>('/api/maps');
      if (response.maps) {
        setAvailableMaps(response.maps);
      }
    } catch (err) {
      console.error('Error loading maps:', err);
    } finally {
      setLoadingMaps(false);
    }
  };

  const loadMapPools = async () => {
    try {
      const response = await api.get<{ mapPools: MapPool[] }>('/api/map-pools');
      if (response.mapPools) {
        setMapPools(response.mapPools);
      }
    } catch (err) {
      console.error('Error loading map pools:', err);
    }
  };

  const getMapDisplayName = (mapId: string): string => {
    const map = availableMaps.find((m) => m.id === mapId);
    return map ? map.displayName : mapId;
  };

  const getMapType = (mapId: string): string => {
    if (mapId.startsWith('de_')) return 'Defusal';
    if (mapId.startsWith('cs_')) return 'Hostage';
    if (mapId.startsWith('ar_')) return 'Arms Race';
    return 'Unknown';
  };

  const getMapTypeColor = (mapId: string): 'default' | 'primary' | 'secondary' | 'success' => {
    if (mapId.startsWith('de_')) return 'primary';
    if (mapId.startsWith('cs_')) return 'secondary';
    if (mapId.startsWith('ar_')) return 'success';
    return 'default';
  };

  // Sort maps by prefix: de_, ar_, cs_
  const sortedMaps = [...availableMaps].sort((a, b) => {
    const prefixOrder: Record<string, number> = { de_: 0, ar_: 1, cs_: 2 };
    const aPrefix = a.id.substring(0, 3);
    const bPrefix = b.id.substring(0, 3);
    const aOrder = prefixOrder[aPrefix] ?? 999;
    const bOrder = prefixOrder[bPrefix] ?? 999;

    if (aOrder !== bOrder) {
      return aOrder - bOrder;
    }
    return a.id.localeCompare(b.id);
  });

  const allMapIds = sortedMaps.map((m) => m.id);
  const isVetoFormat = ['bo1', 'bo3', 'bo5'].includes(editFormat);

  const loadTemplates = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await api.get<{ success: boolean; templates: TournamentTemplate[] }>(
        '/api/templates'
      );
      if (response.success) {
        setTemplates(response.templates);
      }
    } catch (err) {
      setError('Failed to load templates');
      console.error('Error loading templates:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!templateToDelete) return;

    try {
      await api.delete(`/api/templates/${templateToDelete.id}`);
      setSuccess(`Template "${templateToDelete.name}" deleted successfully`);
      setDeleteDialogOpen(false);
      setTemplateToDelete(null);
      loadTemplates();
    } catch (err) {
      setError('Failed to delete template');
      console.error('Error deleting template:', err);
    }
  };

  const handleEdit = (template: TournamentTemplate) => {
    setEditingTemplate(template);
    setEditName(template.name);
    setEditDescription(template.description || '');
    setEditType(template.type);
    setEditFormat(template.format);
    setEditMaps(template.maps || []);
    // Find if maps match a pool, otherwise use custom
    const matchingPool = mapPools.find((pool) => {
      if (pool.mapIds.length !== template.maps.length) return false;
      return pool.mapIds.every((id) => template.maps.includes(id));
    });
    setSelectedMapPool(matchingPool ? matchingPool.id.toString() : 'custom');
    setError(null);
    setEditDialogOpen(true);
  };

  const handleCloseEdit = () => {
    setEditDialogOpen(false);
    setEditingTemplate(null);
    setError(null);
  };

  const handleSaveEdit = async () => {
    if (!editingTemplate) return;

    // Validate maps for veto formats
    const isVetoFormat = ['bo1', 'bo3', 'bo5'].includes(editFormat);
    if (isVetoFormat && editMaps.length !== 7) {
      setError('Veto formats (BO1/BO3/BO5) require exactly 7 maps');
      return;
    }
    if (!isVetoFormat && editMaps.length === 0) {
      setError('At least one map is required');
      return;
    }

    try {
      const mapPoolId =
        selectedMapPool && selectedMapPool !== 'custom' ? parseInt(selectedMapPool, 10) : null;
      await api.put(`/api/templates/${editingTemplate.id}`, {
        name: editName,
        description: editDescription || undefined,
        type: editType,
        format: editFormat,
        maps: editMaps,
        mapPoolId,
      });
      setSuccess(`Template "${editName}" updated successfully`);
      handleCloseEdit();
      loadTemplates();
    } catch (err) {
      setError('Failed to update template');
      console.error('Error updating template:', err);
    }
  };

  const handleMapPoolChange = (poolId: string) => {
    setSelectedMapPool(poolId);
    if (poolId === 'custom') {
      // Keep current maps when switching to custom
      return;
    }
    const pool = mapPools.find((p) => p.id.toString() === poolId);
    if (pool) {
      setEditMaps(pool.mapIds);
    }
  };

  const handleCreateFromTemplate = async (template: TournamentTemplate) => {
    // Check if tournament already exists
    try {
      const response = await api.get<TournamentResponse>('/api/tournament');
      if (response.success && response.tournament) {
        const status = response.tournament.status;
        if (status === 'in_progress' || status === 'completed') {
          setError(
            'Cannot create tournament from template while a tournament is in progress or completed. Please delete or reset the current tournament first.'
          );
          return;
        } else if (status === 'setup' || status === 'ready') {
          setError(
            'A tournament already exists. Please delete or reset the current tournament before creating a new one from a template.'
          );
          return;
        }
      }
    } catch {
      // No tournament exists, continue
    }

    // Navigate to tournament page with template data
    const params = new URLSearchParams({
      template: template.id.toString(),
    });
    window.location.href = `/tournament?${params.toString()}`;
  };

  if (loading) {
    return (
      <Container maxWidth="lg" sx={{ mt: 4, mb: 4 }}>
        <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
          <CircularProgress />
        </Box>
      </Container>
    );
  }

  return (
    <Container maxWidth="lg" sx={{ mt: 4, mb: 4 }}>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
        <Typography variant="h4" fontWeight={600}>
          Tournament Templates
        </Typography>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={() => (window.location.href = '/tournament')}
        >
          Create Template from Tournament
        </Button>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {success && (
        <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccess(null)}>
          {success}
        </Alert>
      )}

      {templates.length === 0 ? (
        <Card>
          <CardContent>
            <Typography variant="body1" color="text.secondary" align="center" py={4}>
              No templates yet. Create your first template from the Tournament page.
            </Typography>
          </CardContent>
        </Card>
      ) : (
        <Grid container spacing={3}>
          {templates.map((template) => (
            <Grid item xs={12} md={6} key={template.id}>
              <Card>
                <CardContent>
                  <Box display="flex" justifyContent="space-between" alignItems="start" mb={2}>
                    <Box>
                      <Typography variant="h6" fontWeight={600}>
                        {template.name}
                      </Typography>
                      {template.description && (
                        <Typography variant="body2" color="text.secondary" mt={0.5}>
                          {template.description}
                        </Typography>
                      )}
                    </Box>
                    <Box>
                      <IconButton
                        size="small"
                        onClick={() => handleEdit(template)}
                        sx={{ mr: 0.5 }}
                      >
                        <EditIcon fontSize="small" />
                      </IconButton>
                      <IconButton
                        size="small"
                        color="error"
                        onClick={() => {
                          setTemplateToDelete(template);
                          setDeleteDialogOpen(true);
                        }}
                      >
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </Box>
                  </Box>

                  <Stack direction="row" spacing={1} mb={2} flexWrap="wrap" gap={1}>
                    <Chip
                      label={TOURNAMENT_TYPE_LABELS[template.type] || template.type}
                      size="small"
                      color="primary"
                      variant="outlined"
                    />
                    <Chip
                      label={FORMAT_LABELS[template.format] || template.format}
                      size="small"
                      color="secondary"
                      variant="outlined"
                    />
                    {template.maps.length > 0 && (
                      <Chip
                        label={`${template.maps.length} map${
                          template.maps.length !== 1 ? 's' : ''
                        }`}
                        size="small"
                        variant="outlined"
                      />
                    )}
                  </Stack>

                  <Button
                    variant="contained"
                    fullWidth
                    startIcon={<CopyIcon />}
                    onClick={() => handleCreateFromTemplate(template)}
                    disabled={
                      tournamentStatus === 'in_progress' ||
                      tournamentStatus === 'completed' ||
                      tournamentStatus === 'setup' ||
                      tournamentStatus === 'ready'
                    }
                    title={
                      tournamentStatus === 'in_progress' || tournamentStatus === 'completed'
                        ? 'Cannot create tournament while one is in progress or completed'
                        : tournamentStatus === 'setup' || tournamentStatus === 'ready'
                        ? 'A tournament already exists. Delete or reset it first.'
                        : ''
                    }
                  >
                    Create Tournament from Template
                  </Button>
                </CardContent>
              </Card>
            </Grid>
          ))}
        </Grid>
      )}

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteDialogOpen} onClose={() => setDeleteDialogOpen(false)}>
        <DialogTitle>Delete Template</DialogTitle>
        <DialogContent>
          <Typography>
            Are you sure you want to delete the template "{templateToDelete?.name}"? This action
            cannot be undone.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteDialogOpen(false)}>Cancel</Button>
          <Button onClick={handleDelete} color="error" variant="contained">
            Delete
          </Button>
        </DialogActions>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={editDialogOpen} onClose={handleCloseEdit} maxWidth="md" fullWidth>
        <DialogTitle>Edit Template</DialogTitle>
        <DialogContent>
          <Stack spacing={3} sx={{ mt: 1 }}>
            <TextField
              fullWidth
              label="Template Name"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              required
            />
            <TextField
              fullWidth
              label="Description (optional)"
              value={editDescription}
              onChange={(e) => setEditDescription(e.target.value)}
              multiline
              rows={2}
            />

            <Box display="flex" gap={2}>
              <FormControl fullWidth>
                <InputLabel>Tournament Type</InputLabel>
                <Select
                  value={editType}
                  label="Tournament Type"
                  onChange={(e) => setEditType(e.target.value)}
                >
                  {TOURNAMENT_TYPES.map((option) => (
                    <MenuItem key={option.value} value={option.value}>
                      {option.label}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>

              <FormControl fullWidth>
                <InputLabel>Match Format</InputLabel>
                <Select
                  value={editFormat}
                  label="Match Format"
                  onChange={(e) => {
                    setEditFormat(e.target.value);
                    // Reset maps if switching to/from veto format
                    const newIsVeto = ['bo1', 'bo3', 'bo5'].includes(e.target.value);
                    const currentIsVeto = ['bo1', 'bo3', 'bo5'].includes(editFormat);
                    if (newIsVeto !== currentIsVeto) {
                      setEditMaps([]);
                      setSelectedMapPool('custom');
                    }
                  }}
                >
                  {MATCH_FORMATS.map((option) => (
                    <MenuItem key={option.value} value={option.value}>
                      {option.label}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Box>

            <Divider />

            <Box>
              <Typography variant="subtitle2" fontWeight={600} gutterBottom>
                Map Pool
              </Typography>
              <FormControl fullWidth sx={{ mb: 2 }}>
                <InputLabel>Choose a map pool</InputLabel>
                <Select
                  value={selectedMapPool || ''}
                  label="Choose a map pool"
                  onChange={(e) => handleMapPoolChange(e.target.value)}
                  displayEmpty
                >
                  {mapPools
                    .filter((p) => p.enabled)
                    .map((pool) => (
                      <MenuItem key={pool.id} value={pool.id.toString()}>
                        {pool.name}
                      </MenuItem>
                    ))}
                  <MenuItem value="custom">Custom</MenuItem>
                </Select>
              </FormControl>

              {/* Map Preview - Only show when using a preset map pool, not custom */}
              {selectedMapPool !== 'custom' && editMaps.length > 0 && (
                <Box sx={{ mb: 2 }}>
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                    Selected Maps ({editMaps.length}):
                  </Typography>
                  <Box display="flex" flexWrap="wrap" gap={1}>
                    {editMaps.map((mapId) => (
                      <Chip
                        key={mapId}
                        label={getMapDisplayName(mapId)}
                        size="small"
                        color="primary"
                        variant="outlined"
                      />
                    ))}
                  </Box>
                </Box>
              )}

              {isVetoFormat && editMaps.length !== 7 && (
                <Alert severity="warning" sx={{ mb: 2 }}>
                  Veto formats (BO1/BO3/BO5) require exactly 7 maps. Currently selected:{' '}
                  {editMaps.length}
                </Alert>
              )}

              {selectedMapPool === 'custom' && (
                <Autocomplete
                  multiple
                  options={allMapIds}
                  value={editMaps}
                  onChange={(_, newValue) => setEditMaps(newValue)}
                  disableCloseOnSelect
                  fullWidth
                  loading={loadingMaps}
                  getOptionLabel={(option) => getMapDisplayName(option)}
                  renderInput={(params) => <TextField {...params} placeholder="Choose maps..." />}
                  renderOption={(props, option) => (
                    <Box component="li" {...props} key={option}>
                      <Box display="flex" alignItems="center" gap={1} width="100%">
                        <Typography variant="body2" sx={{ flex: 1 }}>
                          {getMapDisplayName(option)}
                        </Typography>
                        <Chip
                          label={getMapType(option)}
                          size="small"
                          color={getMapTypeColor(option)}
                          variant="outlined"
                          sx={{ height: 20, fontSize: '0.7rem' }}
                        />
                      </Box>
                    </Box>
                  )}
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
              )}
            </Box>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseEdit}>Cancel</Button>
          <Button
            onClick={handleSaveEdit}
            variant="contained"
            disabled={
              !editName.trim() ||
              (isVetoFormat && editMaps.length !== 7) ||
              (!isVetoFormat && editMaps.length === 0)
            }
          >
            Save
          </Button>
        </DialogActions>
      </Dialog>
    </Container>
  );
}
