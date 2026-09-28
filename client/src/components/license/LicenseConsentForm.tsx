import React, { useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import FormControl from '@mui/material/FormControl';
import FormControlLabel from '@mui/material/FormControlLabel';
import FormLabel from '@mui/material/FormLabel';
import Radio from '@mui/material/Radio';
import RadioGroup from '@mui/material/RadioGroup';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useTranslation } from 'react-i18next';
import { ExternalLink } from '../common/ExternalLink';
import { apiErrorMessage } from '../../utils/api';
import {
  acceptLicenseTerms,
  isConsentPhrase,
  type LicenseConsentStatus,
  type LicenseUse,
} from '../../hooks/useLicenseConsent';

interface Props {
  status: LicenseConsentStatus;
  /** Called with the new status once the terms are accepted. */
  onAccepted: (status: LicenseConsentStatus) => void;
  /** Settings' "Change": a Cancel button next to Accept. */
  onCancel?: () => void;
}

/**
 * The license terms in plain words, the use choice (non-commercial or
 * commercial), an optional key for commercial use, and "type I AGREE".
 * Used by the consent page (required once) and Settings → License (change).
 */
export function LicenseConsentForm({ status, onAccepted, onCancel }: Props) {
  const { t } = useTranslation();
  const [use, setUse] = useState<LicenseUse | ''>(status.consent?.use ?? '');
  const [key, setKey] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { terms } = status;
  const ready = use !== '' && isConsentPhrase(confirm) && !busy;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (use === '' || !ready) return;
    setBusy(true);
    setError(null);
    try {
      const next = await acceptLicenseTerms({
        use,
        confirm,
        termsVersion: terms.version,
        ...(use === 'commercial' && key.trim() ? { key: key.trim() } : {}),
      });
      onAccepted(next);
    } catch (err) {
      setError(apiErrorMessage(err, t('license.consent.failed')));
    } finally {
      setBusy(false);
    }
  };

  const points = [
    t('license.consent.points.free'),
    t('license.consent.points.orgs'),
    t('license.consent.points.commercial'),
    t('license.consent.points.servers'),
    t('license.consent.points.nothingLocked'),
    t('license.consent.points.forks'),
  ];

  return (
    <Box component="form" onSubmit={submit} noValidate data-testid="license-consent-form">
      <Stack spacing={3}>
        <Box>
          <Typography variant="body1" mb={1.5}>
            {t('license.consent.intro', { name: terms.name })}
          </Typography>
          <Box component="ul" sx={{ m: 0, pl: 2.5 }} data-testid="license-consent-summary">
            {points.map((point) => (
              <Typography component="li" variant="body2" key={point} sx={{ mb: 0.75 }}>
                {point}
              </Typography>
            ))}
          </Box>
          <Typography variant="body2" color="text.secondary" mt={1.5}>
            <ExternalLink href={terms.url} data-testid="license-consent-full-license">
              {t('license.consent.readLicense')}
            </ExternalLink>
            {' · '}
            <ExternalLink href={terms.docsUrl}>{t('license.consent.readRules')}</ExternalLink>
            {' · '}
            <ExternalLink href={terms.pricingUrl}>{t('license.pricing')}</ExternalLink>
          </Typography>
          <Typography variant="caption" color="text.secondary" display="block" mt={1}>
            {t('license.consent.summaryNote')}
          </Typography>
        </Box>

        <FormControl>
          <FormLabel id="license-consent-use" sx={{ mb: 1, fontWeight: 600 }}>
            {t('license.consent.useQuestion')}
          </FormLabel>
          <RadioGroup
            aria-labelledby="license-consent-use"
            value={use}
            onChange={(event) => setUse(event.target.value as LicenseUse)}
          >
            <FormControlLabel
              value="noncommercial"
              disabled={busy}
              control={<Radio slotProps={{ input: { 'data-testid': 'license-consent-noncommercial' } as React.InputHTMLAttributes<HTMLInputElement> }} />}
              label={
                <Box py={0.5}>
                  <Typography variant="body1">{t('license.consent.use.noncommercial')}</Typography>
                  <Typography variant="body2" color="text.secondary">
                    {t('license.consent.use.noncommercialHint')}
                  </Typography>
                </Box>
              }
            />
            <FormControlLabel
              value="commercial"
              disabled={busy}
              control={<Radio slotProps={{ input: { 'data-testid': 'license-consent-commercial' } as React.InputHTMLAttributes<HTMLInputElement> }} />}
              label={
                <Box py={0.5}>
                  <Typography variant="body1">{t('license.consent.use.commercial')}</Typography>
                  <Typography variant="body2" color="text.secondary">
                    {t('license.consent.use.commercialHint')}
                  </Typography>
                </Box>
              }
            />
          </RadioGroup>
        </FormControl>

        {use === 'commercial' && (
          <TextField
            label={t('license.consent.keyLabel')}
            value={key}
            onChange={(e) => setKey(e.target.value)}
            disabled={busy}
            size="small"
            placeholder="ATL1.…"
            multiline
            minRows={2}
            maxRows={6}
            autoComplete="off"
            helperText={t('license.consent.keyHelper')}
            slotProps={{ htmlInput: { spellCheck: false, 'data-testid': 'license-consent-key' } }}
          />
        )}

        <TextField
          label={t('license.consent.confirmLabel', { phrase: terms.phrase })}
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          disabled={busy}
          autoComplete="off"
          helperText={t('license.consent.confirmHelper', { phrase: terms.phrase })}
          slotProps={{ htmlInput: { spellCheck: false, 'data-testid': 'license-consent-confirm' } }}
        />

        {error && (
          <Alert severity="error" data-testid="license-consent-error">
            {error}
          </Alert>
        )}

        <Stack direction="row" spacing={1} justifyContent="flex-end">
          {onCancel && (
            <Button color="inherit" onClick={onCancel} disabled={busy}>
              {t('license.consent.cancel')}
            </Button>
          )}
          <Button type="submit" variant="contained" disabled={!ready} data-testid="license-consent-accept">
            {t('license.consent.accept')}
          </Button>
        </Stack>
      </Stack>
    </Box>
  );
}
