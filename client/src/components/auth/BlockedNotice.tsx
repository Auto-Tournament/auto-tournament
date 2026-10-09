import { useState } from 'react';
import { Alert, Snackbar } from '@mui/material';
import { useTranslation } from 'react-i18next';

/**
 * A banned or deleted player is signed out by the API on their next request,
 * wherever they land (a Steam sign-in returns to the home page). The API
 * leaves a short-lived `at_blocked` cookie saying which; this shows it once.
 */
export function BlockedNotice() {
  const { t } = useTranslation();
  const [blocked, setBlocked] = useState<'banned' | 'deleted' | null>(() => {
    const m = /(?:^|;\s*)at_blocked=(banned|deleted)/.exec(document.cookie);
    if (!m) return null;
    document.cookie = 'at_blocked=; Max-Age=0; path=/';
    return m[1] as 'banned' | 'deleted';
  });
  return (
    <Snackbar
      open={!!blocked}
      anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
      onClose={() => setBlocked(null)}
    >
      <Alert
        severity="error"
        variant="filled"
        onClose={() => setBlocked(null)}
        data-testid="blocked-notice"
      >
        {blocked === 'banned' ? t('login.banned') : t('login.deleted')}
      </Alert>
    </Snackbar>
  );
}
