import React, { useState, useRef, useEffect } from 'react';
import { Box, Card, CardContent, Stack, Divider, Alert, Button, Typography } from '@mui/material';
import { Error as ErrorIcon, Add as AddIcon } from '@mui/icons-material';
import { TOURNAMENT_TYPES } from '../../constants/tournament';
import { Team } from '../../types';
import SaveMapPoolModal from '../modals/SaveMapPoolModal';
import { TournamentTypeChecklist } from './TournamentTypeChecklist';
import { TournamentNameStep } from './TournamentNameStep';
import { TeamSelectionStep } from './TeamSelectionStep';
import { MapPoolStep } from './MapPoolStep';
import { TournamentTypeFormatStep } from './TournamentTypeFormatStep';
import { TournamentFormActions } from './TournamentFormActions';
import { useTournamentFormData } from './useTournamentFormData';
import { api } from '../../utils/api';
import type { MapPoolsResponse } from '../../types/api.types';

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
  const [selectedMapPool, setSelectedMapPool] = useState<string>('');
  const [saveMapPoolModalOpen, setSaveMapPoolModalOpen] = useState(false);
  const formRef = useRef<HTMLDivElement>(null);
  const [checklistPosition, setChecklistPosition] = useState({ top: 24, left: 24 });
  const checklistRef = useRef<HTMLDivElement>(null);

  const { serverCount, loadingServers, mapPools, availableMaps, loadingMaps, setMapPools } =
    useTournamentFormData({
      maps,
      selectedMapPool,
      onMapsChange,
    });

  // Initialize selectedMapPool based on default map pool when mapPools load
  React.useEffect(() => {
    if (mapPools.length > 0 && !selectedMapPool && maps.length === 0) {
      // Only initialize if not already set and no maps are selected
      const defaultPool = mapPools.find((p) => p.isDefault);
      if (defaultPool) {
        // Use the default pool's ID, not hardcoded 'active-duty'
        setSelectedMapPool(defaultPool.id.toString());
      } else if (mapPools.length > 0) {
        // Fallback to first pool if no default exists
        setSelectedMapPool(mapPools[0].id.toString());
      }
    }
  }, [mapPools, selectedMapPool, maps.length]);

  // Update checklist position based on form position
  useEffect(() => {
    let rafId: number | null = null;

    const updatePosition = () => {
      if (formRef.current && checklistRef.current) {
        const formRect = formRef.current.getBoundingClientRect();
        const checklistRect = checklistRef.current.getBoundingClientRect();

        // Calculate center of viewport vertically
        const viewportHeight = window.innerHeight;
        const checklistHeight = checklistRect.height;
        const centeredTop = (viewportHeight - checklistHeight) / 2;

        // Constrain to form's height - ensure checklist stays within form bounds
        const formTop = formRect.top;
        const formBottom = formRect.bottom;
        const minTop = formTop + 24; // Minimum: 24px from form top
        const maxTop = formBottom - checklistHeight - 24; // Maximum: checklist bottom 24px from form bottom

        // Clamp the centered position to stay within form bounds
        const finalTop = Math.max(minTop, Math.min(centeredTop, maxTop));

        setChecklistPosition({
          top: finalTop,
          left: formRect.left,
        });
      }
    };

    const handleUpdate = () => {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
      }
      rafId = requestAnimationFrame(updatePosition);
    };

    // Update on mount
    updatePosition();

    // Update on scroll and resize
    window.addEventListener('scroll', handleUpdate, true);
    window.addEventListener('resize', handleUpdate);

    // Also update when content might change
    const resizeObserver = new ResizeObserver(handleUpdate);
    if (formRef.current) {
      resizeObserver.observe(formRef.current);
    }
    if (checklistRef.current) {
      resizeObserver.observe(checklistRef.current);
    }

    return () => {
      window.removeEventListener('scroll', handleUpdate, true);
      window.removeEventListener('resize', handleUpdate);
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
      }
      resizeObserver.disconnect();
    };
  }, []);

  // Initialize map pool selection based on current maps
  React.useEffect(() => {
    // Only auto-detect pool if maps are set and we're not already on custom
    // This prevents overriding user's explicit "custom" selection
    if (maps.length > 0 && mapPools.length > 0 && selectedMapPool !== 'custom') {
      // Check if maps match the default pool (could be Active Duty or a custom default)
      const defaultPool = mapPools.find((p) => p.isDefault);
      if (
        defaultPool &&
        JSON.stringify([...maps].sort()) === JSON.stringify([...defaultPool.mapIds].sort())
      ) {
        // Use the default pool's ID, not hardcoded 'active-duty'
        setSelectedMapPool(defaultPool.id.toString());
        return;
      }

      // Check if maps match any other pool
      const matchingPool = mapPools.find(
        (p) => JSON.stringify([...maps].sort()) === JSON.stringify([...p.mapIds].sort())
      );
      if (matchingPool) {
        setSelectedMapPool(matchingPool.id.toString());
      } else {
        setSelectedMapPool('custom');
      }
    }
  }, [maps, mapPools, selectedMapPool]);

  // Calculate required servers for first round
  const getRequiredServers = (teamCount: number): number => {
    if (teamCount < 2) return 0;
    return Math.ceil(teamCount / 2);
  };

  const requiredServers = getRequiredServers(selectedTeams.length);
  const hasEnoughServers = serverCount >= requiredServers;

  // Handle map pool selection
  const handleMapPoolChange = (poolId: string) => {
    setSelectedMapPool(poolId);

    if (poolId === 'custom') {
      // Clear maps when switching to custom so user can start fresh
      onMapsChange([]);
    } else {
      // Find the pool by ID (could be default pool or any custom pool)
      const pool = mapPools.find((p) => p.id.toString() === poolId);
      if (pool) {
        onMapsChange(pool.mapIds);
      }
    }
  };

  return (
    <Card ref={formRef} sx={{ position: 'relative', overflow: 'visible' }}>
      <CardContent sx={{ position: 'relative', overflow: 'visible' }}>
        <Box
          ref={checklistRef}
          sx={{
            position: 'fixed',
            top: `${checklistPosition.top}px`,
            left: `${checklistPosition.left}px`,
            transform: 'translateX(-100%)',
            zIndex: 1000,
            paddingRight: '24px',
          }}
        >
          <TournamentTypeChecklist
            tournamentName={name}
            tournamentType={TOURNAMENT_TYPES.find((t) => t.value === type)}
            format={format}
            teamCount={selectedTeams.length}
            mapsCount={maps.length}
          />
        </Box>

        <Stack spacing={3}>
          {/* No Servers Warning - Show prominently at the top */}
          {!loadingServers && serverCount === 0 && (
            <Alert
              severity="error"
              icon={<ErrorIcon />}
              action={
                <Button
                  color="inherit"
                  size="small"
                  startIcon={<AddIcon />}
                  onClick={() => (window.location.href = '/servers')}
                  sx={{ fontWeight: 600 }}
                >
                  Add Server
                </Button>
              }
              sx={{ mb: 2 }}
            >
              <Box>
                <Typography variant="body1" fontWeight={600} gutterBottom>
                  No servers configured
                </Typography>
                <Typography variant="body2">
                  You need to add at least one CS2 server before creating a tournament. Matches cannot be loaded without servers.
                </Typography>
              </Box>
            </Alert>
          )}

          <TournamentNameStep
            name={name}
            canEdit={canEdit}
            saving={saving}
            onNameChange={onNameChange}
          />

          <Divider />

          <TeamSelectionStep
            teams={teams}
            selectedTeams={selectedTeams}
            canEdit={canEdit}
            saving={saving}
            onTeamsChange={onTeamsChange}
          />

          <Divider />

          <MapPoolStep
            format={format}
            maps={maps}
            mapPools={mapPools}
            availableMaps={availableMaps}
            selectedMapPool={selectedMapPool}
            loadingMaps={loadingMaps}
            canEdit={canEdit}
            saving={saving}
            onMapPoolChange={handleMapPoolChange}
            onMapsChange={onMapsChange}
            onSaveMapPool={() => setSaveMapPoolModalOpen(true)}
          />

          <Divider />

          <TournamentTypeFormatStep
            type={type}
            format={format}
            selectedTeams={selectedTeams}
            maps={maps}
            serverCount={serverCount}
            requiredServers={requiredServers}
            hasEnoughServers={hasEnoughServers}
            loadingServers={loadingServers}
            canEdit={canEdit}
            saving={saving}
            onTypeChange={onTypeChange}
            onFormatChange={onFormatChange}
          />

          <TournamentFormActions
            tournamentExists={tournamentExists}
            saving={saving}
            hasChanges={hasChanges}
            format={format}
            mapsCount={maps.length}
            canEdit={canEdit}
            onSave={onSave}
            onCancel={onCancel}
            onDelete={onDelete}
          />
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
