import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Box, Typography, Alert, Dialog, Paper, LinearProgress } from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { ArrowsLeftRightIcon, CheckCircleIcon, ProhibitIcon } from '@phosphor-icons/react';
import { VetoMapCard } from './VetoMapCard';
import { getMapData, getMapDisplayName } from '../maps/mapData';
import { getVetoOrder } from './vetoOrders';
import type { MapSide, VetoMapInfo, VetoState, VetoStateResponse, VetoStep } from '../cs2.types';
import {
  onSocketReconnect,
  useSocket,
  tokens,
  mono,
  withAlpha,
  useModuleTranslation,
  useAuth,
  fmtClock,
  fmtTime,
  panelSx,
  panelBorderSx,
} from '../../../module-sdk';
import type { PreMatchViewProps as VetoInterfaceProps } from '../../types';

const { color, radius } = tokens;

export const VetoInterface: React.FC<VetoInterfaceProps> = ({
  matchSlug,
  team1Name: propTeam1Name,
  team2Name: propTeam2Name,
  currentTeamSlug: viewerTeamSlug,
  onComplete,
  hideMatchHeader = false,
}) => {
  const { t } = useModuleTranslation('cs2');

  const translateVetoError = useCallback(
    (backendError: string | undefined): string | undefined => {
      if (!backendError) return undefined;
      if (
        backendError.includes('not your turn') ||
        backendError.includes('Waiting for the other team')
      )
        return t('vetoInterface.errors.notYourTurn');
      if (backendError.includes('already completed'))
        return t('vetoInterface.errors.vetoAlreadyCompleted');
      if (backendError.includes('Invalid map'))
        return t('vetoInterface.errors.invalidMapSelection');
      if (backendError.includes('Invalid side'))
        return t('vetoInterface.errors.invalidSideSelection');
      if (backendError.includes('No map to pick')) return t('vetoInterface.errors.noMapToPickSide');
      if (backendError.includes('Match not found')) return t('vetoInterface.errors.matchNotFound');
      if (backendError.includes('participating teams'))
        return t('vetoInterface.errors.unauthorized');
      return backendError;
    },
    [t]
  );

  const [vetoState, setVetoState] = useState<VetoState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  // Errors from a refused ban/pick/side action are transient: they must not
  // replace the veto board, or the team loses the UI they were acting in.
  const [actionError, setActionError] = useState('');
  // An admin who does not play in the match can act for either team.
  const { isAuthenticated: isAdmin } = useAuth();
  const [actFor, setActFor] = useState<'team1' | 'team2' | null>(null);
  const actingForTeam = !viewerTeamSlug && isAdmin ? actFor : null;
  const currentTeamSlug =
    actingForTeam && vetoState
      ? ((actingForTeam === 'team1' ? vetoState.team1Id : vetoState.team2Id) ?? undefined)
      : viewerTeamSlug;
  const [allMaps, setAllMaps] = useState<
    Map<string, { id: string; displayName: string; imageUrl: string | null }>
  >(new Map());

  // Keep a stable reference to the latest onComplete callback so veto effects
  // don't restart (socket reconnect + loading flashes) when parents re-render.
  const onCompleteRef = useRef<VetoInterfaceProps['onComplete']>(onComplete);
  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);

  const MAP_IMAGE_BASE = '/api/game/cs2/img';

  const getThumbnailUrl = (mapId: string): string => `${MAP_IMAGE_BASE}/maps-480/${mapId}.webp`;

  const getFullImageUrl = (mapId: string): string => `${MAP_IMAGE_BASE}/maps-1280/${mapId}.webp`;

  const isRepoImageUrl = (url: string | null | undefined): boolean =>
    !!url && (url.includes('map_thumbnails') || url.startsWith('/api/game/cs2/img/'));

  // The veto response carries its maps' names and pictures (`maps`), so
  // players never need the admin-only `/api/maps` — which answered them with
  // a 403 and left them with names guessed from the map id.
  const storeMapInfo = useCallback((maps: VetoMapInfo[] | undefined) => {
    if (!maps || maps.length === 0) return;
    setAllMaps(new Map(maps.map((map) => [map.id, map])));
  }, []);

  // The steps this match uses and whose they are (GET /api/veto/:slug): Valve's or the organizer's.
  const [order, setOrder] = useState<{
    steps: VetoStep[];
    source: 'valve' | 'standard' | 'custom';
    maps?: number;
  } | null>(null);

  const loadVetoState = useCallback(async () => {
    setLoading(true);
    setError('');

    try {
      const response = await fetch(`/api/veto/${matchSlug}`);
      const data = (await response.json()) as VetoStateResponse & {
        veto: VetoState;
        order?: { steps: VetoStep[]; source: 'valve' | 'standard' | 'custom'; maps?: number };
      };

      if (data.success) {
        storeMapInfo(data.maps);
        if (data.order) setOrder(data.order);
        setVetoState(data.veto);
        if (data.veto.status === 'completed') {
          onCompleteRef.current?.();
        }
      } else {
        setError(translateVetoError(data.error) || t('vetoInterface.errors.failedToLoadVetoState'));
      }
    } catch (err) {
      console.error('Error loading veto:', err);
      setError(t('vetoInterface.errors.failedToLoadVetoState'));
    } finally {
      setLoading(false);
    }
  }, [matchSlug, t, translateVetoError, storeMapInfo]);

  useEffect(() => {
    loadVetoState();
  }, [loadVetoState]);

  // Socket.IO for real-time veto updates
  const socket = useSocket();

  useEffect(() => {
    const onVetoUpdate = (updatedVeto: VetoState) => {
      // The pushed state has no turn clock (and is not redacted for this
      // viewer): show it at once, keeping the clock, then read the full state
      // so the new turn's deadline appears (the countdown vanished after the
      // first step, 2026-10-12).
      setVetoState((prev) =>
        prev?.turnDeadline && !updatedVeto.turnDeadline
          ? { ...updatedVeto, turnDeadline: undefined, turnSeconds: prev.turnSeconds }
          : updatedVeto
      );
      void fetch(`/api/veto/${matchSlug}`)
        .then((response) => response.json())
        .then((data: { success?: boolean; veto?: VetoState }) => {
          if (data.success && data.veto) setVetoState(data.veto);
        })
        .catch(() => undefined);
      // The board moved on, so a refused action from before is no longer news.
      setActionError('');
      if (updatedVeto.status === 'completed') {
        onCompleteRef.current?.();
      }
    };
    const vetoEvent = `veto:update:${matchSlug}`;
    socket.on(vetoEvent, onVetoUpdate);

    // A pick or ban made while this socket was down never arrives, which left
    // the board on the wrong turn until a reload. Refetch on reconnect,
    // without the loading state so the board does not flash.
    const offReconnect = onSocketReconnect(socket, () => {
      void fetch(`/api/veto/${matchSlug}`)
        .then((response) => response.json())
        .then((data: { success?: boolean; veto?: VetoState; maps?: VetoMapInfo[] }) => {
          if (data.success && data.veto) {
            storeMapInfo(data.maps);
            setVetoState(data.veto);
            if (data.veto.status === 'completed') {
              onCompleteRef.current?.();
            }
          }
        })
        .catch(() => undefined);
    });

    return () => {
      offReconnect();
      socket.off(vetoEvent, onVetoUpdate);
    };
  }, [socket, matchSlug, storeMapInfo]);

  // Memoize mapsToShow - must be called before any early returns (Rules of Hooks)
  // Motion (punchy, short): a decided map leaves the grid, the rest close up. Off with reduced motion.
  const reduceMotion = useReducedMotion();

  const mapsToShow = useMemo(() => {
    if (!vetoState) return [];

    // Normalize arrays defensively in case older API responses omit fields
    const availableMaps = Array.isArray(vetoState.availableMaps) ? vetoState.availableMaps : [];
    const bannedMaps = Array.isArray(vetoState.bannedMaps) ? vetoState.bannedMaps : [];
    const pickedMaps = Array.isArray(vetoState.pickedMaps) ? vetoState.pickedMaps : [];

    // Use allMaps if available (preserves original order), otherwise reconstruct
    const originalMapOrder =
      Array.isArray(vetoState.allMaps) && vetoState.allMaps.length > 0
        ? [...vetoState.allMaps] // Create a copy to ensure immutability
        : [...availableMaps, ...bannedMaps, ...pickedMaps.map((p) => p.mapName)].filter(
            (mapId, index, self) => self.indexOf(mapId) === index
          ); // Fallback: remove duplicates

    return originalMapOrder.map((mapId) => {
      const mapData = allMaps.get(mapId);
      const fallbackData = getMapData(mapId); // Fallback to hardcoded maps if not in DB

      // Thumbnail strategy:
      // - For maps with a custom imageUrl (non-repo), show that directly.
      // - For repo-based maps or missing imageUrl, use the standardized thumbnail URL.
      let thumbnail: string;
      if (mapData?.imageUrl && !isRepoImageUrl(mapData.imageUrl)) {
        thumbnail = mapData.imageUrl;
      } else {
        thumbnail = fallbackData?.thumbnail || getThumbnailUrl(mapId);
      }

      return {
        name: mapId,
        displayName: mapData?.displayName || fallbackData?.displayName || getMapDisplayName(mapId),
        // Use thumbnail for map grid cards
        image: thumbnail,
      };
    });
    // Only depend on allMaps order and the map data cache - not on available/banned/picked arrays
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vetoState?.allMaps?.join(','), allMaps.size]);

  // A click in flight: no second one until it answers (a slow answer made a
  // player click both sides, and the last click won).
  const [submitting, setSubmitting] = useState(false);

  const handleMapAction = async (mapName: string) => {
    if (!vetoState || vetoState.status === 'completed' || !isMyTurn || submitting) return;

    const currentAction = vetoState.currentAction;

    if (currentAction === 'side_pick') {
      // Side picker is shown automatically when action is 'side_pick'
      return;
    }

    // For ban/pick actions, submit immediately
    setSubmitting(true);
    try {
      const response = await fetch(`/api/veto/${matchSlug}/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mapName,
          teamSlug: currentTeamSlug, // Send which team is making the action
          ...(actingForTeam ? { actAs: actingForTeam } : {}),
        }),
      });

      const data = await response.json();

      if (!data.success) {
        setActionError(
          translateVetoError(data.error) || t('vetoInterface.errors.failedToProcessVetoAction')
        );
      } else {
        setActionError(''); // Clear any previous errors
      }
    } catch (err) {
      console.error('Error submitting veto action:', err);
      setActionError(t('vetoInterface.errors.failedToSubmitVetoAction'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleSidePick = async (side: MapSide) => {
    if (!vetoState) {
      console.error('No veto state');
      return;
    }
    if (submitting) return;

    setSubmitting(true);
    try {
      const response = await fetch(`/api/veto/${matchSlug}/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          side,
          teamSlug: currentTeamSlug, // Send which team is making the action
          ...(actingForTeam ? { actAs: actingForTeam } : {}),
        }),
      });

      const data = await response.json();

      if (data.success) {
        setActionError('');
      } else {
        console.error('Side pick failed:', data.error);
        setActionError(
          translateVetoError(data.error) || t('vetoInterface.errors.failedToPickSide')
        );
      }
    } catch (err) {
      console.error('Error picking side:', err);
      setActionError(t('vetoInterface.errors.failedToPickSide'));
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <Box py={4}>
        <LinearProgress />
      </Box>
    );
  }

  if (error) {
    return <Alert severity="error">{error}</Alert>;
  }

  if (!vetoState) {
    return <Alert severity="warning">{t('vetoInterface.vetoNotAvailable')}</Alert>;
  }

  const hasDetailedVetoState =
    typeof vetoState.currentStep === 'number' &&
    typeof vetoState.totalSteps === 'number' &&
    Boolean(vetoState.team1Id) &&
    Boolean(vetoState.team2Id);

  if (!hasDetailedVetoState) {
    return <Alert severity="warning">{t('vetoInterface.vetoUnavailable')}</Alert>;
  }

  // Determine which team is viewing (must be defined before early returns). The page's names
  // first: a matchmaking room calls its teams A and B.
  const team1Name = propTeam1Name || vetoState.team1Name || t('teamMatchHistory.team1');
  const team2Name = propTeam2Name || vetoState.team2Name || t('teamMatchHistory.team2');
  const isViewingTeam1 = currentTeamSlug === vetoState.team1Id;
  const isViewingTeam2 = currentTeamSlug === vetoState.team2Id;
  // A picked map no team chose is the decider (what is left after the bans).
  const teamPickedMaps = new Set(
    (Array.isArray(vetoState.actions) ? vetoState.actions : [])
      .filter((a) => a.action === 'pick' && a.mapName)
      .map((a) => a.mapName as string)
  );
  const isDeciderMap = (mapName: string) =>
    Array.isArray(vetoState.actions) && !teamPickedMaps.has(mapName);

  const imageFor = (mapName: string) => {
    const mapData = allMaps.get(mapName);
    const fallbackData = getMapData(mapName);
    return isRepoImageUrl(mapData?.imageUrl)
      ? fallbackData?.image || getFullImageUrl(mapName)
      : mapData?.imageUrl || fallbackData?.image || getFullImageUrl(mapName);
  };
  const nameFor = (mapName: string) =>
    allMaps.get(mapName)?.displayName ||
    getMapData(mapName)?.displayName ||
    getMapDisplayName(mapName);
  const viewerSide: 'team1' | 'team2' | null = isViewingTeam1
    ? 'team1'
    : isViewingTeam2
      ? 'team2'
      : null;
  const slots = (
    <VetoSlots
      format={vetoState.format}
      picked={Array.isArray(vetoState.pickedMaps) ? vetoState.pickedMaps : []}
      decider={
        vetoState.status !== 'completed' &&
        Array.isArray(vetoState.availableMaps) &&
        vetoState.availableMaps.length === 1
          ? vetoState.availableMaps[0]
          : null
      }
      viewerSide={viewerSide}
      team1Name={team1Name}
      team2Name={team2Name}
      imageFor={imageFor}
      nameFor={nameFor}
      isDecider={isDeciderMap}
    />
  );

  if (vetoState.status === 'completed') {
    return (
      <Box data-testid="veto-interface" sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
        <Box
          sx={{
            ...panelSx,
            border: `2px solid ${color.live}`,
            p: { xs: 2, sm: 3 },
            display: 'flex',
            flexDirection: 'column',
            gap: 0.75,
          }}
        >
          <Typography
            component="h2"
            sx={{
              m: 0,
              fontFamily: 'Sora, Geist, sans-serif',
              fontSize: { xs: '1.5rem', sm: '2rem' },
              fontWeight: 700,
              color: color.live,
            }}
          >
            {t('vetoInterface.vetoCompleted')}
          </Typography>
          <Typography sx={{ color: color.ink2 }}>
            {t('vetoInterface.vetoCompletedSubtitle')}
          </Typography>
        </Box>
        {slots}
      </Box>
    );
  }

  const vetoOrder = order?.steps ?? getVetoOrder(vetoState.format);
  const currentStepConfig = vetoOrder[vetoState.currentStep - 1];
  const currentAction = vetoState.currentAction ?? currentStepConfig?.action;
  const currentTurn =
    typeof vetoState.currentTurn === 'string' ? vetoState.currentTurn : currentStepConfig?.team;
  const hasKnownCurrentTurn = currentTurn === 'team1' || currentTurn === 'team2';

  // Get current team name
  const currentTeamName = hasKnownCurrentTurn
    ? currentTurn === 'team1'
      ? team1Name
      : team2Name
    : t('vetoInterface.otherTeam');

  // Determine if it's this team's turn. Require valid team IDs and currentTeamSlug;
  // otherwise we cannot reliably tell whose turn it is (don't default to "your turn").
  const isMyTurn =
    !!currentTeamSlug &&
    !!vetoState.team1Id &&
    !!vetoState.team2Id &&
    hasKnownCurrentTurn &&
    (currentTurn === 'team1'
      ? currentTeamSlug === vetoState.team1Id
      : currentTeamSlug === vetoState.team2Id);

  // The action's own colour and icon: ban red (danger), pick green, side choice blue. Your turn
  // outlines the card, banner and map grid in it; waiting stays neutral.
  const actionColor =
    currentAction === 'ban' ? color.ban : currentAction === 'pick' ? color.pick : color.info;
  const ActionIcon =
    currentAction === 'ban'
      ? ProhibitIcon
      : currentAction === 'pick'
        ? CheckCircleIcon
        : ArrowsLeftRightIcon;

  const pool = mapsToShow.filter(
    (map) =>
      !vetoState.bannedMaps.includes(map.name) &&
      !vetoState.pickedMaps.find((p) => p.mapName === map.name)
  );
  const choosingSide = currentAction === 'side_pick';
  // The map the side is chosen for: the last pick, or the decider (Bo1 and Bo3's last map).
  const availableNow = Array.isArray(vetoState.availableMaps) ? vetoState.availableMaps : [];
  const sideMapName = choosingSide
    ? (vetoState.format === 'bo1' || vetoState.format === 'bo3') &&
      vetoState.currentStep === vetoState.totalSteps &&
      availableNow.length === 1
      ? availableNow[0]
      : vetoState.pickedMaps.length > 0
        ? vetoState.pickedMaps[vetoState.pickedMaps.length - 1].mapName
        : null
    : null;
  const lastPick = vetoState.pickedMaps[vetoState.pickedMaps.length - 1];
  const sidePickedBy =
    sideMapName &&
    lastPick?.mapName === sideMapName &&
    (lastPick.pickedBy === 'team1' || lastPick.pickedBy === 'team2')
      ? lastPick.pickedBy === 'team1'
        ? team1Name
        : team2Name
      : null;
  const orderLine = order
    ? order.source === 'valve'
      ? t('vetoInterface.orderValve')
      : order.source === 'standard'
        ? t('vetoInterface.orderStandard', { count: order.maps ?? 0 })
        : t('vetoInterface.orderCustom')
    : null;
  const stepLine = t('vetoInterface.stepOf', {
    current: Math.min(vetoState.currentStep, vetoState.totalSteps),
    total: vetoState.totalSteps,
  });
  const title = isMyTurn
    ? currentAction === 'ban'
      ? t('vetoInterface.question.ban')
      : currentAction === 'pick'
        ? t('vetoInterface.question.pick')
        : t('vetoInterface.question.side')
    : currentAction === 'ban'
      ? t('vetoInterface.waitingToBan', { team: currentTeamName })
      : currentAction === 'pick'
        ? t('vetoInterface.waitingToPick', { team: currentTeamName })
        : t('vetoInterface.waitingToChooseSide', { team: currentTeamName });

  return (
    <Box
      data-testid="veto-interface"
      sx={{
        display: 'flex',
        flexDirection: 'column',
        gap: 2.5,
        // Before the veto opens (the break between matches) the countdown is the page.
        ...(vetoState.opensAt
          ? {
              '& [data-testid="veto-opens-countdown"] ~ *': {
                opacity: 0.25,
                filter: 'grayscale(0.6)',
                pointerEvents: 'none',
                userSelect: 'none',
              },
            }
          : {}),
      }}
    >
      {actionError && (
        <Alert severity="error" onClose={() => setActionError('')} data-testid="veto-action-error">
          {actionError}
        </Alert>
      )}

      {!hideMatchHeader && (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
          <Typography
            component="div"
            sx={{
              fontSize: '0.8125rem',
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              color: color.muted,
            }}
          >
            {vetoState.format.toUpperCase()} · {t('vetoInterface.title')}
          </Typography>
          <Typography
            component="h2"
            sx={{
              m: 0,
              fontFamily: 'Sora, Geist, sans-serif',
              fontSize: { xs: '1.5rem', sm: '2rem' },
              fontWeight: 700,
              overflowWrap: 'anywhere',
            }}
          >
            {vetoState.team1Id && vetoState.team1Id !== 'team1' ? (
              <Box
                component={RouterLink}
                to={`/team/${vetoState.team1Id}`}
                sx={{
                  color: 'inherit',
                  textDecoration: 'none',
                  '&:hover': { textDecoration: 'underline' },
                }}
              >
                {team1Name}
              </Box>
            ) : (
              team1Name
            )}{' '}
            <Box component="span" sx={{ color: color.muted, fontWeight: 600 }}>
              {t('teamMatchHistory.vs')}
            </Box>{' '}
            {vetoState.team2Id && vetoState.team2Id !== 'team2' ? (
              <Box
                component={RouterLink}
                to={`/team/${vetoState.team2Id}`}
                sx={{
                  color: 'inherit',
                  textDecoration: 'none',
                  '&:hover': { textDecoration: 'underline' },
                }}
              >
                {team2Name}
              </Box>
            ) : (
              team2Name
            )}
          </Typography>
        </Box>
      )}

      {vetoState.opensAt && (
        <VetoOpensCountdown
          opensAt={vetoState.opensAt}
          startsAt={vetoState.startsAt}
          onOpen={loadVetoState}
        />
      )}

      {/* Whose turn, what to do, and the clock (the drafts' turn panel). */}
      <Box
        data-my-turn={isMyTurn ? 'true' : 'false'}
        sx={{
          ...panelSx,
          border: `2px solid ${isMyTurn ? actionColor : color.rule}`,
          p: { xs: 2, sm: 3 },
          display: 'flex',
          flexWrap: 'wrap',
          gap: 2.5,
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <Box
          sx={{
            flex: '1 1 320px',
            minWidth: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: 0.75,
          }}
        >
          <Typography
            key={`q-${vetoState.currentStep}`}
            component={motion.h2}
            initial={reduceMotion ? false : { opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            className="veto-turn-title"
            sx={{
              m: 0,
              display: 'inline-flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              gap: 1.25,
              fontFamily: 'Sora, Geist, sans-serif',
              fontSize: { xs: '1.5rem', sm: '2rem' },
              lineHeight: 1.15,
              fontWeight: 700,
              color: color.ink,
            }}
          >
            {/* Only "Your turn" carries the action's colour; the question stays plain. */}
            {isMyTurn && (
              <Box
                component="span"
                data-testid="veto-your-turn"
                sx={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 0.75,
                  px: 1.5,
                  py: 0.5,
                  borderRadius: 999,
                  bgcolor: actionColor,
                  color: color.accentInk,
                  fontSize: '1rem',
                  fontWeight: 700,
                  letterSpacing: '0.02em',
                  whiteSpace: 'nowrap',
                }}
              >
                <ActionIcon size={18} weight="bold" aria-hidden />
                {t('vetoInterface.yourTurn')}
              </Box>
            )}
            {title}
          </Typography>
          <Typography sx={{ color: color.ink2 }}>
            {isMyTurn
              ? choosingSide
                ? t('vetoInterface.sideInWindow')
                : t('vetoInterface.clickMapToConfirm')
              : !viewerTeamSlug && !isAdmin
                ? t('vetoInterface.spectatorNote')
                : t('vetoInterface.pageUpdatesAutomatically')}
          </Typography>
          {!viewerTeamSlug && isAdmin && (
            <Box
              role="radiogroup"
              aria-label={t('vetoInterface.actFor.label')}
              data-testid="veto-act-for"
              sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', mt: 1 }}
            >
              <Typography variant="body2" color="text.secondary">
                {t('vetoInterface.actFor.label')}
              </Typography>
              {([null, 'team1', 'team2'] as const).map((team) => (
                <Box
                  key={team ?? 'none'}
                  component="button"
                  type="button"
                  role="radio"
                  onClick={() => setActFor(team)}
                  aria-checked={actFor === team}
                  data-testid={`veto-act-for-${team ?? 'none'}`}
                  sx={{
                    all: 'unset',
                    cursor: 'pointer',
                    px: 1.5,
                    minHeight: 36,
                    display: 'inline-flex',
                    alignItems: 'center',
                    borderRadius: 999,
                    fontSize: '0.875rem',
                    fontWeight: 600,
                    color: color.ink,
                    border: `2px solid ${actFor === team ? color.ink : color.rule}`,
                    '&:focus-visible': { outline: `2px solid ${color.focus}`, outlineOffset: 2 },
                  }}
                >
                  {team === null
                    ? t('vetoInterface.actFor.watch')
                    : team === 'team1'
                      ? team1Name
                      : team2Name}
                </Box>
              ))}
            </Box>
          )}
        </Box>
        {vetoState.turnDeadline && (
          <TurnClock
            deadline={vetoState.turnDeadline}
            total={vetoState.turnSeconds}
            mine={isMyTurn}
            tone={actionColor}
          />
        )}
      </Box>

      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        <VetoStepStrip
          vetoState={vetoState}
          order={vetoOrder}
          teamName={(team) => (team === 'team1' ? team1Name : team2Name)}
          mapName={nameFor}
          imageFor={imageFor}
        />
        <Typography
          data-testid="veto-order-source"
          sx={{ fontSize: '0.8125rem', color: color.muted }}
        >
          {[stepLine, orderLine].filter(Boolean).join(' · ')}
        </Typography>
      </Box>

      {slots}

      {!choosingSide && (
        <Box
          component="section"
          aria-label={t('vetoInterface.pool')}
          sx={{ display: 'flex', flexDirection: 'column', gap: 1.25 }}
        >
          <Box
            data-testid="veto-decided-summary"
            sx={{
              display: 'flex',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: 1,
              fontSize: '0.875rem',
              color: color.muted,
            }}
          >
            <span>{t('vetoInterface.mapsLeft', { count: pool.length })}</span>
            {vetoState.bannedMaps.length > 0 && (
              <span>
                <Box component="span" sx={{ color: color.ban, fontWeight: 600 }}>
                  {t('vetoInterface.decided.out')}
                </Box>{' '}
                {vetoState.bannedMaps.map(nameFor).join(', ')}
              </span>
            )}
          </Box>
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: {
                xs: 'repeat(2, minmax(0, 1fr))',
                sm: 'repeat(auto-fill, minmax(min(100%, 14rem), 1fr))',
              },
              gap: { xs: 1, sm: 1.5 },
              // Not your turn: the pool steps back (fades), so it is plain you are waiting.
              '& > *': { transition: 'opacity 260ms' },
              ...(isMyTurn ? {} : { '& > *': { opacity: 0.3, transition: 'opacity 260ms' } }),
            }}
          >
            <AnimatePresence mode="popLayout" initial={false}>
              {pool.map((map) => (
                <Box
                  key={map.name}
                  component={motion.div}
                  layout={!reduceMotion}
                  initial={false}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={
                    reduceMotion
                      ? { opacity: 0, transition: { duration: 0.12 } }
                      : {
                          opacity: 0,
                          scale: 0.85,
                          transition: { duration: 0.3, ease: [0.55, 0, 1, 0.45] },
                        }
                  }
                  transition={{ type: 'spring', stiffness: 420, damping: 34 }}
                >
                  <VetoMapCard
                    mapName={map.name}
                    displayName={map.displayName}
                    imageUrl={map.image}
                    state="available"
                    onClick={() => handleMapAction(map.name)}
                    disabled={!isMyTurn || submitting}
                    isCurrentTurn={isMyTurn}
                    currentAction={currentAction}
                  />
                </Box>
              ))}
            </AnimatePresence>
          </Box>
        </Box>
      )}

      {/* The side choice is a window over the veto (the drafts): the map, who picked it, CT or T. */}
      <Dialog
        open={choosingSide && isMyTurn && !!sideMapName}
        aria-labelledby="veto-side-title"
        PaperProps={{
          sx: { ...panelSx, ...panelBorderSx, overflow: 'hidden', width: 'min(520px, 100%)', m: 2 },
        }}
      >
        {sideMapName && (
          <Box sx={{ position: 'relative', aspectRatio: '16 / 7' }}>
            <Box
              component="img"
              src={imageFor(sideMapName)}
              alt=""
              sx={{
                position: 'absolute',
                inset: 0,
                width: '100%',
                height: '100%',
                objectFit: 'cover',
              }}
            />
            <Box
              sx={{
                position: 'absolute',
                inset: 0,
                p: 2.5,
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'flex-end',
                background: `linear-gradient(to top, ${color.paper2}, ${withAlpha(color.paper2, 0)} 70%)`,
              }}
            >
              <Typography sx={{ fontSize: '0.8125rem', color: color.ink2 }}>
                {sidePickedBy
                  ? t('vetoInterface.pickedBy', { team: sidePickedBy })
                  : t('vetoInterface.lastMapLeft')}
              </Typography>
              <Typography
                sx={{
                  fontFamily: 'Sora, Geist, sans-serif',
                  fontSize: '1.875rem',
                  fontWeight: 700,
                }}
              >
                {nameFor(sideMapName)}
              </Typography>
            </Box>
          </Box>
        )}
        <Box sx={{ p: 2.5, display: 'flex', flexDirection: 'column', gap: 2 }}>
          <Box
            sx={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'baseline',
              gap: 1.5,
            }}
          >
            <Typography
              id="veto-side-title"
              component="h2"
              sx={{
                m: 0,
                fontFamily: 'Sora, Geist, sans-serif',
                fontSize: '1.375rem',
                fontWeight: 700,
              }}
            >
              {t('vetoInterface.question.side')}
            </Typography>
            {vetoState.turnDeadline && (
              <TurnClock
                deadline={vetoState.turnDeadline}
                total={vetoState.turnSeconds}
                mine
                tone={color.info}
                compact
              />
            )}
          </Box>
          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 1.5 }}>
            {(['CT', 'T'] as const).map((sideKey) => {
              const tone = sideKey === 'CT' ? color.sideCt : color.sideT;
              return (
                <Box
                  key={sideKey}
                  component="button"
                  type="button"
                  data-testid={sideKey === 'CT' ? 'veto-side-ct-button' : 'veto-side-t-button'}
                  onClick={() => handleSidePick(sideKey)}
                  disabled={submitting}
                  sx={{
                    all: 'unset',
                    cursor: 'pointer',
                    minHeight: 96,
                    borderRadius: `${radius.md}px`,
                    border: `2px solid ${tone}`,
                    bgcolor: withAlpha(tone, 0.12),
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'center',
                    gap: 0.5,
                    px: 2,
                    '&:hover': { bgcolor: withAlpha(tone, 0.22) },
                    '&:focus-visible': { outline: `2px solid ${color.focus}`, outlineOffset: 2 },
                    '&[disabled]': { opacity: 0.55, cursor: 'not-allowed' },
                  }}
                >
                  <Typography
                    component="span"
                    sx={{
                      fontFamily: 'Sora, Geist, sans-serif',
                      fontSize: '1.625rem',
                      fontWeight: 700,
                      color: tone,
                    }}
                  >
                    {sideKey}
                  </Typography>
                  <Typography component="span" sx={{ fontSize: '0.875rem', color: color.ink2 }}>
                    {sideKey === 'CT' ? t('vetoInterface.ctHint') : t('vetoInterface.tHint')}
                  </Typography>
                </Box>
              );
            })}
          </Box>
          <Typography sx={{ fontSize: '0.8125rem', color: color.muted }}>
            {t('vetoInterface.sideTimeout')}
          </Typography>
        </Box>
      </Dialog>
    </Box>
  );
};

