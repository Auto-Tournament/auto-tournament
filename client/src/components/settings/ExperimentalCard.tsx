import React, { useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import FormControlLabel from '@mui/material/FormControlLabel';
import Typography from '@mui/material/Typography';
import { useTranslation } from 'react-i18next';
import { api, apiErrorMessage } from '../../utils/api';
import { useSnackbar } from '../../contexts/SnackbarContext';

interface ExperimentalFeatureState {
  id: string;
  enabled: boolean;
  source: 'env' | 'setting' | 'default';
  env: string;
}

/**
 * Settings → Experimental: turn work-in-progress features on or off
 * (`/api/experimental`). Each toggle saves on its own. A feature forced by
 * its environment variable shows the toggle disabled, with the variable's
 * name.
 */
export function ExperimentalCard() {
  const { t } = useTranslation();
  const { showSuccess, showError } = useSnackbar();
  const [features, setFeatures] = useState<ExperimentalFeatureState[] | null>(null);
  const [saving, setSaving] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<{ features: ExperimentalFeatureState[] }>('/api/experimental')
      .then((res) => setFeatures(res.features))
      .catch((err) => {
        setFeatures([]);
        showError(apiErrorMessage(err, t('settingsPage.experimental.loadFailed')));
      });
  }, [showError, t]);

  const toggle = async (id: string, enabled: boolean) => {
    setSaving(id);
    try {
      const res = await api.put<{ feature: ExperimentalFeatureState }>(
        `/api/experimental/${encodeURIComponent(id)}`,
        { enabled }
      );
      setFeatures((prev) => prev?.map((f) => (f.id === id ? res.feature : f)) ?? null);
      showSuccess(t('settingsPage.experimental.saved'));
    } catch (err) {
      showError(apiErrorMessage(err, t('settingsPage.experimental.saveFailed')));
    } finally {
      setSaving(null);
    }
  };

  if (features === null) return null;

  return (
    <Box data-testid="settings-experimental-card">
      <Typography variant="h6" fontWeight={600} gutterBottom>
        {t('settingsPage.experimental.title')}
      </Typography>
      <Typography variant="body2" color="text.secondary" mb={2}>
        {t('settingsPage.experimental.description')}
      </Typography>
      <Stack spacing={2}>
        {features.map((feature) => (
          <Box key={feature.id}>
            <FormControlLabel
              control={
                <Switch
                  checked={feature.enabled}
                  disabled={feature.source === 'env' || saving === feature.id}
                  onChange={(event) => void toggle(feature.id, event.target.checked)}
                  color="primary"
                  size="small"
                  slotProps={{
                    input: {
                      'data-testid': `settings-experimental-${feature.id}`,
                    } as React.InputHTMLAttributes<HTMLInputElement>,
                  }}
                />
              }
              label={t(`settingsPage.experimental.features.${feature.id}.label`)}
            />
            <Typography variant="caption" color="text.secondary" display="block">
              {t(`settingsPage.experimental.features.${feature.id}.description`)}
            </Typography>
            {feature.source === 'env' && (
              <Typography variant="caption" color="warning.main" display="block">
                {t('settingsPage.experimental.envOverride', { env: feature.env })}
              </Typography>
            )}
          </Box>
        ))}
      </Stack>
    </Box>
  );
}
