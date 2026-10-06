import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  Box,
  Typography,
  Grid,
  Button,
  Alert,
  Card,
  CardContent,
  Stack,
  Chip,
  Paper,
  LinearProgress,
} from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { ArrowsLeftRightIcon, CheckCircleIcon, ProhibitIcon } from '@phosphor-icons/react';
import { VetoMapCard } from './VetoMapCard';
import { getMapData, getMapDisplayName } from '../maps/mapData';
import { getVetoOrder } from './vetoOrders';
import type { MapSide, VetoMapInfo, VetoState, VetoStateResponse } from '../cs2.types';
import { FadeInImage } from '../common/FadeInImage';
import { onSocketReconnect, useSocket, tokens, mono, withAlpha, useModuleTranslation } from '../../../module-sdk';
import type { PreMatchViewProps as VetoInterfaceProps } from '../../types';

const { color, radius } = tokens;

export const VetoInterface: React.FC<VetoInterfaceProps> = ({
  matchSlug,
  team1Name: propTeam1Name,
  team2Name: propTeam2Name,
  currentTeamSlug,
  onComplete,
  hideMatchHeader = false,
}) => {
  const { t } = useModuleTranslation('cs2');

  const translateVetoError = useCallback(
    (backendError: string | undefined): string | undefined => {
      if (!backendError) return undefined;
      if (backendError.includes('not your turn') || backendError.includes('Waiting for the other team'))
        return t('vetoInterface.errors.notYourTurn');
      if (backendError.includes('already completed')) return t('vetoInterface.errors.vetoAlreadyCompleted');
      if (backendError.includes('Invalid map')) return t('vetoInterface.errors.invalidMapSelection');
      if (backendError.includes('Invalid side')) return t('vetoInterface.errors.invalidSideSelection');
      if (backendError.includes('No map to pick')) return t('vetoInterface.errors.noMapToPickSide');
      if (backendError.includes('Match not found')) return t('vetoInterface.errors.matchNotFound');
      if (backendError.includes('participating teams')) return t('vetoInterface.errors.unauthorized');
      return backendError;
    },
    [t],
  );

  const [vetoState, setVetoState] = useState<VetoState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  // Errors from a refused ban/pick/side action are transient: they must not
  // replace the veto board, or the team loses the UI they were acting in.
  const [actionError, setActionError] = useState('');
  const [allMaps, setAllMaps] = useState<
    Map<string, { id: string; displayName: string; imageUrl: string | null }>
  >(new Map());

  // Keep a stable reference to the latest onComplete callback so veto effects
  // don't restart (socket reconnect + loading flashes) when parents re-render.
  const onCompleteRef = useRef<VetoInterfaceProps['onComplete']>(onComplete);
  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);

  const MAP_IMAGE_BASE =
    'https://cdn.jsdelivr.net/gh/Auto-Tournament/cs2-server-manager@master/map_thumbnails';

  const getThumbnailUrl = (mapId: string): string => `${MAP_IMAGE_BASE}/${mapId}_thumb.webp`;

  const getFullImageUrl = (mapId: string): string => `${MAP_IMAGE_BASE}/${mapId}.webp`;

  const isRepoImageUrl = (url: string | null | undefined): boolean =>
    !!url && url.includes('cs2-server-manager') && url.includes('map_thumbnails');

  // The veto response carries its maps' names and pictures (`maps`), so
  // players never need the admin-only `/api/maps` — which answered them with
  // a 403 and left them with names guessed from the map id.
  const storeMapInfo = useCallback((maps: VetoMapInfo[] | undefined) => {
    if (!maps || maps.length === 0) return;
    setAllMaps(new Map(maps.map((map) => [map.id, map])));
  }, []);

  const loadVetoState = useCallback(async () => {
    setLoading(true);
    setError('');

    try {
      const response = await fetch(`/api/veto/${matchSlug}`);
      const data = (await response.json()) as VetoStateResponse & { veto: VetoState };

      if (data.success) {
        storeMapInfo(data.maps);
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
      setVetoState(updatedVeto);
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
    const originalMapOrder = Array.isArray(vetoState.allMaps) && vetoState.allMaps.length > 0
      ? [...vetoState.allMaps] // Create a copy to ensure immutability
      : [
          ...availableMaps,
          ...bannedMaps,
          ...pickedMaps.map((p) => p.mapName),
        ].filter((mapId, index, self) => self.indexOf(mapId) === index); // Fallback: remove duplicates

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

  const handleMapAction = async (mapName: string) => {
    if (!vetoState || vetoState.status === 'completed' || !isMyTurn) return;

    const currentAction = vetoState.currentAction;

    if (currentAction === 'side_pick') {
      // Side picker is shown automatically when action is 'side_pick'
      return;
    }

    // For ban/pick actions, submit immediately
    try {
      const response = await fetch(`/api/veto/${matchSlug}/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mapName,
          teamSlug: currentTeamSlug, // Send which team is making the action
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
    }
  };

  const handleSidePick = async (side: MapSide) => {
    if (!vetoState) {
      console.error('No veto state');
      return;
    }

    try {
      const response = await fetch(`/api/veto/${matchSlug}/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          side,
          teamSlug: currentTeamSlug, // Send which team is making the action
        }),
      });

      const data = await response.json();

      if (data.success) {
        setActionError('');
      } else {
        console.error('Side pick failed:', data.error);
        setActionError(translateVetoError(data.error) || t('vetoInterface.errors.failedToPickSide'));
      }
    } catch (err) {
      console.error('Error picking side:', err);
      setActionError(t('vetoInterface.errors.failedToPickSide'));
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

  // Determine which team is viewing (must be defined before early returns)
  const team1Name = vetoState.team1Name || propTeam1Name || t('teamMatchHistory.team1');
  const team2Name = vetoState.team2Name || propTeam2Name || t('teamMatchHistory.team2');
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

  if (vetoState.status === 'completed') {
    return (
      <Box>
        <Alert severity="success" sx={{ mb: 3 }}>
          <Typography variant="body1" fontWeight={600}>
            {t('vetoInterface.vetoCompleted')}
          </Typography>
          <Typography variant="body2">
            {t('vetoInterface.vetoCompletedSubtitle')}
          </Typography>
        </Alert>

        <Typography variant="h6" fontWeight={600} mb={2}>
          {t('vetoInterface.selectedMaps')}
        </Typography>
        <Grid container spacing={2}>
          {vetoState.pickedMaps.map((pick) => {
            const mapData = allMaps.get(pick.mapName);
            const fallbackData = getMapData(pick.mapName);
            const imageUrl = isRepoImageUrl(mapData?.imageUrl)
              ? fallbackData?.image || getFullImageUrl(pick.mapName)
              : mapData?.imageUrl || fallbackData?.image || getFullImageUrl(pick.mapName);
            // Show the side for the team viewing (team1 sees sideTeam1, team2 sees sideTeam2)
            const displaySide = isViewingTeam1
              ? pick.sideTeam1
              : isViewingTeam2
              ? pick.sideTeam2
              : pick.sideTeam1; // Fallback to team1 if unknown
            return (
              <Grid size={{ xs: 12, sm: 6, md: 4 }} key={pick.mapNumber}>
                <VetoMapCard
                  mapName={pick.mapName}
                  displayName={
                    mapData?.displayName || fallbackData?.displayName || getMapDisplayName(pick.mapName)
                  }
                  imageUrl={imageUrl}
                  state="picked"
                  mapNumber={pick.mapNumber}
                  side={displaySide}
                  isDecider={isDeciderMap(pick.mapName)}
                />
              </Grid>
            );
          })}
        </Grid>
      </Box>
    );
  }

  const vetoOrder = getVetoOrder(vetoState.format);
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
  const actionColor = currentAction === 'ban' ? color.ban : currentAction === 'pick' ? color.pick : color.info;
  const ActionIcon = currentAction === 'ban' ? ProhibitIcon : currentAction === 'pick' ? CheckCircleIcon : ArrowsLeftRightIcon;

  return (
    <Box data-testid="veto-interface">
      {actionError && (
        <Alert
          severity="error"
          onClose={() => setActionError('')}
          sx={{ mb: 2 }}
          data-testid="veto-action-error"
        >
          {actionError}
        </Alert>
      )}

      {/* Match Header (left out where the page already shows who plays) */}
      {!hideMatchHeader && (
        <Paper sx={{ mb: 3, p: { xs: 2, sm: 3 }, bgcolor: 'background.paper', borderRadius: `${radius.lg}px` }}>
          <Box
            display="flex"
            alignItems="center"
            justifyContent="center"
            gap={{ xs: 1.5, sm: 3 }}
            flexWrap="wrap"
          >
            <Typography
              variant="h4"
              fontWeight={700}
              component={
                vetoState.team1Id &&
                vetoState.team1Id !== 'team1' &&
                vetoState.team1Id !== 'team2'
                  ? RouterLink
                  : 'span'
              }
              to={
                vetoState.team1Id &&
                vetoState.team1Id !== 'team1' &&
                vetoState.team1Id !== 'team2'
                  ? `/team/${vetoState.team1Id}`
                  : undefined
              }
              sx={{
                color: 'text.primary',
                textDecoration: 'none',
                overflowWrap: 'anywhere',
                '&:hover': {
                  textDecoration:
                    vetoState.team1Id &&
                    vetoState.team1Id !== 'team1' &&
                    vetoState.team1Id !== 'team2'
                      ? 'underline'
                      : 'none',
                },
              }}
            >
              {team1Name}
            </Typography>
            <Typography variant="body2" color="text.disabled" sx={{ ...mono }}>
              {t('teamMatchHistory.vs')}
            </Typography>
            <Typography
              variant="h4"
              fontWeight={700}
              component={
                vetoState.team2Id &&
                vetoState.team2Id !== 'team1' &&
                vetoState.team2Id !== 'team2'
                  ? RouterLink
                  : 'span'
              }
              to={
                vetoState.team2Id &&
                vetoState.team2Id !== 'team1' &&
                vetoState.team2Id !== 'team2'
                  ? `/team/${vetoState.team2Id}`
                  : undefined
              }
              sx={{
                color: 'text.primary',
                textDecoration: 'none',
                overflowWrap: 'anywhere',
                '&:hover': {
                  textDecoration:
                    vetoState.team2Id &&
                    vetoState.team2Id !== 'team1' &&
                    vetoState.team2Id !== 'team2'
                      ? 'underline'
                      : 'none',
                },
              }}
            >
              {team2Name}
            </Typography>
          </Box>
          <Box display="flex" justifyContent="center" mt={1.5}>
            <Chip size="small" label={vetoState.format.toUpperCase()} />
          </Box>
        </Paper>
      )}

      {/* Progress Header */}
      <Paper
        sx={{
          mb: 3,
          p: { xs: 2, sm: 3 },
          bgcolor: 'background.paper',
          borderRadius: `${radius.lg}px`,
          // Your turn: the whole veto card is outlined in the action's colour.
          border: '1px solid',
          borderColor: isMyTurn ? actionColor : 'transparent',
          transition: 'border-color 200ms ease-out',
        }}
        data-my-turn={isMyTurn ? 'true' : 'false'}
      >
        <Stack spacing={2}>
          {/* Big, high‑contrast turn banner */}
          <Box
            sx={() => {
              // Inset row on paper3, as on the homepage veto card, outlined and
              // glowing in the action's colour on your turn.

              return {
                p: 2,
                borderRadius: `${radius.md}px`,
                textAlign: 'center',
                bgcolor: color.paper3,
                color: color.ink,
                border: '1px solid',
                borderColor: isMyTurn ? actionColor : color.rule,
                position: 'relative',
                overflow: 'hidden',
                '& .veto-turn-title': { color: isMyTurn ? actionColor : color.ink },
                '@keyframes vetoTurnPulse': {
                  '0%': { boxShadow: `0 0 0 0 ${withAlpha(actionColor, 0.45)}` },
                  '70%': { boxShadow: `0 0 0 10px ${withAlpha(actionColor, 0)}` },
                  '100%': { boxShadow: `0 0 0 0 ${withAlpha(actionColor, 0)}` },
                },
                animation: isMyTurn ? 'vetoTurnPulse 1.6s ease-out infinite' : 'none',
                '@media (prefers-reduced-motion: reduce)': { animation: 'none' },
              };
            }}
          >
            {isMyTurn ? (
              <>
                {/* One plain question (design draft "Veto B"): only the maps still in play below. */}
                <Typography
                  key={`q-${vetoState.currentStep}`}
                  component={motion.h2}
                  variant="h4"
                  initial={reduceMotion ? false : { opacity: 0, y: 8, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  transition={{ type: 'spring', stiffness: 520, damping: 30 }}
                  className="veto-turn-title"
                  sx={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 1.25,
                    fontWeight: 600,
                    fontSize: { xs: '1.6rem', md: '2.2rem' },
                    lineHeight: 1.15,
                    letterSpacing: '-0.01em',
                  }}
                >
                  <ActionIcon size={30} weight="bold" aria-hidden />
                  {currentAction === 'ban'
                    ? t('vetoInterface.question.ban')
                    : currentAction === 'pick'
                    ? t('vetoInterface.question.pick')
                    : t('vetoInterface.question.side')}
                </Typography>
                {currentAction !== 'side_pick' && (
                  <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                    {t('vetoInterface.clickMapToConfirm')}
                  </Typography>
                )}
              </>
            ) : (
              <>
                <Typography
                  component="h2"
                  className="veto-turn-title"
                  sx={{ fontWeight: 600, fontSize: { xs: '1.35rem', md: '1.8rem' }, lineHeight: 1.2, color: color.ink2 }}
                >
                  {currentAction === 'ban'
                    ? t('vetoInterface.waitingToBan', { team: currentTeamName })
                    : currentAction === 'pick'
                    ? t('vetoInterface.waitingToPick', { team: currentTeamName })
                    : t('vetoInterface.waitingToChooseSide', { team: currentTeamName })}
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                  {t('vetoInterface.pageUpdatesAutomatically')}
                </Typography>
              </>
            )}
            {vetoState.turnDeadline && (
              <TurnClock deadline={vetoState.turnDeadline} mine={isMyTurn} tone={actionColor} />
            )}
          </Box>

          {/* Every step in one strip (draft "Veto B"): what each one did, whose turn now, what is left. */}
          <VetoStepStrip
            vetoState={vetoState}
            order={vetoOrder}
            mySide={currentTeamSlug ? (currentTeamSlug === vetoState.team1Id ? 'team1' : currentTeamSlug === vetoState.team2Id ? 'team2' : null) : null}
            teamName={(team) => (team === 'team1' ? team1Name : team2Name)}
            mapName={(m) => allMaps.get(m)?.displayName || getMapDisplayName(m)}
          />
        </Stack>
      </Paper>

      {/* Side Picker (for side_pick actions) */}
      {currentAction === 'side_pick' &&
        (() => {
          const pickedMaps = Array.isArray(vetoState.pickedMaps) ? vetoState.pickedMaps : [];
          const availableMaps = Array.isArray(vetoState.availableMaps) ? vetoState.availableMaps : [];

          // BO1 and BO3 decider: the side pick is for the *remaining* map,
          // which is not in pickedMaps yet (the server adds it when side is submitted).
          const isDeciderSidePick =
            (vetoState.format === 'bo1' || vetoState.format === 'bo3') &&
            vetoState.currentStep === vetoState.totalSteps &&
            availableMaps.length === 1;

          const sidePickMapName = isDeciderSidePick
            ? availableMaps[0]
            : pickedMaps.length > 0
              ? pickedMaps[pickedMaps.length - 1].mapName
              : null;

          if (!sidePickMapName) {
            return null;
          }

          const mapData = allMaps.get(sidePickMapName);
          const fallbackData = getMapData(sidePickMapName);

          return (
            <Card sx={{ mb: 3 }}>
              <CardContent>
                {/* Map Display */}
                {sidePickMapName && (
                  <FadeInImage
                    src={
                      isRepoImageUrl(mapData?.imageUrl)
                        ? fallbackData?.image || getFullImageUrl(sidePickMapName)
                        : mapData?.imageUrl ||
                          fallbackData?.image ||
                          getFullImageUrl(sidePickMapName)
                    }
                    alt={mapData?.displayName || fallbackData?.displayName || sidePickMapName}
                    height={250}
                    sx={{
                      borderRadius: `${radius.md}px`,
                      mb: 3,
                    }}
                  >
                    <Box
                      sx={{
                        position: 'absolute',
                        inset: 0,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        '&::before': {
                          content: '""',
                          position: 'absolute',
                          top: 0,
                          left: 0,
                          right: 0,
                          bottom: 0,
                          background: `linear-gradient(to bottom, ${withAlpha(color.paper, 0.3)} 0%, ${withAlpha(color.paper, 0.8)} 100%)`,
                        },
                      }}
                    >
                      <Box sx={{ position: 'relative', textAlign: 'center' }}>
                        <Typography
                          variant="h2"
                          fontWeight={700}
                          color="text.primary"
                          sx={{ textShadow: `0 2px 12px ${color.shadow}` }}
                        >
                          {mapData?.displayName ||
                            fallbackData?.displayName ||
                            sidePickMapName}
                        </Typography>
                        <Typography
                          variant="h6"
                          color="text.secondary"
                          sx={{ textShadow: `0 1px 6px ${color.shadow}` }}
                        >
                          {t('vetoInterface.chooseYourStartingSide')}
                        </Typography>
                      </Box>
                    </Box>
                  </FadeInImage>
                )}

                {!isMyTurn && (
                  <Alert severity="info" sx={{ mb: 2 }}>
                    {t('vetoInterface.waitingForSidePick', { team: currentTeamName })}
                  </Alert>
                )}

                <Grid container spacing={2}>
                  <Grid size={{ xs: 6 }}>
                    <Button
                      data-testid="veto-side-ct-button"
                      fullWidth
                      variant="contained"
                      color="info"
                      size="large"
                      onClick={() => handleSidePick('CT')}
                      disabled={!isMyTurn}
                      sx={{
                        py: 2,
                        fontSize: '1.05rem',
                        bgcolor: color.sideCt,
                        color: color.accentInk,
                        '&:hover': { bgcolor: color.sideCt },
                      }}
                    >
                      {t('vetoInterface.counterTerrorist')}
                    </Button>
                  </Grid>
                  <Grid size={{ xs: 6 }}>
                    <Button
                      data-testid="veto-side-t-button"
                      fullWidth
                      variant="contained"
                      color="warning"
                      size="large"
                      onClick={() => handleSidePick('T')}
                      disabled={!isMyTurn}
                      sx={{
                        py: 2,
                        fontSize: '1.05rem',
                        bgcolor: color.sideT,
                        color: color.accentInk,
                        '&:hover': { bgcolor: color.sideT },
                      }}
                    >
                      {t('vetoInterface.terrorist')}
                    </Button>
                  </Grid>
                </Grid>
              </CardContent>
            </Card>
          );
        })()}

      {/* Map Grid */}
      {currentAction !== 'side_pick' && (
        <Grid
          container
          spacing={2}
          sx={
            isMyTurn
              ? {
                  p: 1.5,
                  borderRadius: `${radius.lg}px`,
                  border: '1px dashed',
                  borderColor: withAlpha(actionColor, 0.5),
                  bgcolor: withAlpha(actionColor, 0.05),
                }
              : undefined
          }
        >
          <AnimatePresence mode="popLayout" initial={false}>
          {mapsToShow
            // Decided maps leave the grid; they are listed in one line below it.
            .filter(
              (map) =>
                !vetoState.bannedMaps.includes(map.name) &&
                !vetoState.pickedMaps.find((p) => p.mapName === map.name)
            )
            .map((map) => {
            const mapState = vetoState.bannedMaps.includes(map.name)
              ? 'banned'
              : vetoState.pickedMaps.find((p) => p.mapName === map.name)
              ? 'picked'
              : 'available';

            const pickedMap = vetoState.pickedMaps.find((p) => p.mapName === map.name);
            // Show the side for the team viewing (team1 sees sideTeam1, team2 sees sideTeam2)
            const displaySide = pickedMap
              ? isViewingTeam1
                ? pickedMap.sideTeam1
                : isViewingTeam2
                ? pickedMap.sideTeam2
                : pickedMap.sideTeam1 // Fallback to team1 if unknown
              : undefined;

            return (
              <Grid
                size={{ xs: 12, sm: 6, md: 4 }}
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
                        scale: 0.82,
                        rotate: currentAction === 'ban' ? -2 : 0,
                        filter: `drop-shadow(0 0 18px ${withAlpha(actionColor, 0.7)})`,
                        transition: { duration: 0.32, ease: [0.55, 0, 1, 0.45] },
                      }
                }
                transition={{ type: 'spring', stiffness: 420, damping: 34 }}
              >
                <VetoMapCard
                  mapName={map.name}
                  displayName={map.displayName}
                  imageUrl={map.image}
                  state={mapState}
                  mapNumber={pickedMap?.mapNumber}
                  side={displaySide}
                  onClick={() => handleMapAction(map.name)}
                  disabled={mapState !== 'available' || !isMyTurn}
                  isCurrentTurn={isMyTurn && mapState === 'available'}
                  currentAction={currentAction}
                  isDecider={mapState === 'picked' && isDeciderMap(map.name)}
                />
              </Grid>
            );
          })}
          </AnimatePresence>
        </Grid>
      )}

      {/* What is decided so far, in one quiet line: the picks with who chose them, and the bans. */}
      {(vetoState.pickedMaps.length > 0 || vetoState.bannedMaps.length > 0) && (
        <Box
          data-testid="veto-decided-summary"
          sx={{ mt: 2, display: 'flex', flexWrap: 'wrap', gap: 2.5, justifyContent: 'center', color: 'text.secondary', fontSize: '0.9rem' }}
        >
          {vetoState.pickedMaps.map((pick) => (
            <span key={`pick-${pick.mapNumber}`}>
              <Box component="span" sx={{ color: color.pick, fontWeight: 600 }}>
                {t('vetoInterface.decided.map', { number: pick.mapNumber })}
              </Box>{' '}
              {allMaps.get(pick.mapName)?.displayName || getMapDisplayName(pick.mapName)}
              {pick.pickedBy === 'team1' || pick.pickedBy === 'team2'
                ? ` · ${t('vetoInterface.decided.pickedBy', { team: pick.pickedBy === 'team1' ? team1Name : team2Name })}`
                : ''}
            </span>
          ))}
          {vetoState.bannedMaps.length > 0 && (
            <span>
              <Box component="span" sx={{ color: color.ban, fontWeight: 600 }}>
                {t('vetoInterface.decided.out')}
              </Box>{' '}
              {vetoState.bannedMaps.map((m) => allMaps.get(m)?.displayName || getMapDisplayName(m)).join(', ')}
            </span>
          )}
        </Box>
      )}

    </Box>
  );
};


/** The turn's countdown: "0:24", red in the last ten seconds, "Time's up" at zero. */
function TurnClock({ deadline, mine, tone }: { deadline: string; mine: boolean; tone: string }) {
  const { t } = useModuleTranslation('cs2');
  const end = Date.parse(deadline);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, []);
  const left = Math.max(0, Math.ceil((end - now) / 1000));
  const urgent = left <= 10;
  const text = left > 0 ? `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}` : t('vetoInterface.timeUp');
  return (
    <Box
      data-testid="veto-turn-clock"
      role="timer"
      aria-live={urgent ? 'assertive' : 'off'}
      sx={{
        position: { sm: 'absolute' },
        top: { sm: 12 },
        right: { sm: 12 },
        mt: { xs: 1, sm: 0 },
        display: 'inline-flex',
        alignItems: 'center',
        gap: 0.75,
        px: 1.25,
        py: 0.5,
        borderRadius: 999,
        bgcolor: urgent ? withAlpha(color.ban, 0.18) : mine ? withAlpha(tone, 0.16) : color.paper2,
        color: urgent ? color.ban : mine ? tone : color.ink2,
        fontWeight: 600,
        fontSize: '0.875rem',
        ...mono,
      }}
    >
      {mine ? t('vetoInterface.yourTurnClock') : t('vetoInterface.theirTurnClock')} · {text}
    </Box>
  );
}