/** The turn's countdown, big ("0:24"), red in the last ten seconds, "Time's up" at zero. */
function TurnClock({
  deadline,
  total,
  mine,
  tone,
  compact = false,
}: {
  deadline: string;
  /** The turn's length in seconds: the bar drains from it. */
  total?: number | null;
  mine: boolean;
  tone: string;
  compact?: boolean;
}) {
  const { t } = useModuleTranslation('cs2');
  const end = Date.parse(deadline);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, []);
  const left = Math.max(0, Math.ceil((end - now) / 1000));
  const urgent = left <= 10;
  const text = left > 0 ? fmtClock(left) : t('vetoInterface.timeUp');
  return (
    <Box
      data-testid="veto-turn-clock"
      role="timer"
      aria-live={urgent ? 'assertive' : 'off'}
      aria-label={`${mine ? t('vetoInterface.yourTurnClock') : t('vetoInterface.theirTurnClock')} · ${text}`}
      sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 0.25 }}
    >
      {!compact && (
        <Typography component="span" sx={{ fontSize: '0.8125rem', color: color.muted }}>
          {mine ? t('vetoInterface.yourTurnClock') : t('vetoInterface.theirTurnClock')}
        </Typography>
      )}
      <Typography
        component="span"
        sx={{
          ...mono,
          fontSize: compact ? '1.25rem' : '2.5rem',
          lineHeight: 1,
          color: urgent ? color.ban : color.ink,
        }}
      >
        {text}
      </Typography>
      {/* The time left as a bar that drains: easier to read at a glance than the digits. */}
      {total ? (
        <Box
          aria-hidden
          data-testid="veto-turn-bar"
          sx={{
            width: compact ? 96 : 160,
            height: 6,
            borderRadius: 999,
            bgcolor: color.rule,
            overflow: 'hidden',
            mt: 0.75,
          }}
        >
          <Box
            sx={{
              height: '100%',
              width: `${Math.max(0, Math.min(100, ((end - now) / (total * 1000)) * 100))}%`,
              bgcolor: urgent ? color.ban : mine ? tone : color.ink2,
              borderRadius: 999,
              transition: 'width 250ms linear',
            }}
          />
        </Box>
      ) : null}
    </Box>
  );
}

