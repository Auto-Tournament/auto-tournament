import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Alert, Box, Button, Stack, TextField, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import QRCode from 'qrcode';
import { postJson } from '../../utils/postJson';

/**
 * Turn on TOTP for the signed-in local admin: shows a scannable QR code and
 * the raw secret/otpauth:// link (for authenticator apps and password
 * managers like Bitwarden and 1Password), then asks for a code to confirm.
 */
export function TotpEnrolment({ onDone, onSkip }: { onDone: () => void; onSkip?: () => void }) {
  const { t } = useTranslation();
  const [secret, setSecret] = useState<{ secret: string; uri: string } | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<'key' | 'link' | null>(null);

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

  useEffect(() => {
    if (!secret) return;
    let cancelled = false;
    QRCode.toDataURL(secret.uri, { margin: 2, width: 360 })
      .then((url) => {
        if (!cancelled) setQrDataUrl(url);
      })
      .catch(() => {
        if (!cancelled) setQrDataUrl(null);
      });
    return () => {
      cancelled = true;
    };
  }, [secret]);

  const copy = async (text: string, which: 'key' | 'link') => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(which);
      setTimeout(() => setCopied((current) => (current === which ? null : current)), 2000);
    } catch {
      // Clipboard access can be denied by the browser; there's nothing more we can do.
    }
  };

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
          {qrDataUrl && (
            <Box sx={{ bgcolor: '#fff', display: 'inline-block', p: 1, borderRadius: 1, mb: 1.5 }}>
              <img
                src={qrDataUrl}
                alt={t('localAdmin.totp.qrAlt')}
                data-testid="totp-qr"
                width={180}
                height={180}
                style={{ display: 'block' }}
              />
            </Box>
          )}
          <Typography variant="caption" color="text.secondary">
            {t('localAdmin.totp.secretLabel')}
          </Typography>
          <Typography
            data-testid="totp-secret"
            sx={{ fontFamily: 'monospace', fontSize: '1rem', wordBreak: 'break-all', userSelect: 'all' }}
          >
            {secret.secret.match(/.{1,4}/g)?.join(' ')}
          </Typography>
          <Stack direction="row" spacing={1} mt={1}>
            <Button size="small" variant="outlined" onClick={() => copy(secret.secret, 'key')} data-testid="totp-copy-key">
              {copied === 'key' ? t('localAdmin.totp.copied') : t('localAdmin.totp.copyKey')}
            </Button>
            <Button size="small" variant="outlined" onClick={() => copy(secret.uri, 'link')} data-testid="totp-copy-link">
              {copied === 'link' ? t('localAdmin.totp.copied') : t('localAdmin.totp.copyLink')}
            </Button>
          </Stack>
          <Box aria-live="polite" sx={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>
            {copied && t('localAdmin.totp.copied')}
          </Box>
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
