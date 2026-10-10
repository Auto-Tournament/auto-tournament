/**
 * Tells an admin, once per version, that a newer Auto Tournament is out
 * (api: services/platform/updateCheck.ts, GET /api/system/update). The toast
 * stays until dismissed and links to the release notes; the version it told
 * about is remembered in this browser, so it does not come back every page.
 *
 * The same for each module and game pack with an update, or whose last update
 * did not take (api: services/platform/moduleUpdates.ts, which also puts a
 * notice in the admins' bell), with a link to the Modules page.
 */
import { useEffect } from 'react';
import { Box } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { useSnackbar } from '../../contexts/SnackbarContext';
import { api } from '../../utils/api';
import { Link as RouterLink } from 'react-router-dom';
import { ExternalLink } from '../common/ExternalLink';
import { paths } from '../../paths';

const SEEN = 'at.update.seen';

const seen = (key = SEEN) => {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
};

const remember = (key: string, value: string) => {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Storage blocked: it is shown again next visit.
  }
};

interface ModuleUpdate {
  kind: 'pack' | 'module';
  id: string;
  name: string;
  installed: string | null;
  available: string | null;
  problem: string | null;
}

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
        modules?: ModuleUpdate[];
      }>('/api/system/update')
      .then((u) => {
        if (cancelled) return;
        for (const m of u.modules ?? []) {
          const failed = !!m.problem && /did not|failed|could not/i.test(m.problem);
          const version = m.available ?? m.installed ?? '';
          const key = `at.update.module.${m.kind}.${m.id}`;
          const mark = `${failed ? 'problem' : 'update'}:${version}`;
          if (seen(key) === mark) continue;
          showSnackbar(
            <Box data-testid="module-update-toast">
              {failed
                ? t('update.moduleProblem', { name: m.name, problem: m.problem })
                : t('update.module', {
                    name: m.name,
                    version: m.available,
                    installed: m.installed ?? '?',
                  })}{' '}
              <Box
                component={RouterLink}
                to={paths.modules}
                sx={{ color: 'inherit', fontWeight: 600 }}
              >
                {t('update.openModules')}
              </Box>
            </Box>,
            failed ? 'warning' : 'info',
            {
              persist: true,
              key: `module-update-${m.kind}-${m.id}`,
              onClose: () => remember(key, mark),
            }
          );
        }
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
