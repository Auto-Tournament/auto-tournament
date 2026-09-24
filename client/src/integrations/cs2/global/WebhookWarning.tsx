/**
 * The admin shell's "webhook URL is not configured" warning, which belongs to
 * CS2 (3.0 phase E).
 *
 * The webhook URL is the address a CS2 server reaches the platform on — the
 * `baseUrl` `resolveBaseUrl` answers with on the API side (PR #309), and the
 * one thing an unset URL breaks is a game that has servers to call back. The
 * shell used to nag every install about it, including one whose tournament is
 * reported by hand and has nothing to call anything.
 *
 * Everything here is the code that was in `components/layout/Layout.tsx`, so a
 * CS2 instance sees the same snackbar, with the same copy, at the same moment.
 * It renders nothing itself: the warning is a snackbar, and the slot exists so
 * the shell can host it without knowing what a webhook URL is.
 */

import * as React from 'react';
import { Box, Button } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { useSnackbar, api, links, useModuleTranslation } from '../../../module-sdk';
import type { WebhookSettings, WebhookSettingsResponse } from '../cs2.types';
import type { AdminGlobalWarningProps } from '../../types';

export const WebhookWarning: React.FC<AdminGlobalWarningProps> = () => {
  const { t } = useModuleTranslation('cs2');
  const { showError } = useSnackbar();
  const navigate = useNavigate();
  // The field is on CS2's own Settings tab (0.2.2), so open that tab rather
  // than the page core's `onOpenSettings` goes to.
  const openSettings = React.useCallback(() => navigate(links.settings('cs2')), [navigate]);
  const hasShownWebhookWarningRef = React.useRef(false);
  const [webhookConfigured, setWebhookConfigured] = React.useState<boolean | null>(null);

  React.useEffect(() => {
    let isMounted = true;

    const loadSettings = async () => {
      try {
        const response = await api.get<WebhookSettingsResponse>('/api/settings');
        if (isMounted) {
          setWebhookConfigured(Boolean(response.settings?.webhookConfigured));
        }
      } catch {
        if (isMounted) {
          setWebhookConfigured(false);
        }
      }
    };

    loadSettings();

    const handleSettingsUpdated = (event: Event) => {
      const customEvent = event as CustomEvent<WebhookSettings>;
      setWebhookConfigured(Boolean(customEvent.detail?.webhookConfigured));
    };

    window.addEventListener('at:settingsUpdated', handleSettingsUpdated);

    return () => {
      isMounted = false;
      window.removeEventListener('at:settingsUpdated', handleSettingsUpdated);
    };
  }, []);

  // Show a single global snackbar when webhook is not configured
  React.useEffect(() => {
    if (webhookConfigured === false && !hasShownWebhookWarningRef.current) {
      hasShownWebhookWarningRef.current = true;
      showError(
        <Box display="flex" alignItems="center" gap={1}>
          <Box component="span" sx={{ mr: 1 }}>
            {t('layout.webhookNotConfigured')}
          </Box>
          <Button
            color="inherit"
            size="small"
            onClick={openSettings}
            sx={{ textDecoration: 'underline' }}
          >
            {t('layout.openSettings')}
          </Button>
        </Box>
      );
    }

    if (webhookConfigured === true) {
      hasShownWebhookWarningRef.current = false;
    }
  }, [webhookConfigured, showError, openSettings, t]);

  return null;
};
