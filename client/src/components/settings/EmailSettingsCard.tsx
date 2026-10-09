import {
  useCallback,
  useEffect,
  useState,
  type ChangeEvent,
  type InputHTMLAttributes,
} from 'react';
import { Alert, Box, Button, Chip, MenuItem, Stack, Switch, TextField } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { api, apiErrorMessage } from '../../utils/api';
import { useSnackbar } from '../../contexts/SnackbarContext';
import { SettingsCardHead, SettingsRow } from './SettingsRow';

type Security = 'tls' | 'starttls' | 'none';

interface EmailSettings {
  enabled: boolean;
  host: string;
  port: number | null;
  security: Security;
  username: string;
  passwordSet: boolean;
  fromAddress: string;
  fromName: string;
  siteUrl: string;
  defaultSiteUrl: string;
  ready: boolean;
  updatedAt: number | null;
}

interface Draft {
  host: string;
  port: string;
  security: Security;
  username: string;
  /** A new password; "" keeps the saved one. */
  password: string;
  fromAddress: string;
  fromName: string;
  siteUrl: string;
}

const draftOf = (s: EmailSettings): Draft => ({
  host: s.host,
  port: s.port === null ? '' : String(s.port),
  security: s.security,
  username: s.username,
  password: '',
  fromAddress: s.fromAddress,
  fromName: s.fromName,
  siteUrl: s.siteUrl,
});

/**
 * Settings -> Email: the SMTP server the site sends with (address
 * confirmation, password recovery, tournament emails), a switch to turn
 * sending on, and a test email. The password is kept encrypted and never
 * shown again.
 */
