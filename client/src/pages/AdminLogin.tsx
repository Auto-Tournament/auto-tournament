import { useEffect, useState, type FormEvent } from 'react';
import { Alert, Button, Link, Stack, TextField } from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AuthCard } from '../components/auth/AuthCard';
import { postJson } from '../utils/postJson';
import { pageTitle } from '../utils/pageTitle';
import { paths } from '../paths';

/**
 * /login/admin: local admin sign-in (username + password, then the TOTP code
 * when the account has one). A full page load on success, so the app picks
 * up the admin session.
 */
export default function AdminLogin() {
  const { t } = useTranslation();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [totp, setTotp] = useState('');
  const [needTotp, setNeedTotp] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    document.title = pageTitle(t('localAdmin.title'));
  }, [t]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { status, data } = await postJson<{ totpRequired?: boolean }>('/api/auth/local/login', {
      username,
      password,
      ...(needTotp ? { totp: totp.trim() } : {}),
    });
    setBusy(false);
    if (status === 200) return window.location.assign(paths.root);
    if (data.totpRequired && !needTotp) {
      setNeedTotp(true);
      return;
    }
    if (status === 429) return setError(t('localAdmin.tooMany'));
    if (status === 403) return setError(t('localAdmin.off'));
    setError(t('localAdmin.failed'));
  };

  return (
    <AuthCard title={t('localAdmin.title')} subtitle={t('localAdmin.subtitle')}>
      <Stack spacing={2} component="form" onSubmit={submit} data-testid="admin-login-form">
        <TextField
          label={t('adminSetup.username')}
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoFocus={!needTotp}
          fullWidth
          autoComplete="username"
          disabled={needTotp}
          inputProps={{ spellCheck: false, 'data-testid': 'admin-login-username' }}
        />
        <TextField
          label={t('adminSetup.password')}
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          fullWidth
          autoComplete="current-password"
          disabled={needTotp}
          inputProps={{ 'data-testid': 'admin-login-password' }}
        />
        {needTotp && (
          <TextField
            label={t('localAdmin.totp.code')}
            value={totp}
            onChange={(e) => setTotp(e.target.value)}
            autoFocus
            fullWidth
            helperText={t('localAdmin.totpHelp')}
            inputProps={{ inputMode: 'numeric', autoComplete: 'one-time-code', maxLength: 7, 'data-testid': 'admin-login-totp' }}
          />
        )}
        {error && (
          <Alert severity="error" data-testid="admin-login-error">
            {error}
          </Alert>
        )}
        <Button type="submit" variant="contained" size="large" disabled={busy || !username || !password} data-testid="admin-login-submit">
          {t('localAdmin.signIn')}
        </Button>
        <Link component={RouterLink} to={paths.login} variant="body2" sx={{ textAlign: 'center' }}>
          {t('localAdmin.back')}
        </Link>
      </Stack>
    </AuthCard>
  );
}
