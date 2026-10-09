import { useCallback, useEffect, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import FormControlLabel from '@mui/material/FormControlLabel';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useTranslation } from 'react-i18next';
import { api, apiErrorMessage } from '../../utils/api';
import { useSnackbar } from '../../contexts/SnackbarContext';
import { SettingsRow } from './SettingsRow';

interface LocalAccount {
  username: string;
  playerId: string;
  name: string;
  isAdmin: boolean;
  totpEnabled: boolean;
  createdAt: number;
  lastLoginAt: number | null;
}

/**
 * Settings -> Sign-in, "Accounts": username + password accounts an admin
 * creates, makes admin or not, gives a new password, or removes
 * (/api/local-accounts).
 */
export function LocalAccountsSection() {
  const { t } = useTranslation();
  const { showSuccess, showError } = useSnackbar();
  const [accounts, setAccounts] = useState<LocalAccount[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [isAdmin, setIsAdmin] = useState(false);
  const [resetFor, setResetFor] = useState<LocalAccount | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [removeFor, setRemoveFor] = useState<LocalAccount | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await api.get<{ accounts: LocalAccount[] }>('/api/local-accounts');
      setAccounts(res.accounts);
    } catch (err) {
      showError(apiErrorMessage(err, t('settingsPage.signIn.accounts.loadError')));
    }
  }, [showError, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const run = async (work: () => Promise<unknown>, done: string) => {
    setBusy(true);
    try {
      await work();
      showSuccess(done);
      await load();
      return true;
    } catch (err) {
      showError(apiErrorMessage(err, t('settingsPage.signIn.accounts.saveError')));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const create = async () => {
    const ok = await run(
      () =>
        api.post('/api/local-accounts', { username, password, name: name || undefined, isAdmin }),
      t('settingsPage.signIn.accounts.created', { username: username.trim().toLowerCase() })
    );
    if (ok) {
      setUsername('');
      setPassword('');
      setName('');
      setIsAdmin(false);
    }
  };

  const lastLogin = (a: LocalAccount) =>
    a.lastLoginAt
      ? t('settingsPage.signIn.accounts.lastLogin', {
          date: new Date(a.lastLoginAt * 1000).toLocaleString(),
        })
      : t('settingsPage.signIn.accounts.neverSignedIn');

  return (
    <SettingsRow
      data-testid="local-accounts"
      title={t('settingsPage.signIn.accounts.title')}
      sub={t('settingsPage.signIn.accounts.short')}
      openLabel={t('settingsPage.signIn.accounts.title')}
    >
      <Stack spacing={2}>
        <Typography variant="body2" color="text.secondary">
          {t('settingsPage.signIn.accounts.help')}
        </Typography>

        {accounts && accounts.length === 0 && (
          <Typography variant="body2" color="text.secondary">
            {t('settingsPage.signIn.accounts.none')}
          </Typography>
        )}
        {accounts && accounts.length > 0 && (
          <Box
            data-testid="local-accounts-list"
            sx={{ border: 1, borderColor: 'divider', borderRadius: 2, overflow: 'hidden' }}
          >
            {accounts.map((a, i) => (
              <Box
                key={a.username}
                data-testid={`local-account-${a.username}`}
                sx={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  alignItems: 'center',
                  columnGap: 2,
                  rowGap: 1,
                  px: 2,
                  py: 1.5,
                  borderTop: i > 0 ? 1 : 0,
                  borderColor: 'divider',
                }}
              >
                {/* Who: grows, and wraps the actions under it when the row is narrow. */}
                <Box sx={{ flex: '1 1 220px', minWidth: 0 }}>
                  <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                    <Typography variant="body2" fontWeight={600} noWrap sx={{ minWidth: 0 }}>
                      {a.name && a.name !== a.username ? a.name : a.username}
                    </Typography>
                    {a.totpEnabled && (
                      <Chip
                        size="small"
                        variant="outlined"
                        label={t('settingsPage.signIn.accounts.twoStep')}
                      />
                    )}
                  </Stack>
                  <Typography variant="caption" color="text.secondary" component="div" noWrap>
                    {a.name && a.name !== a.username ? `${a.username} · ` : ''}
                    {lastLogin(a)}
                  </Typography>
                </Box>
                <Stack direction="row" spacing={0.5} alignItems="center" sx={{ flexShrink: 0 }}>
                  <FormControlLabel
                    sx={{ mr: 1, whiteSpace: 'nowrap' }}
                    control={
                      <Switch
                        size="small"
                        checked={a.isAdmin}
                        disabled={busy}
                        onChange={(e) =>
                          void run(
                            () =>
                              api.put(`/api/local-accounts/${encodeURIComponent(a.username)}`, {
                                isAdmin: e.target.checked,
                              }),
                            e.target.checked
                              ? t('settingsPage.signIn.accounts.madeAdmin', {
                                  username: a.username,
                                })
                              : t('settingsPage.signIn.accounts.adminRemoved', {
                                  username: a.username,
                                })
                          )
                        }
                        inputProps={
                          {
                            'aria-label': t('settingsPage.signIn.accounts.admin'),
                            'data-testid': `local-account-admin-${a.username}`,
                          } as Record<string, string>
                        }
                      />
                    }
                    label={t('settingsPage.signIn.accounts.admin')}
                  />
                  <Button
                    size="small"
                    disabled={busy}
                    sx={{ whiteSpace: 'nowrap' }}
                    onClick={() => {
                      setResetFor(a);
                      setNewPassword('');
                    }}
                  >
                    {t('settingsPage.signIn.accounts.setPassword')}
                  </Button>
                  <Button
                    size="small"
                    color="error"
                    disabled={busy}
                    sx={{ whiteSpace: 'nowrap' }}
                    onClick={() => setRemoveFor(a)}
                  >
                    {t('settingsPage.signIn.accounts.remove')}
                  </Button>
                </Stack>
              </Box>
            ))}
          </Box>
        )}

        {/* One column: each field with its own help under it. */}
        <Stack spacing={2} sx={{ maxWidth: 480, pt: 1 }}>
          <Typography variant="subtitle2">{t('settingsPage.signIn.accounts.addTitle')}</Typography>
          <TextField
            id="local-account-username"
            label={t('settingsPage.signIn.accounts.username')}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            helperText={t('settingsPage.signIn.accounts.usernameHelp')}
            size="small"
            fullWidth
            autoComplete="off"
            inputProps={{ 'data-testid': 'local-account-new-username', spellCheck: false }}
          />
          <TextField
            id="local-account-name"
            label={t('settingsPage.signIn.accounts.name')}
            value={name}
            onChange={(e) => setName(e.target.value)}
            helperText={t('settingsPage.signIn.accounts.nameHelp')}
            size="small"
            fullWidth
            inputProps={{ 'data-testid': 'local-account-new-name' }}
          />
          <TextField
            id="local-account-password"
            type="password"
            label={t('settingsPage.signIn.accounts.password')}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            size="small"
            fullWidth
            autoComplete="new-password"
            inputProps={{ 'data-testid': 'local-account-new-password' }}
          />
          <Stack
            direction="row"
            alignItems="center"
            justifyContent="space-between"
            flexWrap="wrap"
            useFlexGap
            spacing={1}
          >
            <FormControlLabel
              control={
                <Switch
                  size="small"
                  checked={isAdmin}
                  onChange={(e) => setIsAdmin(e.target.checked)}
                  inputProps={
                    { 'data-testid': 'local-account-new-admin' } as Record<string, string>
                  }
                />
              }
              label={t('settingsPage.signIn.accounts.makeAdmin')}
            />
            <Button
              variant="contained"
              size="small"
              disabled={busy || !username.trim() || !password}
              onClick={() => void create()}
              data-testid="local-account-create"
            >
              {t('settingsPage.signIn.accounts.create')}
            </Button>
          </Stack>
        </Stack>
      </Stack>

      <Dialog open={!!resetFor} onClose={() => setResetFor(null)} fullWidth maxWidth="xs">
        <DialogTitle>
          {t('settingsPage.signIn.accounts.setPasswordTitle', {
            username: resetFor?.username ?? '',
          })}
        </DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            {resetFor?.totpEnabled && (
              <Alert severity="info">{t('settingsPage.signIn.accounts.setPasswordTotp')}</Alert>
            )}
            <TextField
              id="local-account-reset-password"
              type="password"
              label={t('settingsPage.signIn.accounts.newPassword')}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              size="small"
              fullWidth
              autoFocus
              autoComplete="new-password"
              inputProps={{ 'data-testid': 'local-account-reset-password' }}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setResetFor(null)}>
            {t('settingsPage.signIn.accounts.cancel')}
          </Button>
          <Button
            variant="contained"
            disabled={busy || !newPassword}
            data-testid="local-account-reset-save"
            onClick={async () => {
              const who = resetFor!;
              if (
                await run(
                  () =>
                    api.put(`/api/local-accounts/${encodeURIComponent(who.username)}/password`, {
                      password: newPassword,
                    }),
                  t('settingsPage.signIn.accounts.passwordSet', { username: who.username })
                )
              ) {
                setResetFor(null);
              }
            }}
          >
            {t('settingsPage.signIn.accounts.savePassword')}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={!!removeFor} onClose={() => setRemoveFor(null)} fullWidth maxWidth="xs">
        <DialogTitle>
          {t('settingsPage.signIn.accounts.removeTitle', { username: removeFor?.username ?? '' })}
        </DialogTitle>
        <DialogContent>
          <Typography variant="body2">{t('settingsPage.signIn.accounts.removeBody')}</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRemoveFor(null)}>
            {t('settingsPage.signIn.accounts.cancel')}
          </Button>
          <Button
            color="error"
            variant="contained"
            disabled={busy}
            data-testid="local-account-remove-confirm"
            onClick={async () => {
              const who = removeFor!;
              if (
                await run(
                  () => api.delete(`/api/local-accounts/${encodeURIComponent(who.username)}`),
                  t('settingsPage.signIn.accounts.removed', { username: who.username })
                )
              ) {
                setRemoveFor(null);
              }
            }}
          >
            {t('settingsPage.signIn.accounts.removeConfirm')}
          </Button>
        </DialogActions>
      </Dialog>
    </SettingsRow>
  );
}
