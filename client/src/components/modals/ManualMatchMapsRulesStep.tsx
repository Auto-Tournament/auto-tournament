import React from 'react';
import { Box, FormControlLabel, MenuItem, Switch, TextField, Typography } from '@mui/material';

interface ManualMatchMapsRulesStepProps {
  activeStep: number;

  bestOf: 'bo1' | 'bo3' | 'bo5';
  onBestOfChange: (format: 'bo1' | 'bo3' | 'bo5') => void;

  useVeto: boolean;
  onUseVetoChange: (value: boolean) => void;

  requiredMaps: number;
  selectedMapsCount: number;
  hasVetoMapCountError: boolean;
  hasSeriesMapCountError: boolean;

  startingSide: 'knife' | 'team1_ct' | 'team2_ct';
  onStartingSideChange: (side: 'knife' | 'team1_ct' | 'team2_ct') => void;
  mapSideSelections: Array<'knife' | 'team1_ct' | 'team2_ct'>;
  onMapSideSelectionsChange: (index: number, side: 'knife' | 'team1_ct' | 'team2_ct') => void;

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
  requiredMaps,
  useVeto,
  onUseVetoChange,
  startingSide,
  onStartingSideChange,
  mapSideSelections,
  onMapSideSelectionsChange,
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
    // Rules are configured after the initial "choose template or new match"
    // step, so they live on step 1 now.
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

        {/* Veto mode first so rules and map validation are consistent. */}
        <FormControlLabel
          control={
            <Switch
              checked={useVeto}
              onChange={(e) => onUseVetoChange(e.target.checked)}
              color="primary"
            />
          }
          label="Enable veto flow (requires 7-map pool)"
          sx={{ mt: 1 }}
        />

        {/* When veto is disabled, allow selecting who starts CT directly on this step. */}
        {!useVeto &&
          (bestOf === 'bo1' ? (
            <TextField
              select
              label="Who starts CT?"
              value={startingSide}
              onChange={(e) =>
                onStartingSideChange(e.target.value as 'knife' | 'team1_ct' | 'team2_ct')
              }
              fullWidth
              sx={{ mt: 1 }}
              helperText="Starting CT side for this map (or use knife to decide)."
            >
              <MenuItem value="team1_ct">Team 1 starts CT</MenuItem>
              <MenuItem value="team2_ct">Team 2 starts CT</MenuItem>
              <MenuItem value="knife">Use knife to decide</MenuItem>
            </TextField>
          ) : (
            <Box mt={1}>
              <Typography variant="subtitle2" fontWeight={600}>
                Starting sides per map
              </Typography>
              <Typography variant="caption" color="text.secondary" display="block" mb={1}>
                Only used when veto is disabled. Defaults to "Use knife" if not changed.
              </Typography>
              {Array.from({ length: requiredMaps }).map((_, index) => (
                <TextField
                  key={index}
                  select
                  label={`Map ${index + 1} – starting CT side`}
                  value={mapSideSelections[index] ?? 'knife'}
                  onChange={(e) =>
                    onMapSideSelectionsChange(
                      index,
                      e.target.value as 'knife' | 'team1_ct' | 'team2_ct'
                    )
                  }
                  fullWidth
                  sx={{ mt: index === 0 ? 0.5 : 1 }}
                  helperText="Per-map CT starting side (or use knife to decide)."
                >
                  <MenuItem value="team1_ct">Team 1 starts CT</MenuItem>
                  <MenuItem value="team2_ct">Team 2 starts CT</MenuItem>
                  <MenuItem value="knife">Use knife to decide</MenuItem>
                </TextField>
              ))}
            </Box>
          ))}

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
                  : 'No overtime (decide ties by your MatchZy tiebreak rule or leave them as draws)'
              }
            />

            {overtimeEnabled && (
                <TextField
                  fullWidth
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
                  sx={{ mt: 1 }}
                  helperText={
                    overtimeMaxRounds && overtimeMaxRounds > 0
                      ? `Passed to MatchZy as mp_overtime_maxrounds. Example: ${overtimeMaxRounds} = MR${overtimeMaxRounds} in overtime.`
                    : 'Leave empty to use the server default overtime length (usually MR3 / 6 rounds). Your MatchZy config can still break ties by total damage when OT is disabled or capped.'
                  }
                />
            )}
          </Box>
        </Box>
      </>
    </>
  );
};
