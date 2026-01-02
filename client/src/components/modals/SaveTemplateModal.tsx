import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Button,
  CircularProgress,
  IconButton,
  Typography,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import { api } from '../../utils/api';
import { useSnackbar } from '../../contexts/SnackbarContext';
import type { TournamentSettings } from '../../types/tournament.types';
import { useTranslation } from 'react-i18next';

interface SaveTemplateModalProps {
  open: boolean;
  onClose: () => void;
  onSave: () => void;
  tournamentData: {
    name: string;
    type: string;
    format: string;
    maps: string[];
    mapPoolId?: number | null;
    teamIds?: string[];
    settings?: TournamentSettings;
  };
}

export default function SaveTemplateModal({
  open,
  onClose,
  onSave,
  tournamentData,
}: SaveTemplateModalProps) {
  const { showWarning, showError } = useSnackbar();
  const { t } = useTranslation();
  const [templateName, setTemplateName] = useState('');
  const [templateDescription, setTemplateDescription] = useState('');
  const [saving, setSaving] = useState(false);

  // Initialize template name from tournament name when modal opens
  useEffect(() => {
    if (open && tournamentData.name) {
      setTemplateName(tournamentData.name);
    }
  }, [open, tournamentData.name]);

  const handleSave = async () => {
    if (!templateName.trim()) {
      showWarning(t('saveTemplateModal.errors.nameRequired'));
      return;
    }

    try {
      setSaving(true);
      await api.post('/api/templates', {
        name: templateName,
        description: templateDescription || undefined,
        type: tournamentData.type,
        format: tournamentData.format,
        mapPoolId: tournamentData.mapPoolId,
        maps: tournamentData.maps,
        teamIds: tournamentData.teamIds,
        settings: tournamentData.settings,
      });
      onSave();
      onClose();
      setTemplateName('');
      setTemplateDescription('');
    } catch (err) {
      console.error('Error saving template:', err);
      showError(t('saveTemplateModal.errors.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const handleClose = () => {
    if (!saving) {
      setTemplateName('');
      setTemplateDescription('');
      onClose();
    }
  };

  return (
    <Dialog
      open={open}
      onClose={(_event, reason) => {
        if (reason === 'backdropClick' || reason === 'escapeKeyDown') return;
        handleClose();
      }}
      maxWidth="sm"
      fullWidth
      disableEscapeKeyDown
    >
      <DialogTitle
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <Typography variant="h6" fontWeight={600}>
          {t('saveTemplateModal.title')}
        </Typography>
        <IconButton
          onClick={handleClose}
          size="small"
          aria-label="close"
        >
          <CloseIcon fontSize="small" />
        </IconButton>
      </DialogTitle>
      <DialogContent>
        <TextField
          fullWidth
          label={t('saveTemplateModal.nameLabel')}
          value={templateName}
          onChange={(e) => setTemplateName(e.target.value)}
          margin="normal"
          required
          placeholder={t('saveTemplateModal.namePlaceholder')}
          disabled={saving}
        />
        <TextField
          fullWidth
          label={t('saveTemplateModal.descriptionLabel')}
          value={templateDescription}
          onChange={(e) => setTemplateDescription(e.target.value)}
          margin="normal"
          multiline
          rows={3}
          placeholder={t('saveTemplateModal.descriptionPlaceholder')}
          disabled={saving}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose} disabled={saving}>
          {t('common.cancel')}
        </Button>
        <Button
          onClick={handleSave}
          variant="contained"
          disabled={saving}
          sx={{
            ...(!templateName.trim() && {
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
          ) : (
            t('saveTemplateModal.saveButton')
          )}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

