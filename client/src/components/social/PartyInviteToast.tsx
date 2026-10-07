/**
 * A party invite arriving while the player is anywhere on the site: a card
 * under the top bar with Join and Decline, for 60 seconds. Ignored, it stays
 * in the bell. Mounted once for the app (App.tsx), signed-in players only.
 */
import React from 'react';
import { Box, Button, IconButton, Typography } from '@mui/material';
import { XIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { useSnackbar } from '../../contexts/SnackbarContext';
import { PlayerAvatar } from '../player/PlayerAvatar';
import { paths } from '../../paths';
import { tokens } from '../../theme/tokens';
import { answerPartyInvite, dismissToast, useSocial, type Notice } from './socialStore';
import { soundNotification } from '../../utils/soundNotification';

const { color } = tokens;
const SHOW_SECONDS = 60;

function Toast({ notice }: { notice: Notice }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { showError } = useSnackbar();
  const [left, setLeft] = React.useState(SHOW_SECONDS);
  const [busy, setBusy] = React.useState(false);
  const from = (notice.data.from ?? {}) as { id?: string; name?: string; avatarUrl?: string | null };
  const partyId = String(notice.data.partyId ?? '');

  React.useEffect(() => {
    soundNotification.playNotification();
  }, []);
  React.useEffect(() => {
    if (left <= 0) {
      dismissToast(notice.id);
      return;
    }
    const timer = setTimeout(() => setLeft((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [left, notice.id]);

  const answer = async (accept: boolean) => {
    setBusy(true);
    try {
      await answerPartyInvite(partyId, accept);
      dismissToast(notice.id);
      if (accept) navigate(paths.play);
    } catch (error) {
      showError((error as Error).message);
      dismissToast(notice.id);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Box
      role="status"
      data-testid="party-invite-toast"
      sx={{
        pointerEvents: 'auto',
        display: 'flex',
        gap: 1.5,
        p: 1.75,
        width: 360,
        maxWidth: 'calc(100vw - 32px)',
        borderRadius: '18px',
        bgcolor: color.paper2,
        border: `1px solid ${color.accent}`,
        boxShadow: `0 22px 60px ${color.shadow}`,
      }}
    >
      <PlayerAvatar id={from.id ?? partyId} name={from.name ?? ''} avatarUrl={from.avatarUrl ?? undefined} size={44} />
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography sx={{ fontSize: '0.8125rem', color: color.ink2 }}>
          <Box component="b" sx={{ color: color.ink }}>
            {from.name}
          </Box>{' '}
          {t('social.notice.partyInvite')}
        </Typography>
        <Typography sx={{ fontSize: '0.75rem', color: color.muted }}>
          {t('social.notice.partyDetail', { mode: String(notice.data.mode ?? ''), size: Number(notice.data.size ?? 1) })}
        </Typography>
        <Box sx={{ display: 'flex', gap: 0.75, mt: 1.25 }}>
          <Button size="small" variant="contained" disabled={busy} onClick={() => void answer(true)}>
            {t('social.toast.join')}
          </Button>
          <Button size="small" variant="outlined" disabled={busy} onClick={() => void answer(false)}>
            {t('social.notice.decline')}
          </Button>
        </Box>
        <Box sx={{ height: 3, borderRadius: 9, bgcolor: color.paper3, mt: 1.5, overflow: 'hidden' }}>
          <Box sx={{ height: '100%', width: `${(left / SHOW_SECONDS) * 100}%`, bgcolor: color.accent, transition: 'width 1s linear' }} />
        </Box>
        <Typography sx={{ fontSize: '0.6875rem', color: color.muted, mt: 0.5 }}>{t('social.toast.closes', { count: left })}</Typography>
      </Box>
      <IconButton size="small" aria-label={t('social.toast.close')} onClick={() => dismissToast(notice.id)} sx={{ alignSelf: 'flex-start', color: color.muted }}>
        <XIcon size={16} />
      </IconButton>
    </Box>
  );
}

export function PartyInviteToast() {
  const { playerSteamId, impersonation } = useAuth();
  const social = useSocial(Boolean(playerSteamId) && !impersonation);
  if (social.toasts.length === 0) return null;
  return (
    <Box
      sx={{
        position: 'fixed',
        zIndex: 1400,
        top: 76,
        right: { xs: 16, md: 'max(16px, calc((100vw - 1200px) / 2))' },
        display: 'flex',
        flexDirection: 'column',
        gap: 1,
        pointerEvents: 'none',
      }}
    >
      {social.toasts.slice(-3).map((n) => (
        <Toast key={n.id} notice={n} />
      ))}
    </Box>
  );
}
