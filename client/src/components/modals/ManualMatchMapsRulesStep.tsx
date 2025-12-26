import React from 'react';
import {
  Box,
  FormControlLabel,
  MenuItem,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import type { Team } from '../../types';
import type { MapPool, Map as MapType } from '../../types/api.types';
import { MapPoolStep } from '../tournament/MapPoolStep';

interface ManualMatchMapsRulesStepProps {
  activeStep: number;

  bestOf: 'bo1' | 'bo3' | 'bo5';
  onBestOfChange: (format: 'bo1' | 'bo3' | 'bo5') => void;

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

  maxRounds: number;
  onMaxRoundsChange: (value: number) => void;

  // Overtime configuration for manual matches
  overtimeEnabled: boolean;
  onOvertimeEnabledChange: (value: boolean) => void;
  overtimeMaxRounds: number | null;
  onOvertimeMaxRoundsChange: (value: number | null) => void;

  playersPerTeam: number;
  onPlayersPerTeamChange: (value: number) => void;
}

export const ManualMatchMapsRulesStep: React.FC<ManualMatchMapsRulesStepProps> = ({
  activeStep,
  bestOf,
  onBestOfChange,
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
  maxRounds,
  onMaxRoundsChange,
  overtimeEnabled,
  onOvertimeEnabledChange,
  overtimeMaxRounds,
  onOvertimeMaxRoundsChange,
  playersPerTeam,
  onPlayersPerTeamChange,
}) => {
  if (activeStep !== 1) {
    // Hide all maps/rules fields on the first page of the modal.
    return null;
  }

  return (
    <>
      <>
          {/* Series / format first, akin to tournament type/mode */}
          <TextField
            select
            label="Series format"
            value={bestOf}
            onChange={(e) => onBestOfChange(e.target.value as 'bo1' | 'bo3' | 'bo5')}
            fullWidth
            helperText="Controls how many maps this series is played as (BO1, BO3, BO5)."
          >
            <MenuItem value="bo1">Best of 1</MenuItem>
            <MenuItem value="bo3">Best of 3</MenuItem>
            <MenuItem value="bo5">Best of 5</MenuItem>
          </TextField>

          {/* Map pool & maps next */}
          <MapPoolStep
            // When veto is enabled, use standard veto rules (requires 7 maps).
            // When veto is disabled, behave like a shuffle-style fixed map list.
            format={bestOf}
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
            <Typography variant="body2" color="error">
              {useVeto
                ? `Map veto requires exactly 7 maps. You have selected ${selectedMapsCount}.`
                : requiredMaps === 1
                ? 'Best of 1 requires exactly 1 map.'
                : `Best of ${requiredMaps} requires exactly ${requiredMaps} maps. You have selected ${selectedMapsCount}.`}
            </Typography>
          )}

          {/* Advanced rules */}
          <Box display="flex" flexDirection="column" gap={2}>
            <Box display="flex" gap={2} flexWrap="wrap">
              <TextField
                label="Max rounds per map"
                type="number"
                value={maxRounds}
                onChange={(e) => onMaxRoundsChange(Number(e.target.value) || 24)}
                inputProps={{ min: 1, max: 30 }}
                sx={{ maxWidth: 220, flex: 1, minWidth: 160 }}
                helperText={
                  maxRounds > 0
                    ? `Passed to MatchZy as mp_maxrounds. Example: ${maxRounds} = MR${maxRounds}.`
                    : 'Maximum number of rounds per map (default: 24, max: 30).'
                }
              />

              <TextField
                label="Players per team"
                type="number"
                value={playersPerTeam}
                onChange={(e) => onPlayersPerTeamChange(Number(e.target.value) || 5)}
                inputProps={{ min: 1, max: 10 }}
                sx={{ maxWidth: 200, flex: 1, minWidth: 160 }}
                helperText="Number of players per team (used for expected player counts)"
              />
            </Box>

            <Box>
              <Typography variant="subtitle2" gutterBottom>
                Overtime
              </Typography>
              <FormControlLabel
                control={
                  <Switch
                    checked={overtimeEnabled}
                    onChange={(e) => onOvertimeEnabledChange(e.target.checked)}
                    color="primary"
                  />
                }
                label={
                  overtimeEnabled
                    ? 'Overtime enabled (standard CS2 overtime when scores are tied)'
                    : 'No overtime (match can end in a tie when max rounds are reached)'
                }
              />

              {overtimeEnabled && (
                <TextField
                  label="Overtime rounds per overtime (mp_overtime_maxrounds)"
                  type="number"
                  value={overtimeMaxRounds ?? ''}
                  onChange={(e) => {
                    const raw = e.target.value.trim();
                    if (!raw) {
                      onOvertimeMaxRoundsChange(null);
                      return;
                    }
                    const parsed = Number(raw);
                    if (Number.isNaN(parsed) || parsed <= 0) {
                      onOvertimeMaxRoundsChange(null);
                      return;
                    }
                    onOvertimeMaxRoundsChange(parsed);
                  }}
                  inputProps={{ min: 2, max: 30 }}
                  sx={{ maxWidth: 260, mt: 1 }}
                  helperText={
                    overtimeMaxRounds && overtimeMaxRounds > 0
                      ? `Passed to MatchZy as mp_overtime_maxrounds. Example: ${overtimeMaxRounds} = MR${overtimeMaxRounds} in overtime.`
                      : 'Leave empty to use the server default overtime length (usually MR3 / 6 rounds).'
                  }
                />
              )}
            </Box>
          </Box>
        </>
    </>
  );
};


