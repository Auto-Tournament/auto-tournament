import { Box, Button, Tooltip, CircularProgress } from '@mui/material';
import { FloppyDiskIcon, TrashIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { useSnackbar } from '../../contexts/SnackbarContext';

interface TournamentFormActionsProps {
  tournamentExists: boolean;
  saving: boolean;
  hasChanges: boolean;
  /**
   * Why the game's own settings cannot be saved yet, from its module (CS2: a
   * map pool that does not fit the format), or null. A game with no settings
   * of its own — a manually reported one — never has one (3.0 item 8b).
   */
  settingsError?: string | null;
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
  settingsError = null,
  canEdit,
  onSave,
  onCancel,
  onDelete,
  onSaveTemplate,
}: TournamentFormActionsProps) {
  const { t } = useTranslation();
  const { showWarning } = useSnackbar();

  if (!canEdit) {
    return null;
  }

  const isValidMaps = settingsError === null;

  const handleSave = () => {
    if (!hasChanges) {
      showWarning(t('tournament.toasts.noChangesToSave'));
      // Nothing to regenerate: the bracket already matches the saved settings,
      // so leave the wizard for the tournament view instead of staying put.
      if (tournamentExists) onCancel?.();
      return;
    }
    if (!isValidMaps) {
      showWarning(settingsError || t('tournament.toasts.invalidMapSelection'));
      return;
    }
    onSave();
  };

  const handleSaveTemplate = () => {
    if (!isValidMaps) {
      showWarning(settingsError || t('tournament.toasts.invalidMapSelection'));
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
            t('tournament.formActions.saveAndGenerate')
          ) : (
            t('tournament.common.createTournament')
          )}
        </Button>
        {tournamentExists && onCancel && (
          <Button variant="outlined" onClick={onCancel} disabled={saving}>
            {t('common.cancel')}
          </Button>
        )}
        {onSaveTemplate && (
          <Tooltip title={t('tournament.formActions.saveTemplateTooltip')} enterDelay={500}>
            <Button
              variant="outlined"
              startIcon={<FloppyDiskIcon />}
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
              {t('tournament.formActions.saveAsTemplate')}
            </Button>
          </Tooltip>
        )}
        {/* Delete sits apart, at the far end of the row: it was between
            Cancel and "Save as template", one slip from the save buttons. */}
        {tournamentExists && (
          <Tooltip title={t('tournament.tooltips.deleteTournament')} enterDelay={500}>
            <Button
              variant="outlined"
              color="error"
              startIcon={<TrashIcon />}
              onClick={onDelete}
              disabled={saving}
              sx={{ ml: { sm: 'auto' } }}
            >
              {t('common.delete')}
            </Button>
          </Tooltip>
        )}
      </Box>
    </>
  );
}

