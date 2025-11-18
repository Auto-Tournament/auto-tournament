import React, { useState } from 'react';
import { Box, Typography, Card, CardContent, Stack, Divider } from '@mui/material';
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
  const [selectedMapPool, setSelectedMapPool] = useState<string>('active-duty');
  const [saveMapPoolModalOpen, setSaveMapPoolModalOpen] = useState(false);

  const { serverCount, loadingServers, mapPools, availableMaps, loadingMaps, setMapPools } =
    useTournamentFormData({
      maps,
      selectedMapPool,
      onMapsChange,
    });

  // Initialize map pool selection based on current maps
  React.useEffect(() => {
    if (maps.length > 0 && mapPools.length > 0) {
      // Check if maps match Active Duty pool
      const activeDutyPool = mapPools.find((p) => p.isDefault);
      if (
        activeDutyPool &&
        JSON.stringify([...maps].sort()) === JSON.stringify([...activeDutyPool.mapIds].sort())
      ) {
        setSelectedMapPool('active-duty');
        return;
      }

      // Check if maps match any custom pool
      const matchingPool = mapPools.find(
        (p) =>
          !p.isDefault && JSON.stringify([...maps].sort()) === JSON.stringify([...p.mapIds].sort())
      );
      if (matchingPool) {
        setSelectedMapPool(matchingPool.id.toString());
      } else {
        setSelectedMapPool('custom');
      }
    }
  }, [maps, mapPools]);

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
      return;
    } else if (poolId === 'active-duty') {
      const activeDutyPool = mapPools.find((p) => p.isDefault);
      if (activeDutyPool) {
        onMapsChange(activeDutyPool.mapIds);
      }
    } else {
      const pool = mapPools.find((p) => p.id.toString() === poolId);
      if (pool) {
        onMapsChange(pool.mapIds);
      }
    }
  };

  return (
    <Card sx={{ position: 'relative', overflow: 'visible' }}>
      <CardContent sx={{ position: 'relative', overflow: 'visible' }}>
        <Box display="flex" alignItems="flex-start" gap={3} mb={3}>
          <Box flex={1}>
            <Typography variant="h6" gutterBottom>
              {tournamentExists ? 'Edit Tournament' : 'Create Tournament'}
            </Typography>
          </Box>
          <Box sx={{ minWidth: '200px', mt: 1 }}>
            <TournamentTypeChecklist
              tournamentName={name}
              tournamentType={TOURNAMENT_TYPES.find((t) => t.value === type)}
              format={format}
              teamCount={selectedTeams.length}
              mapsCount={maps.length}
            />
          </Box>
        </Box>

        <Stack spacing={3}>
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
