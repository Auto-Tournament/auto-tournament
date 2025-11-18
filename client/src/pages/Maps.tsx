import React, { useState, useEffect } from 'react';
import {
  Box,
  Button,
  Card,
  CardContent,
  Typography,
  Grid,
  IconButton,
  CircularProgress,
  Alert,
  CardMedia,
  Chip,
  Tabs,
  Tab,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import MapIcon from '@mui/icons-material/Map';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import CollectionsIcon from '@mui/icons-material/Collections';
import { api } from '../utils/api';
import MapModal from '../components/modals/MapModal';
import { EmptyState } from '../components/shared/EmptyState';
import type { Map, MapsResponse, MapPool, MapPoolsResponse } from '../types/api.types';
import ConfirmDialog from '../components/modals/ConfirmDialog';

export default function Maps() {
  const [maps, setMaps] = useState<Map[]>([]);
  const [mapPools, setMapPools] = useState<MapPool[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editingMap, setEditingMap] = useState<Map | null>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [mapToDelete, setMapToDelete] = useState<Map | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deletePoolConfirmOpen, setDeletePoolConfirmOpen] = useState(false);
  const [poolToDelete, setPoolToDelete] = useState<MapPool | null>(null);
  const [deletingPool, setDeletingPool] = useState(false);
  const [activeTab, setActiveTab] = useState(0);

  // Set dynamic page title
  useEffect(() => {
    document.title = 'Maps';
  }, []);

  const loadMaps = async () => {
    try {
      setLoading(true);
      const data = await api.get<MapsResponse>('/api/maps');
      setMaps(data.maps || []);
      setError('');
    } catch (err) {
      setError('Failed to load maps');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const loadMapPools = async () => {
    try {
      const data = await api.get<MapPoolsResponse>('/api/map-pools');
      setMapPools(data.mapPools || []);
    } catch (err) {
      console.error('Failed to load map pools:', err);
    }
  };

  useEffect(() => {
    loadMaps();
    loadMapPools();
  }, []);

  const getMapDisplayName = (mapId: string): string => {
    const map = maps.find((m) => m.id === mapId);
    return map ? map.displayName : mapId;
  };

  const handleDeletePoolClick = (pool: MapPool) => {
    setPoolToDelete(pool);
    setDeletePoolConfirmOpen(true);
  };

  const handleDeletePoolConfirm = async () => {
    if (!poolToDelete) return;

    setDeletingPool(true);
    try {
      await api.delete(`/api/map-pools/${poolToDelete.id}`);
      await loadMapPools();
      setDeletePoolConfirmOpen(false);
      setPoolToDelete(null);
    } catch (err) {
      setError('Failed to delete map pool');
      console.error(err);
    } finally {
      setDeletingPool(false);
    }
  };

  const handleOpenModal = (map?: Map) => {
    setEditingMap(map || null);
    setModalOpen(true);
  };

  const handleCloseModal = () => {
    setModalOpen(false);
    setEditingMap(null);
  };

  const handleSave = async () => {
    await loadMaps();
    handleCloseModal();
  };

  const handleDeleteClick = (map: Map) => {
    setMapToDelete(map);
    setDeleteConfirmOpen(true);
  };

  const handleDeleteConfirm = async () => {
    if (!mapToDelete) return;

    setDeleting(true);
    try {
      await api.delete(`/api/maps/${mapToDelete.id}`);
      await loadMaps();
      setDeleteConfirmOpen(false);
      setMapToDelete(null);
    } catch (err) {
      setError('Failed to delete map');
      console.error(err);
    } finally {
      setDeleting(false);
    }
  };

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box sx={{ p: 3 }}>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
        <Box display="flex" alignItems="center" gap={2}>
          <MapIcon sx={{ fontSize: 40, color: 'primary.main' }} />
          <Typography variant="h4" fontWeight={600}>
            Maps & Map Pools
          </Typography>
        </Box>
        {activeTab === 0 && (
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => handleOpenModal()}>
            Add Map
          </Button>
        )}
      </Box>

      <Tabs value={activeTab} onChange={(_, newValue) => setActiveTab(newValue)} sx={{ mb: 3 }}>
        <Tab label="Maps" icon={<MapIcon />} iconPosition="start" />
        <Tab label="Map Pools" icon={<CollectionsIcon />} iconPosition="start" />
      </Tabs>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>
          {error}
        </Alert>
      )}

      {activeTab === 0 && (
        <>
          {maps.length === 0 ? (
            <EmptyState
              icon={<MapIcon sx={{ fontSize: 64 }} />}
              title="No maps found"
              description="Get started by adding your first map"
              action={
                <Button
                  variant="contained"
                  startIcon={<AddIcon />}
                  onClick={() => handleOpenModal()}
                >
                  Add Map
                </Button>
              }
            />
          ) : (
            <Grid container spacing={2}>
              {maps.map((map) => (
                <Grid item xs={12} sm={6} md={4} lg={3} key={map.id}>
                  <Card
                    sx={{
                      height: '100%',
                      display: 'flex',
                      flexDirection: 'column',
                      transition: 'transform 0.2s, box-shadow 0.2s',
                      '&:hover': {
                        transform: 'translateY(-4px)',
                        boxShadow: 4,
                      },
                    }}
                  >
                    {map.imageUrl && (
                      <CardMedia
                        component="img"
                        height="140"
                        image={map.imageUrl}
                        alt={map.displayName}
                        sx={{ objectFit: 'cover' }}
                        onError={(e) => {
                          const target = e.target as HTMLImageElement;
                          target.style.display = 'none';
                        }}
                      />
                    )}
                    <CardContent sx={{ flexGrow: 1, display: 'flex', flexDirection: 'column' }}>
                      <Typography variant="h6" component="div" gutterBottom>
                        {map.displayName}
                      </Typography>
                      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                        {map.id}
                      </Typography>
                      <Box sx={{ mt: 'auto', display: 'flex', gap: 1 }}>
                        <IconButton
                          size="small"
                          color="primary"
                          onClick={() => handleOpenModal(map)}
                          aria-label="edit map"
                        >
                          <EditIcon />
                        </IconButton>
                        <IconButton
                          size="small"
                          color="error"
                          onClick={() => handleDeleteClick(map)}
                          aria-label="delete map"
                        >
                          <DeleteIcon />
                        </IconButton>
                      </Box>
                    </CardContent>
                  </Card>
                </Grid>
              ))}
            </Grid>
          )}
        </>
      )}

      {activeTab === 1 && (
        <>
          {mapPools.length === 0 ? (
            <EmptyState
              icon={<CollectionsIcon sx={{ fontSize: 64 }} />}
              title="No map pools found"
              description="Map pools will appear here. Create them from the tournament page."
            />
          ) : (
            <Grid container spacing={2}>
              {mapPools.map((pool) => (
                <Grid item xs={12} sm={6} md={4} key={pool.id}>
                  <Card
                    sx={{
                      height: '100%',
                      display: 'flex',
                      flexDirection: 'column',
                    }}
                  >
                    <CardContent sx={{ flexGrow: 1 }}>
                      <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
                        <Typography variant="h6" component="div">
                          {pool.name}
                        </Typography>
                        {pool.isDefault && <Chip label="Default" size="small" color="primary" />}
                      </Box>
                      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                        {pool.mapIds.length} map{pool.mapIds.length !== 1 ? 's' : ''}
                      </Typography>
                      <Box display="flex" flexWrap="wrap" gap={0.5} mb={2}>
                        {pool.mapIds.slice(0, 5).map((mapId) => (
                          <Chip
                            key={mapId}
                            label={getMapDisplayName(mapId)}
                            size="small"
                            variant="outlined"
                          />
                        ))}
                        {pool.mapIds.length > 5 && (
                          <Chip
                            label={`+${pool.mapIds.length - 5} more`}
                            size="small"
                            variant="outlined"
                          />
                        )}
                      </Box>
                      {!pool.isDefault && (
                        <Box sx={{ mt: 'auto' }}>
                          <IconButton
                            size="small"
                            color="error"
                            onClick={() => handleDeletePoolClick(pool)}
                            aria-label="delete map pool"
                          >
                            <DeleteIcon />
                          </IconButton>
                        </Box>
                      )}
                    </CardContent>
                  </Card>
                </Grid>
              ))}
            </Grid>
          )}
        </>
      )}

      <MapModal open={modalOpen} map={editingMap} onClose={handleCloseModal} onSave={handleSave} />

      <ConfirmDialog
        open={deleteConfirmOpen}
        title="Delete Map"
        message={`Are you sure you want to delete "${mapToDelete?.displayName}"? This action cannot be undone.`}
        onConfirm={handleDeleteConfirm}
        onCancel={() => {
          setDeleteConfirmOpen(false);
          setMapToDelete(null);
        }}
        confirmText="Delete"
        confirmColor="error"
        loading={deleting}
      />

      <ConfirmDialog
        open={deletePoolConfirmOpen}
        title="Delete Map Pool"
        message={`Are you sure you want to delete "${poolToDelete?.name}"? This action cannot be undone.`}
        onConfirm={handleDeletePoolConfirm}
        onCancel={() => {
          setDeletePoolConfirmOpen(false);
          setPoolToDelete(null);
        }}
        confirmText="Delete"
        confirmColor="error"
        loading={deletingPool}
      />
    </Box>
  );
}
