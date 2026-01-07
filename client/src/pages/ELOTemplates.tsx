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
import { EloTemplateImportModal } from '../components/modals/EloTemplateImportModal';
import type { EloCalculationTemplate } from '../types/elo.types';
import { useTranslation } from 'react-i18next';

export default function ELOTemplates() {
  const { setHeaderActions } = usePageHeader();
  const { showSuccess, showError } = useSnackbar();
  const [templates, setTemplates] = useState<EloCalculationTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<EloCalculationTemplate | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [templateToDelete, setTemplateToDelete] = useState<EloCalculationTemplate | null>(null);
  const [importModalOpen, setImportModalOpen] = useState(false);
  const { t } = useTranslation();

  const loadTemplates = useCallback(async () => {
    setLoading(true);
    try {
      const response = await api.get<{ success: boolean; templates: EloCalculationTemplate[] }>(
        '/api/elo-templates'
      );
      if (response.success) {
        setTemplates(response.templates);
      } else {
        showError(t('eloTemplatesPage.errors.load'));
      }
    } catch (err) {
      const error = err as Error;
      showError(error.message || t('eloTemplatesPage.errors.load'));
    } finally {
      setLoading(false);
    }
  }, [showError, t]);

  useEffect(() => {
  document.title = t('layout.pageTitle.eloTemplates');
  loadTemplates();
}, [loadTemplates, t]);

  useEffect(() => {
    setHeaderActions(
      <Box display="flex" gap={1}>
        <Button
          variant="contained"
          size="small"
          startIcon={<AddIcon />}
          onClick={() => handleOpenEditor()}
        >
        {t('eloTemplatesPage.header.createTemplate')}
        </Button>
        <Button variant="outlined" size="small" onClick={() => setImportModalOpen(true)}>
        {t('eloTemplatesPage.header.importJson')}
        </Button>
      </Box>
    );

    return () => {
      setHeaderActions(null);
    };
}, [setHeaderActions, t]);

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
    // Protect the built-in default template from deletion
    if (template.id === 'pure-win-loss') {
      showError(t('eloTemplatesPage.delete.defaultProtected'));
      return;
    }
    setTemplateToDelete(template);
    setDeleteDialogOpen(true);
  };

  const handleDeleteConfirm = async () => {
    if (!templateToDelete) return;

    try {
      const response = await api.delete(`/api/elo-templates/${templateToDelete.id}`);
      if (response.success) {
        showSuccess(
          t('eloTemplatesPage.delete.success', { name: templateToDelete.name })
        );
        await loadTemplates();
      } else {
        showError(response.error || t('eloTemplatesPage.delete.error'));
      }
    } catch (err) {
      const error = err as Error;
      showError(error.message || t('eloTemplatesPage.delete.error'));
    } finally {
      setDeleteDialogOpen(false);
      setTemplateToDelete(null);
    }
  };

  const handleImportTemplates = async (
    importedTemplates: Array<{
      id?: string;
      name: string;
      description?: string;
      enabled?: boolean;
      weights?: EloCalculationTemplate['weights'];
      maxAdjustment?: number;
      minAdjustment?: number;
    }>
  ) => {
    // Import each template via the existing POST /api/elo-templates endpoint
    const promises = importedTemplates.map((tpl) =>
      api.post('/api/elo-templates', {
        id: tpl.id,
        name: tpl.name,
        description: tpl.description,
        enabled: tpl.enabled,
        weights: tpl.weights,
        maxAdjustment: tpl.maxAdjustment,
        minAdjustment: tpl.minAdjustment,
      })
    );

    await Promise.all(promises);
    showSuccess(
      t('eloTemplatesPage.import.success', { count: importedTemplates.length })
    );
    await loadTemplates();
  };

  const getWeightSummary = (weights: EloCalculationTemplate['weights']): string => {
    const activeWeights = Object.entries(weights)
      .filter(([_, value]) => value !== undefined && value !== 0)
      .map(([key, value]) => `${key}: ${value > 0 ? '+' : ''}${value}`)
      .join(', ');
    return activeWeights || t('eloTemplatesPage.weights.noAdjustmentsPure');
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
          title={t('eloTemplatesPage.empty.title')}
          description={t('eloTemplatesPage.empty.description')}
          actionLabel={t('eloTemplatesPage.empty.action')}
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
                      <Typography variant="caption" color="text.secondary" display="block">
                        {template.id === 'pure-win-loss'
                          ? t('eloTemplatesPage.card.adjustment.none')
                          : template.minAdjustment === undefined &&
                            template.maxAdjustment === undefined
                          ? t('eloTemplatesPage.card.adjustment.uncapped')
                          : t('eloTemplatesPage.card.adjustment.range', {
                              min:
                                template.minAdjustment !== undefined
                                  ? template.minAdjustment
                                  : t('eloTemplatesPage.card.adjustment.noMin'),
                              max:
                                template.maxAdjustment !== undefined
                                  ? template.maxAdjustment
                                  : t('eloTemplatesPage.card.adjustment.noMax'),
                            })}
                      </Typography>
                    </Box>
                    <Box display="flex" gap={1}>
                      {template.id !== 'pure-win-loss' && (
                        <Tooltip title={t('eloTemplatesPage.card.tooltips.edit')}>
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
                        <Tooltip title={t('eloTemplatesPage.card.tooltips.delete')}>
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
                        label={
                          template.enabled
                            ? t('eloTemplatesPage.card.enabled')
                            : t('eloTemplatesPage.card.disabled')
                        }
                        color={template.enabled ? 'success' : 'default'}
                        size="small"
                      />
                      {template.id === 'pure-win-loss' && (
                        <Chip
                          label={t('eloTemplatesPage.card.default')}
                          color="primary"
                          size="small"
                        />
                      )}
                    </Box>

                    <Divider />

                    <Box>
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        display="block"
                        mb={0.5}
                      >
                        {t('eloTemplatesPage.card.weightsTitle')}
                      </Typography>
                      <Typography
                        variant="body2"
                        sx={{ fontFamily: 'monospace', fontSize: '0.75rem' }}
                      >
                        {getWeightSummary(template.weights)}
                      </Typography>
                    </Box>

                    {(template.maxAdjustment !== undefined ||
                      template.minAdjustment !== undefined) && (
                      <Box>
                        <Typography
                          variant="caption"
                          color="text.secondary"
                          display="block"
                          mb={0.5}
                        >
                          {t('eloTemplatesPage.card.limitsTitle')}
                        </Typography>
                        <Typography
                          variant="body2"
                          sx={{ fontFamily: 'monospace', fontSize: '0.75rem' }}
                        >
                          {template.minAdjustment !== undefined &&
                            `Min: ${template.minAdjustment}`}
                          {template.minAdjustment !== undefined &&
                            template.maxAdjustment !== undefined &&
                            ', '}
                          {template.maxAdjustment !== undefined &&
                            `Max: ${template.maxAdjustment}`}
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
        title={t('eloTemplatesPage.delete.title')}
        message={t('eloTemplatesPage.delete.message', {
          name: templateToDelete?.name ?? '',
        })}
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        onConfirm={handleDeleteConfirm}
        onCancel={() => {
          setDeleteDialogOpen(false);
          setTemplateToDelete(null);
        }}
        severity="error"
      />

      <EloTemplateImportModal
        open={importModalOpen}
        onClose={() => setImportModalOpen(false)}
        onImport={handleImportTemplates}
      />
    </Box>
  );
}

