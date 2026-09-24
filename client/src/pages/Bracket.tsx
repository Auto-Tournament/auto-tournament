import { pageTitle } from '../utils/pageTitle';
import { useState, useEffect, useRef } from 'react';
import {
  Box,
  Typography,
  CircularProgress,
  Alert,
  Button,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  IconButton,
  Chip,
  Tooltip,
} from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import EmojiEventsIcon from '@mui/icons-material/EmojiEvents';
import AddIcon from '@mui/icons-material/Add';
import ViewListIcon from '@mui/icons-material/ViewList';
import AccountTreeOutlinedIcon from '@mui/icons-material/AccountTreeOutlined';
import FullscreenIcon from '@mui/icons-material/Fullscreen';
import FullscreenExitIcon from '@mui/icons-material/FullscreenExit';
import { useNavigate } from 'react-router-dom';
import { tournamentTabPath } from '../paths';
import BracketsViewerVisualization from '../components/visualizations/BracketsViewerVisualization';
import SwissView from '../components/visualizations/SwissView';
import MatchDetailsModal from '../components/modals/MatchDetailsModal';
import { EmptyState } from '../components/shared/EmptyState';
import { MatchListCard } from '../components/shared/MatchListCard';
import { RoundStatusCard } from '../components/tournament/RoundStatusCard';
import { ChampionBanner } from '../components/tournament/ChampionBanner';
import { getGlobalMatchNumber as globalMatchNumber, getRoundLabel } from '../utils/matchUtils';
import { useBracket } from '../hooks/useBracket';
import { useResourceAvailability } from '../hooks/useResourceAvailability';
import { useIntegrationFor } from '../integrations/registry';
import { api } from '../utils/api';
import { StartTournamentButton } from '../components/dashboard';
import type { Match } from '../types';
import { useTranslation } from 'react-i18next';
import { PageHead, Panel, RowList, SectionHead } from '../components/common/ui';

// Interfaces are now imported from useBracket hook

