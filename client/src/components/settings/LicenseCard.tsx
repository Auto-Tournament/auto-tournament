import React, { useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import FormControlLabel from '@mui/material/FormControlLabel';
import LinearProgress from '@mui/material/LinearProgress';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useTranslation } from 'react-i18next';
import { api, apiErrorMessage } from '../../utils/api';
import { useSnackbar } from '../../contexts/SnackbarContext';
import { ExternalLink } from '../common/ExternalLink';
import {
  licenseSummary,
  useLicenseStatus,
  type LicenseStatusResponse,
} from '../../hooks/useLicenseStatus';
import { LicenseConsentSection } from '../license/LicenseConsentSection';

/**
 * Settings → License: the accepted terms and declared use (change it here),
 * paste the Auto Tournament license key, see what it covers, remove it, and
 * the public "Licensed" toggle (/api/license).
 *
 * Nothing is ever locked or limited by it: no key is a quiet note (free for
 * non-commercial use), and a problem with a key is a notice here. The key is
 * never shown again after saving; the license id identifies it.
 */
export function LicenseCard() {
  const { t } = useTranslation();
  const { showSuccess, showError } = useSnackbar();
  const { status, setStatus, loaded, reload } = useLicenseStatus();
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);

  if (!loaded) return <LinearProgress aria-label={t('license.loading')} />;
  if (!status) {
    return <Alert severity="warning">{t('license.loadFailed')}</Alert>;
  }

  const run = async (request: () => Promise<LicenseStatusResponse>, success: string, failure: string) => {
    setBusy(true);
    try {
      const res = await request();
      setStatus(res.license);
      showSuccess(success);
      return true;
    } catch (err) {
      showError(apiErrorMessage(err, failure));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    const saved = await run(
      () => api.put<LicenseStatusResponse>('/api/license', { key: key.trim() }),
      t('license.saved'),
      t('license.saveFailed')
    );
    if (saved) setKey('');
  };

  const remove = () =>
    run(
      () => api.delete('/api/license') as Promise<LicenseStatusResponse>,
      t('license.removed'),
      t('license.removeFailed')
    );

  const setBadge = (enabled: boolean) =>
    run(
      () => api.put<LicenseStatusResponse>('/api/license/public-badge', { enabled }),
      enabled ? t('license.badge.on') : t('license.badge.off'),
      t('license.badge.failed')
    );

  const { license, warnings } = status;
  const hasKey = status.status !== 'none';

  return (
    <Box data-testid="settings-license-card">
      <Typography variant="h6" fontWeight={600} gutterBottom>
        {t('license.title')}
      </Typography>
      <Typography variant="body2" color="text.secondary" mb={2}>
        {t('license.description')}
      </Typography>

      <Stack spacing={2}>
        {/* The use declared when the terms were accepted, and "Change" */}
        <LicenseConsentSection hasKey={hasKey} onChanged={() => void reload()} />

        {!hasKey && (
          <Typography variant="body2" color="text.secondary" data-testid="settings-license-none">
            {t('license.none')}{' '}
            <ExternalLink href={status.pricingUrl}>{t('license.pricing')}</ExternalLink>
          </Typography>
        )}

        {license && (
          <Box data-testid="settings-license-summary">
            <Typography variant="body1" fontWeight={600}>
              {licenseSummary(license, t)}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {t('license.id', { id: license.id })}
              {status.verifyUrl && (
                <>
                  {' · '}
                  <ExternalLink href={status.verifyUrl} data-testid="settings-license-verify">
                    {t('license.verify')}
                  </ExternalLink>
                </>
              )}
            </Typography>
          </Box>
        )}

        {status.status === 'invalid' && (
          <Alert severity="warning" data-testid="settings-license-invalid">
            {t('license.invalid')} {warnings[0]?.message}
          </Alert>
        )}
        {status.status === 'warning' && (
          <Alert severity="warning" data-testid="settings-license-warnings">
            <Box component="ul" sx={{ m: 0, pl: 2 }}>
              {warnings.map((w) => (
                <li key={w.code}>{w.message}</li>
              ))}
            </Box>
            <Typography variant="caption" display="block" mt={1}>
              {t('license.warningsNote')}
            </Typography>
          </Alert>
        )}

        <Stack
          component="form"
          direction={{ xs: 'column', sm: 'row' }}
          spacing={2}
          alignItems={{ sm: 'flex-start' }}
          onSubmit={(e: React.FormEvent) => {
            e.preventDefault();
            if (key.trim()) void save();
          }}
        >
          <TextField
            label={hasKey ? t('license.replaceLabel') : t('license.label')}
            value={key}
            onChange={(e) => setKey(e.target.value)}
            disabled={busy}
            size="small"
            placeholder="ATL1.…"
            multiline
            minRows={2}
            maxRows={6}
            autoComplete="off"
            helperText={t('license.helper')}
            sx={{ flex: 1 }}
            slotProps={{
              htmlInput: { spellCheck: false, 'data-testid': 'settings-license-input' },
            }}
          />
          <Stack direction="row" spacing={1}>
            <Button
              type="submit"
              variant="contained"
              disabled={!key.trim() || busy}
              data-testid="settings-license-save"
            >
              {t('license.save')}
            </Button>
            {hasKey && (
              <Button
                color="inherit"
                onClick={() => void remove()}
                disabled={busy}
                data-testid="settings-license-remove"
              >
                {t('license.remove')}
              </Button>
            )}
          </Stack>
        </Stack>

        <Box>
          <FormControlLabel
            control={
              <Switch
                checked={status.publicBadge}
                onChange={(event) => void setBadge(event.target.checked)}
                disabled={busy}
                color="primary"
                size="small"
                slotProps={{
                  input: {
                    'data-testid': 'settings-license-badge',
                  } as React.InputHTMLAttributes<HTMLInputElement>,
                }}
              />
            }
            label={t('license.badge.label')}
          />
          <Typography variant="caption" color="text.secondary" display="block">
            {t('license.badge.note')}
          </Typography>
        </Box>
      </Stack>
    </Box>
  );
}