export function EmailSettingsCard() {
  const { t } = useTranslation();
  const { showSuccess, showError } = useSnackbar();
  const [settings, setSettings] = useState<EmailSettings | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [testTo, setTestTo] = useState('');
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | null>(null);

  const apply = (s: EmailSettings) => {
    setSettings(s);
    setDraft(draftOf(s));
  };

  const load = useCallback(async () => {
    try {
      apply((await api.get<{ settings: EmailSettings }>('/api/email-settings')).settings);
    } catch (err) {
      showError(apiErrorMessage(err, t('settingsPage.email.loadError')));
    }
  }, [showError, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async (body: Record<string, unknown>, done: string) => {
    setBusy(true);
    try {
      apply((await api.put<{ settings: EmailSettings }>('/api/email-settings', body)).settings);
      showSuccess(done);
      return true;
    } catch (err) {
      showError(apiErrorMessage(err, t('settingsPage.email.saveError')));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const saveServer = () => {
    if (!draft) return;
    const body: Record<string, unknown> = {
      host: draft.host,
      port: draft.port.trim() ? Number(draft.port) : null,
      security: draft.security,
      username: draft.username,
      fromAddress: draft.fromAddress,
      fromName: draft.fromName,
      siteUrl: draft.siteUrl,
    };
    if (draft.password) body.password = draft.password;
    void save(body, t('settingsPage.email.saved'));
  };

  const sendTest = async () => {
    setBusy(true);
    setTestResult(null);
    try {
      await api.post('/api/email-settings/test', { to: testTo.trim() });
      setTestResult({ ok: true, text: t('settingsPage.email.testSent', { to: testTo.trim() }) });
    } catch (err) {
      setTestResult({ ok: false, text: apiErrorMessage(err, t('settingsPage.email.testFailed')) });
    } finally {
      setBusy(false);
    }
  };

  if (!settings || !draft) {
    return (
      <SettingsCardHead
        title={t('settingsPage.email.title')}
        hint={t('settingsPage.email.short')}
      />
    );
  }

  const set = (key: keyof Draft) => (e: ChangeEvent<HTMLInputElement>) =>
    setDraft((d) => (d ? { ...d, [key]: e.target.value } : d));
  const dirty =
    JSON.stringify({ ...draftOf(settings), password: '' }) !==
      JSON.stringify({ ...draft, password: '' }) || draft.password.length > 0;
  const canEnable = !!settings.host && !!settings.fromAddress;

  return (
    <>
      <SettingsCardHead
        title={t('settingsPage.email.title')}
        hint={t('settingsPage.email.short')}
      />

      <SettingsRow
        title={t('settingsPage.email.enabled')}
        sub={
          settings.ready
            ? t('settingsPage.email.enabledOn', { from: settings.fromAddress })
            : canEnable
              ? t('settingsPage.email.enabledOff')
              : t('settingsPage.email.needsServer')
        }
        control={
          <Switch
            checked={settings.enabled}
            disabled={busy || (!settings.enabled && !canEnable)}
            onChange={(e) =>
              void save(
                { enabled: e.target.checked },
                e.target.checked
                  ? t('settingsPage.email.turnedOn')
                  : t('settingsPage.email.turnedOff')
              )
            }
            slotProps={{
              input: {
                'aria-label': t('settingsPage.email.enabled'),
                'data-testid': 'email-enabled',
              } as InputHTMLAttributes<HTMLInputElement>,
            }}
          />
        }
      />

      <SettingsRow
        title={t('settingsPage.email.server')}
        sub={
          settings.host
            ? `${settings.host}${settings.port ? `:${settings.port}` : ''}`
            : t('settingsPage.email.serverNone')
        }
        openLabel={t('settingsPage.email.server')}
        defaultOpen={!settings.host}
        data-testid="email-server"
      >
        <Stack spacing={2} sx={{ maxWidth: 520 }}>
          <TextField
            label={t('settingsPage.email.host')}
            value={draft.host}
            onChange={set('host')}
            placeholder="smtp.example.com"
            size="small"
            fullWidth
            inputProps={{ 'data-testid': 'email-host', spellCheck: false }}
          />
          <Stack direction="row" spacing={2}>
            <TextField
              label={t('settingsPage.email.port')}
              value={draft.port}
              onChange={set('port')}
              placeholder={draft.security === 'tls' ? '465' : '587'}
              size="small"
              sx={{ width: 140 }}
              inputProps={{ inputMode: 'numeric', 'data-testid': 'email-port' }}
            />
            <TextField
              select
              label={t('settingsPage.email.security')}
              value={draft.security}
              onChange={set('security')}
              size="small"
              fullWidth
              inputProps={{ 'data-testid': 'email-security' }}
            >
              <MenuItem value="starttls">{t('settingsPage.email.securityStarttls')}</MenuItem>
              <MenuItem value="tls">{t('settingsPage.email.securityTls')}</MenuItem>
              <MenuItem value="none">{t('settingsPage.email.securityNone')}</MenuItem>
            </TextField>
          </Stack>
          <TextField
            label={t('settingsPage.email.username')}
            value={draft.username}
            onChange={set('username')}
            size="small"
            fullWidth
            autoComplete="off"
            inputProps={{ 'data-testid': 'email-username', spellCheck: false }}
          />
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <TextField
              type="password"
              label={t('settingsPage.email.password')}
              value={draft.password}
              onChange={set('password')}
              placeholder={settings.passwordSet ? t('settingsPage.email.passwordKept') : ''}
              size="small"
              fullWidth
              autoComplete="new-password"
              inputProps={{ 'data-testid': 'email-password' }}
            />
            {settings.passwordSet && (
              <Chip size="small" variant="outlined" label={t('settingsPage.email.passwordSaved')} />
            )}
          </Box>
          <TextField
            label={t('settingsPage.email.fromAddress')}
            value={draft.fromAddress}
            onChange={set('fromAddress')}
            placeholder="noreply@example.com"
            helperText={t('settingsPage.email.fromAddressHelp')}
            size="small"
            fullWidth
            inputProps={{ 'data-testid': 'email-from-address', spellCheck: false }}
          />
          <TextField
            label={t('settingsPage.email.fromName')}
            value={draft.fromName}
            onChange={set('fromName')}
            helperText={t('settingsPage.email.fromNameHelp')}
            size="small"
            fullWidth
            inputProps={{ 'data-testid': 'email-from-name' }}
          />
          <TextField
            label={t('settingsPage.email.siteUrl')}
            value={draft.siteUrl}
            onChange={set('siteUrl')}
            placeholder={settings.defaultSiteUrl || 'https://cs.example.com'}
            helperText={
              settings.defaultSiteUrl
                ? t('settingsPage.email.siteUrlHelpDefault', { url: settings.defaultSiteUrl })
                : t('settingsPage.email.siteUrlHelp')
            }
            size="small"
            fullWidth
            inputProps={{ 'data-testid': 'email-site-url', spellCheck: false }}
          />
          <Box>
            <Button
              variant="contained"
              size="small"
              disabled={busy || !dirty}
              onClick={saveServer}
              data-testid="email-save"
            >
              {t('settingsPage.email.save')}
            </Button>
          </Box>
        </Stack>
      </SettingsRow>

      <SettingsRow
        title={t('settingsPage.email.test')}
        sub={t('settingsPage.email.testShort')}
        openLabel={t('settingsPage.email.test')}
        data-testid="email-test"
      >
        <Stack spacing={1.5} sx={{ maxWidth: 520 }}>
          {!settings.ready && <Alert severity="info">{t('settingsPage.email.testNeedsOn')}</Alert>}
          {testResult && (
            <Alert severity={testResult.ok ? 'success' : 'error'}>{testResult.text}</Alert>
          )}
          <Stack direction="row" spacing={1} alignItems="flex-start">
            <TextField
              label={t('settingsPage.email.testTo')}
              value={testTo}
              onChange={(e) => setTestTo(e.target.value)}
              size="small"
              fullWidth
              inputProps={{ 'data-testid': 'email-test-to', spellCheck: false }}
            />
            <Button
              variant="outlined"
              disabled={busy || !settings.ready || !testTo.trim()}
              onClick={() => void sendTest()}
              sx={{ whiteSpace: 'nowrap', flex: 'none' }}
              data-testid="email-test-send"
            >
              {t('settingsPage.email.testSend')}
            </Button>
          </Stack>
        </Stack>
      </SettingsRow>
    </>
  );
}
