import React, { useState, useEffect, useCallback } from 'react';
import { usePageHeader } from '../contexts/PageHeaderContext';
import { useSnackbar } from '../contexts/SnackbarContext';
import { Box, Button, CircularProgress, Tabs, Tab } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import MapIcon from '@mui/icons-material/Map';
import CollectionsIcon from '@mui/icons-material/Collections';
import { api } from '../utils/api';
import MapModal from '../components/modals/MapModal';
import MapActionsModal from '../components/modals/MapActionsModal';
import MapPoolModal from '../components/modals/MapPoolModal';
import MapPoolActionsModal from '../components/modals/MapPoolActionsModal';
import { MapsTab } from '../components/maps/MapsTab';
import { MapPoolsTab } from '../components/maps/MapPoolsTab';
import type { Map, MapsResponse, MapPool, MapPoolsResponse } from '../types/api.types';
import ConfirmDialog from '../components/modals/ConfirmDialog';

export default function Maps() {
  const { setHeaderActions } = usePageHeader();
  const { showSuccess, showError } = useSnackbar();
  const [maps, setMaps] = useState<Map[]>([]);
  const [mapPools, setMapPools] = useState<MapPool[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingMap, setEditingMap] = useState<Map | null>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [mapToDelete, setMapToDelete] = useState<Map | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [actionsModalOpen, setActionsModalOpen] = useState(false);
  const [selectedMap, setSelectedMap] = useState<Map | null>(null);
  const [deletePoolConfirmOpen, setDeletePoolConfirmOpen] = useState(false);
  const [poolToDelete, setPoolToDelete] = useState<MapPool | null>(null);
  const [deletingPool, setDeletingPool] = useState(false);
  const [activeTab, setActiveTab] = useState(0);
  const [mapPoolModalOpen, setMapPoolModalOpen] = useState(false);
  const [editingMapPool, setEditingMapPool] = useState<MapPool | null>(null);
  const [poolActionsModalOpen, setPoolActionsModalOpen] = useState(false);
  const [selectedMapPool, setSelectedMapPool] = useState<MapPool | null>(null);

  // Set dynamic page title
  useEffect(() => {
    document.title = 'Maps';
  }, []);

  // Set header actions
  useEffect(() => {
    setHeaderActions(
      activeTab === 0 ? (
        <Button
          data-testid="add-map-button"
          variant="contained"
          startIcon={<AddIcon />}
          onClick={() => handleOpenModal()}
        >
          Add Map
        </Button>
      ) : (
        <Button
          data-testid="create-map-pool-button"
          variant="contained"
          startIcon={<AddIcon />}
          onClick={() => handleOpenMapPoolModal()}
        >
          Create Map Pool
        </Button>
      )
    );

    return () => {
      setHeaderActions(null);
    };
  }, [activeTab, setHeaderActions]);

  const loadMaps = useCallback(async () => {
    try {
      setLoading(true);
      const data = await api.get<MapsResponse>('/api/maps');
      setMaps(data.maps || []);
    } catch (err) {
      const errorMessage = 'Failed to load maps';
      showError(errorMessage);
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [showError]);

  const loadMapPools = useCallback(async () => {
    try {
      const data = await api.get<MapPoolsResponse>('/api/map-pools');
      setMapPools(data.mapPools || []);
    } catch (err) {
      console.error('Failed to load map pools:', err);
    }
  }, []);

  useEffect(() => {
    loadMaps();
    loadMapPools();
  }, [loadMaps, loadMapPools]);

  const handleMapPoolCardClick = (pool: MapPool) => {
    setSelectedMapPool(pool);
    setPoolActionsModalOpen(true);
  };

  const handleOpenMapPoolModal = (pool?: MapPool) => {
    setEditingMapPool(pool || null);
    setMapPoolModalOpen(true);
    setPoolActionsModalOpen(false);
  };

  const handleCloseMapPoolModal = () => {
    setMapPoolModalOpen(false);
    setEditingMapPool(null);
  };

  const handleClosePoolActionsModal = () => {
    setPoolActionsModalOpen(false);
    setSelectedMapPool(null);
  };

  const handleEditPoolFromActions = () => {
    if (selectedMapPool) {
      handleOpenMapPoolModal(selectedMapPool);
    }
  };

  const handleDeletePoolClick = (pool: MapPool) => {
    setPoolToDelete(pool);
    setDeletePoolConfirmOpen(true);
    setPoolActionsModalOpen(false);
  };

  const handleDeletePoolFromActions = () => {
    if (selectedMapPool) {
      handleDeletePoolClick(selectedMapPool);
    }
  };

  const handleMapPoolSave = async () => {
    await loadMapPools();
    handleCloseMapPoolModal();
  };

  const handleSetDefaultMapPool = async () => {
    if (!selectedMapPool) return;

    try {
      await api.put(`/api/map-pools/${selectedMapPool.id}/set-default`);
      await loadMapPools();
      // Update selectedMapPool to reflect the change
      const poolsResponse = await api.get<MapPoolsResponse>('/api/map-pools');
      const updatedPool = poolsResponse.mapPools?.find((p) => p.id === selectedMapPool.id);
      if (updatedPool) {
        setSelectedMapPool(updatedPool);
      }
    } catch (err) {
      const errorMessage = 'Failed to set default map pool';
      showError(errorMessage);
      console.error(err);
    }
  };

  const handleToggleMapPoolEnabled = async () => {
    if (!selectedMapPool) return;

    try {
      const endpoint = selectedMapPool.enabled ? 'disable' : 'enable';
      await api.put(`/api/map-pools/${selectedMapPool.id}/${endpoint}`);
      await loadMapPools();
      // Update selectedMapPool to reflect the change
      const poolsResponse = await api.get<MapPoolsResponse>('/api/map-pools');
      const updatedPool = poolsResponse.mapPools?.find((p) => p.id === selectedMapPool.id);
      if (updatedPool) {
        setSelectedMapPool(updatedPool);
      }
    } catch (err) {
      const errorMessage = 'Failed to toggle map pool status';
      showError(errorMessage);
      console.error(err);
    }
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
      const errorMessage = 'Failed to delete map pool';
      showError(errorMessage);
      console.error(err);
    } finally {
      setDeletingPool(false);
    }
  };

  const handleMapCardClick = (map: Map) => {
    setSelectedMap(map);
    setActionsModalOpen(true);
  };

  const handleOpenModal = (map?: Map) => {
    setEditingMap(map || null);
    setModalOpen(true);
    setActionsModalOpen(false);
  };

  const handleCloseModal = () => {
    setModalOpen(false);
    setEditingMap(null);
  };

  const handleCloseActionsModal = () => {
    setActionsModalOpen(false);
    setSelectedMap(null);
  };

  const handleEditFromActions = () => {
    if (selectedMap) {
      handleOpenModal(selectedMap);
    }
  };

  const handleDeleteFromActions = () => {
    if (selectedMap) {
      handleDeleteClick(selectedMap);
      setActionsModalOpen(false);
    }
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
      showSuccess('Map deleted successfully');
      await loadMaps();
      setDeleteConfirmOpen(false);
      setMapToDelete(null);
    } catch (err) {
      const errorMessage = 'Failed to delete map';
      showError(errorMessage);
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
    <Box data-testid="maps-page" sx={{ width: '100%', height: '100%' }}>
      <Tabs value={activeTab} onChange={(_, newValue) => setActiveTab(newValue)} sx={{ mb: 3 }}>
        <Tab
          data-testid="maps-tab"
          label="Maps"
          icon={<MapIcon />}
          iconPosition="start"
        />
        <Tab
          data-testid="map-pools-tab"
          label="Map Pools"
          icon={<CollectionsIcon />}
          iconPosition="start"
        />
      </Tabs>


      {activeTab === 0 && (
        <MapsTab maps={maps} onAddMap={() => handleOpenModal()} onMapClick={handleMapCardClick} />
      )}

      {activeTab === 1 && (
        <MapPoolsTab
          mapPools={mapPools}
          maps={maps}
          onCreatePool={() => handleOpenMapPoolModal()}
          onPoolClick={handleMapPoolCardClick}
        />
      )}

      <MapModal open={modalOpen} map={editingMap} onClose={handleCloseModal} onSave={handleSave} />

      <MapActionsModal
        open={actionsModalOpen}
        map={selectedMap}
        onClose={handleCloseActionsModal}
        onEdit={handleEditFromActions}
        onDelete={handleDeleteFromActions}
      />

      <MapPoolModal
        open={mapPoolModalOpen}
        mapPool={editingMapPool}
        onClose={handleCloseMapPoolModal}
        onSave={handleMapPoolSave}
      />

      <MapPoolActionsModal
        open={poolActionsModalOpen}
        mapPool={selectedMapPool}
        maps={maps}
        onClose={handleClosePoolActionsModal}
        onEdit={handleEditPoolFromActions}
        onDelete={handleDeletePoolFromActions}
        onSetDefault={handleSetDefaultMapPool}
        onToggleEnabled={handleToggleMapPoolEnabled}
      />

      <ConfirmDialog
        open={deleteConfirmOpen}
        title="Delete Map"
        message={`Are you sure you want to delete "${mapToDelete?.displayName}"? This action cannot be undone.`}
        onConfirm={handleDeleteConfirm}
        onCancel={() => {
          setDeleteConfirmOpen(false);
          setMapToDelete(null);
        }}
        confirmLabel="Delete"
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
        confirmLabel="Delete"
        confirmColor="error"
        loading={deletingPool}
      />

    </Box>
  );
}
