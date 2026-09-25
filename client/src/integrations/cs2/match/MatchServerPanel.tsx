import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Box, Button, Typography, Alert } from '@mui/material';
import { CopyIcon, GameControllerIcon } from '@phosphor-icons/react';
import { FadeInImage } from '../common/FadeInImage';
import {
  api,
  onSocketReconnect,
  tokens,
  mono,
  withAlpha,
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
  'https://raw.githubusercontent.com/Auto-Tournament/cs2-server-manager/master/map_thumbnails';

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
 * `server.status` is the Auto Tournament CS2 plugin's own status (idle |
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
    return () => {
      if (timer.current) clearTimeout(timer.current);
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

  const server = connect ? effectiveServer(connect) : null;
  const currentMapData = useMemo(() => mapDataFor(connect?.currentMap ?? null), [connect?.currentMap]);
  const currentMapNumber = connect?.mapNumber ?? null;

  const onConnect = () => {
    if (!server) return;
    const address = `${server.host}:${server.port}`;
    const encodedPassword = server.password ? encodeURIComponent(server.password) : '';

    // Preferred CS2 launch syntax
    const params = server.password
      ? `+password%20${encodedPassword};%20+connect%20${address}`
      : `+connect%20${address}`;
    const steamUri = `steam://run/730//${params}`;

    // Legacy CS:GO/Steam connect syntax as fallback
    const legacyUri = server.password
      ? `steam://connect/${address}/${server.password}`
      : `steam://connect/${address}`;

    let navigationTriggered = false;
    try {
      window.location.href = steamUri;
      navigationTriggered = true;
    } catch (error) {
      console.warn('Failed to trigger Steam connect via run/730, falling back.', error);
    }
    if (!navigationTriggered) {
      window.location.href = legacyUri;
    }

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

  // The API sends an English label alongside the raw Auto Tournament CS2 status; translate
  // the known statuses and fall back to that label for anything new.
  const statusLabel = server.status
    ? t(`matchInfo.server.statusLabels.${server.status}`, {
        defaultValue: server.statusDescription?.label || server.status,
      })
    : '';

  return (
    <Box display="flex" flexDirection="column" gap={2}>
      {currentMapData && (
        <FadeInImage
          src={currentMapData.image}
          alt={currentMapData.displayName}
          height={180}
          sx={{
            borderRadius: radii.md,
          }}
        >
          <Box
            sx={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              background: `linear-gradient(to bottom, ${withAlpha(tokens.color.paper, 0.3)}, ${withAlpha(tokens.color.paper, 0.7)})`,
            }}
          >
            <Typography
              variant="h3"
              sx={{
                fontWeight: 700,
                color: 'text.primary',
                textShadow: `0 2px 12px ${tokens.color.shadow}`,
              }}
            >
              {currentMapData.displayName}
            </Typography>
            {typeof currentMapNumber === 'number' && (
              <Typography
                variant="caption"
                sx={{
                  mt: 0.5,
                  color: 'text.secondary',
                  fontSize: '0.7rem',
                  ...mono,
                  textShadow: `0 1px 6px ${tokens.color.shadow}`,
                }}
              >
                {t('matchInfo.mapN', { n: currentMapNumber + 1 })}
              </Typography>
            )}
          </Box>
        </FadeInImage>
      )}

      <Box display="flex" flexDirection="column" gap={2}>
        {/* Server info */}
        <Box>
          <Typography variant="body2" color="text.secondary" gutterBottom>
            {t('matchInfo.server.serverName', { name: server.name })}
          </Typography>
          <Typography variant="body2" color="text.secondary" fontFamily="monospace">
            {server.host}:{server.port}
          </Typography>
          {server.status && (
            <Typography variant="caption" color="text.secondary" display="block" mt={0.5}>
              {t('matchInfo.server.status', { status: statusLabel })}
            </Typography>
          )}
        </Box>

        <Button
          variant="contained"
          size="large"
          fullWidth
          color={connected ? 'success' : 'primary'}
          startIcon={<GameControllerIcon size={24} />}
          onClick={onConnect}
          disabled={!server.host || !server.port} // Disable if server details missing
          sx={{ py: 1.5 }}
        >
          {connected ? t('matchInfo.server.connecting') : t('matchInfo.server.connect')}
        </Button>

        <Button
          variant="outlined"
          size="small"
          fullWidth
          startIcon={copied ? null : <CopyIcon size={24} />}
          onClick={onCopy}
          disabled={!server.host || !server.port} // Disable if server details missing
        >
          {copied ? t('matchInfo.server.copied') : t('matchInfo.server.copyCommand')}
        </Button>

        {copyFallbackCommand && (
          <Typography variant="caption" color="text.secondary" sx={{ mt: 1, fontFamily: 'monospace' }}>
            {t('matchInfo.copyFallback', { command: copyFallbackCommand })}
          </Typography>
        )}
      </Box>
    </Box>
  );
}
