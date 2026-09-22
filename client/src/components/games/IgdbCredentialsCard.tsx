import React, { useEffect, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import Link from '@mui/material/Link';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import { useTranslation } from 'react-i18next';
import { api, apiErrorMessage } from '../../utils/api';
import { useSnackbar } from '../../contexts/SnackbarContext';

interface IgdbStatus {
  configured: boolean;
  source: 'env' | 'settings' | null;
  envOverride: boolean;
  clientId: string | null;
  clientSecretSet: boolean;
}

const TWITCH_CONSOLE_URL = 'https://dev.twitch.tv/console/apps';

/**
 * Admin card for the IGDB credentials (a Twitch application's client id and
 * secret). The secret is write-only: the API never returns it, so the field
 * starts empty and saving an empty field keeps the stored one.
 */
export function IgdbCredentialsCard() {
  const { t } = useTranslation();
  const { showSuccess, showError } = useSnackbar();
  const [status, setStatus] = useState<IgdbStatus | null>(null);
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  const apply = (next: IgdbStatus) => {
    setStatus(next);
    setClientId(next.envOverride ? '' : (next.clientId ?? ''));
    setClientSecret('');
  };

  useEffect(() => {
    api
      .get<{ igdb: IgdbStatus }>('/api/settings/igdb')
      .then((res) => apply(res.igdb))
      .catch(() => setStatus(null));
  }, []);

  if (!status) return null;

  const storedId = status.envOverride ? '' : (status.clientId ?? '');
  const dirty = clientId.trim() !== storedId || clientSecret.trim() !== '';
  const canSave = dirty && clientId.trim() !== '' && (status.clientSecretSet || clientSecret.trim() !== '');

  const save = async () => {
    setSaving(true);
    setTestResult(null);
    try {
      const res = await api.put<{ igdb: IgdbStatus }>('/api/settings/igdb', {
        clientId: clientId.trim(),
        clientSecret: clientSecret.trim(),
      });
      apply(res.igdb);
      showSuccess(t('games.igdb.saved'));
    } catch (err) {
      showError(apiErrorMessage(err, t('games.igdb.saveFailed')));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    setSaving(true);
    setTestResult(null);
    try {
      const res = await api.put<{ igdb: IgdbStatus }>('/api/settings/igdb', { clientId: null });
      apply(res.igdb);
      showSuccess(t('games.igdb.removed'));
    } catch (err) {
      showError(apiErrorMessage(err, t('games.igdb.saveFailed')));
    } finally {
      setSaving(false);
    }
  };

  const test = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await api.post<{ ok: boolean; error?: string }>('/api/settings/igdb/test');
      setTestResult(
        res.ok
          ? { ok: true, message: t('games.igdb.testOk') }
          : { ok: false, message: t('games.igdb.testFailed', { error: res.error ?? '' }) }
      );
    } catch (err) {
      setTestResult({
        ok: false,
        message: t('games.igdb.testFailed', { error: apiErrorMessage(err, '') }),
      });
    } finally {
      setTesting(false);
    }
  };

  return (
    <Box data-testid="settings-igdb-card">
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5, flexWrap: 'wrap' }}>
        <Typography variant="h6" fontWeight={600}>
          {t('games.igdb.title')}
        </Typography>
        <Chip
          size="small"
          color={status.configured ? 'success' : 'default'}
          variant={status.configured ? 'filled' : 'outlined'}
          label={
            status.configured ? t('games.igdb.statusConfigured') : t('games.igdb.statusNotConfigured')
          }
          data-testid="settings-igdb-status"
        />
      </Box>
      <Typography variant="body2" color="text.secondary" mb={1}>
        {t('games.igdb.description')}
      </Typography>
      <Typography variant="body2" color="text.secondary" mb={1}>
        {t('games.igdb.howTo')}
      </Typography>
      <Link
        href={TWITCH_CONSOLE_URL}
        target="_blank"
        rel="noopener noreferrer"
        variant="body2"
        sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, mb: 2 }}
      >
        {t('games.igdb.consoleLink')}
        <OpenInNewIcon sx={{ fontSize: 16 }} aria-hidden />
      </Link>

      {status.envOverride && (
        <Alert severity="info" sx={{ mb: 2 }}>
          {t('games.igdb.envOverride')}
        </Alert>
      )}

      <Stack
        component="form"
        direction={{ xs: 'column', md: 'row' }}
        spacing={2}
        alignItems={{ md: 'flex-start' }}
        onSubmit={(e: React.FormEvent) => {
          e.preventDefault();
          if (canSave) void save();
        }}
      >
        <TextField
          label={t('games.igdb.clientId')}
          value={clientId}
          onChange={(e) => setClientId(e.target.value)}
          disabled={saving || status.envOverride}
          size="small"
          autoComplete="off"
          sx={{ flex: 1 }}
          slotProps={{ htmlInput: { 'data-testid': 'settings-igdb-client-id' } }}
        />
        <TextField
          label={t('games.igdb.clientSecret')}
          type="password"
          value={clientSecret}
          onChange={(e) => setClientSecret(e.target.value)}
          disabled={saving || status.envOverride}
          size="small"
          autoComplete="new-password"
          placeholder={status.clientSecretSet ? t('games.igdb.secretSetPlaceholder') : undefined}
          helperText={t('games.igdb.secretHelper')}
          sx={{ flex: 1 }}
          slotProps={{
            inputLabel: { shrink: status.clientSecretSet || clientSecret !== '' ? true : undefined },
            htmlInput: { 'data-testid': 'settings-igdb-client-secret' },
          }}
        />
      </Stack>

      <Box sx={{ display: 'flex', gap: 1, mt: 2, flexWrap: 'wrap', alignItems: 'center' }}>
        {!status.envOverride && (
          <Button
            variant="contained"
            onClick={() => void save()}
            disabled={!canSave || saving}
            startIcon={saving ? <CircularProgress size={16} color="inherit" /> : undefined}
            data-testid="settings-igdb-save"
          >
            {t('games.igdb.save')}
          </Button>
        )}
        <Button
          variant="outlined"
          onClick={() => void test()}
          disabled={!status.configured || testing || dirty}
          startIcon={testing ? <CircularProgress size={16} color="inherit" /> : undefined}
          data-testid="settings-igdb-test"
        >
          {testing ? t('games.igdb.testing') : t('games.igdb.test')}
        </Button>
        {!status.envOverride && status.source === 'settings' && (
          <Button color="error" onClick={() => void remove()} disabled={saving}>
            {t('games.igdb.remove')}
          </Button>
        )}
      </Box>

      {testResult && (
        <Alert
          severity={testResult.ok ? 'success' : 'error'}
          sx={{ mt: 2 }}
          data-testid="settings-igdb-test-result"
        >
          {testResult.message}
        </Alert>
      )}
    </Box>
  );
}