/** One chip per veto step: done (map and who), now ("?" and whose turn), or still to come. */
function VetoStepStrip({
  vetoState,
  order,
  mySide,
  teamName,
  mapName,
}: {
  vetoState: VetoState;
  order: Array<{ team: string; action: string }>;
  mySide: 'team1' | 'team2' | null;
  teamName: (team: string) => string;
  mapName: (map: string) => string;
}) {
  const { t } = useModuleTranslation('cs2');
  const actions = Array.isArray(vetoState.actions) ? vetoState.actions : [];
  const steps = Array.from({ length: vetoState.totalSteps }, (_, i) => i + 1);
  const who = (team: string) => (mySide ? (team === mySide ? t('vetoInterface.strip.you') : t('vetoInterface.strip.them')) : teamName(team));
  const tone = (action: string) => (action === 'ban' ? color.ban : action === 'pick' ? color.pick : color.info);
  return (
    <Box
      component="ol"
      aria-label={t('vetoInterface.stepOf', { current: Math.min(vetoState.currentStep, vetoState.totalSteps), total: vetoState.totalSteps })}
      data-testid="veto-step-strip"
      sx={{ listStyle: 'none', m: 0, p: 0, display: 'grid', gridTemplateColumns: `repeat(${Math.max(1, vetoState.totalSteps)}, minmax(0, 1fr))`, gap: 0.75 }}
    >
      {steps.map((step) => {
        const done = actions.find((a) => a.step === step);
        const current = !done && step === vetoState.currentStep && vetoState.status !== 'completed';
        const planned = order[step - 1];
        const action = done?.action ?? (current ? vetoState.currentAction : planned?.action) ?? 'ban';
        const team = done?.team ?? (current ? vetoState.currentTurn : planned?.team);
        return (
          <Box
            component="li"
            key={step}
            aria-current={current ? 'step' : undefined}
            sx={{
              minWidth: 0,
              px: 1,
              py: 0.75,
              borderRadius: '10px',
              bgcolor: done ? withAlpha(tone(action), 0.12) : color.paper2,
              border: '1px solid',
              borderColor: current ? tone(action) : 'transparent',
              opacity: done || current ? 1 : 0.55,
              display: 'flex',
              flexDirection: 'column',
              gap: 0.25,
            }}
          >
            <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 0.75, fontSize: '0.6875rem', color: done || current ? tone(action) : color.muted, fontWeight: 600, letterSpacing: '0.04em' }}>
              <span>{step}</span>
              <span data-testid={done ? 'veto-history-action' : undefined}>
                {t(`vetoInterface.actionLabels.${action}`, { defaultValue: String(action).toUpperCase() })}
              </span>
            </Box>
            <Typography noWrap sx={{ fontSize: '0.8125rem', fontWeight: done ? 600 : 400, color: done ? color.ink : color.muted }}>
              {done
                ? done.action === 'side_pick'
                  ? t('vetoInterface.startingSide', { side: done.side })
                  : mapName(done.mapName)
                : '?'}
            </Typography>
            <Typography noWrap sx={{ fontSize: '0.6875rem', color: color.muted }}>
              {team ? who(team) : ''}
              {done?.timedOut ? ` · ${t('vetoInterface.strip.timedOut')}` : ''}
            </Typography>
          </Box>
        );
      })}
    </Box>
  );
}
