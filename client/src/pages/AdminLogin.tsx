import { useEffect, useState, type FormEvent } from 'react';
import { Alert, Button, Divider, Link, Stack, TextField } from '@mui/material';
import {
  browserSupportsWebAuthn,
  startAuthentication,
  type PublicKeyCredentialRequestOptionsJSON,
} from '@simplewebauthn/browser';
import { Link as RouterLink, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AuthCard } from '../components/auth/AuthCard';
import { postJson } from '../utils/postJson';
import { pageTitle } from '../utils/pageTitle';
import { paths } from '../paths';

/**
 * /login/admin: local admin sign-in (username + password, then the TOTP code
 * when the account has one), or a passkey instead of both. A full page load
 * on success, so the app picks up the admin session.
 */
export default function AdminLogin() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [totp, setTotp] = useState('');
  const [needTotp, setNeedTotp] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    document.title = pageTitle(t('localAdmin.title'));
  }, [t]);

  // "Forgot your password?" only when the site sends email; without it an
  // admin sets a new password on Settings -> Sign-in -> Accounts.
  const [emailRecovery, setEmailRecovery] = useState(false);
  // "Sign in with a passkey" when the site allows passkeys (https or localhost) and so does the browser.
  const [passkeys, setPasskeys] = useState(false);
  useEffect(() => {
    void fetch('/api/auth/local/status', { credentials: 'same-origin' })
      .then((r) =>
        r.ok ? (r.json() as Promise<{ emailRecovery?: boolean; passkeys?: boolean }>) : null
      )
      .then((b) => {
        setEmailRecovery(b?.emailRecovery === true);
        setPasskeys(b?.passkeys === true && window.isSecureContext && browserSupportsWebAuthn());
      })
      .catch(() => undefined);
  }, []);

  const signInWithPasskey = async () => {
    setBusy(true);
    setError(null);
    try {
      const start = await postJson<{ options?: PublicKeyCredentialRequestOptionsJSON }>(
        '/api/auth/local/passkeys/login/options',
        {}
      );
      if (start.status !== 200 || !start.data.options) {
        setError(start.status === 403 ? t('localAdmin.off') : t('localAdmin.passkey.failed'));
        return;
      }
      const response = await startAuthentication({ optionsJSON: start.data.options });
      const { status, data } = await postJson<{ mustChangePassword?: boolean }>(
        '/api/auth/local/passkeys/login/verify',
        { response }
      );
      if (status === 200 && data.mustChangePassword) return navigate(paths.firstSignIn);
      if (status === 200) return window.location.assign(paths.root);
      setError(status === 429 ? t('localAdmin.tooMany') : t('localAdmin.passkey.failed'));
    } catch (err) {
      // NotAllowedError: the browser's dialog was cancelled or timed out.
      if ((err as Error)?.name !== 'NotAllowedError') setError(t('localAdmin.passkey.failed'));
    } finally {
      setBusy(false);
    }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { status, data } = await postJson<{
      totpRequired?: boolean;
      mustChangePassword?: boolean;
    }>('/api/auth/local/login', {
      username,
      password,
      ...(needTotp ? { totp: totp.trim() } : {}),
    });
    setBusy(false);
    // A password an admin chose: pick your own first (the password goes along, not stored).
    if (status === 200 && data.mustChangePassword)
      return navigate(paths.firstSignIn, { state: { password } });
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
            inputProps={{
              inputMode: 'numeric',
              autoComplete: 'one-time-code',
              maxLength: 7,
              'data-testid': 'admin-login-totp',
            }}
          />
        )}
        {error && (
          <Alert severity="error" data-testid="admin-login-error">
            {error}
          </Alert>
        )}
        <Button
          type="submit"
          variant="contained"
          size="large"
          disabled={busy || !username || !password}
          data-testid="admin-login-submit"
        >
          {t('localAdmin.signIn')}
        </Button>
        {passkeys && !needTotp && (
          <>
            <Divider>{t('localAdmin.passkey.or')}</Divider>
            <Button
              variant="outlined"
              size="large"
              disabled={busy}
              onClick={() => void signInWithPasskey()}
              data-testid="admin-login-passkey"
            >
              {t('localAdmin.passkey.signIn')}
            </Button>
          </>
        )}
        <Stack
          direction="row"
          justifyContent="space-between"
          flexWrap="wrap"
          useFlexGap
          spacing={1}
        >
          <Link component={RouterLink} to={paths.login} variant="body2">
            {t('localAdmin.back')}
          </Link>
          {emailRecovery && (
            <Link
              component={RouterLink}
              to={paths.forgotPassword}
              variant="body2"
              data-testid="admin-login-forgot"
            >
              {t('localAdmin.forgot')}
            </Link>
          )}
        </Stack>
      </Stack>
    </AuthCard>
  );
}
