/**
 * Match rules (CS2's rail item, board 7): what every CS2 server is told when
 * a match starts. The webhook URL its servers report to, then the defaults
 * sent with every match (`Cs2ServerDefaults`).
 *
 * These were CS2's pages on the Settings page until Settings became the
 * platform's only. The API is unchanged: the webhook URL is the `webhookUrl`
 * field of `GET`/`PUT /api/settings` (every field there is optional, so this
 * page saves only its own). Map sync lives on the Maps page.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Box, LinearProgress, Stack, TextField, Typography } from '@mui/material';
import { api, useModuleTranslation, useSnackbar, PageHead, pageTitle, tokens, radii, fontDisplay } from '../../../module-sdk';
import type { WebhookSettings, WebhookSettingsResponse } from '../cs2.types';
import { Cs2ServerDefaults } from './Cs2ServerDefaults';

const { color } = tokens;

export const MatchRulesPage: React.FC = () => {
  const { t } = useModuleTranslation('cs2');
  const { showSuccess, showError } = useSnackbar();
  const [loading, setLoading] = useState(true);
  const [initialSettings, setInitialSettings] = useState<Record<string, unknown> | undefined>();
  const [webhookUrl, setWebhookUrl] = useState('');
  const [savedWebhookUrl, setSavedWebhookUrl] = useState('');
  const saveTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saving = useRef(false);

  useEffect(() => {
    document.title = pageTitle(t('matchRules.title'));
  }, [t]);

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

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }} data-testid="cs2-settings">
      <PageHead title={t('matchRules.title')} subtitle={t('matchRules.subtitle')} sx={{ mb: 0 }} />
      {loading ? (
        <LinearProgress />
      ) : (
        <Stack spacing={3}>
          <Box
            component="section"
            aria-labelledby="match-rules-webhook"
            sx={{ bgcolor: color.paper2, border: `1px solid ${color.rule}`, borderRadius: radii.lg, p: { xs: 2, md: 3 } }}
          >
            <Typography id="match-rules-webhook" component="h2" sx={{ fontFamily: fontDisplay, fontSize: '1.1875rem', fontWeight: 600, mb: 0.5 }}>
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
          <Cs2ServerDefaults initial={initialSettings} />
        </Stack>
      )}
    </Box>
  );
};
