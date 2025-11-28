import React from 'react';
import {
  Box,
  Typography,
  Alert,
  Button,
  Grid,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
} from '@mui/material';
import { TOURNAMENT_TYPES, MATCH_FORMATS } from '../../constants/tournament';

interface TournamentTypeFormatStepProps {
  type: string;
  format: string;
  canEdit: boolean;
  saving: boolean;
  onTypeChange: (type: string) => void;
  onFormatChange: (format: string) => void;
}

export function TournamentTypeFormatStep({
  type,
  format,
  canEdit,
  saving,
  onTypeChange,
  onFormatChange,
}: TournamentTypeFormatStepProps) {
  return (
    <Box>
      <Typography variant="overline" color="primary" fontWeight={600}>
        Step 4
      </Typography>
      <Typography variant="subtitle2" fontWeight={600} mb={2}>
        Tournament Type & Format
      </Typography>

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
              {TOURNAMENT_TYPES.map((option) => (
                <MenuItem key={option.value} value={option.value} disabled={option.disabled}>
                  <Box>
                    <Typography variant="body1">{option.label}</Typography>
                    {option.description && (
                      <Typography variant="caption" color="text.secondary">
                        {option.description}
                      </Typography>
                    )}
                  </Box>
                </MenuItem>
              ))}
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
  );
}