/**
 * Every step in one strip (the drafts' veto): what each did and who, the
 * current one ringed, the rest dimmed. A pick shows its map, a ban the map's
 * name in red, a side choice the side in its colour and on which map.
 */
function VetoStepStrip({
  vetoState,
  order,
  teamName,
  mapName,
  imageFor,
}: {
  vetoState: VetoState;
  order: Array<{ team: string; action: string }>;
  teamName: (team: string) => string;
  mapName: (map: string) => string;
  imageFor: (map: string) => string;
}) {
  const { t } = useModuleTranslation('cs2');
  const actions = Array.isArray(vetoState.actions) ? vetoState.actions : [];
  const steps = Array.from({ length: vetoState.totalSteps }, (_, i) => i + 1);
  // Team names, never "you" / "them" (review feedback on the drafts).
  const who = (team: string) => teamName(team);
  const tone = (action: string) =>
    action === 'ban' ? color.ban : action === 'pick' ? color.pick : color.info;
  // The map each side choice was for: the pick before it, or the decider.
  const sideMap = (step: number): string | null => {
    const before = actions.filter((a) => a.step < step && a.action === 'pick').pop();
    const pickedAfter = vetoState.pickedMaps.find(
      (p) => !actions.some((a) => a.action === 'pick' && a.mapName === p.mapName)
    );
    return before &&
      !actions.some((a) => a.action === 'side_pick' && a.step < step && a.step > before.step)
      ? (before.mapName ?? null)
      : (pickedAfter?.mapName ?? null);
  };
  return (
    <Box
      component="ol"
      aria-label={t('vetoInterface.stepOf', {
        current: Math.min(vetoState.currentStep, vetoState.totalSteps),
        total: vetoState.totalSteps,
      })}
      data-testid="veto-step-strip"
      sx={{
        listStyle: 'none',
        m: 0,
        p: 0,
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 7.5rem), 1fr))',
        gap: 1,
      }}
    >
      {steps.map((step) => {
        const done = actions.find((a) => a.step === step);
        const current = !done && step === vetoState.currentStep && vetoState.status !== 'completed';
        const planned = order[step - 1];
        const action =
          done?.action ?? (current ? vetoState.currentAction : planned?.action) ?? 'ban';
        const team = done?.team ?? (current ? vetoState.currentTurn : planned?.team);
        const label = t(`vetoInterface.actionLabels.${action}`, {
          defaultValue: String(action).toUpperCase(),
        });
        return (
          <Box
            component="li"
            key={step}
            aria-current={current ? 'step' : undefined}
            sx={{
              minWidth: 0,
              px: 1.25,
              py: 1,
              borderRadius: '12px',
              bgcolor: current ? color.paper3 : color.paper2,
              border: `2px solid ${current ? tone(action) : 'transparent'}`,
              opacity: done || current ? 1 : 0.5,
              display: 'flex',
              flexDirection: 'column',
              gap: 0.75,
            }}
          >
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 0.75,
                fontSize: '0.75rem',
                fontWeight: 700,
                color: tone(action),
              }}
            >
              <Box
                component="span"
                sx={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  bgcolor: tone(action),
                  flex: 'none',
                }}
              />
              <span data-testid={done ? 'veto-history-action' : undefined}>{label}</span>
              {team && (
                <Box
                  component="span"
                  sx={{
                    minWidth: 0,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  · {who(team)}
                </Box>
              )}
            </Box>
            {done ? (
              done.action === 'side_pick' ? (
                <Typography
                  sx={{
                    fontSize: '0.8125rem',
                    fontWeight: 600,
                    color: done.side === 'CT' ? color.sideCt : color.sideT,
                  }}
                  noWrap
                >
                  {t('vetoInterface.sideOn', {
                    side: done.side,
                    map: sideMap(step) ? mapName(sideMap(step) as string) : '',
                  })}
                </Typography>
              ) : done.action === 'pick' && done.mapName ? (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0 }}>
                  <Box
                    component="img"
                    src={imageFor(done.mapName)}
                    alt=""
                    sx={{
                      width: 36,
                      height: 20,
                      objectFit: 'cover',
                      borderRadius: '4px',
                      flex: 'none',
                    }}
                  />
                  <Typography sx={{ fontSize: '0.8125rem', fontWeight: 600 }} noWrap>
                    {mapName(done.mapName)}
                  </Typography>
                </Box>
              ) : (
                <Typography
                  sx={{ fontSize: '0.8125rem', fontWeight: 600, color: color.ban }}
                  noWrap
                >
                  {done.mapName ? mapName(done.mapName) : ''}
                </Typography>
              )
            ) : (
              <Typography sx={{ fontSize: '0.8125rem', color: color.muted }}>
                {current ? t('vetoInterface.now') : ' '}
              </Typography>
            )}
            {done?.timedOut && (
              <Typography sx={{ fontSize: '0.6875rem', color: color.warning }}>
                {t('vetoInterface.strip.timedOut')}
              </Typography>
            )}
          </Box>
        );
      })}
    </Box>
  );
}

