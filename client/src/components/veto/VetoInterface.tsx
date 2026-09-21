import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
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
import { io } from 'socket.io-client';
import { VetoMapCard } from './VetoMapCard';
import { getMapData, getMapDisplayName } from '../../constants/maps';
import { getVetoOrder } from '../../constants/vetoOrders';
import { api } from '../../utils/api';
import type { VetoState, MapSide } from '../../types';
import type { MapsResponse } from '../../types/api.types';
import { FadeInImage } from '../common/FadeInImage';
import { tokens, mono, withAlpha } from '../../theme/tokens';
import { vetoHistoryRowSx, vetoMapNameSx } from './vetoStyles';

const { color, radius } = tokens;

interface VetoInterfaceProps {
  matchSlug: string;
  team1Name?: string;
  team2Name?: string;
  currentTeamSlug?: string; // For security - which team is viewing this
  onComplete?: (vetoState: VetoState) => void;
}

export const VetoInterface: React.FC<VetoInterfaceProps> = ({
  matchSlug,
  team1Name: propTeam1Name,
  team2Name: propTeam2Name,
  currentTeamSlug,
  onComplete,
}) => {
  const { t } = useTranslation();

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
    'https://raw.githubusercontent.com/Auto-Tournament/cs2-server-manager/master/map_thumbnails';

  const getThumbnailUrl = (mapId: string): string => `${MAP_IMAGE_BASE}/${mapId}_thumb.webp`;

  const getFullImageUrl = (mapId: string): string => `${MAP_IMAGE_BASE}/${mapId}.webp`;

  const isRepoImageUrl = (url: string | null | undefined): boolean =>
    !!url && url.includes('cs2-server-manager') && url.includes('map_thumbnails');

  const loadMaps = useCallback(async () => {
    try {
      const response = await api.get<MapsResponse>('/api/maps');
      const mapsMap = new Map<
        string,
        { id: string; displayName: string; imageUrl: string | null }
      >();
      response.maps?.forEach((map) => {
        mapsMap.set(map.id, {
          id: map.id,
          displayName: map.displayName,
          imageUrl: map.imageUrl,
        });
      });
      setAllMaps(mapsMap);
    } catch (err) {
      console.error('Error loading maps:', err);
      // Continue without map data - will use fallback display names
    }
  }, []);

  const loadVetoState = useCallback(async () => {
    setLoading(true);
    setError('');

    try {
      const response = await fetch(`/api/veto/${matchSlug}`);
      const data = await response.json();

      if (data.success) {
        setVetoState(data.veto);
        if (data.veto.status === 'completed') {
          onCompleteRef.current?.(data.veto);
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
  }, [matchSlug, t, translateVetoError]);

  useEffect(() => {
    loadMaps();
  }, [loadMaps]);

  useEffect(() => {
    loadVetoState();

    // Setup Socket.IO for real-time veto updates
    const newSocket = io();

    newSocket.on(`veto:update:${matchSlug}`, (updatedVeto: VetoState) => {
      setVetoState(updatedVeto);
      // The board moved on, so a refused action from before is no longer news.
      setActionError('');
      if (updatedVeto.status === 'completed') {
        onCompleteRef.current?.(updatedVeto);
      }
    });

    return () => {
      newSocket.close();
    };
  }, [matchSlug, loadVetoState]);

  // Memoize mapsToShow - must be called before any early returns (Rules of Hooks)
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

      {/* Match Header */}
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

      {/* Progress Header */}
      <Paper
        sx={{
          mb: 3,
          p: { xs: 2, sm: 3 },
          bgcolor: 'background.paper',
          borderRadius: `${radius.lg}px`,
        }}
      >
        <Stack spacing={2}>
          {/* Big, high‑contrast turn banner */}
          <Box
            sx={() => {
              // Inset row on paper3, as on the homepage veto card. The action
              // colour (red ban, green pick, blue side) marks the outline and
              // title; on your turn it glows.
              const actionColor =
                currentAction === 'ban'
                  ? color.ban
                  : currentAction === 'pick'
                    ? color.pick
                    : color.info;

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
                <Typography variant="h5" className="veto-turn-title">
                  {currentAction === 'ban'
                    ? t('vetoInterface.yourTurnToBan')
                    : currentAction === 'pick'
                    ? t('vetoInterface.yourTurnToPick')
                    : t('vetoInterface.yourTurnToChooseSide')}
                </Typography>
                {currentAction !== 'side_pick' && (
                  <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                    {t('vetoInterface.clickMapToConfirm')}
                  </Typography>
                )}
              </>
            ) : (
              <>
                <Typography variant="h6" className="veto-turn-title">
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
          </Box>

          {/* Step / progress row */}
          <Box display="flex" justifyContent="space-between" alignItems="center">
            <Typography variant="body2" color="text.secondary" sx={{ ...mono, fontSize: '0.75rem' }}>
              {t('vetoInterface.stepOf', { current: vetoState.currentStep, total: vetoState.totalSteps })}
            </Typography>
            <Chip
              label={currentAction === 'ban' ? t('vetoInterface.banPhase') : currentAction === 'pick' ? t('vetoInterface.pickPhase') : t('vetoInterface.sideChoice')}
              size="small"
              color={
                currentAction === 'ban'
                  ? 'error'
                  : currentAction === 'pick'
                  ? 'success'
                  : 'info'
              }
            />
          </Box>

          <LinearProgress
            variant="determinate"
            value={(vetoState.currentStep / vetoState.totalSteps) * 100}
            sx={{ height: 4 }}
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
                  borderColor: withAlpha(
                    currentAction === 'ban' ? color.ban : currentAction === 'pick' ? color.pick : color.info,
                    0.5
                  ),
                  bgcolor: withAlpha(
                    currentAction === 'ban' ? color.ban : currentAction === 'pick' ? color.pick : color.info,
                    0.05
                  ),
                }
              : undefined
          }
        >
          {mapsToShow.map((map) => {
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
              <Grid size={{ xs: 12, sm: 6, md: 3 }} key={map.name}>
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
        </Grid>
      )}

      {/* Veto History */}
      {Array.isArray(vetoState.actions) && vetoState.actions.length > 0 && (
        <Card sx={{ mt: 3 }}>
          <CardContent>
            <Typography variant="h6" fontWeight={600} mb={2}>
              {t('vetoInterface.vetoHistory')}
            </Typography>
            <Stack spacing={1}>
              {(vetoState.actions || []).map((action, idx) => (
                <Box key={idx} sx={vetoHistoryRowSx(action.action)}>
                  <Typography variant="body2">
                    <strong>{t('vetoInterface.historyStep', { step: action.step })}</strong>{' '}
                    {action.team === 'team1' ? team1Name : team2Name}{' '}
                    <Chip
                      data-testid="veto-history-action"
                      label={t(`vetoInterface.actionLabels.${action.action}`, {
                        defaultValue: action.action.toUpperCase(),
                      })}
                      size="small"
                      color={
                        action.action === 'ban'
                          ? 'error'
                          : action.action === 'pick'
                          ? 'success'
                          : 'info'
                      }
                      sx={{ mx: 1 }}
                    />
                    <Box component="span" sx={vetoMapNameSx(action.action)}>
                      {allMaps.get(action.mapName || '')?.displayName ||
                        getMapDisplayName(action.mapName || '')}
                    </Box>
                    {action.side && ` (${t('vetoInterface.startingSide', { side: action.side })})`}
                  </Typography>
                </Box>
              ))}
            </Stack>
          </CardContent>
        </Card>
      )}
    </Box>
  );
};
