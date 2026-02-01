import React from 'react';
import { Box, TextField } from '@mui/material';
import { useTranslation } from 'react-i18next';

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
  const { t } = useTranslation();

  return (
    <Box>
      <TextField
        label={t('tournament.nameLabel', 'Tournament Name')}
        value={name}
        onChange={(e) => onNameChange(e.target.value)}
        disabled={!canEdit || saving}
        fullWidth
        required
        placeholder={t('tournament.namePlaceholder', 'MAT 2025 Spring Tournament')}
        slotProps={{
          htmlInput: { 'data-testid': 'tournament-name-input' },
        }}
      />
    </Box>
  );
}