export default function Bracket() {
  const navigate = useNavigate();
  const {
    loading,
    error,
    tournament,
    matches,
    totalRounds,
    swissStandings,
    roundRobinStandings,
    // starting handled by StartTournamentButton
    loadBracket,
  } = useBracket();

  // What the waiting matches are waiting for is the game's answer, not the
  // bracket's: CS2 matches wait for a free server and for the next allocation
  // pass, and a game with no resources has neither (3.0 phase E). The core
  // asks the route the module named, once, and hands the numbers to its
  // banner; nothing here knows what a server is.
  const resolved = useIntegrationFor(tournament);
  const integration = tournament ? resolved : null;
  const MatchQueueBanner = integration?.matchQueueBanner;
  const MatchQueueChip = integration?.matchQueueChip;
  const { availability: resourceAvailability, nextInSeconds: nextAllocationInSeconds } =
    useResourceAvailability(integration, 30000);

  const [viewMode, setViewMode] = useState<'visual' | 'list'>('visual');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [selectedMatchId, setSelectedMatchId] = useState<number | null>(null);
  const [selectedMatchOverride, setSelectedMatchOverride] = useState<Match | null>(null);
  const [roundStatus, setRoundStatus] = useState<{
    roundNumber: number;
    totalMatches: number;
    completedMatches: number;
    pendingMatches: number;
    isComplete: boolean;
    map: string;
  } | null>(null);
  const [shuffleTotalRounds, setShuffleTotalRounds] = useState<number | null>(null);
  const fullscreenRef = useRef<globalThis.HTMLDivElement>(null);
  const selectedMatchIdRef = useRef<number | null>(null);
  const { t } = useTranslation();

  // Derive the current match from matches array (keeps status/score in sync with
  // live websocket updates), and optionally merge in richer fields (e.g.
  // mapResults) from a one-time /api/matches/:slug fetch without freezing the
  // match in time. We always let the live bracket state "win" for core fields
  // like status and scores to avoid stale data in the modal.
  const baseSelectedMatch = selectedMatchId
    ? matches.find((m) => m.id === selectedMatchId) || null
    : null;
  const selectedMatch: Match | null =
    baseSelectedMatch && selectedMatchOverride
      ? { ...selectedMatchOverride, ...baseSelectedMatch }
      : baseSelectedMatch ?? null;

  // Load round status for shuffle tournaments
  useEffect(() => {
    if (tournament?.type === 'shuffle' && tournament?.id) {
      const loadRoundStatus = async () => {
        try {
          const response = await api.get<{
            success: boolean;
            roundStatus?: {
              roundNumber: number;
              totalMatches: number;
              completedMatches: number;
              pendingMatches: number;
              isComplete: boolean;
              map: string;
            };
            totalRounds?: number;
            currentRound?: number;
          }>(`/api/tournament/${tournament.id}/round-status`);

          if (response.success && response.roundStatus) {
            setRoundStatus(response.roundStatus);
            // Prefer backend-provided totalRounds; fall back to map sequence length
            if (typeof response.totalRounds === 'number') {
              setShuffleTotalRounds(response.totalRounds);
            } else if (Array.isArray(tournament.mapSequence)) {
              setShuffleTotalRounds(tournament.mapSequence.length);
            } else if (Array.isArray(tournament.maps)) {
              setShuffleTotalRounds(tournament.maps.length);
            }
          }
        } catch (err) {
          console.error('Failed to load round status:', err);
        }
      };

      loadRoundStatus();

      // Refresh round status every 30 seconds
      const interval = setInterval(() => {
        void loadRoundStatus();
      }, 30000);
      return () => clearInterval(interval);
    }
    // Non-shuffle or no tournament:
    // We intentionally do not reset shuffle-specific state here; guards below ensure
    // it is only used when the current tournament is a shuffle tournament.
  }, [tournament?.type, tournament?.id, tournament?.mapSequence, tournament?.maps]);


  // Set dynamic page title
  useEffect(() => {
    document.title = pageTitle(t('layout.pageTitle.bracket'));
  }, [t]);

  // For shuffle tournaments, we always render the list view (no visual bracket).
  const effectiveViewMode: 'visual' | 'list' = tournament?.type === 'shuffle' ? 'list' : viewMode;

  // Chronological numbering across upper/lower brackets (see compareMatchOrder).
  const getGlobalMatchNumber = (match: Match): number => globalMatchNumber(match, matches);

  const handleMatchClick = async (match: Match) => {
    if (!match.team1 || !match.team2) {
      return;
    }
    setSelectedMatchId(match.id);
    selectedMatchIdRef.current = match.id;
    setSelectedMatchOverride(null);

    // Bracket matches often only have series score; load full details (including
    // mapResults) so the modal can show correct per-map rounds even when opened
    // from the bracket list view.
    try {
      const response = await api.get<{ success: boolean; match: Match }>(
        `/api/matches/${match.slug}`
      );
      if (!response?.success || !response.match) {
        return;
      }
      setSelectedMatchOverride((currentOverride) => {
        // Only override if this match is still the selected one; if the user
        // clicked a different match while this request was in flight, keep the
        // newer selection.
        if (selectedMatchIdRef.current !== match.id) {
          return currentOverride;
        }
        return response.match;
      });
    } catch (err) {
      console.error('Failed to load full match details for bracket modal:', err);
    }
  };

  const handleCloseMatchModal = () => {
    setSelectedMatchId(null);
    selectedMatchIdRef.current = null;
    setSelectedMatchOverride(null);
  };

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!globalThis.document.fullscreenElement);
    };

    globalThis.document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () =>
      globalThis.document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  const toggleFullscreen = async () => {
    if (!fullscreenRef.current) return;

    try {
      if (!globalThis.document.fullscreenElement) {
        await fullscreenRef.current.requestFullscreen();
      } else {
        await globalThis.document.exitFullscreen();
      }
    } catch (err) {
      console.error('Error toggling fullscreen:', err);
    }
  };

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="80vh">
        <CircularProgress />
      </Box>
    );
  }

  // The states below have no tournament header of their own.
  const pageHead = <PageHead title={t('layout.pageTitle.bracket')} />;

  if (error) {
    return (
      <Box sx={{ width: '100%', height: '100%' }}>
        {pageHead}
        <Alert severity="error">{error}</Alert>
      </Box>
    );
  }

  if (!tournament) {
    return (
      <Box>
        {pageHead}
        <EmptyState
          icon={AccountTreeOutlinedIcon}
          title={t('bracket.empty.noBracketTitle')}
          description={t('bracket.empty.noBracketDescription')}
          actionLabel={t('tournament.common.createTournament')}
          actionIcon={AddIcon}
          onAction={() => navigate('/tournament')}
        />
      </Box>
    );
  }

  // Special-case: Shuffle tournaments don't use a traditional bracket
  if (tournament.type === 'shuffle' && !matches.length) {
    return (
      <Box sx={{ width: '100%', height: '100%' }}>
        {pageHead}
        <Panel data-testid="bracket-empty-state" sx={{ textAlign: 'center', py: 8, px: 3 }}>
          <EmojiEventsIcon sx={{ fontSize: 80, color: 'text.secondary', mb: 2 }} />
          <Typography variant="h6" color="text.secondary" gutterBottom>
            {t('bracket.shuffleEmpty.title')}
          </Typography>
          <Typography variant="body2" color="text.secondary" mb={2}>
            {t('bracket.shuffleEmpty.description')}
          </Typography>
          <Typography variant="body2" color="text.secondary" mb={3}>
            {t('bracket.shuffleEmpty.hint')}
          </Typography>
          <Stack direction="row" spacing={2} justifyContent="center">
            <Button variant="contained" onClick={() => navigate('/matches')}>
              {t('bracket.shuffleEmpty.goToMatches')}
            </Button>
            <Button
              variant="outlined"
              onClick={() => navigate(`/tournament/${tournament.id}/leaderboard`)}
            >
              {t('bracket.shuffleEmpty.viewLeaderboard')}
            </Button>
          </Stack>
        </Panel>
      </Box>
    );
  }

  if (!matches.length) {
    return (
      <Box sx={{ width: '100%', height: '100%' }}>
        {pageHead}
        <Panel data-testid="bracket-empty-state" sx={{ textAlign: 'center', py: 8, px: 3 }}>
          <EmojiEventsIcon sx={{ fontSize: 80, color: 'text.secondary', mb: 2 }} />
          <Typography variant="h6" color="text.secondary" gutterBottom>
            {t('bracket.notGenerated.title')}
          </Typography>
          <Typography variant="body2" color="text.secondary" mb={3}>
            {t('bracket.notGenerated.description', { name: tournament.name })}
          </Typography>
          <Button variant="contained" onClick={() => navigate('/tournament')}>
            {t('bracket.notGenerated.goToSettings')}
          </Button>
        </Panel>
      </Box>
    );
  }

  // Group matches by round
  const matchesByRound: { [round: number]: Match[] } = {};
  matches.forEach((match) => {
    if (!matchesByRound[match.round]) {
      matchesByRound[match.round] = [];
    }
    matchesByRound[match.round].push(match);
  });

  // For shuffle tournaments, prefer shuffleTotalRounds; fall back to max round present
  const effectiveTotalRounds =
    tournament.type === 'shuffle'
      ? shuffleTotalRounds ??
        (Object.keys(matchesByRound).length
          ? Math.max(...Object.keys(matchesByRound).map((r) => Number(r)))
          : 0)
      : totalRounds;

  const getBracketRoundLabel = (round: number): string => {
    if (tournament.type === 'shuffle') {
      return getRoundLabel(round);
    }
    return getRoundLabel(round, effectiveTotalRounds);
  };

  const getRoundMapLabel = (round: number): string | null => {
    if (tournament.type !== 'shuffle') {
      return null;
    }

    const sequence =
      (Array.isArray(tournament.mapSequence) && tournament.mapSequence.length > 0
        ? tournament.mapSequence
        : tournament.maps) || [];

    if (!sequence.length) {
      return null;
    }

    const mapName = sequence[round - 1];
    return mapName || null;
  };

  // For shuffle tournaments, keep using the backend-provided round metadata
  // (current round number + map), but recompute completed/pending counts from
  // the live matches array so "Match Progress" and chip breakdown update
  // in real time.
  const liveRoundStatus =
    tournament.type === 'shuffle' && roundStatus
      ? (() => {
          const activeRound = roundStatus.roundNumber;
          const matchesInRound = matches.filter((m) => m.round === activeRound);
          const totalMatchesForRound =
            matchesInRound.length > 0 ? matchesInRound.length : roundStatus.totalMatches;
          const completedMatchesForRound = matchesInRound.filter(
            (m) => m.status === 'completed'
          ).length;

          // Split non‑completed matches into "playing" (loaded/live) vs "pending"
          // (pending/ready/waiting for server).
          const playingMatchesForRound = matchesInRound.filter(
            (m) => m.status === 'live' || m.status === 'loaded'
          ).length;
          const pendingMatchesForRound =
            totalMatchesForRound > 0
              ? totalMatchesForRound - completedMatchesForRound - playingMatchesForRound
              : roundStatus.pendingMatches;
          const isCompleteForRound =
            totalMatchesForRound > 0 && completedMatchesForRound === totalMatchesForRound;

          return {
            ...roundStatus,
            totalMatches: totalMatchesForRound,
            completedMatches: completedMatchesForRound,
            pendingMatches: pendingMatchesForRound,
            isComplete: isCompleteForRound,
            playingMatches: playingMatchesForRound,
            waitingMatches: pendingMatchesForRound,
          };
        })()
      : null;

  return (
    <Box
      ref={fullscreenRef}
      data-testid="bracket-page"
      sx={{
        // Opaque only in fullscreen; otherwise the page sits on the body's paper colour.
        bgcolor: isFullscreen ? 'background.default' : 'transparent',
        minHeight: '100vh',
        position: 'relative',
        height: isFullscreen ? '100vh' : 'auto',
        overflow: isFullscreen ? 'hidden' : 'visible',
      }}
    >
      {/* Header - hidden in fullscreen mode */}
      {!isFullscreen && (
        <>
          {/* The page's head (the drafts' `.head`): the tournament on the
              left, the view controls on the right; they wrap under the name
              on a phone. */}
          <PageHead
            data-testid="bracket-tournament-info"
            title={tournament.name}
            subtitle={`${t(`tournament.typeSelector.types.${tournament.type}.label`)} • ${tournament.format.toUpperCase()}`}
            actions={
              <Box display="flex" gap={1} alignItems="center" flexWrap="wrap">
            {tournament.status === 'setup' && (
              <StartTournamentButton variant="contained" size="medium" onSuccess={loadBracket} />
            )}
            <ToggleButtonGroup
              value={effectiveViewMode}
              exclusive
              onChange={(_, newMode) => {
                if (!newMode) return;
                // Shuffle tournaments do not support visual mode
                if (tournament.type === 'shuffle' && newMode === 'visual') return;
                setViewMode(newMode);
              }}
              size="small"
            >
              <Tooltip
                title={
                  tournament.type === 'shuffle'
                    ? t('bracket.view.shuffleNoVisual')
                    : ''
                }
                disableHoverListener={tournament.type !== 'shuffle'}
                enterDelay={500}
              >
                <span>
                  <ToggleButton value="visual" disabled={tournament.type === 'shuffle'}>
                    <AccountTreeOutlinedIcon sx={{ mr: 1 }} fontSize="small" />
                    {t('bracket.view.visual')}
                  </ToggleButton>
                </span>
              </Tooltip>
              <ToggleButton value="list">
                <ViewListIcon sx={{ mr: 1 }} fontSize="small" />
                {t('bracket.view.list')}
              </ToggleButton>
            </ToggleButtonGroup>
            <Button
              variant="outlined"
              startIcon={<RefreshIcon />}
              onClick={loadBracket}
              size="small"
            >
              {t('bracket.view.refresh')}
            </Button>
            <IconButton
              onClick={toggleFullscreen}
              color="primary"
              title={isFullscreen ? t('bracket.view.exitFullscreen') : t('bracket.view.enterFullscreen')}
            >
              {isFullscreen ? <FullscreenExitIcon /> : <FullscreenIcon />}
            </IconButton>
              </Box>
            }
          />
        </>
      )}

      {!isFullscreen && (
        <Box>
          <ChampionBanner tournament={tournament} />
        </Box>
      )}

      {/* What the ready matches are waiting for, in the game's words (CS2:
          a free server, and when the next allocation pass runs). A game whose
          matches wait for nothing fills this with nothing. */}
      {!isFullscreen && MatchQueueBanner && (
        <MatchQueueBanner
          availability={resourceAvailability}
          nextInSeconds={nextAllocationInSeconds}
        />
      )}

      {/* Fullscreen exit button - only visible in fullscreen */}
      {isFullscreen && (
        <IconButton
          onClick={toggleFullscreen}
          sx={{
            position: 'absolute',
            top: 16,
            right: 16,
            zIndex: 1000,
            bgcolor: 'background.surface2',
            backdropFilter: 'blur(10px)',
            color: 'text.primary',
            border: 1,
            borderColor: 'divider',
            '&:hover': {
              bgcolor: 'background.surface2',
              borderColor: 'text.disabled',
            },
          }}
          title={t('bracket.view.exitFullscreen')}
        >
          <FullscreenExitIcon />
        </IconButton>
      )}

      {/* Round Status for Shuffle Tournaments */}
      {tournament.type === 'shuffle' && liveRoundStatus && (
        <RoundStatusCard
          roundStatus={liveRoundStatus}
          totalRounds={shuffleTotalRounds ?? totalRounds}
          isActive={!liveRoundStatus.isComplete}
          queueChip={
            MatchQueueChip ? (
              <MatchQueueChip
                availability={resourceAvailability}
                nextInSeconds={nextAllocationInSeconds}
              />
            ) : null
          }
        />
      )}

      {/* Bracket visualization */}
      {effectiveViewMode === 'visual' ? (
        <Box
          data-testid="bracket-visualization"
          sx={{
            height: isFullscreen ? '100vh' : 'auto',
            pt: 0,
          }}
        >
          {/* Use appropriate visualization based on tournament type */}
          {tournament.type === 'swiss' ? (
            <SwissView
              matches={matches}
              teams={tournament.teams || []}
              standings={swissStandings}
              totalRounds={totalRounds}
              onMatchClick={handleMatchClick}
            />
          ) : tournament.type === 'shuffle' ? (
            // Shuffle tournaments don't have a fixed bracket tree – hide BracketsViewer entirely
            <Box
              sx={{
                py: 6,
                px: 3,
                textAlign: 'center',
              }}
            >
              <Typography variant="h6" gutterBottom>
                {t('bracket.shuffleNoVisual.title')}
              </Typography>
              <Typography variant="body2" color="text.secondary" mb={2}>
                {t('bracket.shuffleNoVisual.description')}
              </Typography>
              <Stack direction="row" spacing={1} justifyContent="center" flexWrap="wrap">
                <Button size="small" variant="outlined" onClick={() => setViewMode('list')}>
                  {t('bracket.shuffleNoVisual.listView')}
                </Button>
                <Button size="small" variant="outlined" onClick={() => navigate('/matches')}>
                  {t('bracket.shuffleNoVisual.matches')}
                </Button>
                <Button
                  size="small"
                  variant="outlined"
                  onClick={() => navigate(tournamentTabPath(tournament.id, 'standings'))}
                >
                  {t('bracket.shuffleNoVisual.standings')}
                </Button>
              </Stack>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
                {t('bracket.shuffleNoVisual.docsHint')}
              </Typography>
            </Box>
          ) : (
            // All bracket-manager types: single_elimination, double_elimination, round_robin
            <BracketsViewerVisualization
              matches={matches}
              tournamentType={tournament.type}
              rankingTeamIds={roundRobinStandings.map((s) => s.teamId)}
              isFullscreen={isFullscreen}
              onMatchClick={handleMatchClick}
            />
          )}
        </Box>
      ) : (
        <Box
          sx={{
            height: isFullscreen ? '100vh' : 'auto',
            pt: isFullscreen ? 2 : 0,
            px: isFullscreen ? 2 : 0,
            overflowY: isFullscreen ? 'auto' : 'visible',
          }}
        >
          {Array.from({ length: effectiveTotalRounds }, (_, i) => i + 1)
            .reverse()
            .map((round) => {
              const roundMatches = matchesByRound[round] || [];
              // Only show matches where both teams are assigned (no TBD placeholders)
              const visibleMatches = roundMatches.filter(
                (match) => match.team1 && match.team2
              );
              if (visibleMatches.length === 0) return null;

              return (
                <Box component="section" key={round} mb={6} aria-labelledby={`bracket-round-${round}`}>
                  <SectionHead
                    id={`bracket-round-${round}`}
                    title={getBracketRoundLabel(round)}
                    action={
                      tournament.type === 'shuffle' && getRoundMapLabel(round) ? (
                        <Chip label={getRoundMapLabel(round)!} size="small" />
                      ) : undefined
                    }
                  />
                  <RowList>
                    {visibleMatches.map((match) => (
                      <MatchListCard
                        key={match.id}
                        match={match}
                        matchNumber={getGlobalMatchNumber(match)}
                        roundLabel={getBracketRoundLabel(round)}
                        scoreDisplayMode="series"
                        onClick={() => handleMatchClick(match)}
                      />
                    ))}
                  </RowList>
                </Box>
              );
            })}
        </Box>
      )}

      {/* Match Details Modal */}
      {selectedMatch && (
        <MatchDetailsModal
          match={selectedMatch}
          matchNumber={getGlobalMatchNumber(selectedMatch)}
          roundLabel={
            tournament.type === 'shuffle'
              ? getRoundLabel(selectedMatch.round)
              : getRoundLabel(selectedMatch.round, totalRounds)
          }
          onClose={handleCloseMatchModal}
        />
      )}
    </Box>
  );
}
