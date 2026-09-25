/**
 * "Sync maps" (`POST /api/maps/sync`), shared by the Maps page header and the
 * CS2 tab on the Settings page. The same sync also runs on the server by
 * itself after start-up and daily; this is for when an admin wants it now.
 */

import { useCallback, useState } from 'react';
import { api, useModuleTranslation, useSnackbar } from '../../../module-sdk';
import type { MapSyncResponse } from '../cs2.types';

export function useMapSync(onSynced?: () => void | Promise<void>) {
  const { t } = useModuleTranslation('cs2');
  const { showSuccess, showError } = useSnackbar();
  const [syncing, setSyncing] = useState(false);

  const sync = useCallback(async () => {
    setSyncing(true);
    try {
      const response = await api.post<MapSyncResponse>('/api/maps/sync');
      if (!response.success) {
        showError(response.error || t('settings.mapSync.failed'));
        return;
      }
      const parts = [
        t('settings.mapSync.newMaps', { count: response.stats?.added ?? 0 }),
        t(`settings.mapSync.activeDuty.${response.activeDutyPool ?? 'unchanged'}`),
      ];
      if (response.source === 'bundled') parts.unshift(t('settings.mapSync.bundled'));
      showSuccess(parts.join(' '));
      await onSynced?.();
    } catch (err: unknown) {
      const { response } = err as { response?: { data?: { error?: string } } };
      showError(response?.data?.error ?? (err instanceof Error ? err.message : t('settings.mapSync.failed')));
    } finally {
      setSyncing(false);
    }
  }, [onSynced, showError, showSuccess, t]);

  return { sync, syncing };
}
