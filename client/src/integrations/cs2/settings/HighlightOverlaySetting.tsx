/**
 * Redraw the overlays: every clip and reel recorded with a clean twin is
 * dressed again from it (the API's demos/redress.ts) by an idle recorder: the
 * current caption card and kill feed, the names as they are now. No CS2 needed.
 */

import { useCallback, useEffect, useState } from 'react';
import { Box, Button, Typography } from '@mui/material';
import { api, apiErrorMessage, useModuleTranslation } from '../../../module-sdk';

interface RedressStatus {
  queued: number;
  working: number;
  failed: number;
  available: number;
}

export function HighlightOverlaySetting() {
  const { t } = useModuleTranslation('cs2');
  const [status, setStatus] = useState<RedressStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setStatus(await api.get<RedressStatus>('/api/game/cs2/redress'));
    } catch {
      setStatus(null);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // While a recorder works through the queue, keep the count fresh.
  const pending = (status?.queued ?? 0) + (status?.working ?? 0);
  useEffect(() => {
    if (!pending) return;
    const timer = window.setInterval(() => void load(), 10_000);
    return () => window.clearInterval(timer);
  }, [pending, load]);

  const redraw = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.post('/api/game/cs2/redress', {});
      await load();
    } catch (e) {
      setError(apiErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  if (!status) return null;
  return (
    <Box sx={{ mt: 3 }} data-testid="cs2-highlights-redress">
      <Typography variant="subtitle2" fontWeight={600}>
        {t('settings.highlights.overlay.label')}
      </Typography>
      <Typography
        variant="body2"
        color="text.secondary"
        sx={{ mt: 0.5, mb: 1.5, maxWidth: '65ch' }}
      >
        {t('settings.highlights.overlay.helper', { count: status.available })}
      </Typography>
      <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
        <Button
          variant="outlined"
          size="small"
          onClick={() => void redraw()}
          disabled={busy || status.available === 0}
          data-testid="cs2-highlights-redress-button"
        >
          {t('settings.highlights.overlay.redraw')}
        </Button>
        {pending > 0 && (
          <Typography variant="body2" color="text.secondary">
            {t('settings.highlights.overlay.pending', { count: pending })}
          </Typography>
        )}
        {status.failed > 0 && (
          <Typography variant="body2" color="error">
            {t('settings.highlights.overlay.failed', { count: status.failed })}
          </Typography>
        )}
      </Box>
      {error && (
        <Typography variant="body2" color="error" sx={{ mt: 1 }}>
          {error}
        </Typography>
      )}
    </Box>
  );
}
