import React, { useState } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  Alert,
  Typography,
  Box,
  Chip,
  Stack,
  Paper,
  IconButton,
  Collapse,
} from '@mui/material';
import {
  Close as CloseIcon,
  CheckCircle as CheckCircleIcon,
  Info as InfoIcon,
  ExpandMore as ExpandMoreIcon,
  ExpandLess as ExpandLessIcon,
} from '@mui/icons-material';
import { useSnackbar } from '../../contexts/SnackbarContext';
import type { EloTemplateWeights } from '../../types/elo.types';

interface ImportTemplate {
  id?: string;
  name: string;
  description?: string;
  enabled?: boolean;
  weights?: EloTemplateWeights;
  maxAdjustment?: number;
  minAdjustment?: number;
}

interface EloTemplateImportModalProps {
  open: boolean;
  onClose: () => void;
  onImport: (templates: ImportTemplate[]) => Promise<void>;
}

export const EloTemplateImportModal: React.FC<EloTemplateImportModalProps> = ({
  open,
  onClose,
  onImport,
}) => {
  const { showError } = useSnackbar();
  const [jsonInput, setJsonInput] = useState('');
  const [parsedTemplates, setParsedTemplates] = useState<ImportTemplate[] | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [expandedItems, setExpandedItems] = useState<Set<number>>(new Set());

  const handleClose = () => {
    setJsonInput('');
    setParsedTemplates(null);
    setValidationError(null);
    setExpandedItems(new Set());
    onClose();
  };

  const validateTemplate = (template: any, index: number): string | null => {
    if (!template || typeof template !== 'object') {
      return `Template ${index + 1}: Must be an object`;
    }

    if (!template.name || typeof template.name !== 'string' || template.name.trim() === '') {
      return `Template ${index + 1}: Missing or invalid "name"`;
    }

    if (template.id !== undefined && typeof template.id !== 'string') {
      return `Template "${template.name}": "id" must be a string if provided`;
    }

    if (template.description !== undefined && typeof template.description !== 'string') {
      return `Template "${template.name}": "description" must be a string if provided`;
    }

    if (template.enabled !== undefined && typeof template.enabled !== 'boolean') {
      return `Template "${template.name}": "enabled" must be a boolean if provided`;
    }

    if (template.weights !== undefined) {
      if (typeof template.weights !== 'object' || Array.isArray(template.weights)) {
        return `Template "${template.name}": "weights" must be an object if provided`;
      }
      for (const [key, value] of Object.entries(template.weights)) {
        if (value !== undefined && typeof value !== 'number') {
          return `Template "${template.name}": Weight "${key}" must be a number`;
        }
      }
    }

    const checkNumber = (field: string, label: string) => {
      if (template[field] !== undefined && typeof template[field] !== 'number') {
        return `Template "${template.name}": "${label}" must be a number if provided`;
      }
      return null;
    };

    const maxErr = checkNumber('maxAdjustment', 'maxAdjustment');
    if (maxErr) return maxErr;
    const minErr = checkNumber('minAdjustment', 'minAdjustment');
    if (minErr) return minErr;

    return null;
  };

  const handlePreview = () => {
    setValidationError(null);
    setParsedTemplates(null);

    try {
      const parsed = JSON.parse(jsonInput);

      if (!Array.isArray(parsed)) {
        setValidationError('JSON must be an array of templates');
        return;
      }

      if (parsed.length === 0) {
        setValidationError('Array cannot be empty');
        return;
      }

      for (let i = 0; i < parsed.length; i++) {
        const validationErr = validateTemplate(parsed[i], i);
        if (validationErr) {
          setValidationError(validationErr);
          return;
        }
      }

      setParsedTemplates(parsed);
    } catch (err) {
      setValidationError(
        err instanceof Error
          ? `JSON Parse Error: ${err.message}`
          : 'Invalid JSON format. Please check your syntax.'
      );
    }
  };

  const handleImport = async () => {
    if (!parsedTemplates) return;

    setImporting(true);
    try {
      await onImport(parsedTemplates);
      handleClose();
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Failed to import ELO templates');
    } finally {
      setImporting(false);
    }
  };

  const toggleExpanded = (index: number) => {
    const next = new Set(expandedItems);
    if (next.has(index)) {
      next.delete(index);
    } else {
      next.add(index);
    }
    setExpandedItems(next);
  };

  const getWeightSummary = (weights?: EloTemplateWeights): string => {
    if (!weights) return 'No stat adjustments (all weights 0 or undefined)';
    const active = Object.entries(weights)
      .filter(([_, value]) => value !== undefined && value !== 0)
      .map(([key, value]) => `${key}: ${value! > 0 ? '+' : ''}${value}`)
      .join(', ');
    return active || 'No stat adjustments (all weights 0 or undefined)';
  };

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="md" fullWidth>
      <DialogTitle>
        <Box display="flex" alignItems="center" justifyContent="space-between">
          <Typography variant="h6" fontWeight={600}>
            Import ELO Templates from JSON
          </Typography>
          <IconButton onClick={handleClose} size="small">
            <CloseIcon />
          </IconButton>
        </Box>
      </DialogTitle>

      <DialogContent dividers sx={{ px: 3, pt: 2, pb: 1 }}>
        <Stack spacing={3}>
          <Alert severity="info" icon={<InfoIcon />}>
            <Typography variant="body2" gutterBottom>
              <strong>Paste JSON with ELO template definitions below.</strong>
            </Typography>
            <Typography variant="caption" component="div">
              Expected format: array of templates with <code>name</code>, optional{' '}
              <code>description</code>, <code>enabled</code>, <code>weights</code>,{' '}
              <code>maxAdjustment</code>, and <code>minAdjustment</code>. If you omit{' '}
              <code>id</code>, it will be generated from the name.
            </Typography>
          </Alert>

          <TextField
            label="JSON Data"
            multiline
            rows={12}
            value={jsonInput}
            onChange={(e) => setJsonInput(e.target.value)}
            placeholder={`[\n  {\n    "id": "balanced-stats-v1",\n    "name": "Balanced Stats v1",\n    "description": "Custom stat-based template",\n    "enabled": true,\n    "weights": {\n      "kills": 0.4,\n      "deaths": -0.4,\n      "adr": 0.05\n    },\n    "maxAdjustment": 40,\n    "minAdjustment": -40\n  }\n]`}
            fullWidth
            disabled={importing}
            error={!!validationError}
            helperText={validationError}
            sx={{
              '& .MuiInputBase-input': {
                fontFamily: 'monospace',
                fontSize: '0.875rem',
              },
            }}
          />

          {parsedTemplates && parsedTemplates.length > 0 && (
            <Box>
              <Alert severity="success" icon={<CheckCircleIcon />} sx={{ mb: 2 }}>
                <Typography variant="body2">
                  <strong>✓ Valid JSON!</strong> Found {parsedTemplates.length} template
                  {parsedTemplates.length !== 1 ? 's' : ''}.
                </Typography>
              </Alert>

              <Typography variant="subtitle2" fontWeight={600} mb={1}>
                Preview:
              </Typography>

              <Stack spacing={1}>
                {parsedTemplates.map((tpl, index) => (
                  <Paper key={index} variant="outlined" sx={{ overflow: 'hidden' }}>
                    <Box
                      display="flex"
                      alignItems="center"
                      justifyContent="space-between"
                      p={2}
                      sx={{
                        cursor: 'pointer',
                        '&:hover': { bgcolor: 'action.hover' },
                      }}
                      onClick={() => toggleExpanded(index)}
                    >
                      <Box display="flex" alignItems="center" gap={1}>
                        <Typography variant="body1" fontWeight={600}>
                          {tpl.name}
                        </Typography>
                        {tpl.id && <Chip label={tpl.id} size="small" />}
                        <Chip
                          label={tpl.enabled === false ? 'Disabled' : 'Enabled'}
                          size="small"
                          color={tpl.enabled === false ? 'default' : 'success'}
                        />
                      </Box>
                      <IconButton size="small">
                        {expandedItems.has(index) ? <ExpandLessIcon /> : <ExpandMoreIcon />}
                      </IconButton>
                    </Box>
                    <Collapse in={expandedItems.has(index)}>
                      <Box px={2} pb={2}>
                        {tpl.description && (
                          <Typography variant="body2" color="text.secondary" mb={1}>
                            {tpl.description}
                          </Typography>
                        )}
                        <Typography
                          variant="caption"
                          color="text.secondary"
                          display="block"
                          mb={0.5}
                        >
                          Stat Weights:
                        </Typography>
                        <Typography
                          variant="body2"
                          sx={{ fontFamily: 'monospace', fontSize: '0.75rem' }}
                        >
                          {getWeightSummary(tpl.weights)}
                        </Typography>
                        {(tpl.maxAdjustment !== undefined || tpl.minAdjustment !== undefined) && (
                          <Box mt={1}>
                            <Typography
                              variant="caption"
                              color="text.secondary"
                              display="block"
                              mb={0.5}
                            >
                              Adjustment Limits:
                            </Typography>
                            <Typography
                              variant="body2"
                              sx={{ fontFamily: 'monospace', fontSize: '0.75rem' }}
                            >
                              {tpl.minAdjustment !== undefined && `Min: ${tpl.minAdjustment}`}
                              {tpl.minAdjustment !== undefined &&
                                tpl.maxAdjustment !== undefined &&
                                ', '}
                              {tpl.maxAdjustment !== undefined && `Max: ${tpl.maxAdjustment}`}
                            </Typography>
                          </Box>
                        )}
                      </Box>
                    </Collapse>
                  </Paper>
                ))}
              </Stack>
            </Box>
          )}
        </Stack>
      </DialogContent>

      <DialogActions>
        <Button onClick={handleClose} disabled={importing}>
          Cancel
        </Button>
        <Button onClick={handlePreview} disabled={importing}>
          Preview
        </Button>
        <Button
          variant="contained"
          onClick={handleImport}
          disabled={importing || !parsedTemplates || parsedTemplates.length === 0}
        >
          Import Templates
        </Button>
      </DialogActions>
    </Dialog>
  );
}


