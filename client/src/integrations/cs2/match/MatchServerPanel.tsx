import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Box, Button, Typography, Alert } from '@mui/material';
import { motion, useReducedMotion } from 'motion/react';
import { CopyIcon, GameControllerIcon } from '@phosphor-icons/react';
import {
  api,
  onSocketReconnect,
  tokens,
  mono,
  useModuleTranslation,
  useSnackbar,
  useSocket,
  radii,
} from '../../../module-sdk';
import type { MatchConnectPanelProps } from '../../types';
import type { CS2MapData, MatchConnectResponse, MatchServer } from '../cs2.types';
import { getMapData, getMapDisplayName } from '../maps/mapData';
import { copyTextToClipboard } from './clipboard';

const MAP_IMAGE_BASE =
  'https://cdn.jsdelivr.net/gh/Auto-Tournament/cs2-server-manager@master/map_thumbnails';

/** The map's name and pictures, from the built-in list or built from its slug. */
function mapDataFor(slug: string | null): CS2MapData | null {
  if (!slug) return null;
  return (
    getMapData(slug) ?? {
      name: slug,
      displayName: getMapDisplayName(slug),
      // Full-size webp for the large hero image, thumbnail for smaller usages.
      image: `${MAP_IMAGE_BASE}/${slug}.webp`,
      thumbnail: `${MAP_IMAGE_BASE}/${slug}_thumb.webp`,
    }
  );
}

/**
 * The server to show, or null for "waiting for a server".
 *
 * `server.status` is MatchZy Enhanced's own status (idle |
 * loading | warmup | knife | live | paused | halftime | postgame | queued |
 * error), filled in only when the server answered, so any value but `error`
 * means it is reachable. Live stats count on their own: they only arrive from
 * a server that is talking to us. (This once compared against 'online' and
 * 'checking', which the route never produces, and a server in `idle` read as
 * unassigned.)
 *
 * The plugin says `idle` for a server with a match loaded that has not been
 * asked again since, so a live match could read "Status: Available": what the
 * match itself is doing is the better answer when there is one.
 */
function effectiveServer(connect: MatchConnectResponse): MatchServer | null {
  const { server, liveStatus, matchStatus } = connect;
  if (!server) return null;
  const serverStatus = server.status ?? null;
  const online = (!!serverStatus && serverStatus !== 'error') || !!liveStatus;
  if (!online) return null;
  const liveDerived: string | null = liveStatus
    ? liveStatus
    : matchStatus === 'live'
      ? 'live'
      : matchStatus === 'loaded'
        ? 'warmup'
        : null;
  const status =
    liveDerived && (!serverStatus || serverStatus === 'idle' || serverStatus === 'queued')
      ? liveDerived
      : serverStatus;
  return { ...server, status: status ?? server.status };
}

/**
 * How the viewer joins this match, read by slug and read again whenever the
 * match, the bracket or the connection moves: a server gets assigned, the map
 * changes, the server's status changes. Null until the first answer.
 */
function useMatchConnect(
  matchSlug: string,
  enabled: boolean,
  matchStatus: string | undefined
): MatchConnectResponse | null {
  const [connect, setConnect] = useState<MatchConnectResponse | null>(null);
  const socket = useSocket();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await api.get<MatchConnectResponse>(
        `/api/game/cs2/matches/${encodeURIComponent(matchSlug)}/connect`
      );
      if (res.success) setConnect(res);
    } catch (err) {
      console.error('Failed to read how to join the match:', err);
    }
  }, [matchSlug]);

  useEffect(() => {
    if (!enabled) return;
    // The state is set after the request answers, not synchronously.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [enabled, load, matchStatus]);

  useEffect(() => {
    if (!enabled) return;
    const reload = () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void load(), 300);
    };
    const onMatch = (data?: { slug?: string }) => {
      if (!data?.slug || data.slug === matchSlug) reload();
    };
    socket.on('match:update', onMatch);
    socket.on(`match:update:${matchSlug}`, reload);
    // server_assigned, match_loaded and the like arrive as bracket updates.
    socket.on('bracket:update', reload);
    const offReconnect = onSocketReconnect(socket, reload);
    // A failover or a restarted server does not always come with an event here, and the page
    // kept the old server / password until a reload (live test). Ask again every 20 s and when
    // the tab comes back into view.
    const poll = setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, 20_000);
    const onVisible = () => {
      if (document.visibilityState === 'visible') reload();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      if (timer.current) clearTimeout(timer.current);
      clearInterval(poll);
      document.removeEventListener('visibilitychange', onVisible);
      offReconnect();
      socket.off('match:update', onMatch);
      socket.off(`match:update:${matchSlug}`, reload);
      socket.off('bracket:update', reload);
    };
  }, [enabled, socket, matchSlug, load]);

  return enabled ? connect : null;
}

/**
 * The team match card's join panel (`matchPanels.teamView`): the map that is
 * up, the server's address and status, and the Connect and Copy buttons.
 *
 * It reads all of that itself by match slug (client API 0.2.0). The page only
 * says whether it lets this viewer join at all: the player page shows the
 * controls to that player alone, even to a teammate looking at it. The route
 * checks again, and sends an address only to a player on the match.
 */
