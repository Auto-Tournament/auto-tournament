import React, { useState } from 'react';
import {
  Box,
  Card,
  CardContent,
  Typography,
  Button,
  Chip,
  Stack,
  Alert,
  Divider,
  Paper,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableRow,
} from '@mui/material';
import SportsEsportsIcon from '@mui/icons-material/SportsEsports';
import StorageIcon from '@mui/icons-material/Storage';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CancelIcon from '@mui/icons-material/Cancel';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import PeopleIcon from '@mui/icons-material/People';
import { getStatusColor, getStatusLabel } from '../../utils/matchUtils';
import { getMapDisplayName, getMapData } from '../../constants/maps';
import { VetoInterface } from '../veto/VetoInterface';
import type { Team, TeamMatchInfo, VetoState } from '../../types';

interface MatchInfoCardProps {
  match: TeamMatchInfo;
  team: Team | null;
  tournamentStatus: string;
  vetoCompleted: boolean;
  matchFormat: 'bo1' | 'bo3' | 'bo5';
  onVetoComplete: (veto: VetoState) => void;
  getRoundLabel: (round: number) => string;
}

// Helper function to determine map status
const getMapStatus = (
  mapIndex: number,
  totalMaps: number,
  matchStatus: string
): 'won' | 'lost' | 'ongoing' | 'upcoming' => {
  // TODO: Replace with actual map results when available
  // For now, show first map as ongoing if match is live or loaded
  if ((matchStatus === 'live' || matchStatus === 'loaded') && mapIndex === 0) return 'ongoing';
  return 'upcoming';
};

// Helper function to get map chip styling
const getMapChipStyle = (status: 'won' | 'lost' | 'ongoing' | 'upcoming') => {
  switch (status) {
    case 'won':
      return {
        bgcolor: 'success.main',
        color: 'success.contrastText',
        icon: <CheckCircleIcon fontSize="small" />,
      };
    case 'lost':
      return {
        bgcolor: 'error.main',
        color: 'error.contrastText',
        icon: <CancelIcon fontSize="small" />,
      };
    case 'ongoing':
      return {
        bgcolor: 'secondary.main',
        color: 'secondary.contrastText',
        icon: <PlayArrowIcon fontSize="small" />,
      };
    case 'upcoming':
      return {
        bgcolor: 'action.selected',
        color: 'text.secondary',
        icon: null,
      };
  }
};

