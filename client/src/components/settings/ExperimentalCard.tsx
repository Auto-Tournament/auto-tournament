import React from 'react';
import Box from '@mui/material/Box';
import Switch from '@mui/material/Switch';
import { useTranslation } from 'react-i18next';
import { api, apiErrorMessage } from '../../utils/api';
import { SettingsCardHead, SettingsRow } from './SettingsRow';
import { useSnackbar } from '../../contexts/SnackbarContext';

export interface ExperimentalFeatureState {
  id: string;
  enabled: boolean;
  source: 'env' | 'setting' | 'default';
  env: string;
}

/**
 * Settings → Experimental: turn work-in-progress features on or off
 * (`/api/experimental`). Each toggle saves on its own. A feature forced by
 * its environment variable shows the toggle disabled, with the variable's
 * name. Renders nothing while no feature is experimental; the page loads the
 * list (`features`) so it can also hide the card around it.
 */
export function ExperimentalCard({
  features,
  onChange,
}: {
  features: ExperimentalFeatureState[];
  onChange: (features: ExperimentalFeatureState[]) => void;
}) {
  const { t } = useTranslation();
  const { showSuccess, showError } = useSnackbar();
  const [saving, setSaving] = React.useState<string | null>(null);

  const toggle = async (id: string, enabled: boolean) => {
    setSaving(id);
    try {
      const res = await api.put<{ feature: ExperimentalFeatureState }>(
        `/api/experimental/${encodeURIComponent(id)}`,
        { enabled }
      );
      onChange(features.map((f) => (f.id === id ? res.feature : f)));
      showSuccess(t('settingsPage.experimental.saved'));
    } catch (err) {
      showError(apiErrorMessage(err, t('settingsPage.experimental.saveFailed')));
    } finally {
      setSaving(null);
    }
  };

  if (features.length === 0) return null;

  return (
    <Box data-testid="settings-experimental-card">
      <SettingsCardHead title={t('settingsPage.experimental.title')} hint={t('settingsPage.experimental.short')} />
      <Box>
        {features.map((feature) => (
          <SettingsRow
            key={feature.id}
            title={t(`settingsPage.experimental.features.${feature.id}.label`)}
            sub={
              feature.source === 'env' ? (
                <Box component="span" sx={{ color: 'warning.main' }}>
                  {t('settingsPage.experimental.envOverride', { env: feature.env })}
                </Box>
              ) : (
                t(`settingsPage.experimental.features.${feature.id}.description`)
              )
            }
            control={
              <Switch
                checked={feature.enabled}
                disabled={feature.source === 'env' || saving === feature.id}
                onChange={(event) => void toggle(feature.id, event.target.checked)}
                color="primary"
                slotProps={{
                  input: {
                    'data-testid': `settings-experimental-${feature.id}`,
                    'aria-label': t(`settingsPage.experimental.features.${feature.id}.label`),
                  } as React.InputHTMLAttributes<HTMLInputElement>,
                }}
              />
            }
          />
        ))}
      </Box>
    </Box>
  );
}
