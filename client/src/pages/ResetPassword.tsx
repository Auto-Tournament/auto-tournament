import { useEffect, useState, type FormEvent } from 'react';
import { Alert, Button, Link, Stack, TextField } from '@mui/material';
import { Link as RouterLink, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AuthCard } from '../components/auth/AuthCard';
import { postJson } from '../utils/postJson';
import { pageTitle } from '../utils/pageTitle';
import { paths } from '../paths';

/** /login/reset?token=…: choose a new password from a reset email's link. */
export default function ResetPassword() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [next, setNext] = useState('');
  const [repeat, setRepeat] = useState('');
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    document.title = pageTitle(t('resetPassword.title'));
  }, [t]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { status, data } = await postJson<{ username?: string; error?: string }>(
      '/api/auth/local/reset',
      {
        token,
        password: next,
      }
    );
    setBusy(false);
    if (status === 200) return setDone(data.username ?? '');
    setError(status === 400 && data.error ? data.error : t('resetPassword.failed'));
  };

  return (
    <AuthCard
      title={t('resetPassword.title')}
      subtitle={done === null ? t('resetPassword.subtitle') : undefined}
    >
      {done !== null ? (
        <Stack spacing={2}>
          <Alert severity="success" data-testid="reset-done">
            {t('resetPassword.done', { username: done })}
          </Alert>
          <Button component={RouterLink} to={paths.adminLogin} variant="contained" size="large">
            {t('resetPassword.signIn')}
          </Button>
        </Stack>
      ) : !token ? (
        <Stack spacing={2}>
          <Alert severity="error">{t('resetPassword.noToken')}</Alert>
          <Link
            component={RouterLink}
            to={paths.forgotPassword}
            variant="body2"
            sx={{ textAlign: 'center' }}
          >
            {t('resetPassword.askAgain')}
          </Link>
        </Stack>
      ) : (
        <Stack spacing={2} component="form" onSubmit={submit} data-testid="reset-form">
          <TextField
            type="password"
            label={t('resetPassword.new')}
            value={next}
            onChange={(e) => setNext(e.target.value)}
            autoFocus
            fullWidth
            autoComplete="new-password"
            inputProps={{ 'data-testid': 'reset-new' }}
          />
          <TextField
            type="password"
            label={t('resetPassword.repeat')}
            value={repeat}
            onChange={(e) => setRepeat(e.target.value)}
            fullWidth
            autoComplete="new-password"
            error={repeat.length > 0 && next !== repeat}
            helperText={repeat.length > 0 && next !== repeat ? t('resetPassword.mismatch') : ' '}
            inputProps={{ 'data-testid': 'reset-repeat' }}
          />
          {error && (
            <Alert severity="error">
              {error}{' '}
              <Link component={RouterLink} to={paths.forgotPassword}>
                {t('resetPassword.askAgain')}
              </Link>
            </Alert>
          )}
          <Button
            type="submit"
            variant="contained"
            size="large"
            disabled={busy || !next || next !== repeat}
            data-testid="reset-submit"
          >
            {t('resetPassword.save')}
          </Button>
        </Stack>
      )}
    </AuthCard>
  );
}