export function MatchServerPanel({ matchSlug, viewerCanJoin, matchStatus }: MatchConnectPanelProps) {
  const { t } = useModuleTranslation('cs2');
  const { showError } = useSnackbar();
  const connect = useMatchConnect(matchSlug, viewerCanJoin, matchStatus);
  const [copied, setCopied] = useState(false);
  const [connected, setConnected] = useState(false);
  const [copyFallbackCommand, setCopyFallbackCommand] = useState<string | null>(null);
  const reduceMotion = useReducedMotion();

  const server = connect ? effectiveServer(connect) : null;
  const currentMapData = useMemo(() => mapDataFor(connect?.currentMap ?? null), [connect?.currentMap]);


  const onConnect = () => {
    if (!server) return;
    // The IP, not the hostname: CS2 ignores steam://connect with a hostname.
    const address = `${server.ip || server.host}:${server.port}`;
    // steam://connect, not steam://run/730//+connect: run only passes its
    // arguments when it starts the game, so with CS2 already open the button
    // did nothing. connect joins a running game too (the webhooks use it).
    window.location.href = server.password
      ? `steam://connect/${address}/${encodeURIComponent(server.password)}`
      : `steam://connect/${address}`;

    setConnected(true);
    setTimeout(() => setConnected(false), 3000);
  };

  const onCopy = async () => {
    if (!server) return;
    const connectCommand = `connect ${server.host}:${server.port}${
      server.password ? `; password ${server.password}` : ''
    }`;

    setCopyFallbackCommand(null);

    // Copying works over plain HTTP too — `copyTextToClipboard` falls back to
    // execCommand where `navigator.clipboard` does not exist. Showing the
    // command is the last resort, not the first response to a non-HTTPS
    // origin: most LAN users can simply have the button work.
    if (await copyTextToClipboard(connectCommand)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      return;
    }
    setCopyFallbackCommand(connectCommand);
    showError(t('matchInfo.copyBlocked'));
  };

  // Not asked yet: nothing, rather than a "waiting" that is about to be wrong.
  if (viewerCanJoin && !connect) return null;

  if (!server) {
    return (
      <Alert severity="info">
        <Typography variant="body2" fontWeight={600} gutterBottom>
          {t('matchInfo.server.waitingTitle')}
        </Typography>
        <Typography variant="body2">{t('matchInfo.server.waitingBody')}</Typography>
      </Alert>
    );
  }

  // The API sends an English label alongside the raw MatchZy Enhanced status; translate
  // the known statuses and fall back to that label for anything new.
  const statusLabel = server.status
    ? t(`matchInfo.server.statusLabels.${server.status}`, {
        defaultValue: server.statusDescription?.label || server.status,
      })
    : '';

  return (
    <Box display="flex" flexDirection="column" gap={2}>

      <Box display="flex" flexDirection="column" gap={2}>
        {server.moved && (
          <Alert severity="warning" data-testid="match-server-moved">
            <Typography variant="body2" fontWeight={600} gutterBottom>
              {server.moved.inPlace
                ? t('matchInfo.server.resumedTitle', { defaultValue: 'The server restarted' })
                : t('matchInfo.server.movedTitle', { defaultValue: 'The match moved to a new server' })}
            </Typography>
            <Typography variant="body2">
              {server.moved.inPlace
                ? t('matchInfo.server.resumedBody', {
                    defaultValue: 'Connect again: the match continues from the last round backup.',
                  })
                : t('matchInfo.server.movedBody', {
                    defaultValue:
                      'The old server went down. Connect to the server below (it has a new password): the match continues from the last round backup.',
                  })}
            </Typography>
          </Alert>
        )}
        {/* Connect first (design draft "Match A"): one big Join, the console line beside Copy. */}
        <Box
          component={motion.div}
          whileHover={reduceMotion ? undefined : { scale: 1.015 }}
          whileTap={reduceMotion ? undefined : { scale: 0.98 }}
          transition={{ type: 'spring', stiffness: 600, damping: 30 }}
        >
          <Button
            variant="contained"
            size="large"
            fullWidth
            color={connected ? 'success' : 'primary'}
            startIcon={<GameControllerIcon size={26} />}
            onClick={onConnect}
            disabled={!server.host || !server.port} // Disable if server details missing
            data-testid="match-join-button"
            sx={{ minHeight: 64, borderRadius: radii.pill, fontSize: '1.15rem', fontWeight: 600 }}
          >
            {connected ? t('matchInfo.server.connecting') : t('matchInfo.server.connect')}
          </Button>
        </Box>

        <Box display="flex" gap={1} alignItems="center" justifyContent="center" flexWrap="wrap">
          <Typography
            variant="body2"
            sx={{ ...mono, color: 'text.secondary', px: 1.5, py: 1, borderRadius: radii.md, bgcolor: tokens.color.paper3 }}
          >
            connect {server.host}:{server.port}
            {server.password ? `; password ${server.password}` : ''}
          </Typography>
          <Button
            variant="outlined"
            size="small"
            startIcon={copied ? null : <CopyIcon size={20} />}
            onClick={onCopy}
            disabled={!server.host || !server.port} // Disable if server details missing
            sx={{ borderRadius: radii.pill }}
          >
            {copied ? t('matchInfo.server.copied') : t('matchInfo.server.copyCommand')}
          </Button>
        </Box>

        <Typography variant="caption" color="text.secondary" textAlign="center">
          {server.name}
          {currentMapData ? ` · ${currentMapData.displayName}` : ''}
          {server.status ? ` · ${statusLabel}` : ''}
          {server.password ? '' : ` · ${t('matchInfo.server.noPassword', { defaultValue: "No password: you're on the list." })}`}
        </Typography>

        {copyFallbackCommand && (
          <Typography variant="caption" color="text.secondary" sx={{ mt: 1, fontFamily: 'monospace' }}>
            {t('matchInfo.copyFallback', { command: copyFallbackCommand })}
          </Typography>
        )}
      </Box>
    </Box>
  );
}
