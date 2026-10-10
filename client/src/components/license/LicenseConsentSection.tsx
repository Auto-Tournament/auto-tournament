import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { useTranslation } from 'react-i18next';
import { useLicenseConsent } from '../../hooks/useLicenseConsent';

interface Props {
  /** The saved key is a genuine license: its kind ('free' is non-commercial). Null without one. */
  keyKind: string | null;
}

/**
 * License page: how this install is used, which follows the key (one thing to
 * do: paste a key). A paid key is commercial use, a free key or none
 * non-commercial; the server records the change when a key is saved or
 * removed (routes/license.ts). Under it, when and by whom the terms were
 * accepted.
 */
export function LicenseConsentSection({ keyKind }: Props) {
  const { t, i18n } = useTranslation();
  const { status, loaded } = useLicenseConsent();

  const use = keyKind && keyKind !== 'free' ? 'commercial' : 'noncommercial';
  const consent = loaded ? status?.consent : null;
  const when = consent
    ? new Date(consent.acceptedAt).toLocaleDateString(i18n.language, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      })
    : '';
  const who = consent?.source === 'env' ? t('license.consent.byEnv') : (consent?.acceptedBy ?? '');

  return (
    <Box data-testid="settings-license-consent">
      <Typography variant="body1" fontWeight={600} data-testid="settings-license-consent-use">
        {t(`license.consent.declared.${use}`)}
      </Typography>
      <Typography variant="body2" color="text.secondary">
        {use === 'commercial'
          ? t('license.useFromPaidKey')
          : keyKind === 'free'
            ? t('license.useFromFreeKey')
            : t('license.useWithoutKey')}
      </Typography>
      {consent && (
        <Typography variant="caption" color="text.secondary" display="block" mt={0.5}>
          {t('license.consent.acceptedLine', { date: when, who, version: consent.termsVersion })}
        </Typography>
      )}
    </Box>
  );
}
