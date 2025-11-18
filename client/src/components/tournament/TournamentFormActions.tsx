import React from 'react';
import { Box, Button, Tooltip, CircularProgress } from '@mui/material';
import { DeleteForever as DeleteForeverIcon } from '@mui/icons-material';

interface TournamentFormActionsProps {
  tournamentExists: boolean;
  saving: boolean;
  hasChanges: boolean;
  format: string;
  mapsCount: number;
  canEdit: boolean;
  onSave: () => void;
  onCancel?: () => void;
  onDelete: () => void;
}

export function TournamentFormActions({
  tournamentExists,
  saving,
  hasChanges,
  format,
  mapsCount,
  canEdit,
  onSave,
  onCancel,
  onDelete,
}: TournamentFormActionsProps) {
  if (!canEdit) {
    return null;
  }

  const isVetoFormat = ['bo1', 'bo3', 'bo5'].includes(format);
  const isValidMaps = isVetoFormat ? mapsCount === 7 : mapsCount > 0;

  return (
    <>
      <Box display="flex" gap={2} flexWrap="wrap">
        <Button
          variant="contained"
          onClick={onSave}
          disabled={saving || !hasChanges || !isValidMaps}
          size="large"
          sx={{ flex: 1, minWidth: 200 }}
        >
          {saving ? (
            <CircularProgress size={24} />
          ) : tournamentExists ? (
            'Save & Generate Brackets'
          ) : (
            'Create Tournament'
          )}
        </Button>
        {tournamentExists && onCancel && (
          <Button variant="outlined" onClick={onCancel} disabled={saving}>
            Cancel
          </Button>
        )}
        {tournamentExists && (
          <Tooltip title="Permanently delete this tournament and all its data">
            <Button
              variant="outlined"
              color="error"
              startIcon={<DeleteForeverIcon />}
              onClick={onDelete}
              disabled={saving}
            >
              Delete
            </Button>
          </Tooltip>
        )}
      </Box>
    </>
  );
}

