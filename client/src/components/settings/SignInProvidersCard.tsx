import { useCallback, useEffect, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import FormControlLabel from '@mui/material/FormControlLabel';
import LinearProgress from '@mui/material/LinearProgress';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { CopyIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { api, apiErrorMessage } from '../../utils/api';
import { useSnackbar } from '../../contexts/SnackbarContext';
import { ExternalLink } from '../common/ExternalLink';
import { ProviderLogo } from '../auth/ProviderLogo';
import { AdminAccessSection } from './AdminAccessSection';

/** One provider as GET /api/sign-in-providers returns it. Never carries a secret. */
export interface AdminSignInProvider {
  id: string;
  label: string;
  comingSoon: boolean;
  enabled: boolean;
  hasClientId: boolean;
  clientId: string | null;
  secretSet: boolean;
  secretUnreadable: boolean;
  configured: boolean;
  active: boolean;
  callbackUrl: string;
  docsUrl: string;
  /** OpenID Connect: the admin sets the issuer URL and the button's name. */
  hasIssuer: boolean;
  issuerUrl: string | null;
  buttonName: string | null;
}

interface ListResponse {
  success: boolean;
  providers: AdminSignInProvider[];
  secretsKeySource: 'SECRETS_KEY' | 'SESSION_SECRET' | 'default';
}

type TestResult = 'ok' | 'invalid_credentials' | 'unreachable' | 'not_configured' | 'not_supported' | 'unexpected';

/**
 * Settings -> Sign-in: every sign-in provider with its enabled switch, client
 * id, write-only secret, the callback URL to register with the provider, a
 * Test button and a link to the provider's developer console
 * (/api/sign-in-providers). Saving applies at once; no restart.
 */
export function SignInProvidersCard({ welcome = false }: { welcome?: boolean }) {
  const { t } = useTranslation();
  const [data, setData] = useState<ListResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api.get<ListResponse>('/api/sign-in-providers'));
      setLoadError(null);
    } catch (err) {
      setLoadError(apiErrorMessage(err, t('settingsPage.signIn.loadError')));
    }
  }, [t]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  if (loadError) return <Alert severity="error">{loadError}</Alert>;
  if (!data) return <LinearProgress aria-label={t('settingsPage.signIn.title')} />;

  return (
    <Stack spacing={3} data-testid="sign-in-providers">
      {welcome && (
        <Alert severity="info" data-testid="sign-in-welcome">
          <Typography variant="subtitle2" component="p" fontWeight={600}>
            {t('settingsPage.signIn.welcomeTitle')}
          </Typography>
          <Typography variant="body2">{t('settingsPage.signIn.welcomeBody')}</Typography>
        </Alert>
      )}
      <Box>
        <Typography variant="h6" fontWeight={600} gutterBottom>
          {t('settingsPage.signIn.title')}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {t('settingsPage.signIn.intro')}
        </Typography>
        <Typography variant="caption" color="text.secondary" display="block" mt={1}>
          {data.secretsKeySource === 'default'
            ? t('settingsPage.signIn.keySourceDefault')
            : t('settingsPage.signIn.keySource', { name: data.secretsKeySource })}
        </Typography>
      </Box>
      {data.providers.map((provider) => (
        <ProviderSection key={provider.id} provider={provider} onSaved={setData} />
      ))}
      <AdminAccessSection />
    </Stack>
  );
}

