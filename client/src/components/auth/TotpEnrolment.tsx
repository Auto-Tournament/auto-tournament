import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Alert, Box, Button, Stack, TextField, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { postJson } from '../../utils/postJson';

/**
 * Turn on TOTP for the signed-in local admin: shows the secret (and an
 * otpauth:// link for phones), then asks for a code to confirm.
 */
export function TotpEnrolment({ onDone, onSkip }: { onDone: () => void; onSkip?: () => void }) {
  const { t } = useTranslation();
  const [secret, setSecret] = useState<{ secret: string; uri: string } | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Once per mount: a second start would replace the pending secret shown here.
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void postJson<{ secret: string; uri: string }>('/api/auth/local/totp/start', {}).then(({ status, data }) => {
      if (status === 200) setSecret({ secret: data.secret, uri: data.uri });
      else setError(data.error || t('localAdmin.totp.startError'));
    });
  }, [t]);

  const confirm = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const { status, data } = await postJson('/api/auth/local/totp/confirm', { code: code.trim() });
    setBusy(false);
    if (status === 200) onDone();
    else setError(data.error || t('localAdmin.totp.wrongCode'));
  };

  return (
    <Stack spacing={2} component="form" onSubmit={confirm} data-testid="totp-enrolment">
      <Typography variant="body2">{t('localAdmin.totp.intro')}</Typography>
      {secret && (
        <Box>
          <Typography variant="caption" color="text.secondary">
            {t('localAdmin.totp.secretLabel')}
          </Typography>
          <Typography
            data-testid="totp-secret"
            sx={{ fontFamily: 'monospace', fontSize: '1rem', wordBreak: 'break-all', userSelect: 'all' }}
          >
            {secret.secret.match(/.{1,4}/g)?.join(' ')}
          </Typography>
          <Typography variant="body2" mt={1}>
            <a href={secret.uri}>{t('localAdmin.totp.openInApp')}</a>
          </Typography>
        </Box>
      )}
      <TextField
        label={t('localAdmin.totp.code')}
        value={code}
        onChange={(e) => setCode(e.target.value)}
        inputProps={{ inputMode: 'numeric', autoComplete: 'one-time-code', maxLength: 7, 'data-testid': 'totp-confirm-code' }}
        size="small"
        fullWidth
      />
      {error && <Alert severity="error">{error}</Alert>}
      <Stack direction="row" spacing={1}>
        <Button type="submit" variant="contained" disabled={busy || !secret || code.trim().length < 6} data-testid="totp-confirm">
          {t('localAdmin.totp.turnOn')}
        </Button>
        {onSkip && (
          <Button onClick={onSkip} disabled={busy} data-testid="totp-skip">
            {t('localAdmin.totp.skip')}
          </Button>
        )}
      </Stack>
    </Stack>
  );
}