/**
 * The maps the match is played on, as slots above the pool (the drafts): a
 * picked map moves into its slot with who picked it and the side the viewer
 * starts on (in the side's colour); an empty slot says whose pick it will be.
 */
function VetoSlots({
  format,
  picked,
  decider,
  viewerSide,
  team1Name,
  team2Name,
  imageFor,
  nameFor,
  isDecider,
}: {
  format: string;
  picked: VetoState['pickedMaps'];
  decider: string | null;
  viewerSide: 'team1' | 'team2' | null;
  team1Name: string;
  team2Name: string;
  imageFor: (map: string) => string;
  nameFor: (map: string) => string;
  isDecider: (map: string) => boolean;
}) {
  const { t } = useModuleTranslation('cs2');
  const reduceMotion = useReducedMotion();
  const count = Number(format.replace(/\D/g, '')) || 1;
  const slots = Array.from({ length: count }, (_, i) => i + 1);
  return (
    <Box
      component="section"
      aria-label={t('vetoInterface.selectedMaps')}
      sx={{
        display: 'grid',
        gridTemplateColumns: `repeat(${count}, minmax(0, 300px))`,
        justifyContent: 'center',
        gap: { xs: 1, sm: 4 },
      }}
    >
      {slots.map((n) => {
        const pick =
          picked.find((p) => p.mapNumber === n) ??
          (n === count && decider ? { mapNumber: n, mapName: decider } : undefined);
        const mapName = pick?.mapName;
        const sideTeam1 =
          pick && 'sideTeam1' in pick ? (pick.sideTeam1 as string | undefined) : undefined;
        const sideTeam2 =
          pick && 'sideTeam2' in pick ? (pick.sideTeam2 as string | undefined) : undefined;
        const pickedBy =
          pick && 'pickedBy' in pick ? (pick.pickedBy as string | undefined) : undefined;
        const mySideHere = viewerSide === 'team2' ? sideTeam2 : sideTeam1;
        const starts = viewerSide
          ? t('vetoInterface.youStart')
          : t('vetoInterface.teamStarts', { team: team1Name });
        const decided = mapName ? isDecider(mapName) || (n === count && !pickedBy) : false;
        const pickedByName =
          pickedBy === 'team1' ? team1Name : pickedBy === 'team2' ? team2Name : null;
        return (
          <Box
            key={n}
            sx={{
              position: 'relative',
              overflow: 'hidden',
              aspectRatio: { xs: '4 / 5', sm: '16 / 9' },
              maxWidth: '100%',
              borderRadius: `${radius.md}px`,
              border: `2px ${mapName ? 'solid' : 'dashed'} ${mapName ? (decided ? color.ink : color.pick) : color.rule}`,
              bgcolor: color.paper,
            }}
          >
            {mapName ? (
              <Box
                component={motion.div}
                initial={reduceMotion ? false : { opacity: 0, y: 24, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                sx={{ position: 'absolute', inset: 0 }}
              >
                <Box
                  component="img"
                  src={imageFor(mapName)}
                  alt=""
                  sx={{
                    position: 'absolute',
                    inset: 0,
                    width: '100%',
                    height: '100%',
                    objectFit: 'cover',
                  }}
                />
                <Box
                  sx={{
                    position: 'absolute',
                    inset: 0,
                    p: 1.5,
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                    background: `linear-gradient(to top, ${withAlpha(color.paper, 0.95)}, ${withAlpha(color.paper, 0.6)} 45%, ${withAlpha(color.paper, 0.1)} 80%)`,
                  }}
                >
                  <Box
                    component="span"
                    sx={{
                      alignSelf: 'flex-start',
                      px: 1,
                      py: 0.25,
                      borderRadius: '999px',
                      bgcolor: color.pick,
                      color: color.accentInk,
                      fontSize: '0.75rem',
                      fontWeight: 700,
                    }}
                  >
                    {t('vetoInterface.mapBadge', { n })}
                  </Box>
                  <Box sx={{ display: 'flex', flexDirection: 'column' }}>
                    <Typography
                      sx={{
                        fontFamily: 'Sora, Geist, sans-serif',
                        fontSize: { xs: '0.9375rem', sm: '1.375rem' },
                        fontWeight: 700,
                      }}
                    >
                      {nameFor(mapName)}
                    </Typography>
                    <Typography
                      sx={{ fontSize: { xs: '0.6875rem', sm: '0.875rem' }, color: color.ink2 }}
                    >
                      {mySideHere ? (
                        <>
                          {starts}{' '}
                          <Box
                            component="span"
                            sx={{
                              color: mySideHere === 'CT' ? color.sideCt : color.sideT,
                              fontWeight: 700,
                            }}
                          >
                            {mySideHere}
                          </Box>
                        </>
                      ) : decided ? (
                        t('vetoInterface.decider')
                      ) : pickedByName ? (
                        t('vetoInterface.pickedBy', { team: pickedByName })
                      ) : null}
                    </Typography>
                  </Box>
                </Box>
              </Box>
            ) : (
              <Box
                sx={{
                  position: 'absolute',
                  inset: 0,
                  display: 'grid',
                  placeItems: 'center',
                  textAlign: 'center',
                  color: color.muted,
                  p: 1,
                }}
              >
                <Box>
                  <Typography sx={{ fontFamily: 'Sora, Geist, sans-serif', fontWeight: 700 }}>
                    {t('vetoInterface.mapBadge', { n })}
                  </Typography>
                  <Typography sx={{ fontSize: '0.8125rem' }}>
                    {n === count ? t('vetoInterface.lastMapLeft') : t('vetoInterface.toBePicked')}
                  </Typography>
                </Box>
              </Box>
            )}
          </Box>
        );
      })}
    </Box>
  );
}

/**
 * "The veto opens in 4:32": the break between a team's matches, counting
 * down; at zero the veto is loaded again (the navbar plays the sound).
 */
function VetoOpensCountdown({
  opensAt,
  startsAt,
  onOpen,
}: {
  opensAt: string;
  /** The match's start time (Manage › Schedule): it says so instead of "break". */
  startsAt?: string;
  onOpen: () => void;
}) {
  const { t } = useModuleTranslation('cs2');
  const start = startsAt ? Date.parse(startsAt) : NaN;
  const lead = Number.isFinite(start) ? Math.round((start - Date.parse(opensAt)) / 60000) : 0;
  const target = Date.parse(opensAt);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  useEffect(() => {
    if (!Number.isFinite(target)) return;
    const id = window.setTimeout(onOpen, Math.max(0, target - Date.now()) + 1500);
    return () => window.clearTimeout(id);
  }, [target, onOpen]);
  if (!Number.isFinite(target)) return null;
  const left = Math.max(0, Math.round((target - now) / 1000));
  const clock = fmtClock(left);
  return (
    <Paper
      variant="outlined"
      role="timer"
      aria-live="polite"
      data-testid="veto-opens-countdown"
      sx={{
        px: 3,
        py: { xs: 4, md: 5 },
        mb: 3,
        textAlign: 'center',
        borderWidth: 2,
        borderColor: tokens.color.warning,
        display: 'grid',
        justifyItems: 'center',
        gap: 1.5,
      }}
    >
      <Typography variant="overline" sx={{ color: tokens.color.warning, lineHeight: 1.4 }}>
        {Number.isFinite(start)
          ? t('vetoInterface.startsAtEyebrow', {
              time: fmtTime(start),
              opens: fmtTime(Date.parse(opensAt)),
            })
          : t('vetoInterface.breakEyebrow')}
      </Typography>
      <Typography sx={{ fontWeight: 600, fontSize: '1.25rem', color: 'text.secondary' }}>
        {left > 0 ? t('vetoInterface.opensInTitle') : t('vetoInterface.opening')}
      </Typography>
      {left > 0 && (
        <Typography
          sx={{
            ...mono,
            fontWeight: 600,
            fontSize: { xs: '4rem', md: '6rem' },
            lineHeight: 1,
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {clock}
        </Typography>
      )}
      <Typography color="text.secondary" sx={{ maxWidth: 560 }}>
        {Number.isFinite(start)
          ? t('vetoInterface.opensBeforeStart', { count: lead })
          : t('vetoInterface.opensBreak')}
      </Typography>
    </Paper>
  );
}
