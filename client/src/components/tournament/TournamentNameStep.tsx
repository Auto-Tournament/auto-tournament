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
            <TextField
              label="Tournament Name"
              value={name}
              onChange={(e) => onNameChange(e.target.value)}
              disabled={!canEdit || saving}
              fullWidth
              required
              placeholder="NTLAN 2025 Spring Tournament"
              inputProps={{ 'data-testid': 'tournament-name-input' }}
            />
    </Box>
  );
}

