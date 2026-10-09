import { useEffect, useRef, useState } from 'react';
import { Alert, Button, CircularProgress, Stack } from '@mui/material';
import { Link as RouterLink, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AuthCard } from '../components/auth/AuthCard';
import { postJson } from '../utils/postJson';
import { pageTitle } from '../utils/pageTitle';
import { paths } from '../paths';

/**
 * What a link in an email opens: /me/email/verify?token=… confirms the
 * address, /email/unsubscribe?token=… stops tournament emails. Neither needs
 * a sign-in.
 */
export default function EmailLink({ kind }: { kind: 'verify' | 'unsubscribe' }) {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [state, setState] = useState<'working' | 'ok' | 'failed'>('working');
  const [message, setMessage] = useState<string | null>(null);
  const sent = useRef(false);

  useEffect(() => {
    document.title = pageTitle(t(`emailLink.${kind}.title`));
  }, [kind, t]);

  useEffect(() => {
    if (sent.current) return;
    sent.current = true;
    void (async () => {
      const { status, data } = await postJson<{ error?: string }>(`/api/email/${kind}`, { token });
      if (status === 200) return setState('ok');
      setMessage(data.error ?? null);
      setState('failed');
    })();
  }, [kind, token]);

  return (
    <AuthCard title={t(`emailLink.${kind}.title`)}>
      {state === 'working' ? (
        <Stack alignItems="center" sx={{ py: 3 }}>
          <CircularProgress size={28} />
        </Stack>
      ) : (
        <Stack spacing={2}>
          <Alert
            severity={state === 'ok' ? 'success' : 'error'}
            data-testid={`email-link-${state}`}
          >
            {state === 'ok'
              ? t(`emailLink.${kind}.ok`)
              : (message ?? t(`emailLink.${kind}.failed`))}
          </Alert>
          <Button
            component={RouterLink}
            to={kind === 'verify' ? paths.meConnections : paths.root}
            variant="contained"
          >
            {kind === 'verify' ? t('emailLink.toAccount') : t('emailLink.toSite')}
          </Button>
        </Stack>
      )}
    </AuthCard>
  );
}
