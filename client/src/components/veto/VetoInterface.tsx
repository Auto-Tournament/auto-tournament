import React, { useState, useEffect } from 'react';
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
import { io, Socket } from 'socket.io-client';
import { VetoMapCard } from './VetoMapCard';
import { CS2_MAPS, getMapData } from '../../constants/maps';
import { getVetoOrder } from '../../constants/vetoOrders';
import type { VetoState, MapSide } from '../../types';

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
  onComplete 
}) => {
  const [vetoState, setVetoState] = useState<VetoState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedMap, setSelectedMap] = useState<string | null>(null);
  const [socket, setSocket] = useState<Socket | null>(null);

  useEffect(() => {
    loadVetoState();

    // Setup Socket.IO for real-time veto updates
    const newSocket = io();
    setSocket(newSocket);

    newSocket.on(`veto:update:${matchSlug}`, (updatedVeto: VetoState) => {
      setVetoState(updatedVeto);
      if (updatedVeto.status === 'completed' && onComplete) {
        onComplete(updatedVeto);
      }
    });

    return () => {
      newSocket.close();
    };
  }, [matchSlug]);

  const loadVetoState = async () => {
    setLoading(true);
    setError('');

    try {
      const response = await fetch(`/api/veto/${matchSlug}`);
      const data = await response.json();

      if (data.success) {
        setVetoState(data.veto);
        if (data.veto.status === 'completed' && onComplete) {
          onComplete(data.veto);
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
  };

  const handleMapAction = async (mapName: string) => {
    if (!vetoState || vetoState.status === 'completed' || !isMyTurn) return;

    const currentAction = vetoState.currentAction;

    if (currentAction === 'side_pick') {
      // Just select the map, show side picker
      setSelectedMap(mapName);
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

    console.log('Picking side:', side);
    console.log('Current team slug:', currentTeamSlug);
    console.log('Match slug:', matchSlug);

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
      console.log('Side pick response:', data);

      if (data.success) {
        setSelectedMap(null);
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
            const mapData = getMapData(pick.mapName);
            return (
              <Grid size={{ xs: 12, sm: 6, md: 4 }} key={pick.mapNumber}>
                <VetoMapCard
                  mapName={pick.mapName}
                  displayName={mapData?.displayName || pick.mapName}
                  imageUrl={mapData?.image || ''}
                  state="picked"
                  mapNumber={pick.mapNumber}
                  side={pick.sideTeam1}
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
  const currentAction = currentStepConfig?.action;
  
  // Use team names from veto state (backend) or props as fallback
  const team1Name = vetoState.team1Name || propTeam1Name || 'Team 1';
  const team2Name = vetoState.team2Name || propTeam2Name || 'Team 2';
  
  // Get current team name
  const currentTeamName = currentStepConfig?.team === 'team1' ? team1Name : team2Name;
  
  // Determine if it's this team's turn
  // Compare current team slug with the team IDs in veto state
  const isMyTurn = !currentTeamSlug || !vetoState.team1Id || !vetoState.team2Id || (
    currentStepConfig?.team === 'team1' ? currentTeamSlug === vetoState.team1Id : currentTeamSlug === vetoState.team2Id
  );

  // Determine action color and text
  const getActionDisplay = () => {
    switch (currentAction) {
      case 'ban':
        return { text: 'BAN', color: 'error.main', bgcolor: 'error.dark' };
      case 'pick':
        return { text: 'PICK', color: 'success.main', bgcolor: 'success.dark' };
      case 'side_pick':
        return { text: 'PICK SIDE', color: 'info.main', bgcolor: 'info.dark' };
      default:
        return { text: 'SELECT', color: 'primary.main', bgcolor: 'primary.dark' };
    }
  };

  const actionDisplay = getActionDisplay();

  // Show ALL maps, not just available ones (banned maps will be faded)
  const mapsToShow = CS2_MAPS;

  return (
    <Box>
      {/* Match Header */}
      <Paper elevation={2} sx={{ mb: 3, p: 3, bgcolor: 'background.paper' }}>
        <Box display="flex" alignItems="center" justifyContent="center" gap={3}>
          <Typography variant="h4" fontWeight={700} color="primary">
            {team1Name}
          </Typography>
          <Typography variant="h3" fontWeight={300} color="text.secondary">
            VS
          </Typography>
          <Typography variant="h4" fontWeight={700} color="error">
            {team2Name}
          </Typography>
        </Box>
        <Typography variant="body2" textAlign="center" color="text.secondary" mt={1}>
          Best of {vetoState.format === 'bo1' ? '1' : vetoState.format === 'bo3' ? '3' : '5'}
        </Typography>
      </Paper>

      {/* Progress Header */}
      <Paper elevation={3} sx={{ mb: 3, p: 3, bgcolor: actionDisplay.bgcolor }}>
        <Stack spacing={2}>
          <Box display="flex" justifyContent="space-between" alignItems="center">
            <Typography variant="h4" fontWeight={700} color="white">
              {currentTeamName}: {actionDisplay.text} A MAP
            </Typography>
            <Chip
              label={`Step ${vetoState.currentStep} of ${vetoState.totalSteps}`}
              sx={{
                bgcolor: 'rgba(255,255,255,0.2)',
                color: 'white',
                fontWeight: 600,
              }}
            />
          </Box>

          <LinearProgress
            variant="determinate"
            value={(vetoState.currentStep / vetoState.totalSteps) * 100}
            sx={{
              height: 8,
              borderRadius: 4,
              bgcolor: 'rgba(255,255,255,0.2)',
              '& .MuiLinearProgress-bar': {
                bgcolor: 'white',
              },
            }}
          />

          <Typography variant="body1" color="white">
            {isMyTurn 
              ? `Your turn to ${currentAction === 'ban' ? 'ban' : currentAction === 'pick' ? 'pick' : 'choose starting side on'} a map` 
              : `Waiting for ${currentTeamName} to ${currentAction === 'ban' ? 'ban' : currentAction === 'pick' ? 'pick' : 'choose starting side on'} a map...`
            }
          </Typography>
        </Stack>
      </Paper>

      {/* Side Picker (for side_pick actions) */}
      {currentAction === 'side_pick' && (
        <Card sx={{ mb: 3 }}>
          <CardContent>
            <Typography variant="h6" fontWeight={600} mb={2} textAlign="center">
              Choose Your Starting Side
            </Typography>
            <Typography variant="body2" color="text.secondary" mb={3} textAlign="center">
              Select which side you want to start on for{' '}
              {getMapData(vetoState.pickedMaps[vetoState.pickedMaps.length - 1]?.mapName)
                ?.displayName || 'the map'}
            </Typography>
            {!isMyTurn && (
              <Alert severity="info" sx={{ mb: 2 }}>
                Waiting for {currentTeamName} to choose their starting side...
              </Alert>
            )}
            <Grid container spacing={2}>
              <Grid size={{ xs: 6 }}>
                <Button
                  fullWidth
                  variant="contained"
                  color="info"
                  size="large"
                  onClick={() => handleSidePick('CT')}
                  disabled={!isMyTurn}
                  sx={{ py: 2, fontSize: '1.2rem', fontWeight: 700 }}
                >
                  Counter-Terrorist (CT)
                </Button>
              </Grid>
              <Grid size={{ xs: 6 }}>
                <Button
                  fullWidth
                  variant="contained"
                  color="warning"
                  size="large"
                  onClick={() => handleSidePick('T')}
                  disabled={!isMyTurn}
                  sx={{ py: 2, fontSize: '1.2rem', fontWeight: 700 }}
                >
                  Terrorist (T)
                </Button>
              </Grid>
            </Grid>
          </CardContent>
        </Card>
      )}

      {/* Map Grid */}
      {currentAction !== 'side_pick' && (
        <Grid container spacing={2}>
          {mapsToShow.map((map) => {
            const mapState = vetoState.bannedMaps.includes(map.name)
              ? 'banned'
              : vetoState.pickedMaps.find((p) => p.mapName === map.name)
              ? 'picked'
              : 'available';

            const pickedMap = vetoState.pickedMaps.find((p) => p.mapName === map.name);

            return (
              <Grid size={{ xs: 12, sm: 6, md: 3 }} key={map.name}>
                <VetoMapCard
                  mapName={map.name}
                  displayName={map.displayName}
                  imageUrl={map.image}
                  state={mapState}
                  mapNumber={pickedMap?.mapNumber}
                  side={pickedMap?.sideTeam1}
                  onClick={() => handleMapAction(map.name)}
                  disabled={mapState !== 'available' || !isMyTurn}
                />
              </Grid>
            );
          })}
        </Grid>
      )}

      {/* Veto History */}
      {vetoState.actions.length > 0 && (
        <Card sx={{ mt: 3 }}>
          <CardContent>
            <Typography variant="h6" fontWeight={600} mb={2}>
              Veto History
            </Typography>
            <Stack spacing={1}>
              {vetoState.actions.map((action, idx) => (
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
                    <strong>Step {action.step}:</strong> {action.team === 'team1' ? team1Name : team2Name}{' '}
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
                    {getMapData(action.mapName)?.displayName || action.mapName}
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

