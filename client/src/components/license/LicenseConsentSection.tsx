import { useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { Trans, useTranslation } from 'react-i18next';
import { consoleLinkComponents } from './licenseLinks';
import { useLicenseConsent } from '../../hooks/useLicenseConsent';
import { useSnackbar } from '../../contexts/SnackbarContext';
import { LicenseConsentForm } from './LicenseConsentForm';

interface Props {
  /** A license key is saved (any status). */
  hasKey: boolean;
  /** Called after a change, so the key status can be reloaded (a key may have been saved). */
  onChanged?: () => void;
}

/**
 * Settings → License: which use the admin declared when accepting the terms,
 * when and by whom, and "Change" (accept again with the new choice).
 */
export function LicenseConsentSection({ hasKey, onChanged }: Props) {
  const { t, i18n } = useTranslation();
  const { showSuccess } = useSnackbar();
  const { status, loaded } = useLicenseConsent();
  const [open, setOpen] = useState(false);

  if (!loaded || !status) return null;
  const { consent } = status;

  const when = consent
    ? new Date(consent.acceptedAt).toLocaleDateString(i18n.language, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      })
    : '';
  const who = consent?.source === 'env' ? t('license.consent.byEnv') : consent?.acceptedBy ?? '';

  return (
    <Box data-testid="settings-license-consent">
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ sm: 'center' }}>
        <Box flex={1}>
          <Typography variant="body1" fontWeight={600} data-testid="settings-license-consent-use">
            {consent
              ? t(`license.consent.declared.${consent.use}`)
              : t('license.consent.declared.none')}
          </Typography>
          {consent && (
            <Typography variant="body2" color="text.secondary">
              {t('license.consent.acceptedLine', {
                date: when,
                who,
                version: consent.termsVersion,
              })}
            </Typography>
          )}
        </Box>
        <Button
          variant="outlined"
          size="small"
          onClick={() => setOpen(true)}
          data-testid="settings-license-consent-change"
        >
          {t('license.consent.change')}
        </Button>
      </Stack>

      {consent?.use === 'commercial' && !hasKey && (
        <Alert severity="info" sx={{ mt: 1.5 }} data-testid="settings-license-consent-needs-key">
          <Trans t={t} i18nKey="license.consent.commercialNoKey" components={consoleLinkComponents} />
        </Alert>
      )}

      <Dialog open={open} onClose={() => setOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{t('license.consent.changeTitle')}</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" mb={2}>
            {t('license.consent.changeNote')}
          </Typography>
          <LicenseConsentForm
            status={status}
            onCancel={() => setOpen(false)}
            onAccepted={() => {
              setOpen(false);
              showSuccess(t('license.consent.accepted'));
              onChanged?.();
            }}
          />
        </DialogContent>
      </Dialog>
    </Box>
  );
}
