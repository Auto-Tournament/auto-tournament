import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  Box,
  Typography,
  Switch,
  FormControlLabel,
  Divider,
  Stack,
  Slider,
  Grid,
  Alert,
  IconButton,
  CircularProgress,
} from '@mui/material';
import { Close as CloseIcon, Info as InfoIcon } from '@mui/icons-material';
import { api } from '../../utils/api';
import { useSnackbar } from '../../contexts/SnackbarContext';
import type {
  EloCalculationTemplate,
  EloTemplateWeights,
  CreateEloTemplateInput,
  UpdateEloTemplateInput,
} from '../../types/elo.types';
import { useTranslation } from 'react-i18next';

interface EloTemplateEditorModalProps {
  open: boolean;
  template: EloCalculationTemplate | null;
  onClose: () => void;
  onSave: () => void;
}

const STAT_LABELS: Record<keyof EloTemplateWeights, string> = {
  kills: 'Kills',
  deaths: 'Deaths',
  assists: 'Assists',
  flashAssists: 'Flash Assists',
  headshotKills: 'Headshot Kills',
  damage: 'Damage',
  utilityDamage: 'Utility Damage',
  kast: 'KAST %',
  mvps: 'MVPs',
  score: 'Score',
  adr: 'ADR',
};

const STAT_DESCRIPTIONS: Record<keyof EloTemplateWeights, string> = {
  kills: 'Number of kills per match',
  deaths: 'Number of deaths per match (typically negative weight)',
  assists: 'Number of assists per match',
  flashAssists: 'Number of flash assists per match',
  headshotKills: 'Number of headshot kills per match',
  damage: 'Total damage dealt per match',
  utilityDamage: 'Damage dealt with utility (grenades)',
  kast: 'Percentage of rounds with Kill, Assist, Survive, or Trade',
  mvps: 'Number of MVP awards per match',
  score: 'Match score (combines multiple factors)',
  adr: 'Average Damage per Round',
};

