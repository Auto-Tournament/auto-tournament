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
import { io } from 'socket.io-client';
import { VetoMapCard } from './VetoMapCard';
import { getMapData } from '../../constants/maps';
import { getVetoOrder } from '../../constants/vetoOrders';
import { api } from '../../utils/api';
import type { VetoState, MapSide } from '../../types';
import type { MapsResponse } from '../../types/api.types';
import { FadeInImage } from '../common/FadeInImage';

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
  const [vetoState, setVetoState] = useState<VetoState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
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
    'https://raw.githubusercontent.com/sivert-io/cs2-server-manager/master/map_thumbnails';

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
        setError(data.error || 'Failed to load veto state');
      }
    } catch (err) {
      console.error('Error loading veto:', err);
      setError('Failed to load veto state');
    } finally {
      setLoading(false);
    }
  }, [matchSlug]);

  useEffect(() => {
    loadMaps();
  }, [loadMaps]);

  useEffect(() => {
    loadVetoState();

    // Setup Socket.IO for real-time veto updates
    const newSocket = io();

    newSocket.on(`veto:update:${matchSlug}`, (updatedVeto: VetoState) => {
      setVetoState(updatedVeto);
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
        displayName:
          mapData?.displayName ||
          fallbackData?.displayName ||
          mapId.replace('de_', '').replace('cs_', ''),
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
        setError(data.error || 'Failed to process veto action');
      } else {
        setError(''); // Clear any previous errors
      }
    } catch (err) {
      console.error('Error submitting veto action:', err);
      setError('Failed to submit veto action');
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
        setError('');
      } else {
        console.error('Side pick failed:', data.error);
        setError(data.error || 'Failed to pick side');
      }
    } catch (err) {
      console.error('Error picking side:', err);
      setError('Failed to pick side');
    }
  };

  if (loading) {
    return (
      <Box py={4}>
        <LinearProgress />
        <Typography variant="body2" textAlign="center" mt={2}>
          Loading veto...
        </Typography>
      </Box>
    );
  }

  if (error) {
    return <Alert severity="error">{error}</Alert>;
  }

  if (!vetoState) {
    return <Alert severity="warning">Veto not available for this match</Alert>;
  }

  // Determine which team is viewing (must be defined before early returns)
  const team1Name = vetoState.team1Name || propTeam1Name || 'Team 1';
  const team2Name = vetoState.team2Name || propTeam2Name || 'Team 2';
  const isViewingTeam1 = currentTeamSlug === vetoState.team1Id;
  const isViewingTeam2 = currentTeamSlug === vetoState.team2Id;

  if (vetoState.status === 'completed') {
    return (
      <Box>
        <Alert severity="success" sx={{ mb: 3 }}>
          <Typography variant="body1" fontWeight={600}>
            ✅ Veto Completed!
          </Typography>
          <Typography variant="body2">
            Map selection is complete. Match will start shortly.
          </Typography>
        </Alert>

        <Typography variant="h6" fontWeight={600} mb={2}>
          Selected Maps
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
                  displayName={mapData?.displayName || fallbackData?.displayName || pick.mapName}
                  imageUrl={imageUrl}
                  state="picked"
                  mapNumber={pick.mapNumber}
                  side={displaySide}
                />
              </Grid>
            );
          })}
        </Grid>
      </Box>
    );
  }

  const vetoOrder = getVetoOrder(vetoState.format);
  const fallbackStepIndex =
    typeof vetoState.currentStep === 'number' && vetoState.currentStep > 0
      ? vetoState.currentStep - 1
      : 0;
  const currentStepConfig = vetoOrder[fallbackStepIndex];
  const currentAction = vetoState.currentAction ?? currentStepConfig?.action;
  const currentTurn = vetoState.currentTurn ?? currentStepConfig?.team;

  // Get current team name
  const currentTeamName =
    currentTurn === 'team1' ? team1Name : currentTurn === 'team2' ? team2Name : 'the other team';

  const hasDetailedVetoState =
    typeof vetoState.currentStep === 'number' &&
    typeof vetoState.totalSteps === 'number' &&
    Array.isArray(vetoState.availableMaps) &&
    Array.isArray(vetoState.bannedMaps) &&
    !!currentAction &&
    !!currentTurn;

  if (!hasDetailedVetoState) {
    return (
      <Alert severity="warning">
        Veto details are unavailable for this account. Sign in as a player on one of the two
        teams to continue the veto.
      </Alert>
    );
  }

  // Determine if it's this team's turn. Require valid team IDs and currentTeamSlug;
  // otherwise we cannot reliably tell whose turn it is (don't default to "your turn").
  const isMyTurn =
    !!currentTeamSlug &&
    !!vetoState.team1Id &&
    !!vetoState.team2Id &&
    (currentTurn === 'team1'
      ? currentTeamSlug === vetoState.team1Id
      : currentTeamSlug === vetoState.team2Id);

  return (
    <Box data-testid="veto-interface">
      {/* Match Header */}
      <Paper elevation={2} sx={{ mb: 3, p: 3, bgcolor: 'background.paper' }}>
        <Box display="flex" alignItems="center" justifyContent="center" gap={3}>
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
              color: 'primary.main',
              textDecoration: 'none',
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
          <Typography variant="h3" fontWeight={300} color="text.secondary">
            VS
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
              color: 'error.main',
              textDecoration: 'none',
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
        <Typography variant="body2" textAlign="center" color="text.secondary" mt={1}>
          Best of {vetoState.format === 'bo1' ? '1' : vetoState.format === 'bo3' ? '3' : '5'}
        </Typography>
      </Paper>

      {/* Progress Header */}
      <Paper
        elevation={1}
        sx={{
          mb: 3,
          p: 3,
          bgcolor: 'background.paper',
          border: '1px solid',
          borderColor: 'divider',
        }}
      >
        <Stack spacing={2}>
          {/* Big, high‑contrast turn banner */}
          <Box
            sx={(theme) => {
              const bgColor = isMyTurn
                ? currentAction === 'ban'
                  ? theme.palette.error.main
                  : currentAction === 'pick'
                    ? theme.palette.success.main
                    : theme.palette.info.main
                : theme.palette.grey[900];

              return {
                p: 2,
                borderRadius: 2,
                textAlign: 'center',
                bgcolor: bgColor,
                color: theme.palette.getContrastText(bgColor),
                boxShadow: isMyTurn ? 6 : 1,
                border: '2px solid',
                borderColor: isMyTurn
                  ? currentAction === 'ban'
                    ? 'error.light'
                    : currentAction === 'pick'
                      ? 'success.light'
                      : 'info.light'
                  : 'grey.700',
                position: 'relative',
                overflow: 'hidden',
                '@keyframes vetoTurnPulse': {
                  '0%': { boxShadow: '0 0 0 0 rgba(255,255,255,0.5)' },
                  '70%': { boxShadow: '0 0 0 12px rgba(255,255,255,0)' },
                  '100%': { boxShadow: '0 0 0 0 rgba(255,255,255,0)' },
                },
                animation: isMyTurn ? 'vetoTurnPulse 1.6s ease-out infinite' : 'none',
              };
            }}
          >
            {isMyTurn ? (
              <>
                <Typography variant="h5" fontWeight={800} color="inherit">
                  YOUR TEAM&apos;S TURN TO{' '}
                  {currentAction === 'ban'
                    ? 'BAN A MAP'
                    : currentAction === 'pick'
                    ? 'PICK A MAP'
                    : 'CHOOSE A SIDE'}
                </Typography>
                {currentAction !== 'side_pick' && (
                  <Typography variant="body2" color="inherit" sx={{ mt: 0.5, opacity: 0.9 }}>
                    Click one of the highlighted maps below to confirm your choice.
                  </Typography>
                )}
              </>
            ) : (
              <>
                <Typography variant="h6" fontWeight={700} color="inherit">
                  Waiting for {currentTeamName} to{' '}
                  {currentAction === 'ban'
                    ? 'ban a map'
                    : currentAction === 'pick'
                    ? 'pick a map'
                    : 'choose a side'}
                </Typography>
                <Typography variant="body2" color="inherit" sx={{ mt: 0.5, opacity: 0.9 }}>
                  Keep this page open – it will update automatically when it&apos;s your turn.
                </Typography>
              </>
            )}
          </Box>

          {/* Step / progress row */}
          <Box display="flex" justifyContent="space-between" alignItems="center">
            <Typography variant="body2" color="text.secondary">
              Step {vetoState.currentStep} of {vetoState.totalSteps}
            </Typography>
            <Chip
              label={currentAction === 'ban' ? 'Ban phase' : currentAction === 'pick' ? 'Pick phase' : 'Side choice'}
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
            sx={{ height: 6, borderRadius: 3 }}
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
                      borderRadius: 2,
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
                          background:
                            'linear-gradient(to bottom, rgba(0,0,0,0.3) 0%, rgba(0,0,0,0.7) 100%)',
                        },
                      }}
                    >
                      <Box sx={{ position: 'relative', textAlign: 'center' }}>
                        <Typography
                          variant="h2"
                          fontWeight={700}
                          color="white"
                          sx={{ textShadow: '2px 2px 4px rgba(0,0,0,0.8)' }}
                        >
                          {mapData?.displayName ||
                            fallbackData?.displayName ||
                            sidePickMapName}
                        </Typography>
                        <Typography
                          variant="h6"
                          color="rgba(255,255,255,0.9)"
                          sx={{ textShadow: '1px 1px 2px rgba(0,0,0,0.8)' }}
                        >
                          Choose Your Starting Side
                        </Typography>
                      </Box>
                    </Box>
                  </FadeInImage>
                )}

                {!isMyTurn && (
                  <Alert severity="info" sx={{ mb: 2 }}>
                    Waiting for {currentTeamName} to choose their starting side...
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
                      sx={{ py: 2, fontSize: '1.1rem', fontWeight: 600 }}
                    >
                      🛡️ Counter-Terrorist
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
                      sx={{ py: 2, fontSize: '1.1rem', fontWeight: 600 }}
                    >
                      💣 Terrorist
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
                  borderRadius: 2,
                  border: '2px dashed',
                  borderColor:
                    currentAction === 'ban'
                      ? 'error.light'
                      : currentAction === 'pick'
                      ? 'success.light'
                      : 'info.light',
                  bgcolor:
                    currentAction === 'ban'
                      ? 'rgba(211, 47, 47, 0.06)'
                      : currentAction === 'pick'
                      ? 'rgba(46, 125, 50, 0.06)'
                      : 'rgba(2, 136, 209, 0.06)',
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
              Veto History
            </Typography>
            <Stack spacing={1}>
              {(vetoState.actions || []).map((action, idx) => (
                <Box
                  key={idx}
                  sx={{
                    p: 1.5,
                    borderRadius: 1,
                    bgcolor: 'action.hover',
                    border: '1px solid',
                    borderColor: 'divider',
                  }}
                >
                  <Typography variant="body2">
                    <strong>Step {action.step}:</strong>{' '}
                    {action.team === 'team1' ? team1Name : team2Name}{' '}
                    <Chip
                      label={action.action.toUpperCase()}
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
                    {allMaps.get(action.mapName || '')?.displayName ||
                      getMapData(action.mapName || '')?.displayName ||
                      action.mapName}
                    {action.side && ` (Starting ${action.side})`}
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
