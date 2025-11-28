import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Button,
  CircularProgress,
  Alert,
} from '@mui/material';
import { api } from '../../utils/api';
import type { TournamentSettings } from '../../types/tournament.types';

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
    settings?: TournamentSettings;
  };
}

export default function SaveTemplateModal({
  open,
  onClose,
  onSave,
  tournamentData,
}: SaveTemplateModalProps) {
  const [templateName, setTemplateName] = useState('');
  const [templateDescription, setTemplateDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Initialize template name from tournament name when modal opens
  useEffect(() => {
    if (open && tournamentData.name) {
      setTemplateName(tournamentData.name);
    }
  }, [open, tournamentData.name]);

  const handleSave = async () => {
    if (!templateName.trim()) {
      setError('Template name is required');
      return;
    }

    try {
      setSaving(true);
      setError(null);
      await api.post('/api/templates', {
        name: templateName,
        description: templateDescription || undefined,
        type: tournamentData.type,
        format: tournamentData.format,
        mapPoolId: tournamentData.mapPoolId,
        maps: tournamentData.maps,
        settings: tournamentData.settings,
      });
      onSave();
      onClose();
      setTemplateName('');
      setTemplateDescription('');
    } catch (err) {
      console.error('Error saving template:', err);
      setError('Failed to save template');
    } finally {
      setSaving(false);
    }
  };

  const handleClose = () => {
    if (!saving) {
      setTemplateName('');
      setTemplateDescription('');
      setError(null);
      onClose();
    }
  };

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
      <DialogTitle>Save as Template</DialogTitle>
      <DialogContent>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
            {error}
          </Alert>
        )}
        <TextField
          fullWidth
          label="Template Name"
          value={templateName}
          onChange={(e) => setTemplateName(e.target.value)}
          margin="normal"
          required
          placeholder="e.g., 8-team Single Elim BO3"
          disabled={saving}
        />
        <TextField
          fullWidth
          label="Description (optional)"
          value={templateDescription}
          onChange={(e) => setTemplateDescription(e.target.value)}
          margin="normal"
          multiline
          rows={3}
          placeholder="e.g., Weekly 8-team single elimination tournament"
          disabled={saving}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose} disabled={saving}>
          Cancel
        </Button>
        <Button
          onClick={handleSave}
          variant="contained"
          disabled={!templateName.trim() || saving}
        >
          {saving ? <CircularProgress size={24} /> : 'Save Template'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

