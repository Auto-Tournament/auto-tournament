import { useEffect, useState, type FormEvent } from 'react';
import { Alert, Button, CircularProgress, Stack, TextField } from '@mui/material';
import { useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AuthCard } from '../components/auth/AuthCard';
import { TotpEnrolment } from '../components/auth/TotpEnrolment';
import { api, apiErrorMessage } from '../utils/api';
import { pageTitle } from '../utils/pageTitle';
import { paths } from '../paths';

type Step = 'loading' | 'password' | 'email' | 'totp';

/**
 * /login/welcome: the first sign-in of an account an admin made (or gave a
 * new password). Like the first-admin setup: choose your own password, add
 * an email address for recovery (when the site sends email), and turn on
 * two-step verification if you want it. A full page load at the end.
 */
export default function FirstSignIn() {
  const { t } = useTranslation();
  const location = useLocation();
  // The password they just signed in with, handed over by /login/admin.
  const given = (location.state as { password?: string } | null)?.password ?? '';
  const [step, setStep] = useState<Step>('loading');
  const [username, setUsername] = useState('');
  const [canEmail, setCanEmail] = useState(false);
  const [current, setCurrent] = useState(given);
  const [next, setNext] = useState('');
  const [repeat, setRepeat] = useState('');
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    document.title = pageTitle(t('firstSignIn.title'));
  }, [t]);

  useEffect(() => {
    void (async () => {
      try {
        const me = await api.get<{ username: string; mustChangePassword: boolean }>(
          '/api/auth/local/me'
        );
        if (!me.mustChangePassword) {
          window.location.assign(paths.root);
          return;
        }
        setUsername(me.username);
        const mail = await api
          .get<{ canSend: boolean }>('/api/me/email')
          .catch(() => ({ canSend: false }));
        setCanEmail(mail.canSend);
        setStep('password');
      } catch {
        window.location.assign(paths.adminLogin);
      }
    })();
  }, []);

  const finish = () => window.location.assign(paths.root);

  const savePassword = async (e: FormEvent) => {
    e.preventDefault();
    if (next !== repeat) {
      setError(t('firstSignIn.mismatch'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.post('/api/auth/local/password', { currentPassword: current, newPassword: next });
      setStep(canEmail ? 'email' : 'totp');
    } catch (err) {
      setError(apiErrorMessage(err, t('firstSignIn.passwordFailed')));
    } finally {
      setBusy(false);
    }
  };

  const saveEmail = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.put('/api/me/email', { email: email.trim() });
      setInfo(t('firstSignIn.emailSent', { email: email.trim() }));
      setStep('totp');
    } catch (err) {
      setError(apiErrorMessage(err, t('firstSignIn.emailFailed')));
    } finally {
      setBusy(false);
    }
  };

  if (step === 'loading') {
    return (
      <AuthCard title={t('firstSignIn.title')}>
        <Stack alignItems="center" sx={{ py: 3 }}>
          <CircularProgress size={28} />
        </Stack>
      </AuthCard>
    );
  }

  if (step === 'totp') {
    return (
      <AuthCard title={t('firstSignIn.totpTitle')} subtitle={t('firstSignIn.totpSubtitle')}>
        {info && (
          <Alert severity="success" sx={{ mb: 2 }}>
            {info}
          </Alert>
        )}
        <TotpEnrolment onDone={finish} onSkip={finish} />
      </AuthCard>
    );
  }

  if (step === 'email') {
    return (
      <AuthCard title={t('firstSignIn.emailTitle')} subtitle={t('firstSignIn.emailSubtitle')}>
        <Stack spacing={2} component="form" onSubmit={saveEmail} data-testid="first-sign-in-email">
          <TextField
            type="email"
            label={t('firstSignIn.email')}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoFocus
            fullWidth
            autoComplete="email"
            inputProps={{ 'data-testid': 'first-sign-in-email-input' }}
          />
          {error && <Alert severity="error">{error}</Alert>}
          <Button type="submit" variant="contained" size="large" disabled={busy || !email.trim()}>
            {t('firstSignIn.emailSend')}
          </Button>
          <Button
            onClick={() => setStep('totp')}
            disabled={busy}
            data-testid="first-sign-in-email-skip"
          >
            {t('firstSignIn.skip')}
          </Button>
        </Stack>
      </AuthCard>
    );
  }

  const mismatch = repeat.length > 0 && next !== repeat;
  return (
    <AuthCard title={t('firstSignIn.title')} subtitle={t('firstSignIn.subtitle', { username })}>
      <Stack
        spacing={2}
        component="form"
        onSubmit={savePassword}
        data-testid="first-sign-in-password"
      >
        {!given && (
          <TextField
            type="password"
            label={t('firstSignIn.current')}
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            fullWidth
            autoComplete="current-password"
            helperText={t('firstSignIn.currentHelp')}
            inputProps={{ 'data-testid': 'first-sign-in-current' }}
          />
        )}
        <TextField
          type="password"
          label={t('firstSignIn.new')}
          value={next}
          onChange={(e) => setNext(e.target.value)}
          autoFocus
          fullWidth
          autoComplete="new-password"
          inputProps={{ 'data-testid': 'first-sign-in-new' }}
        />
        <TextField
          type="password"
          label={t('firstSignIn.repeat')}
          value={repeat}
          onChange={(e) => setRepeat(e.target.value)}
          fullWidth
          autoComplete="new-password"
          error={mismatch}
          helperText={mismatch ? t('firstSignIn.mismatch') : ' '}
          inputProps={{ 'data-testid': 'first-sign-in-repeat' }}
        />
        {error && <Alert severity="error">{error}</Alert>}
        <Button
          type="submit"
          variant="contained"
          size="large"
          disabled={busy || !current || !next || next !== repeat}
          data-testid="first-sign-in-save"
        >
          {t('firstSignIn.save')}
        </Button>
      </Stack>
    </AuthCard>
  );
}
