import { useEffect, useState, type FormEvent } from 'react';
import { Alert, Button, LinearProgress, Stack, TextField, Typography } from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AuthCard } from '../components/auth/AuthCard';
import { TotpEnrolment } from '../components/auth/TotpEnrolment';
import { postJson } from '../utils/postJson';
import { pageTitle } from '../utils/pageTitle';
import { paths } from '../paths';

type Step = 'loading' | 'closed' | 'code' | 'account' | 'totp';

/** Where setup ends: Settings -> Sign-in, with the "Set up how players sign in" banner. */
const AFTER_SETUP = '/manage/settings?section=signin&welcome=setup';

/**
 * /setup: the first admin on a fresh install, or recovery with a reset-admin
 * code. Code -> username + password -> optional TOTP -> Settings -> Sign-in.
 * A full page load at the end, so the app picks up the new admin session.
 */
export default function Setup() {
  const { t } = useTranslation();
  const [step, setStep] = useState<Step>('loading');
  const [mode, setMode] = useState<'setup' | 'reset'>('setup');
  const [code, setCode] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    document.title = pageTitle(t('adminSetup.title'));
    void fetch('/api/setup/status', { credentials: 'same-origin' }).then(async (res) => {
      if (!res.ok) return setStep('closed');
      const data = (await res.json()) as { mode?: 'setup' | 'reset' };
      setMode(data.mode === 'reset' ? 'reset' : 'setup');
      setStep('code');
    });
  }, [t]);

  const finish = () => window.location.assign(AFTER_SETUP);

  const submitCode = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { status, data } = await postJson('/api/setup/check', { code });
    setBusy(false);
    if (status === 200) return setStep('account');
    if (status === 404) return setStep('closed');
    setError(status === 429 ? data.error || t('adminSetup.tooMany') : t('adminSetup.badCode'));
  };

  const submitAccount = async (e: FormEvent) => {
    e.preventDefault();
    if (password !== confirm) return setError(t('adminSetup.mismatch'));
    setBusy(true);
    setError(null);
    const { status, data } = await postJson<{ problem?: string }>('/api/setup/complete', { code, username, password });
    setBusy(false);
    if (status === 200) return setStep('totp');
    if (status === 404) return setStep('closed');
    if (status === 400 && data.problem) return setError(t(`adminSetup.problem.${data.problem}`));
    if (status === 400) {
      setStep('code');
      return setError(t('adminSetup.badCode'));
    }
    setError(data.error || t('adminSetup.failed'));
  };

  if (step === 'loading') {
    return (
      <AuthCard title={t('adminSetup.title')}>
        <LinearProgress aria-label={t('adminSetup.title')} />
      </AuthCard>
    );
  }

  if (step === 'closed') {
    return (
      <AuthCard title={t('adminSetup.closedTitle')} subtitle={t('adminSetup.closedBody')}>
        <Button component={RouterLink} to={paths.login} variant="contained">
          {t('adminSetup.toLogin')}
        </Button>
      </AuthCard>
    );
  }

  if (step === 'totp') {
    return (
      <AuthCard title={t('adminSetup.totpTitle')} subtitle={t('adminSetup.totpSubtitle')}>
        <TotpEnrolment onDone={finish} onSkip={finish} />
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title={mode === 'reset' ? t('adminSetup.resetTitle') : t('adminSetup.title')}
      subtitle={step === 'code' ? (mode === 'reset' ? t('adminSetup.resetCodeIntro') : t('adminSetup.codeIntro')) : t('adminSetup.accountIntro')}
    >
      {step === 'code' ? (
        <Stack spacing={2} component="form" onSubmit={submitCode} data-testid="setup-code-form">
          <TextField
            label={t('adminSetup.code')}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            autoFocus
            fullWidth
            autoComplete="off"
            inputProps={{ spellCheck: false, 'data-testid': 'setup-code', style: { fontFamily: 'monospace' } }}
          />
          {error && <Alert severity="error">{error}</Alert>}
          <Button type="submit" variant="contained" size="large" disabled={busy || !code.trim()} data-testid="setup-code-submit">
            {t('adminSetup.continue')}
          </Button>
        </Stack>
      ) : (
        <Stack spacing={2} component="form" onSubmit={submitAccount} data-testid="setup-account-form">
          {mode === 'reset' && <Alert severity="info">{t('adminSetup.resetAccountHint')}</Alert>}
          <TextField
            label={t('adminSetup.username')}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            helperText={t('adminSetup.usernameHelp')}
            autoFocus
            fullWidth
            autoComplete="username"
            inputProps={{ spellCheck: false, 'data-testid': 'setup-username' }}
          />
          <TextField
            label={t('adminSetup.password')}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            helperText={t('adminSetup.passwordHelp')}
            fullWidth
            autoComplete="new-password"
            inputProps={{ 'data-testid': 'setup-password' }}
          />
          <TextField
            label={t('adminSetup.confirm')}
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            fullWidth
            autoComplete="new-password"
            inputProps={{ 'data-testid': 'setup-confirm' }}
          />
          {error && <Alert severity="error">{error}</Alert>}
          <Button type="submit" variant="contained" size="large" disabled={busy || !username || !password} data-testid="setup-account-submit">
            {mode === 'reset' ? t('adminSetup.saveReset') : t('adminSetup.create')}
          </Button>
          <Typography variant="caption" color="text.secondary">
            {t('adminSetup.after')}
          </Typography>
        </Stack>
      )}
    </AuthCard>
  );
}
