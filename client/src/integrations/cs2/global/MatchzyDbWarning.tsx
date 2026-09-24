/**
 * The admin shell's "MatchZy DB unreachable" warning, which belongs to CS2
 * (3.0 phase E).
 *
 * `matchzyDbOk` is the MatchZy plugin's own report, from a CS2 game server,
 * about the database it writes backups and its event queue to. It is named
 * after the plugin in the copy, and there is no such thing on an instance
 * whose results are typed in by a captain — the shell used to poll `/api/servers`
 * for it on every install, once a minute, forever.
 *
 * Everything here is the code that was in `components/layout/Layout.tsx`, so a
 * CS2 instance sees the same persistent snackbar, with the same copy, on the
 * same 60s cadence. Like the webhook warning it renders nothing: the warning
 * *is* the snackbar.
 */

import * as React from 'react';
import type { SnackbarKey } from 'notistack';
import { useSnackbar, api, useModuleTranslation } from '../../../module-sdk';

export const MatchzyDbWarning: React.FC = () => {
  const { t } = useModuleTranslation('cs2');
  const { showPersistentError, closeSnackbar } = useSnackbar();
  const [dbHealthSnackbarKey, setDbHealthSnackbarKey] = React.useState<SnackbarKey | null>(null);

  // Keep a persistent snackbar while any server reports plugin DB down.
  React.useEffect(() => {
    let cancelled = false;

    const checkDbHealth = async () => {
      try {
        const response = await api.get<{
          success: boolean;
          servers?: Array<{ enabled?: boolean; matchzyDbOk?: boolean | null }>;
        }>('/api/servers');
        if (cancelled) return;
        const servers = response.servers ?? [];
        const downCount = servers.filter(
          (s) => s.enabled !== false && s.matchzyDbOk === false
        ).length;

        if (downCount > 0) {
          if (!dbHealthSnackbarKey) {
            const key = showPersistentError(
              <span>
                <strong>{t('layout.matchzyDbDown.title')}</strong> —{' '}
                {t('layout.matchzyDbDown.body', { count: downCount })}
              </span>,
              'matchzy-db-down'
            );
            setDbHealthSnackbarKey(key);
          }
        } else if (dbHealthSnackbarKey) {
          closeSnackbar(dbHealthSnackbarKey);
          setDbHealthSnackbarKey(null);
        }
      } catch {
        // Non-fatal; we don't want global UI to hard-fail.
      }
    };

    void checkDbHealth();
    const interval = window.setInterval(checkDbHealth, 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [dbHealthSnackbarKey, showPersistentError, closeSnackbar, t]);

  return null;
};
