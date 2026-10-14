import { useEffect, useState } from 'react';
import { Alert, Button } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../contexts/AuthContext';
import { api } from '../../utils/api';

/**
 * Admins only: the site was opened on another address than the one it is set
 * up for (FRONTEND_BASE_URL), e.g. by IP while the domain points elsewhere.
 * Steam sign-in, links in emails and the game servers use the configured
 * address, so say which one that is. Not shown when no address is set.
 */
export function AddressMismatchBanner() {
  const { t } = useTranslation();
  const { isAuthenticated: isAdmin } = useAuth();
  const [configured, setConfigured] = useState<string | null>(null);

  useEffect(() => {
    if (!isAdmin) return;
    let live = true;
    api
      .get<{ url: string | null }>('/api/settings/site-url')
      .then((r) => live && setConfigured(r.url))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [isAdmin]);

  if (!isAdmin || !configured) return null;
  let host: string;
  try {
    host = new URL(configured).host;
  } catch {
    return null;
  }
  if (host === window.location.host) return null;

  return (
    <Alert
      severity="info"
      data-testid="address-mismatch"
      sx={{ borderRadius: 0 }}
      action={
        <Button color="inherit" size="small" href={`${configured}${window.location.pathname}`}>
          {t('addressMismatch.open', 'Open {{host}}', { host })}
        </Button>
      }
    >
      {t('addressMismatch.text', {
        defaultValue:
          "You're on {{current}}, but this site is set up for {{host}}: Steam sign-in, emails and the game servers use that address.",
        current: window.location.host,
        host,
      })}
    </Alert>
  );
}
