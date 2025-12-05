import React, { useState, useEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';
import {
  Box,
  Card,
  CardContent,
  Typography,
  Alert,
  CircularProgress,
  Container,
  Stack,
} from '@mui/material';
import SportsEsportsIcon from '@mui/icons-material/SportsEsports';
import { soundNotification } from '../utils/soundNotification';
import { TeamHeader } from '../components/team/TeamHeader';
import { PlayerRosterCard } from '../components/team/PlayerRosterCard';
import { SoundSettingsModal } from '../components/modals/SoundSettingsModal';
import { MatchInfoCard } from '../components/team/MatchInfoCard';
import { TeamStatsCard } from '../components/team/TeamStatsCard';
import { TeamMatchHistoryCard } from '../components/team/TeamMatchHistory';
import { useTeamMatchData } from '../hooks/useTeamMatchData';
import { useTournamentStatus } from '../hooks/useTournamentStatus';
import { useSoundSettings } from '../hooks/useSoundSettings';
import type { Team } from '../types';

function TeamSoundControls({ team }: { team: Team | null }) {
  const [showSettings, setShowSettings] = useState(false);
  const {
    isMuted,
    volume,
    soundFile,
    toggleMute,
    handleVolumeChange,
    handlePreviewSound,
    handleSoundChange,
  } = useSoundSettings();

  return (
    <>
      <TeamHeader
        team={team}
        isMuted={isMuted}
        onToggleMute={toggleMute}
        onToggleSettings={() => setShowSettings(true)}
      />
      <SoundSettingsModal
        open={showSettings}
        onClose={() => setShowSettings(false)}
        volume={volume}
        soundFile={soundFile}
        onVolumeChange={handleVolumeChange}
        onSoundChange={handleSoundChange}
        onPreviewSound={handlePreviewSound}
      />
    </>
  );
}

export default function TeamMatch() {
  const { teamId } = useParams<{ teamId: string }>();

  const previousMatchStatus = useRef<string | null>(null);
  const previousVetoReady = useRef<boolean>(false);
  const previousServerReady = useRef<boolean>(false);

  // Custom hooks for data and sound
  const {
    team,
    match,
    hasMatch,
    matchHistory,
    stats,
    standing,
    loading,
    error,
    tournamentStatus,
    loadTeamMatch,
  } = useTeamMatchData(teamId);
  const { tournament } = useTournamentStatus();
  const tournamentName = tournament?.name ?? null;

  // Get match format from match data (fallback to 'bo1' if not available)
  const matchFormat = (match?.matchFormat as 'bo1' | 'bo3' | 'bo5') || 'bo1';

  // Derive veto completion status from match data
  const vetoCompleted = match?.veto?.status === 'completed';

  // Set dynamic page title
  useEffect(() => {
    if (team?.name) {
      document.title = team.name;
    } else {
      document.title = 'Team Page';
    }
  }, [team]);

  // Sound notification when match becomes ready or veto starts
  useEffect(() => {
    if (!match) return;

    const isEligibleFormat = ['bo1', 'bo3', 'bo5'].includes(matchFormat);

    const vetoReady =
      tournamentStatus === 'in_progress' &&
      match.status === 'pending' &&
      !vetoCompleted &&
      isEligibleFormat &&
      match.veto?.status !== 'completed';

    const serverReady =
      Boolean(match.server) && (match.status === 'loaded' || match.status === 'live');

    if (vetoReady && !previousVetoReady.current) {
      soundNotification.playNotification();
      console.log('Notification: Veto is now available!');
    }

    if (serverReady && !previousServerReady.current) {
      soundNotification.playNotification();
      console.log('Notification: Server is ready, players can connect!');
    }

    previousMatchStatus.current = match.status;
    previousVetoReady.current = vetoReady;
    previousServerReady.current = serverReady;
  }, [match, tournamentStatus, vetoCompleted, matchFormat]);

  // Check if match format is in veto debug info
  useEffect(() => {
    if (match) {
      console.log('Veto Debug Info:', {
        tournamentStatus,
        matchStatus: match.status,
        matchFormat,
        vetoCompleted,
        vetoStatus: match.veto?.status,
        shouldShowVeto:
          tournamentStatus === 'in_progress' &&
          match.status === 'pending' &&
          !vetoCompleted &&
          match.veto?.status !== 'completed' &&
          ['bo1', 'bo3', 'bo5'].includes(matchFormat),
        shouldShowMatch:
          ['loaded', 'live'].includes(match.status) ||
          (match.status === 'ready' && (vetoCompleted || match.veto?.status === 'completed')) ||
          (match.status === 'pending' && match.veto?.status === 'completed'),
      });
    }
  }, [match, tournamentStatus, matchFormat, vetoCompleted]);

  const handleVetoComplete = async () => {
    // Reload match data to get updated status and server assignment
    setTimeout(() => {
      loadTeamMatch();
    }, 1000);
  };

  // No polling needed - rely on websockets for server assignment updates
  // The backend will poll for available servers and emit updates via websockets

  const getRoundLabel = (round: number) => {
    if (round === 1) return 'Round 1';
    if (round === 2) return 'Round 2';
    if (round === 3) return 'Quarterfinals';
    if (round === 4) return 'Semifinals';
    if (round === 5) return 'Finals';
    return `Round ${round}`;
  };

  // Loading state
  if (loading) {
    return (
      <Box
        minHeight="100vh"
        display="flex"
        alignItems="center"
        justifyContent="center"
        bgcolor="background.default"
      >
        <CircularProgress />
      </Box>
    );
  }

  // Error state
  if (error) {
    return (
      <Box minHeight="100vh" bgcolor="background.default" py={6}>
        <Container maxWidth="md">
          <Alert severity="error">{error}</Alert>
        </Container>
      </Box>
    );
  }

  // No match state
  if (!hasMatch) {
    return (
      <Box minHeight="100vh" bgcolor="background.default" py={6}>
        <Container maxWidth="md">
          <Stack spacing={3}>
            <TeamSoundControls team={team} />

            <PlayerRosterCard team={team} />

            <Card>
              <CardContent sx={{ textAlign: 'center', py: 6 }}>
                <SportsEsportsIcon sx={{ fontSize: 80, color: 'text.secondary', mb: 2 }} />
                <Typography variant="body1" color="text.secondary" mt={2}>
                  No matches available right now
                </Typography>
                <Typography variant="body2" color="text.secondary" mt={1}>
                  Keep this page open to receive notifications when your match is ready
                </Typography>
              </CardContent>
            </Card>

            <TeamStatsCard stats={stats} standing={standing} />
            <TeamMatchHistoryCard matchHistory={matchHistory} />
          </Stack>
        </Container>
      </Box>
    );
  }

  // Active match state
  return (
    <Box minHeight="100vh" bgcolor="background.default" py={6}>
      <Container maxWidth="md">
        <Stack spacing={3}>
          {tournamentName && (
            <Typography
              component="h1"
              variant="h3"
              fontWeight={800}
              textAlign="center"
              color="text.primary"
            >
              {tournamentName}
            </Typography>
          )}
          <TeamSoundControls team={team} />

          {match && (
            <MatchInfoCard
              match={match}
              team={team}
              tournamentStatus={tournamentStatus}
              vetoCompleted={vetoCompleted}
              matchFormat={matchFormat}
              onVetoComplete={handleVetoComplete}
              getRoundLabel={getRoundLabel}
            />
          )}

          <PlayerRosterCard team={team} />

          <TeamStatsCard stats={stats} standing={standing} />
          <TeamMatchHistoryCard matchHistory={matchHistory} teamId={teamId} />
        </Stack>
      </Container>
    </Box>
  );
}
