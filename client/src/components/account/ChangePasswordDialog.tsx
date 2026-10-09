import { useState } from 'react';
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
import { useTranslation } from 'react-i18next';
import { apiErrorFlag, changeOwnPassword } from './connectionsApi';
import { apiErrorMessage } from '../../utils/api';

/**
 * "Change password" on /me/connections: the current password (and the
 * authenticator code when two-step is on), then the new one twice. Two-step
 * verification stays on.
 */
export function ChangePasswordDialog({
  open,
  totpEnabled,
  onClose,
  onDone,
}: {
  open: boolean;
  totpEnabled: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [repeat, setRepeat] = useState('');
  const [totp, setTotp] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reset = () => {
    setCurrent('');
    setNext('');
    setRepeat('');
    setTotp('');
    setError(null);
  };
  const close = () => {
    if (busy) return;
    reset();
    onClose();
  };

  const mismatch = repeat.length > 0 && next !== repeat;
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await changeOwnPassword(current, next, totp.trim() || undefined);
      reset();
      onDone();
    } catch (err) {
      setError(
        apiErrorFlag(err, 'totpRequired') && !totp
          ? t('account.changePassword.totpNeeded')
          : apiErrorMessage(err, t('account.changePassword.failed'))
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={close}
      fullWidth
      maxWidth="xs"
      aria-labelledby="change-password-title"
    >
      <DialogTitle id="change-password-title">{t('account.changePassword.title')}</DialogTitle>
      <DialogContent>
        <Stack
          component="form"
          spacing={2}
          sx={{ pt: 1 }}
          onSubmit={(e) => {
            e.preventDefault();
            if (!busy && current && next && next === repeat) void submit();
          }}
        >
          {error && <Alert severity="error">{error}</Alert>}
          <TextField
            type="password"
            autoComplete="current-password"
            label={t('account.changePassword.current')}
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            size="small"
            fullWidth
            autoFocus
            inputProps={{ 'data-testid': 'change-password-current' }}
          />
          {totpEnabled && (
            <TextField
              label={t('account.changePassword.totp')}
              value={totp}
              onChange={(e) => setTotp(e.target.value)}
              size="small"
              fullWidth
              autoComplete="one-time-code"
              inputProps={{ inputMode: 'numeric', 'data-testid': 'change-password-totp' }}
            />
          )}
          <TextField
            type="password"
            autoComplete="new-password"
            label={t('account.changePassword.new')}
            value={next}
            onChange={(e) => setNext(e.target.value)}
            size="small"
            fullWidth
            inputProps={{ 'data-testid': 'change-password-new' }}
          />
          <TextField
            type="password"
            autoComplete="new-password"
            label={t('account.changePassword.repeat')}
            value={repeat}
            onChange={(e) => setRepeat(e.target.value)}
            error={mismatch}
            helperText={mismatch ? t('account.changePassword.mismatch') : ' '}
            size="small"
            fullWidth
            inputProps={{ 'data-testid': 'change-password-repeat' }}
          />
          <button type="submit" hidden />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={close} disabled={busy}>
          {t('account.changePassword.cancel')}
        </Button>
        <Button
          variant="contained"
          disabled={busy || !current || !next || next !== repeat}
          onClick={() => void submit()}
          data-testid="change-password-save"
        >
          {t('account.changePassword.save')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
