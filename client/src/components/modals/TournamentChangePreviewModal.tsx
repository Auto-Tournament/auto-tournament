import React from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Box,
  Typography,
  Chip,
  Divider,
  Alert,
} from '@mui/material';
import { ArrowsLeftRightIcon, WarningIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { useSnackbar } from '../../contexts/SnackbarContext';
import { radii } from '../../theme/tokens';

interface ChangeItem {
  field: string;
  oldValue: string | string[];
  newValue: string | string[];
  label: string;
}

interface TournamentChangePreviewModalProps {
  open: boolean;
  changes: ChangeItem[];
  isLive: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

const TournamentChangePreviewModal: React.FC<TournamentChangePreviewModalProps> = ({
  open,
  changes,
  isLive,
  onConfirm,
  onCancel,
}) => {
  const { t } = useTranslation();
  const { showWarning } = useSnackbar();

  const handleConfirm = () => {
    if (changes.length === 0) {
      showWarning(t('tournament.changePreview.noChangesToApply'));
      return;
    }
    onConfirm();
  };
  const formatValue = (value: string | string[]): string => {
    if (Array.isArray(value)) {
      if (value.length === 0) return t('tournament.changePreview.none');
      if (value.length <= 3) return value.join(', ');
      return t('tournament.changePreview.itemCount', { count: value.length });
    }
    return value || t('tournament.review.summary.notSet');
  };

  const hasStructuralChanges = changes.some(
    (c) =>
      c.field === 'type' ||
      c.field === 'format' ||
      c.field === 'teamIds' ||
      c.field === 'grandFinalMode'
  );

  return (
    <Dialog open={open} onClose={onCancel} maxWidth="sm" fullWidth>
      <DialogTitle>
        <Box display="flex" alignItems="center" gap={1.5}>
          <Box component={ArrowsLeftRightIcon} sx={{ color: 'primary.main' }} />
          <Typography variant="h6" fontWeight={600}>
            {t('tournament.changePreview.title')}
          </Typography>
        </Box>
      </DialogTitle>
      <DialogContent>
        {isLive && hasStructuralChanges && (
          <Alert severity="error" sx={{ mb: 2 }} icon={<WarningIcon />}>
            <Typography variant="body2" fontWeight={600} gutterBottom>
              {t('tournament.changePreview.liveHeading')}
            </Typography>
            <Typography variant="caption">{t('tournament.changePreview.liveBody')}</Typography>
          </Alert>
        )}

        {changes.length === 0 ? (
          <Typography variant="body2" color="text.secondary" align="center" py={3}>
            {t('tournament.changePreview.noChangesDetected')}
          </Typography>
        ) : (
          <Box>
            <Typography variant="caption" color="text.secondary" display="block" mb={2}>
              {t('tournament.changePreview.intro')}
            </Typography>

            {changes.map((change, index) => (
              <Box key={change.field} mb={2}>
                <Box
                  sx={{
                    p: 2,
                    borderRadius: radii.md,
                    bgcolor: 'action.hover',
                    border: '1px solid',
                    borderColor: 'divider',
                  }}
                >
                  <Typography
                    variant="caption"
                    fontWeight={600}
                    color="primary"
                    display="block"
                    mb={1.5}
                  >
                    {change.label}
                  </Typography>

                  {/* Old Value */}
                  <Box display="flex" alignItems="center" gap={1} mb={1}>
                    <Chip
                      label={t('tournament.changePreview.before')}
                      size="small"
                      sx={{
                        bgcolor: 'error.light',
                        color: 'error.contrastText',
                        fontWeight: 600,
                        fontSize: '0.65rem',
                        height: 20,
                      }}
                    />
                    <Typography
                      variant="body2"
                      sx={{
                        fontFamily: 'monospace',
                        textDecoration: 'line-through',
                        color: 'text.secondary',
                      }}
                    >
                      {formatValue(change.oldValue)}
                    </Typography>
                  </Box>

                  {/* New Value */}
                  <Box display="flex" alignItems="center" gap={1}>
                    <Chip
                      label={t('tournament.changePreview.after')}
                      size="small"
                      sx={{
                        bgcolor: 'success.light',
                        color: 'success.contrastText',
                        fontWeight: 600,
                        fontSize: '0.65rem',
                        height: 20,
                      }}
                    />
                    <Typography
                      variant="body2"
                      fontWeight={600}
                      sx={{
                        fontFamily: 'monospace',
                      }}
                    >
                      {formatValue(change.newValue)}
                    </Typography>
                  </Box>
                </Box>
                {index < changes.length - 1 && <Divider sx={{ my: 2 }} />}
              </Box>
            ))}
          </Box>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5 }}>
        <Button
          onClick={handleConfirm}
          variant="contained"
          color={isLive && hasStructuralChanges ? 'warning' : 'primary'}
          autoFocus
          sx={{
            ml: 'auto',
            ...(changes.length === 0 && {
              bgcolor: 'action.disabledBackground',
              color: 'action.disabled',
              '&:hover': {
                bgcolor: 'action.disabledBackground',
              },
            }),
          }}
        >
          {isLive && hasStructuralChanges
            ? t('tournament.changePreview.applyRisky')
            : t('tournament.changePreview.apply')}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default TournamentChangePreviewModal;
