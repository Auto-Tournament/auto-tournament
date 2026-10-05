/**
 * Matchmaking on every page (docs/design/matchmaking.md, UI): a slim bar while
 * searching, and the "Match found" dialog with its countdown. When everyone
 * has accepted it opens the match room. Renders nothing while matchmaking is
 * not available to this player.
 */
import { useEffect, useRef, useState } from 'react';
import { Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, Stack, Typography } from '@mui/material';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { tokens, radii, fontDisplay } from '../../theme/tokens';
import { useSnackbar } from '../../contexts/SnackbarContext';
import { useAuth } from '../../contexts/AuthContext';
import { matchmakingAction, secondsUntil, useMatchmaking } from './matchmakingStore';
import { playLobbyPath } from '../../paths';

const ACCEPT_SECONDS = 20;

function useTick(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return undefined;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [active]);
  return now;
}

function clock(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function MatchmakingOverlay() {
  const { t } = useTranslation();
  const { available, me, skew } = useMatchmaking();
  const { showError } = useSnackbar();
  const { playerSteamId } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [busy, setBusy] = useState(false);

  const searching = me?.queue?.status === 'searching';
  const lobby = me?.lobby ?? null;
  const accepting = lobby?.status === 'accepting';
  useTick(searching || accepting);

  // A found match: a sound and the tab title, so a background tab notices.
  const announced = useRef<string | null>(null);
  useEffect(() => {
    if (!accepting || !lobby || announced.current === lobby.id) return;
    announced.current = lobby.id;
    void new Audio('/alerts/notification.mp3').play().catch(() => undefined);
    const before = document.title;
    document.title = t('matchmaking.found.title');
    const restore = setTimeout(() => {
      document.title = before;
    }, ACCEPT_SECONDS * 1000);
    return () => clearTimeout(restore);
  }, [accepting, lobby, t]);

  // Everyone accepted: off to the match room (once).
  const opened = useRef<string | null>(null);
  useEffect(() => {
    if (lobby?.status !== 'ready' || opened.current === lobby.id) return;
    opened.current = lobby.id;
    const room = playLobbyPath(lobby.id);
    if (pathname !== room) navigate(room);
  }, [lobby, navigate, pathname]);

  if (!available || !me) return null;

  const answer = async (action: 'accept' | 'decline') => {
    if (!lobby) return;
    setBusy(true);
    try {
      await matchmakingAction('POST', `/lobbies/${lobby.id}/${action}`);
    } catch (error) {
      showError((error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    setBusy(true);
    try {
      await matchmakingAction('DELETE', '/queue');
    } catch (error) {
      showError((error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const waited = searching && me.queue ? Math.max(0, Math.floor(Date.now() / 1000 + skew - me.queue.queuedAt)) : 0;
  const left = accepting && lobby ? secondsUntil(lobby.acceptDeadline, skew) : 0;
  const isLeader = !!me.party && me.party.leader === playerSteamId;

  return (
    <>
      {searching && (
        <Box
          role="status"
          data-testid="mm-queue-bar"
          sx={(theme) => ({
            position: 'fixed',
            left: '50%',
            bottom: 16,
            transform: 'translateX(-50%)',
            zIndex: theme.zIndex.snackbar - 1,
            display: 'flex',
            alignItems: 'center',
            gap: 2,
            px: 2.5,
            py: 1,
            bgcolor: tokens.color.navGlass,
            backdropFilter: 'blur(14px)',
            border: `1px solid ${tokens.color.rule}`,
            borderRadius: radii.pill,
            maxWidth: 'calc(100vw - 32px)',
          })}
        >
          <CircularProgress size={16} thickness={5} aria-hidden />
          <Typography variant="body2" sx={{ whiteSpace: 'nowrap' }}>
            {t('matchmaking.queue.searching', { mode: me.queue?.mode ?? '5v5' })}{' '}
            <Box component="span" sx={{ fontVariantNumeric: 'tabular-nums', color: 'text.secondary' }}>
              {clock(waited)}
            </Box>
          </Typography>
          {isLeader && (
            <Button size="small" onClick={() => void cancel()} disabled={busy} data-testid="mm-queue-cancel">
              {t('matchmaking.queue.cancel')}
            </Button>
          )}
        </Box>
      )}

      <Dialog open={accepting && !!lobby} maxWidth="xs" fullWidth aria-labelledby="mm-found-title">
        <DialogContent sx={{ textAlign: 'center', pt: 4 }}>
          <Typography id="mm-found-title" component="h2" sx={{ fontFamily: fontDisplay, fontWeight: 700, fontSize: '1.75rem' }}>
            {t('matchmaking.found.title')}
          </Typography>
          <Box sx={{ position: 'relative', display: 'inline-flex', my: 3 }}>
            <CircularProgress
              variant="determinate"
              value={(left / ACCEPT_SECONDS) * 100}
              size={96}
              thickness={3}
              aria-label={t('matchmaking.found.secondsLeft', { count: left })}
            />
            <Box sx={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center' }}>
              <Typography sx={{ fontFamily: fontDisplay, fontWeight: 700, fontSize: '1.75rem' }}>{left}</Typography>
            </Box>
          </Box>
          <Typography color="text.secondary" data-testid="mm-accepted-count">
            {t('matchmaking.found.accepted', { accepted: lobby?.accepted ?? 0, total: lobby?.total ?? 0 })}
          </Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 3 }}>
          <Stack direction="row" spacing={1} sx={{ width: '100%' }}>
            <Button
              fullWidth
              onClick={() => void answer('decline')}
              disabled={busy || lobby?.youAccepted}
              data-testid="mm-decline"
            >
              {t('matchmaking.found.decline')}
            </Button>
            <Button
              fullWidth
              variant="contained"
              onClick={() => void answer('accept')}
              disabled={busy || lobby?.youAccepted}
              data-testid="mm-accept"
            >
              {lobby?.youAccepted ? t('matchmaking.found.waiting') : t('matchmaking.found.accept')}
            </Button>
          </Stack>
        </DialogActions>
      </Dialog>
    </>
  );
}
