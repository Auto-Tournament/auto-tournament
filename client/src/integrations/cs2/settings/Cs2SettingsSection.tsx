/**
 * CS2's tab on the Settings page (slot `instanceSettings`, client API 0.2.2):
 * the webhook URL its servers call back on, the map sync (also in the Maps
 * page header, ../maps/useMapSync), and the defaults
 * sent to every server with a match (`Cs2ServerDefaults`).
 *
 * Both were the first thing on core's Settings page until the module split
 * (audit chunk 9). The API is unchanged: the webhook URL is still the
 * `webhookUrl` field of `GET`/`PUT /api/settings` (every field there is
 * optional, so this tab saves only its own), and the sync is CS2's
 * `POST /api/maps/sync`.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Box,
  Button,
  CircularProgress,
  Divider,
  LinearProgress,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import SyncIcon from '@mui/icons-material/Sync';
import { api, useModuleTranslation, useSnackbar } from '../../../module-sdk';
import type { InstanceSettingsSectionProps } from '../../types';
import type { WebhookSettings, WebhookSettingsResponse } from '../cs2.types';
import { useMapSync } from '../maps/useMapSync';
import { Cs2ServerDefaults } from './Cs2ServerDefaults';

export const Cs2SettingsSection: React.FC<InstanceSettingsSectionProps> = () => {
  const { t } = useModuleTranslation('cs2');
  const { showSuccess, showError } = useSnackbar();
  const [loading, setLoading] = useState(true);
  const [initialSettings, setInitialSettings] = useState<Record<string, unknown> | undefined>();
  const [webhookUrl, setWebhookUrl] = useState('');
  const [savedWebhookUrl, setSavedWebhookUrl] = useState('');
  const { sync: handleSyncMaps, syncing: syncingMaps } = useMapSync();
  const saveTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saving = useRef(false);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const response = await api.get<WebhookSettingsResponse>('/api/settings');
        const url = response.settings?.webhookUrl ?? '';
        if (active) {
          setWebhookUrl(url);
          setSavedWebhookUrl(url);
          setInitialSettings(response.settings as Record<string, unknown> | undefined);
        }
      } catch (err) {
        if (active) showError(err instanceof Error ? err.message : t('settings.loadFailed'));
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [showError, t]);

  const save = useCallback(async () => {
    if (saveTimeout.current) {
      clearTimeout(saveTimeout.current);
      saveTimeout.current = null;
    }
    // Enter then blur would otherwise send the same value twice.
    if (webhookUrl === savedWebhookUrl || saving.current) return;
    saving.current = true;
    const trimmed = webhookUrl.trim();
    try {
      const response = await api.put<WebhookSettingsResponse>('/api/settings', {
        webhookUrl: trimmed === '' ? null : trimmed,
      });
      const url = response.settings?.webhookUrl ?? '';
      setWebhookUrl(url);
      setSavedWebhookUrl(url);
      showSuccess(t('settings.saved'));
      // The shell's "webhook not configured" warning listens for this.
      window.dispatchEvent(
        new CustomEvent<WebhookSettings | undefined>('at:settingsUpdated', {
          detail: response.settings,
        })
      );
    } catch (err) {
      showError(err instanceof Error ? err.message : t('settings.saveFailed'));
    } finally {
      saving.current = false;
    }
  }, [webhookUrl, savedWebhookUrl, showError, showSuccess, t]);

  // Saved a second after the last keystroke, or at once on blur / Enter.
  useEffect(() => {
    if (loading || webhookUrl === savedWebhookUrl) return;
    saveTimeout.current = setTimeout(() => void save(), 1000);
    return () => {
      if (saveTimeout.current) clearTimeout(saveTimeout.current);
    };
  }, [loading, webhookUrl, savedWebhookUrl, save]);

  if (loading) {
    return <LinearProgress />;
  }

  return (
    <Stack spacing={3} data-testid="cs2-settings">
      <Box>
        <Typography variant="h6" fontWeight={600} gutterBottom>
          {t('settings.webhook.title')}
        </Typography>
        <Typography variant="body2" color="text.secondary" mb={2}>
          {t('settings.webhook.description')}
        </Typography>
        <TextField
          label={t('settings.webhook.label')}
          value={webhookUrl}
          onChange={(event) => setWebhookUrl(event.target.value)}
          onBlur={() => void save()}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              void save();
            }
          }}
          helperText={t('settings.webhook.helper')}
          fullWidth
          required
          error={webhookUrl.trim() === ''}
          slotProps={{
            htmlInput: { 'data-testid': 'settings-webhook-url-input' },
          }}
        />
      </Box>

      <Divider />

      <Box>
        <Typography variant="h6" fontWeight={600} gutterBottom>
          {t('settings.mapSync.title')}
        </Typography>
        <Typography variant="body2" color="text.secondary" mb={2}>
          {t('settings.mapSync.description')}
        </Typography>
        <Button
          variant="outlined"
          startIcon={syncingMaps ? <CircularProgress size={16} /> : <SyncIcon />}
          onClick={handleSyncMaps}
          disabled={syncingMaps}
          data-testid="cs2-settings-map-sync"
        >
          {syncingMaps ? t('settings.mapSync.buttonSyncing') : t('settings.mapSync.buttonIdle')}
        </Button>
      </Box>

      <Divider />

      <Cs2ServerDefaults initial={initialSettings} />
    </Stack>
  );
};
