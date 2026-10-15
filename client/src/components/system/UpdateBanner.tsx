/**
 * Tells an admin, once per version, that a newer Auto Tournament is out
 * (api: services/platform/updateCheck.ts, GET /api/system/update): a banner
 * across the top of Manage, with the release notes, until it is closed. The
 * version it told about is remembered in this browser, so a closed banner
 * stays away until a newer version is out.
 *
 * The same for each module and game pack with an update, or whose last update
 * did not take (api: services/platform/moduleUpdates.ts, which also puts a
 * notice in the admins' bell), with a link to the Modules page.
 *
 * A banner, not a toast in the corner (2026-10-14): a toast got lost among
 * the others and covered the page's own buttons.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { Alert, Box, IconButton, Stack } from '@mui/material';
import { XIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { Link as RouterLink } from 'react-router-dom';
import { api } from '../../utils/api';
import { ExternalLink } from '../common/ExternalLink';
import { paths } from '../../paths';

const SEEN = 'at.update.seen';

const seen = (key: string) => {
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

interface UpdateInfo {
  running: string;
  latest: string | null;
  available: boolean;
  releaseUrl: string | null;
  modules?: ModuleUpdate[];
}

interface Notice {
  /** Where its "closed" mark is kept, and the mark (the version it is about). */
  key: string;
  mark: string;
  severity: 'info' | 'warning';
  testId: string;
  body: ReactNode;
}

export function UpdateBanner() {
  const { t } = useTranslation();
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [closed, setClosed] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    api
      .get<UpdateInfo>('/api/system/update')
      .then((u) => !cancelled && setInfo(u))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  if (!info) return null;
  const notices: Notice[] = [];
  if (info.available && info.latest) {
    notices.push({
      key: SEEN,
      mark: info.latest,
      severity: 'info',
      testId: 'update-banner',
      body: (
        <>
          {t('update.available', { latest: info.latest, running: info.running })}{' '}
          {info.releaseUrl && (
            <ExternalLink href={info.releaseUrl} sx={{ color: 'inherit', fontWeight: 600 }}>
              {t('update.notes')}
            </ExternalLink>
          )}
        </>
      ),
    });
  }
  for (const m of info.modules ?? []) {
    const failed = !!m.problem && /did not|failed|could not/i.test(m.problem);
    const version = m.available ?? m.installed ?? '';
    notices.push({
      key: `at.update.module.${m.kind}.${m.id}`,
      mark: `${failed ? 'problem' : 'update'}:${version}`,
      severity: failed ? 'warning' : 'info',
      testId: 'module-update-banner',
      body: (
        <>
          {failed
            ? t('update.moduleProblem', { name: m.name, problem: m.problem })
            : t('update.module', {
                name: m.name,
                version: m.available,
                installed: m.installed ?? '?',
              })}{' '}
          <Box component={RouterLink} to={paths.modules} sx={{ color: 'inherit', fontWeight: 600 }}>
            {t('update.openModules')}
          </Box>
        </>
      ),
    });
  }
  const open = notices.filter(
    (n) => seen(n.key) !== n.mark && !closed.includes(`${n.key}=${n.mark}`)
  );
  if (open.length === 0) return null;

  return (
    <Stack spacing={1} sx={{ mb: 2 }} data-testid="update-banners">
      {open.map((n) => (
        <Alert
          key={n.key}
          severity={n.severity}
          data-testid={n.testId}
          action={
            <IconButton
              size="small"
              color="inherit"
              aria-label={t('common.close', 'Close')}
              data-testid="update-banner-close"
              onClick={() => {
                remember(n.key, n.mark);
                setClosed((list) => [...list, `${n.key}=${n.mark}`]);
              }}
            >
              <XIcon size={16} />
            </IconButton>
          }
        >
          {n.body}
        </Alert>
      ))}
    </Stack>
  );
}
