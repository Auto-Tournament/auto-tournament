import React from 'react';
import { Box, MenuItem, TextField, Typography } from '@mui/material';

interface ManualMatchSidesStepProps {
  bestOf: 'bo1' | 'bo3' | 'bo5';
  useVeto: boolean;
  team1Name?: string | null;
  team2Name?: string | null;
  requiredMaps: number;
  mapSideSelections: Array<'knife' | 'team1_ct' | 'team2_ct'>;
  onMapSideSelectionsChange: (index: number, side: 'knife' | 'team1_ct' | 'team2_ct') => void;
  startingSide: 'knife' | 'team1_ct' | 'team2_ct';
  onStartingSideChange: (side: 'knife' | 'team1_ct' | 'team2_ct') => void;
}

export const ManualMatchSidesStep: React.FC<ManualMatchSidesStepProps> = ({
  bestOf,
  useVeto,
  team1Name,
  team2Name,
  requiredMaps,
  mapSideSelections,
  onMapSideSelectionsChange,
  startingSide,
  onStartingSideChange,
}) => {
  const t1 = team1Name || 'Team 1';
  const t2 = team2Name || 'Team 2';

  return (
    <Box>
      <Typography variant="subtitle1" fontWeight={600} gutterBottom>
        Veto & Starting Sides
      </Typography>
      <Typography variant="body2" color="text.secondary" gutterBottom>
        Configure who starts CT on each map when veto is disabled. Veto mode itself is selected on
        the Maps & Rules step.
      </Typography>

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
            <MenuItem value="team1_ct">
              {t1} starts CT
            </MenuItem>
            <MenuItem value="team2_ct">
              {t2} starts CT
            </MenuItem>
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
                <MenuItem value="team1_ct">
                  {t1} starts CT
                </MenuItem>
                <MenuItem value="team2_ct">
                  {t2} starts CT
                </MenuItem>
                <MenuItem value="knife">Use knife to decide</MenuItem>
              </TextField>
            ))}
          </Box>
        ))}
    </Box>
  );
};


