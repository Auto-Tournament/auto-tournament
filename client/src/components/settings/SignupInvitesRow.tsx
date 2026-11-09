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
import { CheckIcon, CopyIcon, LinkIcon, TrashIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { api, apiErrorMessage } from '../../utils/api';
import { fmtDate, fmtDateTime } from '../../utils/time';
import { useSnackbar } from '../../contexts/SnackbarContext';
import { tokens, radii, mono } from '../../theme/tokens';
import { SettingsRow } from './SettingsRow';

const { color } = tokens;

interface SignupInvite {
  id: string;
  maxUses: number | null;
  uses: number;
  expiresAt: number | null;
  createdByName: string | null;
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
  const [made, setMade] = useState<{ url: string; invite: SignupInvite } | null>(null);
  const [copied, setCopied] = useState(false);

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
      const r = await api.post<{ path: string; invite: SignupInvite }>(
        '/api/settings/signup-invites',
        { maxUses, expiresInDays }
      );
      setCopied(false);
      setMade({ url: `${window.location.origin}${r.path}`, invite: r.invite });
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

  // What the new link allows, in one sentence ("…, 10 times, until 16 Nov.").
  const madeFor = (i: SignupInvite) => {
    const date = i.expiresAt === null ? '' : fmtDate(i.expiresAt);
    if (i.maxUses === null)
      return date
        ? t('settingsPage.players.invites.madeForUntil', { date })
        : t('settingsPage.players.invites.madeFor');
    return date
      ? t('settingsPage.players.invites.madeForBoth', { count: i.maxUses, date })
      : t('settingsPage.players.invites.madeForUses', { count: i.maxUses });
  };

  return (
    <SettingsRow
      title={t('settingsPage.players.invites.title')}
      sub={t('settingsPage.players.invites.short')}
      data-testid="settings-signup-invites"
    >
      <Box component="ul" sx={{ m: 0, p: 0, listStyle: 'none' }}>
        {(list ?? []).map((invite) => {
          const madeAt = fmtDateTime(invite.createdAt);
          return (
            <Box
              component="li"
              key={invite.id}
              sx={{ display: 'flex', alignItems: 'center', gap: 1.5, py: 0.75 }}
              data-testid={`signup-invite-${invite.id}`}
            >
              <LinkIcon size={18} color={color.muted} aria-hidden />
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography sx={{ fontSize: '0.875rem' }}>
                  {invite.createdByName
                    ? t('settingsPage.players.invites.madeBy', {
                        date: madeAt,
                        name: invite.createdByName,
                      })
                    : t('settingsPage.players.invites.made', { date: madeAt })}
                </Typography>
                <Typography sx={{ fontSize: '0.8125rem', color: color.ink2 }}>
                  {line(invite)}
                </Typography>
              </Box>
              {invite.maxUses !== null && (
                <Box
                  aria-hidden
                  sx={{
                    flex: 'none',
                    width: 96,
                    height: 4,
                    borderRadius: radii.pill,
                    bgcolor: color.rule,
                    overflow: 'hidden',
                  }}
                >
                  <Box
                    sx={{
                      height: '100%',
                      width: `${Math.min(100, (invite.uses / invite.maxUses) * 100)}%`,
                      bgcolor: color.live,
                    }}
                  />
                </Box>
              )}
              <IconButton
                aria-label={t('settingsPage.players.invites.revoke', { date: madeAt })}
                onClick={() => void revoke(invite)}
                data-testid={`signup-invite-revoke-${invite.id}`}
                sx={{ color: color.ink2 }}
              >
                <TrashIcon size={18} />
              </IconButton>
            </Box>
          );
        })}
      </Box>
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
        sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap', alignItems: 'flex-end', mt: 1.5 }}
      >
        <TextField
          size="small"
          label={t('settingsPage.players.invites.uses')}
          placeholder={t('settingsPage.players.invites.noLimit')}
          value={uses}
          onChange={(e) => setUses(e.target.value)}
          error={maxUses === undefined}
          slotProps={{
            inputLabel: { shrink: true },
            htmlInput: { inputMode: 'numeric', 'data-testid': 'signup-invite-uses' },
          }}
          sx={{ width: 150 }}
        />
        <TextField
          size="small"
          label={t('settingsPage.players.invites.days')}
          placeholder={t('settingsPage.players.invites.noLimit')}
          value={days}
          onChange={(e) => setDays(e.target.value)}
          error={expiresInDays === undefined}
          slotProps={{
            inputLabel: { shrink: true },
            htmlInput: { inputMode: 'numeric', 'data-testid': 'signup-invite-days' },
          }}
          sx={{ width: 150 }}
        />
        <Button
          type="submit"
          variant="contained"
          disabled={busy || maxUses === undefined || expiresInDays === undefined}
          data-testid="signup-invite-make"
          sx={{ borderRadius: radii.pill }}
        >
          {t('settingsPage.players.invites.make')}
        </Button>
        <Typography sx={{ flexBasis: '100%', fontSize: '0.8125rem', color: color.muted }}>
          {t('settingsPage.players.invites.limitsHint')}
        </Typography>
      </Box>

      <Dialog
        open={made !== null}
        onClose={() => setMade(null)}
        fullWidth
        maxWidth="xs"
        data-testid="signup-invite-made"
      >
        <DialogTitle>{t('settingsPage.players.invites.madeTitle')}</DialogTitle>
        <DialogContent sx={{ display: 'grid', gap: 1.5 }}>
          <Typography sx={{ fontSize: '0.875rem', color: color.ink2 }}>
            {t('settingsPage.players.invites.madeHelp')} {made && madeFor(made.invite)}
          </Typography>
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 1,
              p: 1,
              pl: 1.5,
              borderRadius: radii.md,
              bgcolor: color.paper3,
              border: `1px solid ${color.rule}`,
            }}
          >
            <Box
              component="code"
              data-testid="signup-invite-link"
              sx={{ ...mono, fontSize: '0.8125rem', wordBreak: 'break-all', flex: 1 }}
            >
              {made?.url}
            </Box>
            <Button
              size="small"
              variant="outlined"
              startIcon={copied ? <CheckIcon size={15} /> : <CopyIcon size={15} />}
              onClick={() => {
                if (!made) return;
                void navigator.clipboard
                  ?.writeText(made.url)
                  .then(() => setCopied(true))
                  .catch(() => undefined);
              }}
              sx={{ flex: 'none', borderRadius: radii.pill, whiteSpace: 'nowrap' }}
            >
              {copied
                ? t('settingsPage.players.invites.copied')
                : t('settingsPage.players.invites.copy')}
            </Button>
          </Box>
          <Typography sx={{ fontSize: '0.8125rem', color: color.muted }}>
            {t('settingsPage.players.invites.revokeNote')}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button
            variant="contained"
            onClick={() => setMade(null)}
            sx={{ borderRadius: radii.pill }}
          >
            {t('settingsPage.players.invites.done')}
          </Button>
        </DialogActions>
      </Dialog>
    </SettingsRow>
  );
}
