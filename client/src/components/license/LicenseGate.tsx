import { useEffect, useState } from 'react';
import { Alert, Box, Button, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../contexts/AuthContext';
import { useLicenseStatus } from '../../hooks/useLicenseStatus';
import { LICENSE_EXPIRED_EVENT } from '../../utils/api';

const CONSOLE_URL = 'https://console.autotournament.gg/billing';

/**
 * The paid license's standing, on every page (api/src/services/license/gate.ts):
 *
 * - past due: admins see a warning bar with the day it stops. Players see
 *   nothing yet.
 * - expired: the API answers every call with `license_expired`, and everyone
 *   sees this page instead of the platform until it is paid. Admins get the
 *   link to pay and to the license settings (still open, so a renewed key
 *   can be pasted).
 */
export function LicenseGate() {
  const { t } = useTranslation();
  const { isAuthenticated: isAdmin } = useAuth();
  const [expired, setExpired] = useState(false);
  const { status } = useLicenseStatus({ enabled: isAdmin });

  useEffect(() => {
    const on = () => setExpired(true);
    window.addEventListener(LICENSE_EXPIRED_EVENT, on);
    return () => window.removeEventListener(LICENSE_EXPIRED_EVENT, on);
  }, []);

  const standing = status?.standing;
  const isExpired = expired || standing?.status === 'expired';
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
            {t('licenseGate.expiredTitle', "This platform's license has expired")}
          </Typography>
          <Typography color="text.secondary">
            {isAdmin
              ? t('licenseGate.expiredAdmin', 'The license payment is overdue, so the platform has stopped. Paying turns it back on right away. Your data is safe.')
              : t('licenseGate.expiredPlayer', 'Matches and sign-ups are paused. The organizer has been told. Check back later.')}
          </Typography>
          {isAdmin && (
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5, justifyContent: 'center' }}>
              <Button variant="contained" href={CONSOLE_URL} target="_blank" rel="noopener noreferrer">
                {t('licenseGate.pay', 'Pay in the console ↗')}
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
          <Button color="inherit" size="small" href={CONSOLE_URL} target="_blank" rel="noopener noreferrer">
            {t('licenseGate.fix', 'Fix it ↗')}
          </Button>
        }
      >
        {t('licenseGate.pastDue', {
          defaultValue: 'The license payment failed. The platform stops on {{date}} unless it is paid.',
          date: standing.stopsOn ?? '',
        })}
      </Alert>
    );
  }
  return null;
}
