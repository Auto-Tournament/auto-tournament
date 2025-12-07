import React, { useState, useEffect, useCallback } from 'react';
import { usePageHeader } from '../contexts/PageHeaderContext';
import { useSnackbar } from '../contexts/SnackbarContext';
import {
  Box,
  Typography,
  Card,
  CardContent,
  Button,
  Grid,
  IconButton,
  Chip,
  Stack,
  CircularProgress,
  Tooltip,
  Divider,
} from '@mui/material';
import {
  Delete as DeleteIcon,
  Edit as EditIcon,
  Add as AddIcon,
  Info as InfoIcon,
} from '@mui/icons-material';
import { api } from '../utils/api';
import { EmptyState } from '../components/shared/EmptyState';
import EloTemplateEditorModal from '../components/modals/EloTemplateEditorModal';
import ConfirmDialog from '../components/modals/ConfirmDialog';
import type { EloCalculationTemplate } from '../types/elo.types';

export default function ELOTemplates() {
  const { setHeaderActions } = usePageHeader();
  const { showSuccess, showError } = useSnackbar();
  const [templates, setTemplates] = useState<EloCalculationTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<EloCalculationTemplate | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [templateToDelete, setTemplateToDelete] = useState<EloCalculationTemplate | null>(null);

  const loadTemplates = useCallback(async () => {
    setLoading(true);
    try {
      const response = await api.get<{ success: boolean; templates: EloCalculationTemplate[] }>(
        '/api/elo-templates'
      );
      if (response.success) {
        setTemplates(response.templates);
      } else {
        showError('Failed to load ELO templates');
      }
    } catch (err) {
      const error = err as Error;
      showError(error.message || 'Failed to load ELO templates');
    } finally {
      setLoading(false);
    }
  }, [showError]);

  useEffect(() => {
    document.title = 'ELO Calculation';
    loadTemplates();
  }, [loadTemplates]);

  useEffect(() => {
    setHeaderActions(
      <Button variant="contained" startIcon={<AddIcon />} onClick={() => handleOpenEditor()}>
        Create Template
      </Button>
    );

    return () => {
      setHeaderActions(null);
    };
  }, [setHeaderActions]);

  const handleOpenEditor = (template?: EloCalculationTemplate) => {
    setEditingTemplate(template || null);
    setEditorOpen(true);
  };

  const handleCloseEditor = () => {
    setEditorOpen(false);
    setEditingTemplate(null);
  };

  const handleSaveTemplate = async () => {
    await loadTemplates();
    handleCloseEditor();
  };

  const handleDeleteClick = (template: EloCalculationTemplate) => {
    setTemplateToDelete(template);
    setDeleteDialogOpen(true);
  };

  const handleDeleteConfirm = async () => {
    if (!templateToDelete) return;

    try {
      const response = await api.delete(`/api/elo-templates/${templateToDelete.id}`);
      if (response.success) {
        showSuccess(`Template "${templateToDelete.name}" deleted successfully`);
        await loadTemplates();
      } else {
        showError(response.error || 'Failed to delete template');
      }
    } catch (err) {
      const error = err as Error;
      showError(error.message || 'Failed to delete template');
    } finally {
      setDeleteDialogOpen(false);
      setTemplateToDelete(null);
    }
  };

  const getWeightSummary = (weights: EloCalculationTemplate['weights']): string => {
    const activeWeights = Object.entries(weights)
      .filter(([_, value]) => value !== undefined && value !== 0)
      .map(([key, value]) => `${key}: ${value > 0 ? '+' : ''}${value}`)
      .join(', ');
    return activeWeights || 'No stat adjustments (Pure Win/Loss)';
  };

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box sx={{ width: '100%', height: '100%' }}>
      {templates.length === 0 ? (
        <EmptyState
          icon={InfoIcon}
          title="No ELO Calculation Templates"
          description="Create your first template to customize how player statistics influence ELO adjustments"
          actionLabel="Create Template"
          actionIcon={AddIcon}
          onAction={() => handleOpenEditor()}
        />
      ) : (
        <Grid container spacing={2}>
          {templates.map((template) => (
            <Grid size={{ xs: 12, sm: 6, md: 6 }} key={template.id}>
              <Card
                sx={{
                  height: '100%',
                  display: 'flex',
                  flexDirection: 'column',
                  transition: 'transform 0.2s, box-shadow 0.2s',
                  '&:hover': {
                    transform: 'translateY(-4px)',
                    boxShadow: 6,
                  },
                }}
              >
                <CardContent sx={{ flexGrow: 1 }}>
                  <Box display="flex" justifyContent="space-between" alignItems="start" mb={2}>
                    <Box>
                      <Typography variant="h6" fontWeight={600} gutterBottom>
                        {template.name}
                      </Typography>
                      {template.description && (
                        <Typography variant="body2" color="text.secondary" gutterBottom>
                          {template.description}
                        </Typography>
                      )}
                    </Box>
                    <Box display="flex" gap={1}>
                      {template.id !== 'pure-win-loss' && (
                        <Tooltip title="Edit Template">
                          <IconButton
                            size="small"
                            onClick={() => handleOpenEditor(template)}
                            color="primary"
                          >
                            <EditIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      )}
                      {template.id !== 'pure-win-loss' && (
                        <Tooltip title="Delete Template">
                          <IconButton
                            size="small"
                            onClick={() => handleDeleteClick(template)}
                            color="error"
                          >
                            <DeleteIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      )}
                    </Box>
                  </Box>

                  <Stack spacing={1}>
                    <Box display="flex" alignItems="center" gap={1}>
                      <Chip
                        label={template.enabled ? 'Enabled' : 'Disabled'}
                        color={template.enabled ? 'success' : 'default'}
                        size="small"
                      />
                      {template.id === 'pure-win-loss' && (
                        <Chip label="Default" color="primary" size="small" />
                      )}
                    </Box>

                    <Divider />

                    <Box>
                      <Typography variant="caption" color="text.secondary" display="block" mb={0.5}>
                        Stat Weights:
                      </Typography>
                      <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: '0.75rem' }}>
                        {getWeightSummary(template.weights)}
                      </Typography>
                    </Box>

                    {(template.maxAdjustment !== undefined || template.minAdjustment !== undefined) && (
                      <Box>
                        <Typography variant="caption" color="text.secondary" display="block" mb={0.5}>
                          Adjustment Limits:
                        </Typography>
                        <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: '0.75rem' }}>
                          {template.minAdjustment !== undefined && `Min: ${template.minAdjustment}`}
                          {template.minAdjustment !== undefined &&
                            template.maxAdjustment !== undefined &&
                            ', '}
                          {template.maxAdjustment !== undefined && `Max: ${template.maxAdjustment}`}
                        </Typography>
                      </Box>
                    )}
                  </Stack>
                </CardContent>
              </Card>
            </Grid>
          ))}
        </Grid>
      )}

      <EloTemplateEditorModal
        open={editorOpen}
        template={editingTemplate}
        onClose={handleCloseEditor}
        onSave={handleSaveTemplate}
      />

      <ConfirmDialog
        open={deleteDialogOpen}
        title="Delete ELO Template"
        message={`Are you sure you want to delete "${templateToDelete?.name}"? This action cannot be undone.`}
        confirmLabel="Delete"
        cancelLabel="Cancel"
        onConfirm={handleDeleteConfirm}
        onCancel={() => {
          setDeleteDialogOpen(false);
          setTemplateToDelete(null);
        }}
        severity="error"
      />
    </Box>
  );
}

