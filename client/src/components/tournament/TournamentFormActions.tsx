import { Box, Button, Tooltip, CircularProgress } from '@mui/material';
import { DeleteForever as DeleteForeverIcon, Save as SaveIcon } from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
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
  const { t } = useTranslation();
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
      showWarning(t('tournament.toasts.noChangesToSave'));
      // Nothing to regenerate: the bracket already matches the saved settings,
      // so leave the wizard for the tournament view instead of staying put.
      if (tournamentExists) onCancel?.();
      return;
    }
    if (!isValidMaps) {
      showWarning(mapValidation.message || t('tournament.toasts.invalidMapSelection'));
      return;
    }
    onSave();
  };

  const handleSaveTemplate = () => {
    if (!isValidMaps) {
      showWarning(mapValidation.message || t('tournament.toasts.invalidMapSelection'));
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
        {tournamentExists && (
          <Tooltip title={t('tournament.tooltips.deleteTournament')} enterDelay={500}>
            <Button
              variant="outlined"
              color="error"
              startIcon={<DeleteForeverIcon />}
              onClick={onDelete}
              disabled={saving}
            >
              {t('common.delete')}
            </Button>
          </Tooltip>
        )}
        {onSaveTemplate && (
          <Tooltip title={t('tournament.formActions.saveTemplateTooltip')} enterDelay={500}>
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
              {t('tournament.formActions.saveAsTemplate')}
            </Button>
          </Tooltip>
        )}
      </Box>
    </>
  );
}

