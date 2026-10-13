import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  TextField,
} from '@mui/material';
import { TotpEnrolment } from '../auth/TotpEnrolment';
import { postJson } from '../../utils/postJson';

/**
 * Two-step verification on /me/connections, for a password login: "Turn on"
 * shows the authenticator setup (QR code, key, a code to confirm); "Turn off"
 * asks for the password and a current code.
 */
export function TwoStepDialog({
  mode,
  onClose,
  onDone,
}: {
  /** null: closed. */
  mode: 'on' | 'off' | null;
  onClose: () => void;
  onDone: (on: boolean) => void;
}) {
  const { t } = useTranslation();
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const close = () => {
    setPassword('');
    setCode('');
    setError(null);
    onClose();
  };

  const turnOff = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { status, data } = await postJson('/api/auth/local/totp/disable', {
      password,
      totp: code.trim(),
    });
    setBusy(false);
    if (status === 200) {
      setPassword('');
      setCode('');
      onDone(false);
      return;
    }
    setError(
      (data as { totpRequired?: boolean }).totpRequired
        ? t('account.twoStep.codeNeeded')
        : (data as { error?: string }).error || t('account.twoStep.failed')
    );
  };

  return (
    <Dialog open={mode !== null} onClose={busy ? undefined : close} maxWidth="xs" fullWidth>
      <DialogTitle>
        {mode === 'on' ? t('account.twoStep.onTitle') : t('account.twoStep.offTitle')}
      </DialogTitle>
      {mode === 'on' && (
        <DialogContent>
          <TotpEnrolment onDone={() => onDone(true)} onSkip={close} />
        </DialogContent>
      )}
      {mode === 'off' && (
        <form onSubmit={turnOff}>
          <DialogContent>
            <Stack spacing={2}>
              <Alert severity="warning">{t('account.twoStep.offWarning')}</Alert>
              <TextField
                label={t('account.twoStep.password')}
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoFocus
                inputProps={{ 'data-testid': 'two-step-password' }}
              />
              <TextField
                label={t('account.twoStep.code')}
                value={code}
                onChange={(e) => setCode(e.target.value)}
                inputMode="numeric"
                autoComplete="one-time-code"
                required
                inputProps={{ 'data-testid': 'two-step-code' }}
              />
              {error && <Alert severity="error">{error}</Alert>}
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button onClick={close} disabled={busy}>
              {t('account.twoStep.cancel')}
            </Button>
            <Button
              type="submit"
              variant="contained"
              color="error"
              disabled={busy || !password || !code.trim()}
              data-testid="two-step-turn-off"
            >
              {t('account.twoStep.turnOff')}
            </Button>
          </DialogActions>
        </form>
      )}
    </Dialog>
  );
}
