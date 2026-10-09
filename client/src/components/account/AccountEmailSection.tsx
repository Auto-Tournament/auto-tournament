import { useCallback, useEffect, useState, type InputHTMLAttributes } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  FormControlLabel,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import { useTranslation } from 'react-i18next';
import { api, apiErrorMessage } from '../../utils/api';
import { useSnackbar } from '../../contexts/SnackbarContext';
import { fontDisplay, tokens } from '../../theme/tokens';

const { color, radius } = tokens;

interface MyEmail {
  email: string;
  verified: boolean;
  notifyTournaments: boolean;
}

/**
 * "Email" on the account page: your address (confirmed by a link sent to
 * it), used for password recovery, and whether you get an email when a
 * tournament opens its sign-up. Hidden when the site does not send email
 * and you have no address.
 */
export function AccountEmailSection() {
  const { t } = useTranslation();
  const { showSuccess, showError } = useSnackbar();
  const [loaded, setLoaded] = useState(false);
  const [email, setEmail] = useState<MyEmail | null>(null);
  const [canSend, setCanSend] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await api.get<{ email: MyEmail | null; canSend: boolean }>('/api/me/email');
      setEmail(res.email);
      setCanSend(res.canSend);
    } catch {
      setEmail(null);
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const submit = async () => {
    setBusy(true);
    try {
      const res = await api.put<{ email: MyEmail }>('/api/me/email', { email: draft.trim() });
      setEmail(res.email);
      setEditing(false);
      showSuccess(
        res.email.verified
          ? t('account.email.saved')
          : t('account.email.sent', { email: res.email.email })
      );
    } catch (err) {
      showError(apiErrorMessage(err, t('account.email.saveFailed')));
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    if (!email) return;
    setBusy(true);
    try {
      await api.put('/api/me/email', { email: email.email });
      showSuccess(t('account.email.sent', { email: email.email }));
    } catch (err) {
      showError(apiErrorMessage(err, t('account.email.saveFailed')));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      await api.delete('/api/me/email');
      setEmail(null);
      showSuccess(t('account.email.removed'));
    } catch (err) {
      showError(apiErrorMessage(err, t('account.email.saveFailed')));
    } finally {
      setBusy(false);
    }
  };

  const setNotify = async (on: boolean) => {
    setBusy(true);
    try {
      const res = await api.put<{ email: MyEmail }>('/api/me/email/notifications', {
        tournaments: on,
      });
      setEmail(res.email);
      showSuccess(on ? t('account.email.notifyOn') : t('account.email.notifyOff'));
    } catch (err) {
      showError(apiErrorMessage(err, t('account.email.saveFailed')));
    } finally {
      setBusy(false);
    }
  };

  if (!loaded || (!canSend && !email)) return null;

  const form = (
    <Stack
      component="form"
      direction={{ xs: 'column', sm: 'row' }}
      spacing={1}
      alignItems={{ sm: 'flex-start' }}
      onSubmit={(e) => {
        e.preventDefault();
        if (!busy && draft.trim()) void submit();
      }}
    >
      <TextField
        type="email"
        label={t('account.email.address')}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        size="small"
        fullWidth
        autoFocus={editing}
        autoComplete="email"
        inputProps={{ 'data-testid': 'account-email-input' }}
      />
      <Stack direction="row" spacing={1} sx={{ flex: 'none' }}>
        <Button
          type="submit"
          variant="contained"
          disabled={busy || !draft.trim()}
          data-testid="account-email-save"
        >
          {t('account.email.sendLink')}
        </Button>
        {editing && (
          <Button onClick={() => setEditing(false)} disabled={busy}>
            {t('account.email.cancel')}
          </Button>
        )}
      </Stack>
    </Stack>
  );

  return (
    <Box
      component="section"
      aria-labelledby="account-email"
      sx={{ mt: 6 }}
      data-testid="account-email"
    >
      <Typography
        id="account-email"
        component="h2"
        variant="h6"
        sx={{ fontFamily: fontDisplay, fontWeight: 600 }}
      >
        {t('account.email.title')}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, mb: 2, maxWidth: '62ch' }}>
        {t('account.email.description')}
      </Typography>

      {!email || editing ? (
        <Box sx={{ maxWidth: 560 }}>{form}</Box>
      ) : (
        <Stack spacing={2} sx={{ maxWidth: 560 }}>
          <Box
            sx={{
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              columnGap: 2,
              rowGap: 1,
              px: 2,
              py: 1.5,
              bgcolor: color.paper2,
              border: `1px solid ${color.rule}`,
              borderRadius: `${radius.lg}px`,
            }}
          >
            <Box sx={{ flex: '1 1 220px', minWidth: 0 }}>
              <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                <Typography sx={{ fontWeight: 500, overflowWrap: 'anywhere' }}>
                  {email.email}
                </Typography>
                <Chip
                  size="small"
                  variant="outlined"
                  color={email.verified ? 'success' : 'warning'}
                  label={
                    email.verified ? t('account.email.verified') : t('account.email.unverified')
                  }
                />
              </Stack>
              {!email.verified && (
                <Typography sx={{ color: color.muted, fontSize: '0.875rem' }}>
                  {t('account.email.checkInbox')}
                </Typography>
              )}
            </Box>
            <Stack direction="row" spacing={0.5} sx={{ flex: 'none' }}>
              {!email.verified && canSend && (
                <Button
                  size="small"
                  disabled={busy}
                  onClick={() => void resend()}
                  data-testid="account-email-resend"
                >
                  {t('account.email.resend')}
                </Button>
              )}
              {canSend && (
                <Button
                  size="small"
                  disabled={busy}
                  onClick={() => {
                    setDraft(email.email);
                    setEditing(true);
                  }}
                >
                  {t('account.email.change')}
                </Button>
              )}
              <Button
                size="small"
                color="inherit"
                disabled={busy}
                onClick={() => void remove()}
                data-testid="account-email-remove"
              >
                {t('account.email.remove')}
              </Button>
            </Stack>
          </Box>

          <FormControlLabel
            control={
              <Switch
                checked={email.notifyTournaments}
                disabled={busy || !email.verified}
                onChange={(e) => void setNotify(e.target.checked)}
                slotProps={{
                  input: {
                    'data-testid': 'account-email-notify',
                  } as InputHTMLAttributes<HTMLInputElement>,
                }}
              />
            }
            label={
              <Box>
                <Typography sx={{ fontWeight: 500 }}>{t('account.email.notifyLabel')}</Typography>
                <Typography sx={{ fontSize: '0.8125rem', color: color.muted }}>
                  {email.verified
                    ? t('account.email.notifyHint')
                    : t('account.email.notifyNeedsVerified')}
                </Typography>
              </Box>
            }
            sx={{ alignItems: 'flex-start', ml: 0, gap: 1, '& .MuiSwitch-root': { mt: 0.25 } }}
          />
          {!canSend && <Alert severity="info">{t('account.email.siteCannotSend')}</Alert>}
        </Stack>
      )}
    </Box>
  );
}
