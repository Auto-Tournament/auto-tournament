import React from 'react';
import { Box, Button, Tooltip, CircularProgress } from '@mui/material';
import { DeleteForever as DeleteForeverIcon, Save as SaveIcon } from '@mui/icons-material';
import { validateMapCount } from '../../utils/tournamentVerification';
import { useSnackbar } from '../../contexts/SnackbarContext';

interface TournamentFormActionsProps {
  tournamentExists: boolean;
  saving: boolean;
  hasChanges: boolean;
  type: string;
  format: string;
  mapsCount: number;
  canEdit: boolean;
  onSave: () => void;
  onCancel?: () => void;
  onDelete: () => void;
  onSaveTemplate?: () => void;
}

export function TournamentFormActions({
  tournamentExists,
  saving,
  hasChanges,
  type,
  format,
  mapsCount,
  canEdit,
  onSave,
  onCancel,
  onDelete,
  onSaveTemplate,
}: TournamentFormActionsProps) {
  const { showWarning } = useSnackbar();

  if (!canEdit) {
    return null;
  }

  // Use verification rules system - create dummy array for validation
  const dummyMaps = Array(mapsCount).fill('dummy');
  const mapValidation = validateMapCount(dummyMaps, type, format);
  const isValidMaps = mapValidation.valid;

  const handleSave = () => {
    if (!hasChanges) {
      showWarning('No changes to save');
      return;
    }
    if (!isValidMaps) {
      showWarning(mapValidation.message || 'Invalid map selection');
      return;
    }
    onSave();
  };

  const handleSaveTemplate = () => {
    if (!isValidMaps) {
      showWarning(mapValidation.message || 'Invalid map selection');
      return;
    }
    onSaveTemplate?.();
  };

  return (
    <>
      <Box display="flex" gap={2} flexWrap="wrap">
        <Button
          data-testid="tournament-save-button"
          variant="contained"
          onClick={handleSave}
          disabled={saving}
          size="large"
          sx={{
            flex: 1,
            minWidth: 200,
            ...((!hasChanges || !isValidMaps) && {
              bgcolor: 'action.disabledBackground',
              color: 'action.disabled',
              '&:hover': {
                bgcolor: 'action.disabledBackground',
              },
            }),
          }}
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
          <Tooltip title="Permanently delete this tournament and all its data" enterDelay={500}>
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
        {onSaveTemplate && (
          <Tooltip title="Save current tournament configuration as a template" enterDelay={500}>
            <Button
              variant="outlined"
              startIcon={<SaveIcon />}
              onClick={handleSaveTemplate}
              disabled={saving}
              sx={{
                ...(!isValidMaps && {
                  bgcolor: 'action.disabledBackground',
                  color: 'action.disabled',
                  borderColor: 'action.disabled',
                  '&:hover': {
                    bgcolor: 'action.disabledBackground',
                    borderColor: 'action.disabled',
                  },
                }),
              }}
            >
              Save as Template
            </Button>
          </Tooltip>
        )}
      </Box>
    </>
  );
}

