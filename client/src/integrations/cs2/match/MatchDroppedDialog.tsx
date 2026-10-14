/**
 * "Looks like you lost connection": on any page, for a player who was on
 * their live match's server and left it (a crash, a dropped connection, a
 * quit). One click puts them back (steam://connect, the match's address and
 * password). It closes by itself once they are on the server again.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Box, Button, Dialog, Typography } from '@mui/material';
import { PlugsIcon } from '@phosphor-icons/react';
import {
  api,
  fontDisplay,
  playNotificationSound,
  radii,
  tokens,
  useAuth,
  useModuleTranslation,
  useSocket,
} from '../../../module-sdk';
import type { MatchConnectResponse, MatchServer } from '../cs2.types';

const { color } = tokens;

interface MyMatch {
  status?: string;
  matchSlug?: string | null;
  connection?: 'connected' | 'dropped' | 'never';
  droppedAt?: number | null;
}

function connectHref(server: MatchServer): string {
  // The IP, not the hostname: CS2 ignores steam://connect with a hostname.
  const address = `${server.ip || server.host}:${server.port}`;
  return server.password
    ? `steam://connect/${address}/${encodeURIComponent(server.password)}`
    : `steam://connect/${address}`;
}

export function MatchDroppedDialog() {
  const { t } = useModuleTranslation('cs2');
  const { isPlayerAuthenticated } = useAuth();
  const socket = useSocket();
  const [drop, setDrop] = useState<{ slug: string; at: number } | null>(null);
  const [server, setServer] = useState<MatchServer | null>(null);
  // Drops the player closed the dialog for: not shown again for that drop.
  const dismissed = useRef(new Set<string>());

  const check = useCallback(async () => {
    const me = await api
      .get<MyMatch & { success: boolean }>('/api/players/me/match-status')
      .catch(() => null);
    const slug = me?.matchSlug ?? null;
    if (!me?.success || !slug || me.status !== 'match_ready' || me.connection !== 'dropped') {
      setDrop(null);
      return;
    }
    const at = me.droppedAt ?? 0;
    if (dismissed.current.has(`${slug}:${at}`)) return;
    const res = await api
      .get<MatchConnectResponse>(`/api/game/cs2/matches/${encodeURIComponent(slug)}/connect`)
      .catch(() => null);
    setServer(res?.server ?? null);
    setDrop((prev) => {
      if (!prev || prev.slug !== slug || prev.at !== at) playNotificationSound();
      return { slug, at };
    });
  }, []);

  useEffect(() => {
    if (!isPlayerAuthenticated) return;
    // After this render: the check can set state before its first await.
    const first = setTimeout(() => void check(), 0);
    return () => clearTimeout(first);
  }, [isPlayerAuthenticated, check]);

  // A player connecting or leaving changes the match: check again.
  useEffect(() => {
    if (!socket || !isPlayerAuthenticated) return;
    const onUpdate = () => void check();
    socket.on('match:update', onUpdate);
    return () => {
      socket.off('match:update', onUpdate);
    };
  }, [socket, isPlayerAuthenticated, check]);

  if (!drop) return null;
  const close = () => {
    dismissed.current.add(`${drop.slug}:${drop.at}`);
    setDrop(null);
  };
  return (
    <Dialog
      open
      onClose={close}
      maxWidth="xs"
      fullWidth
      aria-labelledby="dropped-title"
      data-testid="match-dropped-dialog"
      PaperProps={{
        sx: { borderRadius: radii.lg, bgcolor: color.paper2, backgroundImage: 'none' },
      }}
    >
      <Box sx={{ p: 3, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, color: color.sideT }}>
          <PlugsIcon size={24} aria-hidden />
          <Typography
            id="dropped-title"
            component="h2"
            sx={{
              fontFamily: fontDisplay,
              fontSize: '1.375rem',
              fontWeight: 600,
              color: color.ink,
            }}
          >
            {t('dropped.title')}
          </Typography>
        </Box>
        <Typography sx={{ color: color.ink2 }}>{t('dropped.body')}</Typography>
        <Box sx={{ display: 'flex', gap: 1, justifyContent: 'flex-end', mt: 1 }}>
          <Button onClick={close}>{t('dropped.later')}</Button>
          {server && (
            <Button
              variant="contained"
              component="a"
              href={connectHref(server)}
              onClick={close}
              data-testid="match-dropped-reconnect"
            >
              {t('dropped.reconnect')}
            </Button>
          )}
        </Box>
      </Box>
    </Dialog>
  );
}
