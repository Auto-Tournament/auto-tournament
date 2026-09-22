import React from 'react';
import { Typography } from '@mui/material';
import type { MapPool, Map as MapType } from '../../types/api.types';
import { MapPoolStep } from '../tournament/MapPoolStep';

interface ManualMatchMapsStepProps {
  activeStep: number;

  maps: string[];
  mapPools: MapPool[];
  availableMaps: MapType[];
  selectedMapPool: string;
  loadingMaps: boolean;
  saving: boolean;
  onMapPoolChange: (poolId: string) => void;
  onMapsChange: (maps: string[]) => void;
  onMapRemove: (mapId: string) => void;
  onOpenSaveMapPool: () => void;

  useVeto: boolean;
  requiredMaps: number;
  selectedMapsCount: number;
  hasVetoMapCountError: boolean;
  hasSeriesMapCountError: boolean;
}

export const ManualMatchMapsStep: React.FC<ManualMatchMapsStepProps> = ({
  activeStep,
  maps,
  mapPools,
  availableMaps,
  selectedMapPool,
  loadingMaps,
  saving,
  onMapPoolChange,
  onMapsChange,
  onMapRemove,
  onOpenSaveMapPool,
  useVeto,
  requiredMaps,
  selectedMapsCount,
  hasVetoMapCountError,
  hasSeriesMapCountError,
}) => {
  if (activeStep !== 2) {
    return null;
  }

  return (
    <>
      <Typography variant="subtitle1" fontWeight={600} gutterBottom>
        Maps
      </Typography>
      <Typography variant="body2" color="text.secondary" gutterBottom>
        Choose a map pool and select the maps that will be used for this series.
      </Typography>

      <MapPoolStep
        format="custom"
        type={useVeto ? 'single_elimination' : 'shuffle'}
        maps={maps}
        mapPools={mapPools}
        availableMaps={availableMaps}
        selectedMapPool={selectedMapPool}
        loadingMaps={loadingMaps}
        canEdit={!saving}
        saving={saving}
        onMapPoolChange={onMapPoolChange}
        onMapsChange={onMapsChange}
        onMapRemove={onMapRemove}
        onSaveMapPool={onOpenSaveMapPool}
        hideShuffleExplanation
        enableOrdering={false}
      />

      {(hasVetoMapCountError || hasSeriesMapCountError) && (
        <Typography variant="body2" color="error" sx={{ mt: 1 }}>
          {useVeto
            ? `Map veto requires exactly 7 maps. You have selected ${selectedMapsCount}.`
            : requiredMaps === 1
            ? 'Best of 1 requires exactly 1 map.'
            : `Best of ${requiredMaps} requires exactly ${requiredMaps} maps. You have selected ${selectedMapsCount}.`}
        </Typography>
      )}
    </>
  );
};


