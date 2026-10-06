/**
 * Matchmaking on every page (docs/design/matchmaking.md, UI): a slim bar while
 * searching, and the "Match found" dialog with its countdown. When everyone
 * has accepted it opens the match room. Renders nothing while matchmaking is
 * not available to this player.
 */
import { useEffect, useRef, useState } from 'react';
import {
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogContent,
  Stack,
  Typography,
} from '@mui/material';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { tokens, radii, fontDisplay, fontMono } from '../../theme/tokens';
import { useSnackbar } from '../../contexts/SnackbarContext';
import { useAuth } from '../../contexts/AuthContext';
import { matchmakingAction, secondsUntil, useMatchmaking, playersFor } from './matchmakingStore';
import { playLobbyPath } from '../../paths';

const ACCEPT_SECONDS = 20;
/** The countdown ring's circumference (r = 52). */
const RING = 2 * Math.PI * 52;

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

  const waited =
    searching && me.queue
      ? Math.max(0, Math.floor(Date.now() / 1000 + skew - me.queue.queuedAt))
      : 0;
  const left = accepting && lobby ? secondsUntil(lobby.acceptDeadline, skew) : 0;
  const isLeader = !!me.party && me.party.leader === playerSteamId;
  // "7 of 10" on the bar too (draft 6b): the players searching in this mode, of a full match.
  const queueMode = me.queue?.mode ?? '5v5';
  const seatsInMode = playersFor(queueMode);
  const queuedInMode = me.queueCounts?.[queueMode];

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
            border: `1px solid ${tokens.color.accent}`,
            borderRadius: radii.pill,
            maxWidth: 'calc(100vw - 32px)',
          })}
        >
          <CircularProgress size={16} thickness={5} aria-hidden />
          <Typography variant="body2" sx={{ whiteSpace: 'nowrap' }}>
            {t('matchmaking.queue.searching', { mode: me.queue?.mode ?? '5v5' })}{' '}
            <Box
              component="span"
              sx={{ fontVariantNumeric: 'tabular-nums', color: 'text.secondary' }}
            >
              {clock(waited)}
            </Box>
            {typeof queuedInMode === 'number' && (
              <Box component="span" sx={{ color: 'text.secondary' }}>
                {' · '}
                {t('matchmaking.play.seats', { count: Math.min(queuedInMode, seatsInMode), total: seatsInMode })}
              </Box>
            )}
          </Typography>
          {isLeader && (
            <Button
              size="small"
              onClick={() => void cancel()}
              disabled={busy}
              data-testid="mm-queue-cancel"
            >
              {t('matchmaking.queue.cancel')}
            </Button>
          )}
        </Box>
      )}

      <Dialog
        open={accepting && !!lobby}
        maxWidth="sm"
        fullWidth
        aria-labelledby="mm-found-title"
        aria-describedby="mm-found-desc"
        PaperProps={{
          sx: {
            borderRadius: '28px',
            bgcolor: tokens.color.paper2,
            border: `1px solid ${tokens.color.accent}`,
            backgroundImage: 'none',
          },
        }}
      >
        <DialogContent
          sx={{
            p: { xs: 3, sm: 5 },
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 3,
            textAlign: 'center',
          }}
        >
          <Box
            sx={{
              position: 'relative',
              width: 120,
              height: 120,
              display: 'grid',
              placeItems: 'center',
            }}
          >
            <svg width="120" height="120" viewBox="0 0 120 120" aria-hidden="true">
              <circle
                cx="60"
                cy="60"
                r="52"
                fill="none"
                stroke={tokens.color.rule}
                strokeWidth="8"
              />
              <circle
                cx="60"
                cy="60"
                r="52"
                fill="none"
                stroke={tokens.color.accent}
                strokeWidth="8"
                strokeLinecap="round"
                strokeDasharray={RING}
                strokeDashoffset={RING * (1 - Math.max(0, Math.min(1, left / ACCEPT_SECONDS)))}
                transform="rotate(-90 60 60)"
                style={{ transition: 'stroke-dashoffset 250ms linear' }}
              />
            </svg>
            <Typography
              aria-label={t('matchmaking.found.secondsLeft', { count: left })}
              sx={{ position: 'absolute', fontFamily: fontMono, fontSize: '2.125rem' }}
            >
              {left}
            </Typography>
          </Box>
          <Typography
            id="mm-found-title"
            component="h2"
            sx={{
              fontFamily: fontDisplay,
              fontWeight: 700,
              fontSize: { xs: '2rem', sm: '2.5rem' },
            }}
          >
            {t('matchmaking.found.title')}
          </Typography>
          <Typography id="mm-found-desc" sx={{ color: tokens.color.ink2 }}>
            {t('matchmaking.found.subtitle', {
              mode: t(`matchmaking.play.modeTitle.${me.queue?.mode ?? '5v5'}`, {
                defaultValue: me.queue?.mode ?? '5v5',
              }),
              seconds: ACCEPT_SECONDS,
            })}
          </Typography>
          <Box
            role="img"
            aria-label={t('matchmaking.found.accepted', {
              accepted: lobby?.accepted ?? 0,
              total: lobby?.total ?? 0,
            })}
            sx={{
              display: 'grid',
              gridTemplateColumns: `repeat(${Math.max(1, lobby?.total ?? 10)}, minmax(0, 34px))`,
              gap: 1,
              width: '100%',
              justifyContent: 'center',
            }}
          >
            {Array.from({ length: lobby?.total ?? 0 }, (_, i) => (
              <Box
                key={i}
                sx={{
                  height: 34,
                  borderRadius: '10px',
                  bgcolor: i < (lobby?.accepted ?? 0) ? tokens.color.pick : tokens.color.paper3,
                }}
              />
            ))}
          </Box>
          <Typography
            sx={{ fontSize: '0.875rem', color: tokens.color.muted }}
            data-testid="mm-accepted-count"
          >
            {t('matchmaking.found.accepted', {
              accepted: lobby?.accepted ?? 0,
              total: lobby?.total ?? 0,
            })}
          </Typography>
          <Stack direction="row" spacing={1.5} sx={{ width: '100%' }}>
            <Button
              onClick={() => void answer('decline')}
              disabled={busy || lobby?.youAccepted}
              data-testid="mm-decline"
              variant="outlined"
              sx={{
                flex: 1,
                height: 64,
                borderRadius: radii.pill,
                fontWeight: 600,
                fontSize: '1.0625rem',
              }}
            >
              {t('matchmaking.found.decline')}
            </Button>
            <Button
              variant="contained"
              onClick={() => void answer('accept')}
              disabled={busy || lobby?.youAccepted}
              data-testid="mm-accept"
              sx={{
                flex: 2,
                height: 64,
                borderRadius: radii.pill,
                fontFamily: fontDisplay,
                fontWeight: 700,
                fontSize: lobby?.youAccepted ? '1rem' : '1.375rem',
              }}
            >
              {lobby?.youAccepted ? t('matchmaking.found.waiting') : t('matchmaking.found.accept')}
            </Button>
          </Stack>
        </DialogContent>
      </Dialog>
    </>
  );
}
