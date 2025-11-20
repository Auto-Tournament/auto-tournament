import React from 'react';
import { Box, Typography, TextField } from '@mui/material';

interface TournamentNameStepProps {
  name: string;
  canEdit: boolean;
  saving: boolean;
  onNameChange: (name: string) => void;
}

export function TournamentNameStep({
  name,
  canEdit,
  saving,
  onNameChange,
}: TournamentNameStepProps) {
  return (
    <Box>
      <Typography variant="overline" color="primary" fontWeight={600}>
        Step 1
      </Typography>
      <Typography variant="subtitle2" fontWeight={600} mb={1}>
        Tournament Name
      </Typography>
      <TextField
        label="Tournament Name"
        value={name}
        onChange={(e) => onNameChange(e.target.value)}
        disabled={!canEdit || saving}
        fullWidth
        required
        placeholder="e.g., NTLAN 2025 Spring Tournament"
      />
    </Box>
  );
}

