import { useEffect, useState } from 'react';
import { Alert, Box, Button, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../contexts/AuthContext';
import { useLicenseStatus } from '../../hooks/useLicenseStatus';
import { LICENSE_EXPIRED_EVENT } from '../../utils/api';

const CONSOLE_URL = 'https://console.autotournament.gg/billing';
const LICENSES_URL = 'https://console.autotournament.gg/licenses';

type Reason = 'unpaid' | 'replaced' | 'in_use_elsewhere' | null;

/**
 * The paid license's standing, on every page (api/src/services/license/gate.ts):
 *
 * - past due: admins see a warning bar with the day it stops. Players see
 *   nothing yet.
 * - expired: the API answers every call with `license_expired`, and everyone
 *   sees this page instead of the platform until it is sorted. Admins get the
 *   link to the console and to the license settings (still open, so a new key
 *   can be pasted).
 *
 * The reason changes what admins are told: not paid; the key was replaced by
 * a new one in the console (a day's warning, then it stops); or the key
 * belongs to another Auto Tournament install.
 */
export function LicenseGate() {
  const { t } = useTranslation();
  const { isAuthenticated: isAdmin } = useAuth();
  const [expired, setExpired] = useState<{ reason: Reason } | null>(null);
  const { status } = useLicenseStatus({ enabled: isAdmin });

  useEffect(() => {
    const on = (e: Event) => setExpired({ reason: ((e as CustomEvent<{ reason?: Reason }>).detail?.reason ?? null) as Reason });
    window.addEventListener(LICENSE_EXPIRED_EVENT, on);
    return () => window.removeEventListener(LICENSE_EXPIRED_EVENT, on);
  }, []);

  const standing = status?.standing;
  const isExpired = Boolean(expired) || standing?.status === 'expired';
  const reason: Reason = standing?.reason ?? expired?.reason ?? null;
  const elsewhere = reason === 'in_use_elsewhere';
  const replaced = reason === 'replaced';
  const onSettings = window.location.pathname.startsWith('/manage/settings') || window.location.pathname.startsWith('/login');

  if (isExpired && !onSettings) {
    return (
      <Box
        role="alert"
        data-testid="license-expired"
        sx={{ position: 'fixed', inset: 0, zIndex: 2000, bgcolor: 'background.default', display: 'grid', placeItems: 'center', p: 3 }}
      >
        <Box sx={{ maxWidth: 460, textAlign: 'center', display: 'grid', gap: 2, justifyItems: 'center' }}>
          <Typography variant="h5" component="h1" sx={{ fontWeight: 700 }}>
            {elsewhere
              ? t('licenseGate.elsewhereTitle', 'This license key is in use on another install')
              : replaced
                ? t('licenseGate.replacedTitle', 'This license key was replaced')
                : t('licenseGate.expiredTitle', "This platform's license has expired")}
          </Typography>
          <Typography color="text.secondary">
            {!isAdmin
              ? t('licenseGate.expiredPlayer', 'Matches and sign-ups are paused. The organizer has been told. Check back later.')
              : elsewhere
                ? t(
                    'licenseGate.elsewhereAdmin',
                    'One license key works on one Auto Tournament install, and another install has this one. Paste this install\'s own key, or use "Move to another install" in the console. Your data is safe.'
                  )
                : replaced
                  ? t('licenseGate.replacedAdmin', 'A new key was made for this license in the console, so the old one has stopped. Paste the new key in the license settings. Your data is safe.')
                  : t('licenseGate.expiredAdmin', 'The license payment is overdue, so the platform has stopped. Paying turns it back on right away. Your data is safe.')}
          </Typography>
          {isAdmin && (
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5, justifyContent: 'center' }}>
              <Button variant="contained" href={elsewhere || replaced ? LICENSES_URL : CONSOLE_URL} target="_blank" rel="noopener noreferrer">
                {elsewhere || replaced ? t('licenseGate.openConsole', 'Open the console ↗') : t('licenseGate.pay', 'Pay in the console ↗')}
              </Button>
              <Button variant="outlined" href="/manage/settings/license">
                {t('licenseGate.settings', 'License settings')}
              </Button>
            </Box>
          )}
        </Box>
      </Box>
    );
  }

  if (isAdmin && standing?.status === 'past_due') {
    return (
      <Alert
        severity="warning"
        data-testid="license-past-due"
        sx={{ borderRadius: 0 }}
        action={
          <Button color="inherit" size="small" href={replaced ? '/manage/settings/license' : CONSOLE_URL} {...(replaced ? {} : { target: '_blank', rel: 'noopener noreferrer' })}>
            {replaced ? t('licenseGate.pasteKey', 'Paste the new key') : t('licenseGate.fix', 'Fix it ↗')}
          </Button>
        }
      >
        {replaced
          ? t('licenseGate.replacedSoon', {
              defaultValue: 'A new key was made for this license in the console. Paste it in the license settings: this key stops on {{date}}.',
              date: standing.stopsOn ?? '',
            })
          : t('licenseGate.pastDue', {
              defaultValue: 'The license payment failed. The platform stops on {{date}} unless it is paid.',
              date: standing.stopsOn ?? '',
            })}
      </Alert>
    );
  }
  return null;
}
