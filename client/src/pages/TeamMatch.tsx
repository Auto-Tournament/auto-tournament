import React, { useState, useEffect } from 'react';
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
  Button,
} from '@mui/material';
import SportsEsportsIcon from '@mui/icons-material/SportsEsports';
import { TeamHeader } from '../components/team/TeamHeader';
import { SoundSettingsModal } from '../components/modals/SoundSettingsModal';
import { MatchInfoCard } from '../components/team/MatchInfoCard';
import { TeamStatsCard } from '../components/team/TeamStatsCard';
import { TeamMatchHistoryCard } from '../components/team/TeamMatchHistory';
import { PlayerRosterCard } from '../components/team/PlayerRosterCard';
import { useTeamMatchData } from '../hooks/useTeamMatchData';
import { useTournamentStatus } from '../hooks/useTournamentStatus';
import { useSoundSettings } from '../hooks/useSoundSettings';
import { TournamentRulesAccordion } from '../components/tournament/TournamentRulesAccordion';
import type { SelectChangeEvent } from '@mui/material';
import type { Team } from '../types';
import type { NotificationSoundValue } from '../utils/soundNotification';
import { MatchNotificationAudio } from '../components/match/MatchNotificationAudio';
import { useAuth } from '../contexts/AuthContext';
import { TopNavBar } from '../components/layout/TopNavBar';

type TeamSoundControlsProps = {
  team: Team | null;
  isMuted: boolean;
  volume: number;
  soundFile: NotificationSoundValue;
  toggleMute: () => void;
  handleVolumeChange: (newValue: number) => void;
  handlePreviewSound: () => void;
  handleSoundChange: (event: SelectChangeEvent<string>) => void;
};

