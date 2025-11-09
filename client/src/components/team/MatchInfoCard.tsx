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
} from '@mui/material';
import SportsEsportsIcon from '@mui/icons-material/SportsEsports';
import StorageIcon from '@mui/icons-material/Storage';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import { getStatusColor, getStatusLabel } from '../../utils/matchUtils';
import { getMapDisplayName } from '../../constants/maps';
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
            <Box display="flex" justifyContent="space-around" alignItems="center">
              <Box textAlign="center" flex={1}>
                <Typography variant="h4" fontWeight={700} color="primary" gutterBottom>
                  {team?.name}
                </Typography>
                {team?.players && team.players.length > 0 && (
                  <Box mt={1}>
                    {team.players.map((player, idx) => (
                      <Typography
                        key={idx}
                        variant="caption"
                        display="block"
                        color="text.secondary"
                      >
                        {player.name}
                      </Typography>
                    ))}
                  </Box>
                )}
              </Box>
              <Typography variant="h3" color="text.secondary" fontWeight={700} mx={3}>
                VS
              </Typography>
              <Box textAlign="center" flex={1}>
                <Typography variant="h4" fontWeight={700} gutterBottom>
                  {match.opponent?.name || 'TBD'}
                </Typography>
                {match.config && (
                  <Box mt={1}>
                    {(match.isTeam1
                      ? match.config.team2?.players
                      : match.config.team1?.players
                    )?.map((player, idx) => (
                      <Typography
                        key={idx}
                        variant="caption"
                        display="block"
                        color="text.secondary"
                      >
                        {player.name}
                      </Typography>
                    ))}
                  </Box>
                )}
              </Box>
            </Box>
          </Paper>

          {/* Server Connection */}
          {match.server ? (
            <>
              <Divider sx={{ my: 3 }} />
              <Box>
                <Box display="flex" alignItems="center" gap={1} mb={2}>
                  <StorageIcon color="primary" />
                  <Typography variant="h6" fontWeight={600}>
                    Server
                  </Typography>
                </Box>

                <Paper variant="outlined" sx={{ p: 3, mb: 2 }}>
                  <Box display="flex" alignItems="center" justifyContent="space-between" mb={2}>
                    <Typography variant="h6" fontWeight={600}>
                      {match.server.name}
                    </Typography>
                  </Box>

                  <Typography
                    variant="h5"
                    fontFamily="monospace"
                    color="primary.main"
                    mb={2}
                    sx={{ fontWeight: 600 }}
                  >
                    {match.server.host}:{match.server.port}
                  </Typography>

                  <Stack spacing={2}>
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
                </Paper>
              </Box>
            </>
          ) : (
            <Alert severity="info" sx={{ mt: 3 }}>
              Server will be assigned when the match is ready. Please check back soon.
            </Alert>
          )}

          {/* Match Details */}
          <Box mb={3}>
            <Typography variant="h6" fontWeight={600} gutterBottom>
              Match Details
            </Typography>
            <Stack spacing={1.5}>
              <Box>
                <Typography variant="body2" color="text.secondary">
                  <strong>Format:</strong> {match.matchFormat}
                </Typography>
              </Box>
              <Box>
                <Typography variant="body2" color="text.secondary" gutterBottom>
                  <strong>Maps:</strong>
                </Typography>
                {match.maps.length > 0 ? (
                  <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                    {match.maps.map((map, idx) => (
                      <Chip
                        key={idx}
                        label={`${idx + 1}. ${getMapDisplayName(map)}`}
                        size="small"
                        color="primary"
                        variant="outlined"
                      />
                    ))}
                  </Stack>
                ) : (
                  <Typography variant="body2" color="text.secondary" fontStyle="italic">
                    To be determined via veto
                  </Typography>
                )}
              </Box>
            </Stack>
          </Box>
        </CardContent>
      </Card>
    );
  }

  return null;
}
