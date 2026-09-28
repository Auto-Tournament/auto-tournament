import { useEffect } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Container from '@mui/material/Container';
import LinearProgress from '@mui/material/LinearProgress';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import { useTranslation } from 'react-i18next';
import { TopNavBar } from '../components/layout/TopNavBar';
import { LicenseConsentForm } from '../components/license/LicenseConsentForm';
import { safeNextPath } from '../components/games/nextPath';
import { useLicenseConsent } from '../hooks/useLicenseConsent';
import { useSnackbar } from '../contexts/SnackbarContext';
import { pageTitle } from '../utils/pageTitle';
import { fontDisplay } from '../theme/tokens';
import { paths } from '../paths';

/** Where to go afterwards: `?next=`, but never back to this page. */
function destination(raw: string | null): string {
  const next = safeNextPath(raw);
  return next.startsWith(paths.licenseConsent) ? paths.root : next;
}

/**
 * The one required step before the admin UI: accept the license terms and
 * say whether this instance is used non-commercially or commercially. The
 * admin shell sends admins here (`LicenseConsentGate`) until it is done, or
 * when the terms changed since. `?next=` is where to go afterwards.
 *
 * Players, public pages and running matches never see this.
 */
export default function LicenseConsent() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { showSuccess } = useSnackbar();
  const [searchParams] = useSearchParams();
  const next = destination(searchParams.get('next'));
  const { status, loaded } = useLicenseConsent();

  useEffect(() => {
    document.title = pageTitle(t('license.consent.title'));
  }, [t]);

  // Nothing to accept (or the status could not be read: never lock admins
  // out over that).
  if (loaded && (!status || status.accepted)) {
    return <Navigate to={next} replace />;
  }

  return (
    <Box minHeight="100vh" bgcolor="transparent" sx={{ pb: 8 }}>
      <TopNavBar />
      <Container maxWidth="md" sx={{ pt: { xs: 3, md: 6 } }} data-testid="license-consent-page">
        <Box component="header" sx={{ mb: 3 }}>
          <Typography
            component="h1"
            variant="h4"
            sx={{
              fontFamily: fontDisplay,
              fontWeight: 700,
              fontSize: { xs: '1.75rem', sm: '2.25rem' },
              letterSpacing: '-0.02em',
              lineHeight: 1.15,
            }}
          >
            {t('license.consent.title')}
          </Typography>
          <Typography variant="body1" color="text.secondary" sx={{ mt: 1, maxWidth: '62ch' }}>
            {t('license.consent.subtitle')}
          </Typography>
        </Box>

        {!loaded || !status ? (
          <LinearProgress aria-label={t('license.loading')} />
        ) : (
          <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 } }}>
            {status.reason === 'version' && (
              <Alert severity="info" sx={{ mb: 3 }} data-testid="license-consent-changed">
                {t('license.consent.termsChanged')}
              </Alert>
            )}
            <LicenseConsentForm
              status={status}
              onAccepted={() => {
                showSuccess(t('license.consent.accepted'));
                navigate(next, { replace: true });
              }}
            />
          </Paper>
        )}
        <Typography variant="caption" color="text.secondary" display="block" mt={2}>
          {t('license.consent.onlyAdmins')}
        </Typography>
      </Container>
    </Box>
  );
}