function TeamSoundControls({
  team,
    isMuted,
    volume,
    soundFile,
    toggleMute,
    handleVolumeChange,
    handlePreviewSound,
    handleSoundChange,
}: TeamSoundControlsProps) {
  const [showSettings, setShowSettings] = useState(false);

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
  const {
    isMuted,
    volume,
    soundFile,
    toggleMute,
    handleVolumeChange,
    handlePreviewSound,
    handleSoundChange,
  } = useSoundSettings();
  const { playerSteamId } = useAuth();

  // Get match format from match data (fallback to 'bo1' if not available)
  const matchFormat = (match?.matchFormat as 'bo1' | 'bo3' | 'bo5') || 'bo1';

  // Derive veto completion status from match data.
  // Manual matches (round === 0) never use the team veto UI and should behave
  // as if veto is already completed from the team page's perspective.
  const vetoCompleted =
    match?.round === 0 ? true : match?.veto?.status === 'completed';

  // Set dynamic page title
  useEffect(() => {
    if (team?.name) {
      document.title = team.name;
    } else {
      document.title = 'Team Page';
    }
  }, [team]);

    const isEligibleFormat = ['bo1', 'bo3', 'bo5'].includes(matchFormat);

    const vetoReady =
    !!match &&
      tournamentStatus === 'in_progress' &&
      match.status === 'pending' &&
      !vetoCompleted &&
      isEligibleFormat &&
      match.veto?.status !== 'completed';

    const serverReady =
    !!match && Boolean(match.server) && (match.status === 'loaded' || match.status === 'live');


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
        flexDirection="column"
        bgcolor="background.default"
      >
        <TopNavBar />
        <Box
          flex={1}
          display="flex"
          alignItems="center"
          justifyContent="center"
        >
          <CircularProgress />
        </Box>
      </Box>
    );
  }

  // Error state
  if (error) {
    return (
      <Box minHeight="100vh" bgcolor="background.default">
        <TopNavBar />
        <Container maxWidth="md">
          <Box py={6}>
          <Alert severity="error">{error}</Alert>
          </Box>
        </Container>
      </Box>
    );
  }

  const tournamentIsActive = tournamentStatus === 'in_progress';
  const tournamentIsCompleted = tournamentStatus === 'completed';
  const teamHasPlayed = !!(stats && stats.totalMatches > 0);

  // Tournament rules configuration for the "About this tournament" accordion.
  const rulesFormat = matchFormat;
  const rulesMaxRounds = match?.config?.maxRounds ?? tournament?.maxRounds;
  const rulesOvertimeMode = match?.config?.overtimeMode ?? tournament?.overtimeMode;
  const rulesOvertimeSegments = match?.config?.overtimeSegments ?? tournament?.overtimeSegments;

  // No match state
  if (!hasMatch) {
    return (
      <Box minHeight="100vh" bgcolor="background.default">
        <TopNavBar />
        <Container maxWidth="md">
          <Stack spacing={3} py={6}>
            <MatchNotificationAudio
              vetoReady={vetoReady}
              serverReady={serverReady}
              isMuted={isMuted}
              volume={volume}
              soundFile={soundFile}
            />
            <TeamSoundControls
              team={team}
              isMuted={isMuted}
              volume={volume}
              soundFile={soundFile}
              toggleMute={toggleMute}
              handleVolumeChange={handleVolumeChange}
              handlePreviewSound={handlePreviewSound}
              handleSoundChange={handleSoundChange}
            />

            {playerSteamId && (
              <Card>
                <CardContent sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Typography variant="body2" color="text.secondary">
                    Want to see your own stats and match history?
                  </Typography>
                  <Button
                    size="small"
                    variant="outlined"
                    onClick={() => window.open(`/player/${playerSteamId}`, '_blank')}
                  >
                    Open my player page
                  </Button>
                </CardContent>
              </Card>
            )}

            <TournamentRulesAccordion
              format={rulesFormat}
              maxRounds={rulesMaxRounds}
              overtimeMode={rulesOvertimeMode}
              overtimeSegments={rulesOvertimeSegments}
            />

            <Card>
              <CardContent sx={{ textAlign: 'center', py: 6 }}>
                <SportsEsportsIcon sx={{ fontSize: 80, color: 'text.secondary', mb: 2 }} />
                {tournamentIsCompleted && teamHasPlayed && standing ? (
                  <>
                    <Typography variant="h6" color="text.primary" mt={1} gutterBottom>
                      Tournament finished
                    </Typography>
                    <Typography variant="body1" color="text.secondary" mt={1}>
                      Final placement: #{standing.position} of {standing.totalTeams}
                    </Typography>
                  </>
                ) : tournamentIsActive ? (
                  <>
                    <Typography variant="body1" color="text.secondary" mt={2}>
                      No match scheduled right now
                    </Typography>
                    <Typography variant="body2" color="text.secondary" mt={1}>
                      Your team is still in the tournament. Keep this page open to be notified when
                      the next match is ready.
                    </Typography>
                  </>
                ) : (
                  <>
                    <Typography variant="body1" color="text.secondary" mt={2}>
                      No matches available right now
                    </Typography>
                    <Typography variant="body2" color="text.secondary" mt={1}>
                      The tournament hasn&apos;t started yet. Once it begins, your matches will
                      appear here.
                    </Typography>
                  </>
                )}
              </CardContent>
            </Card>

            <PlayerRosterCard team={team} />

            <TeamStatsCard stats={stats} standing={standing} />
            <TeamMatchHistoryCard matchHistory={matchHistory} teamId={teamId} />
          </Stack>
        </Container>
      </Box>
    );
  }

  // Active match state
  return (
    <Box minHeight="100vh" bgcolor="background.default">
      <TopNavBar />
      <Container maxWidth="md">
        <Box py={6}>
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
          
          <TeamSoundControls
            team={team}
            isMuted={isMuted}
            volume={volume}
            soundFile={soundFile}
            toggleMute={toggleMute}
            handleVolumeChange={handleVolumeChange}
            handlePreviewSound={handlePreviewSound}
            handleSoundChange={handleSoundChange}
          />

          <TournamentRulesAccordion
            format={rulesFormat}
            maxRounds={rulesMaxRounds}
            overtimeMode={rulesOvertimeMode}
            overtimeSegments={rulesOvertimeSegments}
          />

          <MatchNotificationAudio
            vetoReady={vetoReady}
            serverReady={serverReady}
            isMuted={isMuted}
            volume={volume}
            soundFile={soundFile}
          />

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
        </Box>
      </Container>
    </Box>
  );
}
