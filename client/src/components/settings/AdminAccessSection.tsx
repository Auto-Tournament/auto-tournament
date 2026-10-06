import { useCallback, useEffect, useState } from 'react';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import FormControlLabel from '@mui/material/FormControlLabel';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useTranslation } from 'react-i18next';
import { api, apiErrorMessage } from '../../utils/api';
import { useSnackbar } from '../../contexts/SnackbarContext';
import { SettingsRow } from './SettingsRow';

interface AdminAccess {
  localAdminLoginEnabled: boolean;
  canDisableLocalAdminLogin: boolean;
  adminSteamIds: string;
  adminEmails: string;
}

/**
 * Settings -> Sign-in, "Admin access": the local admin login switch and the
 * admin Steam IDs / emails (/api/sign-in-providers/admin-access).
 */
export function AdminAccessSection() {
  const { t } = useTranslation();
  const { showSuccess, showError } = useSnackbar();
  const [data, setData] = useState<AdminAccess | null>(null);
  const [steamIds, setSteamIds] = useState('');
  const [emails, setEmails] = useState('');
  const [busy, setBusy] = useState(false);

  const apply = useCallback((next: AdminAccess) => {
    setData(next);
    setSteamIds(next.adminSteamIds);
    setEmails(next.adminEmails);
  }, []);

  useEffect(() => {
    api
      .get<AdminAccess>('/api/sign-in-providers/admin-access')
      .then(apply)
      .catch((err) => showError(apiErrorMessage(err, t('settingsPage.signIn.adminAccess.loadError'))));
  }, [apply, showError, t]);

  const save = async (body: Partial<AdminAccess>) => {
    setBusy(true);
    try {
      apply(await api.put<AdminAccess>('/api/sign-in-providers/admin-access', body));
      showSuccess(t('settingsPage.signIn.adminAccess.saved'));
    } catch (err) {
      showError(apiErrorMessage(err, t('settingsPage.signIn.saveError')));
    } finally {
      setBusy(false);
    }
  };

  if (!data) return null;
  const lockedOn = data.localAdminLoginEnabled && !data.canDisableLocalAdminLogin;

  return (
    <SettingsRow
      data-testid="admin-access"
      title={<span id="admin-access-title">{t('settingsPage.signIn.adminAccess.title')}</span>}
      sub={t('settingsPage.signIn.adminAccess.short')}
      openLabel={t('settingsPage.signIn.adminAccess.title')}
    >
      <Stack spacing={2}>
        <div>
          <FormControlLabel
            control={
              <Switch
                checked={data.localAdminLoginEnabled}
                disabled={busy || lockedOn}
                onChange={(e) => void save({ localAdminLoginEnabled: e.target.checked })}
                size="small"
                data-testid="admin-access-local-login"
              />
            }
            label={t('settingsPage.signIn.adminAccess.localLogin')}
          />
          <Typography variant="caption" color="text.secondary" display="block">
            {lockedOn
              ? t('settingsPage.signIn.adminAccess.localLoginLocked')
              : t('settingsPage.signIn.adminAccess.localLoginHelp')}
          </Typography>
        </div>
        <TextField
          label={t('settingsPage.signIn.adminAccess.steamIds')}
          value={steamIds}
          onChange={(e) => setSteamIds(e.target.value)}
          helperText={t('settingsPage.signIn.adminAccess.steamIdsHelp')}
          size="small"
          fullWidth
          multiline
          minRows={1}
          disabled={busy}
          inputProps={{ 'data-testid': 'admin-access-steam-ids', spellCheck: false }}
        />
        <TextField
          label={t('settingsPage.signIn.adminAccess.emails')}
          value={emails}
          onChange={(e) => setEmails(e.target.value)}
          helperText={t('settingsPage.signIn.adminAccess.emailsHelp')}
          size="small"
          fullWidth
          multiline
          minRows={1}
          disabled={busy}
          inputProps={{ 'data-testid': 'admin-access-emails', spellCheck: false }}
        />
        {(steamIds !== data.adminSteamIds || emails !== data.adminEmails) && (
          <Alert severity="info" variant="outlined">
            {t('settingsPage.signIn.adminAccess.unsaved')}
          </Alert>
        )}
        <div>
          <Button
            variant="contained"
            size="small"
            disabled={busy}
            onClick={() => void save({ adminSteamIds: steamIds, adminEmails: emails })}
            data-testid="admin-access-save"
          >
            {t('settingsPage.signIn.save')}
          </Button>
        </div>
      </Stack>
    </SettingsRow>
  );
}