export default function EloTemplateEditorModal({
  open,
  template,
  onClose,
  onSave,
}: EloTemplateEditorModalProps) {
  const { showSuccess, showError, showWarning } = useSnackbar();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [weights, setWeights] = useState<EloTemplateWeights>({});
  const [maxAdjustment, setMaxAdjustment] = useState<number | undefined>(undefined);
  const [minAdjustment, setMinAdjustment] = useState<number | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  const { t } = useTranslation();

  useEffect(() => {
    if (template) {
      setName(template.name);
      setDescription(template.description || '');
      setEnabled(template.enabled);
      setWeights(template.weights || {});
      setMaxAdjustment(template.maxAdjustment);
      setMinAdjustment(template.minAdjustment);
    } else {
      // Reset for new template
      setName('');
      setDescription('');
      setEnabled(true);
      setWeights({});
      setMaxAdjustment(undefined);
      setMinAdjustment(undefined);
    }
  }, [template, open]);

  const handleWeightChange = (stat: keyof EloTemplateWeights, value: number | undefined) => {
    setWeights((prev) => {
      const newWeights = { ...prev };
      if (value === undefined || value === 0) {
        delete newWeights[stat];
      } else {
        newWeights[stat] = value;
      }
      return newWeights;
    });
  };

  const handleSave = async () => {
    if (!name.trim()) {
      showError(t('eloTemplatesPage.editor.errors.nameRequired'));
      return;
    }

    setSaving(true);
    try {
      if (template) {
        // Update existing template
        const input: UpdateEloTemplateInput = {
          name,
          description: description.trim() || undefined,
          enabled,
          weights,
          maxAdjustment,
          minAdjustment,
        };
        const response = await api.put<{ success: boolean; template: EloCalculationTemplate }>(
          `/api/elo-templates/${template.id}`,
          input
        );
        if (response.success) {
          showSuccess(t('eloTemplatesPage.editor.update.success', { name }));
          onSave();
        } else {
          showError(response.error || t('eloTemplatesPage.editor.update.error'));
        }
      } else {
        // Create new template
        const input: CreateEloTemplateInput = {
          name,
          description: description.trim() || undefined,
          enabled,
          weights,
          maxAdjustment,
          minAdjustment,
        };
        const response = await api.post<{ success: boolean; template: EloCalculationTemplate }>(
          '/api/elo-templates',
          input
        );
        if (response.success) {
          showSuccess(t('eloTemplatesPage.editor.create.success', { name }));
          onSave();
        } else {
          showError(response.error || t('eloTemplatesPage.editor.create.error'));
        }
      }
    } catch (err) {
      const error = err as Error;
      showError(
        error.message ||
          (template
            ? t('eloTemplatesPage.editor.update.error')
            : t('eloTemplatesPage.editor.create.error'))
      );
    } finally {
      setSaving(false);
    }
  };

  const statKeys: (keyof EloTemplateWeights)[] = [
    'kills',
    'deaths',
    'assists',
    'flashAssists',
    'headshotKills',
    'damage',
    'utilityDamage',
    'kast',
    'mvps',
    'score',
    'adr',
  ];

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>
        <Box display="flex" alignItems="center" justifyContent="space-between">
          <Typography variant="h6" fontWeight={600}>
            {template
              ? t('eloTemplatesPage.editor.titleEdit')
              : t('eloTemplatesPage.editor.titleCreate')}
          </Typography>
          <IconButton onClick={onClose} size="small">
            <CloseIcon />
          </IconButton>
        </Box>
      </DialogTitle>

      <DialogContent dividers>
        <Stack spacing={3}>
          <Alert severity="info" icon={<InfoIcon />}>
            <Typography variant="body2">
              {t('eloTemplatesPage.editor.info')}
            </Typography>
          </Alert>

          <TextField
            label={t('eloTemplatesPage.editor.nameLabel')}
            value={name}
            onChange={(e) => setName(e.target.value)}
            fullWidth
            required
            disabled={template?.id === 'pure-win-loss'}
            helperText={
              template?.id === 'pure-win-loss'
                ? t('eloTemplatesPage.editor.nameDefaultLocked')
                : ''
            }
          />

          <TextField
            label={t('eloTemplatesPage.editor.descriptionLabel')}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            fullWidth
            multiline
            rows={2}
            placeholder={t('eloTemplatesPage.editor.descriptionPlaceholder')}
          />

          <FormControlLabel
            control={<Switch checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />}
            label={t('eloTemplatesPage.editor.enabledLabel')}
          />

          <Divider />

          <Box>
            <Typography variant="h6" gutterBottom>
              {t('eloTemplatesPage.editor.weights.title')}
            </Typography>
            <Typography variant="body2" color="text.secondary" gutterBottom>
              {t('eloTemplatesPage.editor.weights.subtitle')}
            </Typography>

            <Grid container spacing={3} sx={{ mt: 1 }}>
              {statKeys.map((stat) => (
                <Grid size={{ xs: 12, sm: 6 }} key={stat}>
                  <Box>
                    <Box display="flex" alignItems="center" justifyContent="space-between" mb={1}>
                      <Box>
                        <Typography variant="body2" fontWeight={600}>
                          {STAT_LABELS[stat]}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {STAT_DESCRIPTIONS[stat]}
                        </Typography>
                      </Box>
                      <Typography
                        variant="body2"
                        sx={{
                          minWidth: 60,
                          textAlign: 'right',
                          fontFamily: 'monospace',
                          fontWeight: 600,
                          color: weights[stat] && weights[stat]! > 0 ? 'success.main' : weights[stat] && weights[stat]! < 0 ? 'error.main' : 'text.secondary',
                        }}
                      >
                        {weights[stat] !== undefined ? (weights[stat]! > 0 ? '+' : '') + weights[stat] : '0'}
                      </Typography>
                    </Box>
                    <Slider
                      value={weights[stat] || 0}
                      onChange={(_, value) => handleWeightChange(stat, value as number)}
                      min={-2}
                      max={2}
                      step={0.1}
                      marks={[
                        { value: -2, label: '-2' },
                        { value: 0, label: '0' },
                        { value: 2, label: '+2' },
                      ]}
                      valueLabelDisplay="auto"
                      valueLabelFormat={(value) => (value > 0 ? '+' : '') + value.toFixed(1)}
                      disabled={template?.id === 'pure-win-loss'}
                    />
                  </Box>
                </Grid>
              ))}
            </Grid>
          </Box>

          <Divider />

          <Box>
            <Typography variant="h6" gutterBottom>
              {t('eloTemplatesPage.editor.limits.title')}
            </Typography>
            <Typography variant="body2" color="text.secondary" gutterBottom>
              {t('eloTemplatesPage.editor.limits.subtitle')}
            </Typography>

            <Grid container spacing={2} sx={{ mt: 1 }}>
              <Grid size={{ xs: 12, sm: 6 }}>
                <TextField
                  label={t('eloTemplatesPage.editor.limits.maxLabel')}
                  type="number"
                  value={maxAdjustment ?? ''}
                  onChange={(e) =>
                    setMaxAdjustment(e.target.value ? parseInt(e.target.value, 10) : undefined)
                  }
                  fullWidth
                  slotProps={{
                    htmlInput: { min: 0 },
                  }}
                  helperText={t('eloTemplatesPage.editor.limits.maxHelper')}
                  disabled={template?.id === 'pure-win-loss'}
                />
              </Grid>
              <Grid size={{ xs: 12, sm: 6 }}>
                <TextField
                  label={t('eloTemplatesPage.editor.limits.minLabel')}
                  type="number"
                  value={minAdjustment ?? ''}
                  onChange={(e) =>
                    setMinAdjustment(e.target.value ? parseInt(e.target.value, 10) : undefined)
                  }
                  fullWidth
                  slotProps={{
                    htmlInput: { max: 0 },
                  }}
                  helperText={t('eloTemplatesPage.editor.limits.minHelper')}
                />
              </Grid>
            </Grid>
          </Box>
        </Stack>
      </DialogContent>

      <DialogActions sx={{ px: 3, pb: 3 }}>
        <Button onClick={onClose} disabled={saving}>
          {t('common.cancel')}
        </Button>
        <Button
          onClick={() => {
            if (!name.trim()) {
              showWarning(t('eloTemplatesPage.editor.errors.nameRequired'));
              return;
            }
            handleSave();
          }}
          variant="contained"
          disabled={saving}
          startIcon={saving ? <CircularProgress size={20} color="inherit" /> : undefined}
          sx={{
            ...(!name.trim() && {
              bgcolor: 'action.disabledBackground',
              color: 'action.disabled',
              '&:hover': {
                bgcolor: 'action.disabledBackground',
              },
            }),
          }}
        >
          {saving
            ? t('eloTemplatesPage.editor.buttons.saving')
            : template
            ? t('eloTemplatesPage.editor.buttons.update')
            : t('eloTemplatesPage.editor.buttons.create')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

