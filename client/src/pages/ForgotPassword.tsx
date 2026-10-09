import { useEffect, useState, type FormEvent } from 'react';
import { Alert, Button, Link, Stack, TextField } from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AuthCard } from '../components/auth/AuthCard';
import { postJson } from '../utils/postJson';
import { pageTitle } from '../utils/pageTitle';
import { paths } from '../paths';

/**
 * /login/forgot: ask for a password reset link by username or email. The
 * answer is the same whether or not the account exists.
 */
export default function ForgotPassword() {
  const { t } = useTranslation();
  const [identifier, setIdentifier] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    document.title = pageTitle(t('forgotPassword.title'));
  }, [t]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { status } = await postJson('/api/auth/local/forgot', { identifier: identifier.trim() });
    setBusy(false);
    if (status === 200) return setSent(true);
    setError(status === 429 ? t('localAdmin.tooMany') : t('forgotPassword.failed'));
  };

  return (
    <AuthCard title={t('forgotPassword.title')} subtitle={t('forgotPassword.subtitle')}>
      {sent ? (
        <Stack spacing={2}>
          <Alert severity="success" data-testid="forgot-sent">
            {t('forgotPassword.sent')}
          </Alert>
          <Link
            component={RouterLink}
            to={paths.adminLogin}
            variant="body2"
            sx={{ textAlign: 'center' }}
          >
            {t('forgotPassword.back')}
          </Link>
        </Stack>
      ) : (
        <Stack spacing={2} component="form" onSubmit={submit} data-testid="forgot-form">
          <TextField
            label={t('forgotPassword.identifier')}
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
            autoFocus
            fullWidth
            autoComplete="username"
            inputProps={{ spellCheck: false, 'data-testid': 'forgot-identifier' }}
          />
          {error && <Alert severity="error">{error}</Alert>}
          <Button
            type="submit"
            variant="contained"
            size="large"
            disabled={busy || !identifier.trim()}
            data-testid="forgot-submit"
          >
            {t('forgotPassword.send')}
          </Button>
          <Link
            component={RouterLink}
            to={paths.adminLogin}
            variant="body2"
            sx={{ textAlign: 'center' }}
          >
            {t('forgotPassword.back')}
          </Link>
        </Stack>
      )}
    </AuthCard>
  );
}
