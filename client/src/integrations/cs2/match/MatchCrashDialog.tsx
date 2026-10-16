/**
 * "Looks like the match server crashed": on any page, for a player whose live
 * match lost its server (failover, FLEET.md §11). It follows the recovery
 * (bringing the server back, moving the match) and, once the match is back,
 * gives the Reconnect button for the new address. It closes by itself once the
 * player is on the server again.
 */
import { useCallback, useEffect, useState } from 'react';
import { Box, Button, CircularProgress, Dialog, Typography } from '@mui/material';
import {
  api,
  useAuth,
  useModuleTranslation,
  useSocket,
  tokens,
  fontDisplay,
  radii,
} from '../../../module-sdk';
import type { MatchConnectResponse, MatchServer } from '../cs2.types';
import { nextCrashState, showMissedMove, type CrashState } from './crashPopup';

const { color } = tokens;

const seenKey = (slug: string, at: number) => `cs2.crashSeen.${slug}.${at}`;

function wasSeen(slug: string, at: number): boolean {
  try {
    return localStorage.getItem(seenKey(slug, at)) === '1';
  } catch {
    return false;
  }
}

function markSeen(slug: string, at: number) {
  try {
    localStorage.setItem(seenKey(slug, at), '1');
  } catch {
    // No storage: it may show once more on the next page.
  }
}

function connectHref(server: MatchServer): string {
  // The IP, not the hostname: CS2 ignores steam://connect with a hostname.
  const address = `${server.ip || server.host}:${server.port}`;
  return server.password
    ? `steam://connect/${address}/${encodeURIComponent(server.password)}`
    : `steam://connect/${address}`;
}

export function MatchCrashDialog() {
  const { t } = useModuleTranslation('cs2');
  const { isPlayerAuthenticated } = useAuth();
  const socket = useSocket();
  const [state, setState] = useState<CrashState | null>(null);
  const [server, setServer] = useState<MatchServer | null>(null);
  const [movedAt, setMovedAt] = useState<number | null>(null);

  const mySlug = useCallback(async (): Promise<string | null> => {
    const res = await api
      .get<{ success: boolean; matchSlug?: string | null }>('/api/players/me/match-status')
      .catch(() => null);
    return res?.success ? (res.matchSlug ?? null) : null;
  }, []);

  const loadServer = useCallback(async (slug: string) => {
    const res = await api
      .get<MatchConnectResponse>(`/api/game/cs2/matches/${encodeURIComponent(slug)}/connect`)
      .catch(() => null);
    setServer(res?.server ?? null);
    setMovedAt(res?.server?.moved?.at ?? null);
    return res;
  }, []);

  // A move the page missed: it opened after the match was moved.
  useEffect(() => {
    if (!isPlayerAuthenticated) return;
    let live = true;
    void (async () => {
      const slug = await mySlug();
      if (!slug || !live) return;
      const res = await loadServer(slug);
      const at = res?.server?.moved?.at;
      if (
        live &&
        showMissedMove(at, Math.floor(Date.now() / 1000), at ? wasSeen(slug, at) : true)
      ) {
        setState({ matchSlug: slug, phase: 'back' });
      }
    })();
    return () => {
      live = false;
    };
  }, [isPlayerAuthenticated, mySlug, loadServer]);

  useEffect(() => {
    if (!socket || !isPlayerAuthenticated) return;
    const onFailover = (event: { matchSlug: string; status: string | null }) => {
      void (async () => {
        const slug = await mySlug();
        setState((prev) => nextCrashState(prev, event, slug));
        if (
          slug === event.matchSlug &&
          (event.status === 'moved' || event.status === 'withdrawn')
        ) {
          await loadServer(slug);
        }
      })();
    };
    socket.on('fleet:failover', onFailover);
    return () => {
      socket.off('fleet:failover', onFailover);
    };
  }, [socket, isPlayerAuthenticated, mySlug, loadServer]);

  const close = useCallback(() => {
    if (state && movedAt) markSeen(state.matchSlug, movedAt);
    setState(null);
  }, [state, movedAt]);

  // Back on the server: the notice has done its job (it stayed up after the player reconnected,
  // 2026-10-15). Checked on every match update (a player connecting is one) and every 10 s.
  const back = state?.phase === 'back';
  useEffect(() => {
    if (!back) return;
    let live = true;
    const check = async () => {
      const me = await api
        .get<{ success: boolean; connection?: string }>('/api/players/me/match-status')
        .catch(() => null);
      if (live && me?.success && me.connection === 'connected') close();
    };
    const timer = window.setInterval(() => void check(), 10_000);
    const onUpdate = () => void check();
    socket?.on('match:update', onUpdate);
    void check();
    return () => {
      live = false;
      window.clearInterval(timer);
      socket?.off('match:update', onUpdate);
    };
  }, [back, socket, close]);

  if (!state) return null;
  return (
    <Dialog
      open
      onClose={close}
      maxWidth="xs"
      fullWidth
      aria-labelledby="crash-title"
      data-testid="match-crash-dialog"
      PaperProps={{
        sx: {
          borderRadius: radii.lg,
          bgcolor: color.paper,
          border: `1px solid ${color.rule}`,
          backgroundImage: 'none',
        },
      }}
    >
      <Box sx={{ p: 3, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <Typography
          component="span"
          sx={{
            fontSize: '0.75rem',
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            fontWeight: 600,
            color: back ? color.live : color.warning,
          }}
        >
          {back ? t('crash.backEyebrow') : t('crash.downTitle')}
        </Typography>
        <Typography
          id="crash-title"
          component="h2"
          sx={{
            m: 0,
            fontFamily: fontDisplay,
            fontSize: '1.375rem',
            fontWeight: 700,
            color: color.ink,
          }}
        >
          {back
            ? t('crash.backTitle')
            : state.phase === 'moving'
              ? t('crash.movingTitle')
              : t('crash.downHeading')}
        </Typography>
        <Typography sx={{ color: color.ink2 }} data-testid="match-crash-status">
          {back
            ? server?.moved?.inPlace
              ? t('crash.backInPlace')
              : t('crash.backMoved')
            : state.phase === 'moving'
              ? t('crash.moving')
              : t('crash.down')}
          {!back && <> {t('crash.wait')}</>}
        </Typography>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.25 }}>
          {back && server ? (
            <Button
              variant="contained"
              component="a"
              href={connectHref(server)}
              onClick={close}
              data-testid="match-crash-reconnect"
            >
              {t('crash.reconnect')}
            </Button>
          ) : (
            <Button
              variant="contained"
              disabled
              startIcon={<CircularProgress size={14} color="inherit" aria-hidden />}
            >
              {t('crash.reconnect')}
            </Button>
          )}
          <Button variant="outlined" onClick={close}>
            {t('crash.close')}
          </Button>
        </Box>
      </Box>
    </Dialog>
  );
}
