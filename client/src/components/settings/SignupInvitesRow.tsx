import { useCallback, useEffect, useState } from 'react';
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  TextField,
  Typography,
} from '@mui/material';
import { CopyIcon, TrashIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { api, apiErrorMessage } from '../../utils/api';
import { fmtDateTime } from '../../utils/time';
import { useSnackbar } from '../../contexts/SnackbarContext';
import { tokens, radii, mono } from '../../theme/tokens';
import { SettingsRow } from './SettingsRow';

const { color } = tokens;

interface SignupInvite {
  id: string;
  maxUses: number | null;
  uses: number;
  expiresAt: number | null;
  createdAt: number;
}

/** A whole number in [1, max], null for empty, undefined when not valid. */
function limit(raw: string, max: number): number | null | undefined {
  if (!raw.trim()) return null;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 && n <= max ? n : undefined;
}

/**
 * Settings -> Players -> Invite links: links that let someone make an account while
 * "Allow anyone to register" is off. A link is shown once, when it is made.
 */
export function SignupInvitesRow() {
  const { t } = useTranslation();
  const { showError, showSuccess } = useSnackbar();
  const [list, setList] = useState<SignupInvite[] | null>(null);
  const [uses, setUses] = useState('');
  const [days, setDays] = useState('7');
  const [busy, setBusy] = useState(false);
  const [made, setMade] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await api.get<{ invites: SignupInvite[] }>('/api/settings/signup-invites');
      setList(r.invites);
    } catch (error) {
      showError(apiErrorMessage(error, t('settingsPage.players.invites.loadFailed')));
      setList([]);
    }
  }, [showError, t]);
  useEffect(() => {
    const id = setTimeout(() => void load(), 0);
    return () => clearTimeout(id);
  }, [load]);

  const maxUses = limit(uses, 10000);
  const expiresInDays = limit(days, 365);

  const make = async () => {
    setBusy(true);
    try {
      const r = await api.post<{ path: string }>('/api/settings/signup-invites', {
        maxUses,
        expiresInDays,
      });
      setMade(`${window.location.origin}${r.path}`);
      void load();
    } catch (error) {
      showError(apiErrorMessage(error, t('settingsPage.players.invites.makeFailed')));
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (invite: SignupInvite) => {
    try {
      await api.delete(`/api/settings/signup-invites/${invite.id}`);
      showSuccess(t('settingsPage.players.invites.revoked'));
      void load();
    } catch (error) {
      showError(apiErrorMessage(error, t('settingsPage.players.invites.revokeFailed')));
    }
  };

  const line = (i: SignupInvite) =>
    [
      i.maxUses === null
        ? t('settingsPage.players.invites.usedTimes', { count: i.uses })
        : t('settingsPage.players.invites.usedOf', { uses: i.uses, max: i.maxUses }),
      i.expiresAt === null
        ? t('settingsPage.players.invites.noEnd')
        : t('settingsPage.players.invites.until', { date: fmtDateTime(i.expiresAt) }),
    ].join(' · ');

  return (
    <SettingsRow
      title={t('settingsPage.players.invites.title')}
      sub={t('settingsPage.players.invites.short')}
      data-testid="settings-signup-invites"
    >
      {(list ?? []).map((invite) => (
        <Box
          key={invite.id}
          sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.75 }}
          data-testid={`signup-invite-${invite.id}`}
        >
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography sx={{ fontSize: '0.875rem' }}>
              {t('settingsPage.players.invites.made', { date: fmtDateTime(invite.createdAt) })}
            </Typography>
            <Typography sx={{ fontSize: '0.8125rem', color: color.ink2 }}>
              {line(invite)}
            </Typography>
          </Box>
          <IconButton
            aria-label={t('settingsPage.players.invites.revoke')}
            onClick={() => void revoke(invite)}
            data-testid={`signup-invite-revoke-${invite.id}`}
          >
            <TrashIcon size={18} />
          </IconButton>
        </Box>
      ))}
      {list && list.length === 0 && (
        <Typography sx={{ color: color.ink2, fontSize: '0.875rem', py: 0.75 }}>
          {t('settingsPage.players.invites.none')}
        </Typography>
      )}

      <Box
        component="form"
        onSubmit={(e) => {
          e.preventDefault();
          void make();
        }}
        sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap', alignItems: 'flex-start', mt: 1.5 }}
      >
        <TextField
          size="small"
          label={t('settingsPage.players.invites.uses')}
          value={uses}
          onChange={(e) => setUses(e.target.value)}
          error={maxUses === undefined}
          helperText={t('settingsPage.players.invites.usesHelp')}
          slotProps={{ htmlInput: { inputMode: 'numeric', 'data-testid': 'signup-invite-uses' } }}
          sx={{ width: 160 }}
        />
        <TextField
          size="small"
          label={t('settingsPage.players.invites.days')}
          value={days}
          onChange={(e) => setDays(e.target.value)}
          error={expiresInDays === undefined}
          helperText={t('settingsPage.players.invites.daysHelp')}
          slotProps={{ htmlInput: { inputMode: 'numeric', 'data-testid': 'signup-invite-days' } }}
          sx={{ width: 160 }}
        />
        <Button
          type="submit"
          variant="contained"
          disabled={busy || maxUses === undefined || expiresInDays === undefined}
          data-testid="signup-invite-make"
          sx={{ borderRadius: radii.pill, mt: 0.25 }}
        >
          {t('settingsPage.players.invites.make')}
        </Button>
      </Box>

      <Dialog open={made !== null} onClose={() => setMade(null)} data-testid="signup-invite-made">
        <DialogTitle>{t('settingsPage.players.invites.madeTitle')}</DialogTitle>
        <DialogContent>
          <Typography sx={{ mb: 1.5, fontSize: '0.875rem', color: color.ink2 }}>
            {t('settingsPage.players.invites.madeHelp')}
          </Typography>
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 1,
              p: 1.25,
              borderRadius: radii.md,
              bgcolor: color.paper3,
            }}
          >
            <Box
              component="code"
              data-testid="signup-invite-link"
              sx={{ ...mono, fontSize: '0.8125rem', wordBreak: 'break-all', flex: 1 }}
            >
              {made}
            </Box>
            <IconButton
              aria-label={t('settingsPage.players.invites.copy')}
              onClick={() => {
                if (!made) return;
                void navigator.clipboard
                  ?.writeText(made)
                  .then(() => showSuccess(t('settingsPage.players.invites.copied')))
                  .catch(() => undefined);
              }}
            >
              <CopyIcon size={18} />
            </IconButton>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setMade(null)}>{t('settingsPage.players.invites.done')}</Button>
        </DialogActions>
      </Dialog>
    </SettingsRow>
  );
}