export function MatchInfoCard({
  match,
  team,
  tournamentStatus,
  vetoCompleted,
  matchFormat,
  onVetoComplete,
  getRoundLabel,
}: MatchInfoCardProps) {
  const [copied, setCopied] = useState(false);
  const [connected, setConnected] = useState(false);

  // Get current map being played (first map for now)
  const currentMap = match.maps.length > 0 ? match.maps[0] : null;
  const currentMapData = currentMap ? getMapData(currentMap) : null;

  const handleConnect = () => {
    if (!match.server) return;
    if (match.server.password) {
      window.location.href = `steam://connect/${match.server.host}:${match.server.port}/${match.server.password}`;
    } else {
      window.location.href = `steam://connect/${match.server.host}:${match.server.port}`;
    }
    setConnected(true);
    setTimeout(() => setConnected(false), 3000);
  };

  const handleCopyIP = () => {
    if (!match.server) return;
    const connectCommand = `connect ${match.server.host}:${match.server.port}${
      match.server.password ? `; password ${match.server.password}` : ''
    }`;
    navigator.clipboard.writeText(connectCommand);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Tournament Not Started - waiting for tournament to start
  if (
    tournamentStatus !== 'in_progress' &&
    match.status === 'pending' &&
    ['bo1', 'bo3', 'bo5'].includes(matchFormat)
  ) {
    return (
      <Card>
        <CardContent>
          <Alert severity="warning">
            <Typography variant="body1" fontWeight={600} gutterBottom>
              ⏳ Waiting for Tournament to Start
            </Typography>
            <Typography variant="body2">
              Your match is ready, but the tournament hasn't started yet. The map veto will become
              available once the tournament administrator starts the tournament.
            </Typography>
            {tournamentStatus === 'setup' && (
              <Typography variant="caption" display="block" mt={1}>
                Tournament Status: Setup Phase
              </Typography>
            )}
          </Alert>
        </CardContent>
      </Card>
    );
  }

  // Veto Phase - tournament started, show veto interface
  if (
    tournamentStatus === 'in_progress' &&
    match.status === 'pending' &&
    !vetoCompleted &&
    ['bo1', 'bo3', 'bo5'].includes(matchFormat)
  ) {
    return (
      <Card>
        <CardContent>
          <Typography variant="h5" fontWeight={600} mb={3}>
            🗺️ Map Selection
          </Typography>
          <Alert severity="info" sx={{ mb: 3 }}>
            <Typography variant="body2">
              <strong>Tournament has started!</strong> Complete the map veto process to begin your
              match.
            </Typography>
          </Alert>
          <VetoInterface
            matchSlug={match.slug}
            team1Name={match.team1?.name}
            team2Name={match.team2?.name}
            currentTeamSlug={team?.id}
            onComplete={onVetoComplete}
          />
        </CardContent>
      </Card>
    );
  }

  // Active Match - show full match details
  if (['loaded', 'live'].includes(match.status) || (match.status === 'ready' && vetoCompleted)) {
    return (
      <Card>
        <CardContent>
          <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
            <Box>
              <Typography variant="h5" fontWeight={600}>
                Match #{match.matchNumber}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {getRoundLabel(match.round)}
              </Typography>
            </Box>
            <Chip
              label={getStatusLabel(match.status)}
              color={getStatusColor(match.status)}
              sx={{ fontWeight: 600, fontSize: '0.9rem', px: 2 }}
            />
          </Box>

          {/* VS Display */}
          <Paper
            variant="outlined"
            sx={{
              p: 4,
              mb: 3,
              background: 'linear-gradient(135deg, rgba(0,0,0,0.02) 0%, rgba(0,0,0,0.05) 100%)',
            }}
          >
            <Box display="flex" justifyContent="space-between" alignItems="center">
              <Box textAlign="center" flex={1}>
                <Typography variant="h4" fontWeight={700} color="primary.main" gutterBottom>
                  {team?.name}
                </Typography>
              </Box>
              <Typography variant="h3" color="text.secondary" fontWeight={700} mx={3}>
                VS
              </Typography>
              <Box textAlign="center" flex={1}>
                <Typography variant="h4" fontWeight={700} color="error.main" gutterBottom>
                  {match.opponent?.name || 'TBD'}
                </Typography>
              </Box>
            </Box>
          </Paper>

          {/* Map Image Display with Server Info */}
          {match.server && currentMapData && (
            <Box
              sx={{
                position: 'relative',
                width: '100%',
                height: 180,
                mb: 2,
                borderRadius: 2,
                overflow: 'hidden',
              }}
            >
              <Box
                component="img"
                src={currentMapData.image}
                alt={currentMapData.displayName}
                sx={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover',
                  filter: 'brightness(0.4)',
                }}
              />
              <Box
                sx={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: 'linear-gradient(to bottom, rgba(0,0,0,0.3), rgba(0,0,0,0.5))',
                }}
              >
                <Typography
                  variant="h3"
                  sx={{
                    fontWeight: 700,
                    color: 'white',
                    textShadow: '2px 2px 8px rgba(0,0,0,0.8)',
                  }}
                >
                  {currentMapData.displayName}
                </Typography>
              </Box>

              {/* Server Info Overlay - Bottom Right */}
              <Box
                sx={{
                  position: 'absolute',
                  bottom: 8,
                  right: 12,
                  textAlign: 'right',
                }}
              >
                <Typography
                  variant="caption"
                  sx={{
                    color: 'rgba(255, 255, 255, 0.6)',
                    fontSize: '0.7rem',
                    display: 'block',
                    textShadow: '1px 1px 3px rgba(0,0,0,0.8)',
                  }}
                >
                  {match.server.name}
                </Typography>
                <Typography
                  variant="caption"
                  sx={{
                    color: 'rgba(255, 255, 255, 0.6)',
                    fontSize: '0.7rem',
                    fontFamily: 'monospace',
                    textShadow: '1px 1px 3px rgba(0,0,0,0.8)',
                  }}
                >
                  {match.server.host}:{match.server.port}
                </Typography>
              </Box>
            </Box>
          )}

          {/* Connect Buttons */}
          {match.server ? (
            <Stack spacing={2} mb={3}>
              <Button
                variant="contained"
                size="large"
                fullWidth
                color={connected ? 'success' : 'primary'}
                startIcon={<SportsEsportsIcon />}
                onClick={handleConnect}
                sx={{ py: 1.5 }}
              >
                {connected ? '✓ Connecting...' : 'Connect to Server'}
              </Button>

              <Button
                variant="outlined"
                size="small"
                fullWidth
                startIcon={copied ? null : <ContentCopyIcon />}
                onClick={handleCopyIP}
              >
                {copied ? '✓ Copied!' : 'Copy Console Command'}
              </Button>
            </Stack>
          ) : (
            <Alert severity="info" sx={{ mb: 3 }}>
              Server will be assigned when the match is ready. Please check back soon.
            </Alert>
          )}

          {/* Players Accordion */}
          <Accordion sx={{ mb: 3 }}>
            <AccordionSummary expandIcon={<ExpandMoreIcon />}>
              <Box display="flex" alignItems="center" gap={1}>
                <PeopleIcon color="primary" />
                <Typography variant="h6" fontWeight={600}>
                  Players
                </Typography>
              </Box>
            </AccordionSummary>
            <AccordionDetails>
              <TableContainer>
                <Table size="small">
                  <TableBody>
                    {/* Calculate max rows needed */}
                    {Array.from({
                      length: Math.max(
                        team?.players?.length || 0,
                        match.config
                          ? (match.isTeam1
                              ? match.config.team2?.players?.length
                              : match.config.team1?.players?.length) || 0
                          : 0
                      ),
                    }).map((_, idx) => (
                      <TableRow key={idx}>
                        <TableCell sx={{ borderBottom: 'none', py: 1 }}>
                          <Typography variant="body2" color="primary.main" fontWeight={500}>
                            {team?.players && team.players[idx] ? team.players[idx].name : '—'}
                          </Typography>
                        </TableCell>
                        <TableCell sx={{ borderBottom: 'none', py: 1, textAlign: 'right' }}>
                          <Typography variant="body2" color="error.main" fontWeight={500}>
                            {match.config &&
                            (match.isTeam1
                              ? match.config.team2?.players
                              : match.config.team1?.players)?.[idx]
                              ? (match.isTeam1
                                  ? match.config.team2?.players
                                  : match.config.team1?.players)?.[idx].name
                              : '—'}
                          </Typography>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            </AccordionDetails>
          </Accordion>

          {/* Map Chips - Bottom Left */}
          {match.maps.length > 0 && (
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
              {match.maps.map((map, idx) => {
                const status = getMapStatus(idx, match.maps.length, match.status);
                const chipStyle = getMapChipStyle(status);
                return (
                  <Chip
                    key={idx}
                    label={`${idx + 1}. ${getMapDisplayName(map)}`}
                    size="medium"
                    icon={chipStyle.icon || undefined}
                    sx={{
                      bgcolor: chipStyle.bgcolor,
                      color: chipStyle.color,
                      fontWeight: 600,
                      '& .MuiChip-icon': {
                        color: chipStyle.color,
                      },
                    }}
                  />
                );
              })}
            </Stack>
          )}
        </CardContent>
      </Card>
    );
  }

  return null;
}
