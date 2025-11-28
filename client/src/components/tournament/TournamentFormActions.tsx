import React, { useState } from 'react';
import {
  Box,
  Button,
  Tooltip,
  CircularProgress,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
} from '@mui/material';
import { DeleteForever as DeleteForeverIcon, Save as SaveIcon } from '@mui/icons-material';
import { api } from '../../utils/api';

interface TournamentFormActionsProps {
  tournamentExists: boolean;
  saving: boolean;
  hasChanges: boolean;
  format: string;
  mapsCount: number;
  canEdit: boolean;
  name: string;
  type: string;
  maps: string[];
  settings?: any;
  mapPoolId?: number | null;
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
  name,
  type,
  maps,
  settings,
  mapPoolId,
  onSave,
  onCancel,
  onDelete,
}: TournamentFormActionsProps) {
  const [saveTemplateDialogOpen, setSaveTemplateDialogOpen] = useState(false);
  const [templateName, setTemplateName] = useState('');
  const [templateDescription, setTemplateDescription] = useState('');
  const [savingTemplate, setSavingTemplate] = useState(false);

  if (!canEdit) {
    return null;
  }

  const isVetoFormat = ['bo1', 'bo3', 'bo5'].includes(format);
  const isValidMaps = isVetoFormat ? mapsCount === 7 : mapsCount > 0;

  const handleSaveTemplate = async () => {
    if (!templateName.trim()) return;

    try {
      setSavingTemplate(true);
      await api.post('/api/templates', {
        name: templateName,
        description: templateDescription || undefined,
        type,
        format,
        mapPoolId,
        maps,
        settings,
      });
      setSaveTemplateDialogOpen(false);
      setTemplateName('');
      setTemplateDescription('');
      // Show success message (you might want to add a toast/alert here)
      alert('Template saved successfully!');
    } catch (error) {
      console.error('Error saving template:', error);
      alert('Failed to save template');
    } finally {
      setSavingTemplate(false);
    }
  };

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
        <Tooltip title="Save current tournament configuration as a template">
          <Button
            variant="outlined"
            startIcon={<SaveIcon />}
            onClick={() => {
              setTemplateName(name || '');
              setSaveTemplateDialogOpen(true);
            }}
            disabled={saving || !isValidMaps}
          >
            Save as Template
          </Button>
        </Tooltip>
      </Box>

      {/* Save Template Dialog */}
      <Dialog open={saveTemplateDialogOpen} onClose={() => setSaveTemplateDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Save as Template</DialogTitle>
        <DialogContent>
          <TextField
            fullWidth
            label="Template Name"
            value={templateName}
            onChange={(e) => setTemplateName(e.target.value)}
            margin="normal"
            required
            placeholder="e.g., 8-team Single Elim BO3"
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
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSaveTemplateDialogOpen(false)} disabled={savingTemplate}>
            Cancel
          </Button>
          <Button
            onClick={handleSaveTemplate}
            variant="contained"
            disabled={!templateName.trim() || savingTemplate}
          >
            {savingTemplate ? <CircularProgress size={24} /> : 'Save Template'}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}

