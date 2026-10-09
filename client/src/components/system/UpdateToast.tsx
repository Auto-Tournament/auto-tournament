/**
 * Tells an admin, once per version, that a newer Auto Tournament is out
 * (api: services/platform/updateCheck.ts, GET /api/system/update). The toast
 * stays until dismissed and links to the release notes; the version it told
 * about is remembered in this browser, so it does not come back every page.
 */
import { useEffect } from 'react';
import { Box } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { useSnackbar } from '../../contexts/SnackbarContext';
import { api } from '../../utils/api';
import { ExternalLink } from '../common/ExternalLink';

const SEEN = 'at.update.seen';

const seen = () => {
  try {
    return window.localStorage.getItem(SEEN);
  } catch {
    return null;
  }
};

export function UpdateToast() {
  const { t } = useTranslation();
  const { showSnackbar } = useSnackbar();

  useEffect(() => {
    let cancelled = false;
    api
      .get<{
        running: string;
        latest: string | null;
        available: boolean;
        releaseUrl: string | null;
      }>('/api/system/update')
      .then((u) => {
        if (cancelled || !u.available || !u.latest || seen() === u.latest) return;
        showSnackbar(
          <Box data-testid="update-toast">
            {t('update.available', { latest: u.latest, running: u.running })}{' '}
            {u.releaseUrl && (
              <ExternalLink href={u.releaseUrl} sx={{ color: 'inherit', fontWeight: 600 }}>
                {t('update.notes')}
              </ExternalLink>
            )}
          </Box>,
          'info',
          {
            persist: true,
            key: `update-${u.latest}`,
            onClose: () => {
              try {
                window.localStorage.setItem(SEEN, u.latest ?? '');
              } catch {
                // Storage blocked: it is shown again next visit.
              }
            },
          }
        );
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [showSnackbar, t]);

  return null;
}