function ProviderSection({
  provider,
  onSaved,
}: {
  provider: AdminSignInProvider;
  onSaved: (data: ListResponse) => void;
}) {
  const { t } = useTranslation();
  const { showSuccess, showError } = useSnackbar();
  const [clientId, setClientId] = useState(provider.clientId ?? '');
  const [issuerUrl, setIssuerUrl] = useState(provider.issuerUrl ?? '');
  const [buttonName, setButtonName] = useState(provider.buttonName ?? '');
  const [replacing, setReplacing] = useState(!provider.secretSet);
  const [secret, setSecret] = useState('');
  const [busy, setBusy] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);

  // A save returns fresh values: show them, and fold the secret back to "set".
  useEffect(() => {
    setClientId(provider.clientId ?? '');
    setIssuerUrl(provider.issuerUrl ?? '');
    setButtonName(provider.buttonName ?? '');
    setReplacing(!provider.secretSet);
    setSecret('');
  }, [provider.clientId, provider.issuerUrl, provider.buttonName, provider.secretSet]);

  const idPrefix = `sign-in-${provider.id}`;
  const secretLabel = provider.hasClientId
    ? t('settingsPage.signIn.clientSecret')
    : t('settingsPage.signIn.steamKey');

  const save = async (body: Record<string, unknown>) => {
    setBusy(true);
    setTestResult(null);
    try {
      const res = await api.put<ListResponse>(`/api/sign-in-providers/${provider.id}`, body);
      // The admin shell rechecks Steam right away instead of in five minutes.
      window.dispatchEvent(new Event('at:sign-in-settings-changed'));
      onSaved(res);
      showSuccess(t('settingsPage.signIn.saved', { provider: provider.label }));
    } catch (err) {
      showError(apiErrorMessage(err, t('settingsPage.signIn.saveError')));
    } finally {
      setBusy(false);
    }
  };

  const saveCredentials = () => {
    const body: Record<string, unknown> = {};
    if (provider.hasClientId && clientId.trim() !== (provider.clientId ?? '')) {
      body.clientId = clientId.trim() || null;
    }
    if (replacing && secret.trim()) body.clientSecret = secret.trim();
    if (provider.hasIssuer && issuerUrl.trim() !== (provider.issuerUrl ?? '')) {
      body.issuerUrl = issuerUrl.trim() || null;
    }
    if (provider.hasIssuer && buttonName.trim() !== (provider.buttonName ?? '')) {
      body.label = buttonName.trim() || null;
    }
    if (Object.keys(body).length === 0) return;
    void save(body);
  };

  const runTest = async () => {
    setBusy(true);
    try {
      const res = await api.post<{ result: TestResult }>(`/api/sign-in-providers/${provider.id}/test`, {});
      setTestResult(res.result);
    } catch (err) {
      showError(apiErrorMessage(err, t('settingsPage.signIn.testError')));
    } finally {
      setBusy(false);
    }
  };

  const copyCallback = async () => {
    try {
      await navigator.clipboard.writeText(provider.callbackUrl);
      showSuccess(t('settingsPage.signIn.copied'));
    } catch {
      showError(t('settingsPage.signIn.copyError'));
    }
  };

  const status = provider.comingSoon
    ? { label: t('settingsPage.signIn.comingSoon'), color: 'default' as const }
    : provider.active
      ? { label: t('settingsPage.signIn.status.active'), color: 'success' as const }
      : provider.enabled
        ? { label: t('settingsPage.signIn.status.missing'), color: 'warning' as const }
        : { label: t('settingsPage.signIn.status.off'), color: 'default' as const };

  return (
    <Paper
      variant="outlined"
      component="section"
      aria-labelledby={`${idPrefix}-title`}
      data-testid={idPrefix}
      sx={{ p: { xs: 2, md: 3 } }}
    >
      <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap" useFlexGap>
        <ProviderLogo id={provider.id} />
        <Typography id={`${idPrefix}-title`} variant="subtitle1" fontWeight={600} component="h3">
          {provider.label}
        </Typography>
        <Chip size="small" label={status.label} color={status.color} data-testid={`${idPrefix}-status`} />
        <Box sx={{ flexGrow: 1 }} />
        {/* The URL to paste into the provider's console, one click away. Steam needs none. */}
        {provider.id !== 'steam' && (
          <Button
            size="small"
            startIcon={<CopyIcon size={16} aria-hidden />}
            onClick={() => void copyCallback()}
            title={provider.callbackUrl}
            data-testid={`${idPrefix}-copy-callback`}
          >
            {t('settingsPage.signIn.copyCallback')}
          </Button>
        )}
        <ExternalLink
          href={`https://docs.autotournament.gg/guides/sign-in/${provider.id}`}
          sx={{ fontSize: '0.85rem' }}
          data-testid={`${idPrefix}-guide`}
        >
          {t('settingsPage.signIn.guide')}
        </ExternalLink>
        <ExternalLink href={provider.docsUrl} sx={{ fontSize: '0.85rem' }}>
          {t('settingsPage.signIn.howTo')}
        </ExternalLink>
      </Stack>

      {provider.comingSoon ? (
        <Typography variant="body2" color="text.secondary" mt={1}>
          {t('settingsPage.signIn.comingSoonNote', { provider: provider.label })}
        </Typography>
      ) : (
        <Stack spacing={2} mt={2}>
          <Box>
            <FormControlLabel
              control={
                <Switch
                  checked={provider.enabled}
                  disabled={busy}
                  onChange={(e) => void save({ enabled: e.target.checked })}
                  size="small"
                  data-testid={`${idPrefix}-enabled`}
                />
              }
              label={t('settingsPage.signIn.enabled')}
            />
          </Box>

          {provider.hasIssuer && (
            <TextField
              label={t('settingsPage.signIn.issuerUrl')}
              value={issuerUrl}
              onChange={(e) => setIssuerUrl(e.target.value)}
              disabled={busy}
              size="small"
              fullWidth
              autoComplete="off"
              placeholder="https://sso.example.com/realms/community"
              helperText={t('settingsPage.signIn.issuerUrlHelp')}
              inputProps={{ 'data-testid': `${idPrefix}-issuer-url`, spellCheck: false, inputMode: 'url' }}
            />
          )}

          {provider.hasIssuer && (
            <TextField
              label={t('settingsPage.signIn.buttonName')}
              value={buttonName}
              onChange={(e) => setButtonName(e.target.value)}
              disabled={busy}
              size="small"
              fullWidth
              autoComplete="off"
              placeholder={provider.label}
              helperText={t('settingsPage.signIn.buttonNameHelp')}
              inputProps={{ 'data-testid': `${idPrefix}-button-name`, maxLength: 40 }}
            />
          )}

          {provider.hasClientId && (
            <TextField
              label={t('settingsPage.signIn.clientId')}
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              disabled={busy}
              size="small"
              fullWidth
              autoComplete="off"
              inputProps={{ 'data-testid': `${idPrefix}-client-id`, spellCheck: false }}
            />
          )}

          {replacing ? (
            <TextField
              label={secretLabel}
              type="password"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              disabled={busy}
              size="small"
              fullWidth
              autoComplete="new-password"
              helperText={provider.secretUnreadable ? t('settingsPage.signIn.secretUnreadable') : undefined}
              error={provider.secretUnreadable}
              inputProps={{ 'data-testid': `${idPrefix}-secret`, spellCheck: false }}
            />
          ) : (
            <Stack direction="row" spacing={1.5} alignItems="center">
              <Typography variant="body2">
                {secretLabel}: <strong>{t('settingsPage.signIn.secretSet')}</strong>
              </Typography>
              <Button size="small" onClick={() => setReplacing(true)} data-testid={`${idPrefix}-replace`}>
                {t('settingsPage.signIn.replace')}
              </Button>
            </Stack>
          )}

          {provider.id !== 'steam' && (
            // Set automatically: nothing to fill in here, only to paste at the provider.
            <Typography variant="body2" color="text.secondary">
              {t('settingsPage.signIn.callbackHint', { provider: provider.label })}{' '}
              <Box
                component="code"
                data-testid={`${idPrefix}-callback`}
                sx={{ fontFamily: 'monospace', fontSize: '0.8rem', color: 'text.primary', wordBreak: 'break-all' }}
              >
                {provider.callbackUrl}
              </Box>
            </Typography>
          )}

          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            <Button variant="contained" size="small" onClick={saveCredentials} disabled={busy} data-testid={`${idPrefix}-save`}>
              {t('settingsPage.signIn.save')}
            </Button>
            {replacing && provider.secretSet && (
              <Button
                size="small"
                onClick={() => {
                  setReplacing(false);
                  setSecret('');
                }}
                disabled={busy}
              >
                {t('settingsPage.signIn.cancel')}
              </Button>
            )}
            <Button
              variant="outlined"
              size="small"
              onClick={() => void runTest()}
              disabled={busy || !provider.configured}
              data-testid={`${idPrefix}-test`}
            >
              {t('settingsPage.signIn.test')}
            </Button>
          </Stack>

          {testResult && (
            <Alert
              severity={testResult === 'ok' ? 'success' : testResult === 'unreachable' ? 'warning' : 'error'}
              data-testid={`${idPrefix}-test-result`}
            >
              {t(`settingsPage.signIn.testResult.${testResult}`)}
            </Alert>
          )}
        </Stack>
      )}
    </Paper>
  );
}
