import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { Alert, Box, Button, Typography } from '@mui/material';
import { motion, useReducedMotion } from 'motion/react';
import { CopyIcon, GameControllerIcon } from '@phosphor-icons/react';
import {
  api,
  links,
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

const MAP_IMAGE_BASE = '/api/game/cs2/img';

/** The map's name and pictures, from the built-in list or built from its slug. */
function mapDataFor(slug: string | null): CS2MapData | null {
  if (!slug) return null;
  return (
    getMapData(slug) ?? {
      name: slug,
      displayName: getMapDisplayName(slug),
      // Full-size webp for the large hero image, thumbnail for smaller usages.
      image: `${MAP_IMAGE_BASE}/maps-1280/${slug}.webp`,
      thumbnail: `${MAP_IMAGE_BASE}/maps-480/${slug}.webp`,
    }
  );
}

/**
 * The match is over. Its `server_id` stays set, but the server runs another match by now: a
 * Connect there lands on that match's server, which kicks the player (NTLAN, 2026-10-16).
 */
const isFinished = (status: string | null | undefined): boolean =>
  status === 'completed' || status === 'cancelled';

/**
 * The server to show, or null for "waiting for a server".
 *
 * `server.status` is the plugin's own status (idle |
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
): { connect: MatchConnectResponse | null; reload: () => Promise<void> } {
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

  // Until there is a server to join, ask again every 5 s as well: a missed socket event left
  // a matchmaking room without its Join until the page was reloaded (2026-10-15).
  const waitingForServer = enabled && !connect?.server?.host && !isFinished(connect?.matchStatus);
  useEffect(() => {
    if (!waitingForServer) return;
    const id = window.setInterval(() => void load(), 5000);
    return () => window.clearInterval(id);
  }, [waitingForServer, load]);

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
    // A failover moves the match to another server (or epoch): its address changes.
    const onFailover = (data?: { matchSlug?: string }) => {
      if (!data?.matchSlug || data.matchSlug === matchSlug) reload();
    };
    socket.on('fleet:failover', onFailover);
    const offReconnect = onSocketReconnect(socket, reload);
    // And when the tab comes back into view (events missed while it slept).
    const onVisible = () => {
      if (document.visibilityState === 'visible') reload();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      if (timer.current) clearTimeout(timer.current);
      socket.off('fleet:failover', onFailover);
      document.removeEventListener('visibilitychange', onVisible);
      offReconnect();
      socket.off('match:update', onMatch);
      socket.off(`match:update:${matchSlug}`, reload);
      socket.off('bracket:update', reload);
    };
  }, [enabled, socket, matchSlug, load]);

  return { connect: enabled ? connect : null, reload: load };
}

/** How long after a Connect the panel waits for the player to show up on the server. */
const CONNECT_CHECK_MS = 10_000;

/**
 * The team match card's join panel (`matchPanels.teamView`): the map that is
 * up, the server's address and status, and the Connect and Copy buttons.
 *
 * It reads all of that itself by match slug (client API 0.2.0). The page only
 * says whether it lets this viewer join at all: the player page shows the
 * controls to that player alone, even to a teammate looking at it. The route
 * checks again, and sends an address only to a player on the match.
 */
export function MatchServerPanel({
  matchSlug,
  viewerCanJoin,
  matchStatus,
  waitingSaidByPage = false,
}: MatchConnectPanelProps) {
  const { t } = useModuleTranslation('cs2');
  const { showError } = useSnackbar();
  const { connect, reload } = useMatchConnect(matchSlug, viewerCanJoin, matchStatus);
  const [copied, setCopied] = useState(false);
  const [connected, setConnected] = useState(false);
  const [copyFallbackCommand, setCopyFallbackCommand] = useState<string | null>(null);
  const reduceMotion = useReducedMotion();

  // Over, by the route's answer or the page's (whichever heard first): nothing to join.
  const finished = isFinished(connect?.matchStatus) || isFinished(matchStatus);
  const server = connect && !finished ? effectiveServer(connect) : null;
  // LAN or internet: the platform picks for where the viewer is; they can switch.
  const [via, setVia] = useState<'lan' | 'public' | null>(null);
  const addresses = server?.addresses ?? null;
  const chosen = addresses?.find((a) => a.kind === (via ?? server?.recommended)) ?? null;
  const targetNow = chosen
    ? { host: chosen.host, ip: chosen.ip ?? null, port: chosen.port }
    : server
      ? { host: server.host, ip: server.ip ?? null, port: server.port }
      : null;
  // A Connect that did not land: the other address (LAN or internet), offered after a wait.
  const [attempt, setAttempt] = useState<{ kind: 'lan' | 'public' | null; at: number } | null>(
    null
  );
  const [checkDue, setCheckDue] = useState(false);
  useEffect(() => {
    if (!attempt) return;
    const id = window.setTimeout(() => {
      void reload().finally(() => setCheckDue(true));
    }, CONNECT_CHECK_MS);
    return () => window.clearTimeout(id);
  }, [attempt, reload]);
  const other =
    attempt && addresses && addresses.length > 1
      ? (addresses.find((a) => a.kind !== (attempt.kind ?? server?.recommended)) ?? null)
      : null;
  const showOther = checkDue && !!other && server?.viewerConnected === false;
  const currentMapData = useMemo(
    () => mapDataFor(connect?.currentMap ?? null),
    [connect?.currentMap]
  );

  const onConnect = (viaKind?: 'lan' | 'public') => {
    if (!server) return;
    const pick = viaKind ? (addresses?.find((a) => a.kind === viaKind) ?? null) : null;
    if (viaKind && pick) setVia(viaKind);
    const target = pick ? { host: pick.host, ip: pick.ip ?? null, port: pick.port } : targetNow;
    if (!target) return;
    // The IP, not the hostname: CS2 ignores steam://connect with a hostname.
    const address = `${target.ip || target.host}:${target.port}`;
    // steam://connect, not steam://run/730//+connect: run only passes its
    // arguments when it starts the game, so with CS2 already open the button
    // did nothing. connect joins a running game too (the webhooks use it).
    window.location.assign(
      server.password
        ? `steam://connect/${address}/${encodeURIComponent(server.password)}`
        : `steam://connect/${address}`
    );

    setConnected(true);
    setTimeout(() => setConnected(false), 3000);
    setCheckDue(false);
    setAttempt((prev) => ({ kind: viaKind ?? chosen?.kind ?? null, at: (prev?.at ?? 0) + 1 }));
  };
  const target = targetNow;

  const onCopy = async () => {
    if (!server || !target) return;
    const connectCommand = `connect ${target.host}:${target.port}${
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

  // The page says the match is over itself; the panel only adds where to play now, if anywhere.
  if (finished) {
    const current = connect?.currentMatchSlug ?? null;
    if (!current) return null;
    return (
      <Box
        data-testid="match-server-finished"
        sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}
      >
        <Typography sx={{ fontWeight: 700, fontSize: '1.0625rem' }}>
          {t('matchInfo.server.finishedTitle')}
        </Typography>
        <Typography sx={{ color: tokens.color.ink2 }}>
          {t('matchInfo.server.finishedBody')}
        </Typography>
        <Box>
          <Button
            component={RouterLink}
            to={links.match(current)}
            variant="contained"
            startIcon={<GameControllerIcon size={18} weight="bold" />}
            data-testid="match-server-current-match"
          >
            {t('matchInfo.server.finishedGoToCurrent')}
          </Button>
        </Box>
      </Box>
    );
  }

  if (!server) {
    return (
      <Box
        data-testid="match-server-waiting"
        sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}
      >
        {!waitingSaidByPage && (
          <>
            <Box
              sx={{
                display: 'flex',
                flexWrap: 'wrap',
                justifyContent: 'space-between',
                alignItems: 'baseline',
                gap: 1,
              }}
            >
              <Typography sx={{ fontWeight: 700, fontSize: '1.0625rem' }}>
                {t('matchInfo.server.waitingTitle')}
              </Typography>
              {connect?.currentMap && (
                <Box
                  component="span"
                  sx={{
                    px: 1.25,
                    py: 0.25,
                    borderRadius: radii.pill,
                    bgcolor: tokens.color.paper3,
                    color: tokens.color.ink2,
                    fontSize: '0.8125rem',
                    fontWeight: 600,
                  }}
                >
                  {t('matchInfo.server.vetoDoneChip', {
                    map: currentMapData?.displayName ?? connect.currentMap,
                  })}
                </Box>
              )}
            </Box>
            <Typography sx={{ color: tokens.color.ink2 }}>
              {t('matchInfo.server.waitingBody')}
            </Typography>
          </>
        )}
        {typeof connect?.queuePosition === 'number' && (
          <Box
            data-testid="match-server-queue"
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 2,
              borderRadius: radii.md,
              bgcolor: tokens.color.paper3,
              p: 2,
            }}
          >
            <Typography component="span" sx={{ ...mono, fontSize: '1.875rem', fontWeight: 500 }}>
              #{connect.queuePosition}
            </Typography>
            <Typography component="span" sx={{ color: tokens.color.ink2 }}>
              {connect.queuePosition === 1
                ? t('matchInfo.server.queueNext')
                : t('matchInfo.server.queueInLine')}
            </Typography>
          </Box>
        )}
      </Box>
    );
  }

  // The API sends an English label alongside the raw plugin status; translate
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
                : t('matchInfo.server.movedTitle', {
                    defaultValue: 'The match moved to a new server',
                  })}
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
        {server.pause && (
          <Box
            data-testid="match-server-paused"
            role="status"
            sx={{
              display: 'flex',
              flexDirection: 'column',
              gap: 0.75,
              p: 2,
              borderRadius: radii.md,
              border: `2px solid ${tokens.color.warning}`,
              bgcolor: tokens.color.paper3,
            }}
          >
            <Box
              sx={{
                display: 'flex',
                flexWrap: 'wrap',
                justifyContent: 'space-between',
                alignItems: 'baseline',
                gap: 1,
              }}
            >
              <Typography sx={{ fontWeight: 700 }}>
                {server.pause.waitingFor.length > 0
                  ? t('matchInfo.server.pausedWaiting', {
                      names: server.pause.waitingFor.join(', '),
                      count: server.pause.waitingFor.length,
                    })
                  : t('matchInfo.server.paused')}
              </Typography>
              <Box
                component="span"
                sx={{
                  px: 1.25,
                  py: 0.25,
                  borderRadius: radii.pill,
                  bgcolor: tokens.color.warning,
                  color: tokens.color.accentInk,
                  fontSize: '0.8125rem',
                  fontWeight: 700,
                }}
              >
                {connect?.roundNumber
                  ? t('matchInfo.server.pausedChip', { n: connect.roundNumber })
                  : t('matchInfo.server.pausedChipShort')}
              </Box>
            </Box>
            <Typography sx={{ fontSize: '0.875rem', color: tokens.color.ink2 }}>
              {server.pause.waitingFor.length > 0
                ? t('matchInfo.server.pausedBodyWaiting', {
                    names: server.pause.waitingFor.join(', '),
                    count: server.pause.waitingFor.length,
                  })
                : t('matchInfo.server.pausedBody')}
            </Typography>
          </Box>
        )}
        {/* The drafts' match room: Connect and LAN / Internet on one row, the console line under it. */}
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5, alignItems: 'center' }}>
          <Box
            component={motion.div}
            whileTap={reduceMotion ? undefined : { scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 600, damping: 30 }}
            sx={{ flex: '1 1 260px' }}
          >
            <Button
              variant="contained"
              size="large"
              fullWidth
              color={connected ? 'success' : 'primary'}
              startIcon={<GameControllerIcon size={24} />}
              onClick={() => onConnect()}
              disabled={!server.host || !server.port}
              data-testid="match-join-button"
              sx={{
                minHeight: 56,
                borderRadius: radii.pill,
                fontSize: '1.125rem',
                fontWeight: 700,
              }}
            >
              {connected
                ? t('matchInfo.server.connecting')
                : server.pause || server.moved
                  ? t('matchInfo.server.reconnect')
                  : t('matchInfo.server.connect')}
            </Button>
          </Box>
          {addresses && addresses.length > 1 && (
            <Box
              role="radiogroup"
              aria-label={t('matchInfo.server.via')}
              data-testid="match-connect-via"
              sx={{
                display: 'flex',
                borderRadius: radii.pill,
                bgcolor: tokens.color.paper3,
                p: 0.5,
              }}
            >
              {addresses.map((a) => {
                const on = a.kind === (via ?? server.recommended ?? 'public');
                return (
                  <Box
                    key={a.kind}
                    component="button"
                    type="button"
                    role="radio"
                    aria-checked={on}
                    data-testid={`match-connect-via-${a.kind}`}
                    onClick={() => setVia(a.kind)}
                    sx={{
                      minHeight: 44,
                      px: 2,
                      border: 0,
                      borderRadius: radii.pill,
                      bgcolor: on ? tokens.color.rule : 'transparent',
                      color: on ? tokens.color.ink : tokens.color.ink2,
                      fontWeight: 600,
                      font: 'inherit',
                      cursor: 'pointer',
                      whiteSpace: 'nowrap',
                      '&:focus-visible': {
                        outline: `2px solid ${tokens.color.focus}`,
                        outlineOffset: 2,
                      },
                    }}
                  >
                    {a.kind === 'lan'
                      ? t('matchInfo.server.viaLan')
                      : t('matchInfo.server.viaPublic')}
                    {a.kind === server.recommended && ` · ${t('matchInfo.server.viaRecommended')}`}
                  </Box>
                );
              })}
            </Box>
          )}
        </Box>

        {showOther && other && (
          <Alert
            severity="info"
            data-testid="match-connect-try-other"
            action={
              <Button color="inherit" size="small" onClick={() => onConnect(other.kind)}>
                {other.kind === 'lan'
                  ? t('matchInfo.server.tryOtherLan')
                  : t('matchInfo.server.tryOtherPublic')}
              </Button>
            }
          >
            {t('matchInfo.server.tryOtherBody')}
          </Alert>
        )}

        <Box display="flex" gap={1} alignItems="center" flexWrap="wrap">
          <Typography
            variant="body2"
            sx={{
              ...mono,
              color: 'text.secondary',
              px: 1.5,
              py: 1,
              borderRadius: radii.md,
              bgcolor: tokens.color.paper3,
            }}
          >
            connect {target?.host}:{target?.port}
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

        <Typography variant="caption" color="text.secondary">
          {server.name}
          {currentMapData ? ` · ${currentMapData.displayName}` : ''}
          {server.status ? ` · ${statusLabel}` : ''}
          {server.password
            ? ''
            : ` · ${t('matchInfo.server.noPassword', { defaultValue: "No password: you're on the list." })}`}
          {` ${t('matchInfo.server.startsGame', { defaultValue: 'CS2 not open? The button starts it.' })}`}
        </Typography>

        {copyFallbackCommand && (
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ mt: 1, fontFamily: 'monospace' }}
          >
            {t('matchInfo.copyFallback', { command: copyFallbackCommand })}
          </Typography>
        )}
      </Box>
    </Box>
  );
}
