import React from 'react';
import {
  Box,
  Typography,
  Card,
  CardContent,
  Button,
  Chip,
  Alert,
  Grid,
  Tooltip,
  IconButton,
  TextField,
  Stack,
  Divider,
} from '@mui/material';
import VisibilityIcon from '@mui/icons-material/Visibility';
import RestartAltIcon from '@mui/icons-material/RestartAlt';
import DeleteForeverIcon from '@mui/icons-material/DeleteForever';
import EmojiEventsIcon from '@mui/icons-material/EmojiEvents';
import EditIcon from '@mui/icons-material/Edit';
import CheckIcon from '@mui/icons-material/Check';
import CloseIcon from '@mui/icons-material/Close';
import { useTranslation } from 'react-i18next';
import { io } from 'socket.io-client';
import { onSocketReconnect } from '../../utils/socketResync';
import { TOURNAMENT_TYPES, MATCH_FORMATS } from '../../constants/tournament';
import { RestartTournamentButton } from '../dashboard/RestartTournamentButton';
import { ChampionBanner } from './ChampionBanner';
import { api } from '../../utils/api';
import type { Map, MatchesResponse } from '../../types/api.types';
import type { Tournament } from '../../types';
import { getMapDisplayName } from '../../constants/maps';
import { radii } from '../../theme/tokens';
import { tournamentTabPath } from '../../paths';

interface TournamentLiveProps {
  tournament: {
    name: string;
    type: string;
    format: string;
    status: string;
    teams: Array<{ id: string; name: string }>;
    maps: string[];
    mapSequence?: string[];
    teamSize?: number;
    maxRounds?: number;
    overtimeMode?: 'enabled' | 'disabled';
    overtimeSegments?: number;
    eloTemplateId?: string;
    winner?: { id: string; name: string; tag?: string } | null;
  };
  tournamentId: number;
  onRename: (newName: string) => Promise<void> | void;
  saving: boolean;
  onViewBracket: () => void;
  onReset: () => void;
  onDelete: () => void;
  playerCount?: number;
}

export const TournamentLive: React.FC<TournamentLiveProps> = ({
  tournament,
  tournamentId,
  onRename,
  saving,
  onViewBracket,
  onReset,
  onDelete,
  playerCount,
}) => {
  const { t } = useTranslation();
  const [isRenaming, setIsRenaming] = React.useState(false);
  const [nameInput, setNameInput] = React.useState(tournament.name);
  const [availableMaps, setAvailableMaps] = React.useState<Map[]>([]);
  // Whether at least one match has actually reached a server. Until then the
  // tournament is "in progress" but nothing is running yet (servers are being
  // allocated / vetoes are still open).
  const [hasStartedMatch, setHasStartedMatch] = React.useState(false);

  React.useEffect(() => {
    setNameInput(tournament.name);
  }, [tournament.name]);

  React.useEffect(() => {
    const loadMaps = async () => {
      try {
        const response = await api.get<{ maps: Map[] }>('/api/maps');
        if (response.maps) {
          setAvailableMaps(response.maps);
        }
      } catch (err) {
        console.error('Error loading maps for live tournament view:', err);
      }
    };
    loadMaps();
  }, []);

  React.useEffect(() => {
    let cancelled = false;

    const loadMatches = async () => {
      try {
        const response = await api.get<MatchesResponse>('/api/matches');
        if (cancelled || !response.matches) return;
        setHasStartedMatch(
          response.matches.some((match) => match.status === 'loaded' || match.status === 'live')
        );
      } catch (err) {
        console.error('Error loading matches for live tournament view:', err);
      }
    };

    void loadMatches();

    const socket = io();
    const handleMatchUpdate = () => {
      void loadMatches();
    };
    socket.on('match:update', handleMatchUpdate);
    const offReconnect = onSocketReconnect(socket, handleMatchUpdate);

    return () => {
      cancelled = true;
      offReconnect();
      socket.off('match:update', handleMatchUpdate);
      socket.close();
    };
  }, []);

  const isShuffle = tournament.type === 'shuffle';
  const isCompleted = tournament.status !== 'in_progress';
  const isRunning = !isCompleted && hasStartedMatch;
  const teamSize = tournament.teamSize || 5;
  const maxRounds = tournament.maxRounds || 24;
  const overtimeMode = tournament.overtimeMode ?? 'enabled';
  const overtimeSegments = tournament.overtimeSegments;

  const resolveDisplayName = (mapId: string): string => {
    const map = availableMaps.find((m) => m.id === mapId);
    return map ? map.displayName : getMapDisplayName(mapId);
  };

  const renderOvertimeLine = () => {
    if (overtimeMode === 'enabled') {
      return t('tournament.matchRules.overtimeEnabled');
    }
    return overtimeSegments === 0
      ? t('tournament.matchRules.overtimeDisabledNoDraws')
      : t('tournament.matchRules.overtimeDisabled');
  };

  const shuffleMaps: string[] =
    (tournament.mapSequence && tournament.mapSequence.length > 0
      ? tournament.mapSequence
      : tournament.maps) || [];

  const handleStartRename = () => {
    setNameInput(tournament.name);
    setIsRenaming(true);
  };

  const handleCancelRename = () => {
    setNameInput(tournament.name);
    setIsRenaming(false);
  };

  const handleConfirmRename = async () => {
    const trimmed = nameInput.trim();

    if (!trimmed || trimmed === tournament.name) {
      setNameInput(tournament.name);
      setIsRenaming(false);
      return;
    }

    try {
      await onRename(trimmed);
      setIsRenaming(false);
    } catch {
      // Error handling is managed by caller (snackbar), keep edit state
    }
  };

  return (
    <Card sx={{ mb: 3 }}>
      <CardContent>
        <ChampionBanner
          tournament={{
            status: tournament.status as Tournament['status'],
            type: tournament.type as Tournament['type'],
            winner: tournament.winner ?? null,
          }}
        />

        <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
          <Box display="flex" alignItems="center" gap={1} sx={{ flex: 1, minWidth: 0 }}>
            {isRenaming ? (
              <>
                <TextField
                  value={nameInput}
                  onChange={(event) => setNameInput(event.target.value)}
                  size="small"
                  variant="outlined"
                  autoFocus
                  slotProps={{
                    htmlInput: { maxLength: 100 },
                  }}
                  sx={{ maxWidth: 360 }}
                />
                <IconButton
                  aria-label={t('tournament.live.saveNameAria')}
                  color="primary"
                  size="small"
                  onClick={handleConfirmRename}
                  disabled={saving}
                >
                  <CheckIcon fontSize="small" />
                </IconButton>
                <IconButton
                  aria-label={t('tournament.live.cancelRenameAria')}
                  size="small"
                  onClick={handleCancelRename}
                  disabled={saving}
                >
                  <CloseIcon fontSize="small" />
                </IconButton>
              </>
            ) : (
              <>
                <Typography variant="h5" fontWeight={600} noWrap sx={{ mr: 1 }}>
                  {tournament.name}
                </Typography>
                <Tooltip
                  title={t('tournament.live.renameTooltip')}
                  PopperProps={{ style: { zIndex: 1200 } }}
                  enterDelay={500}
                >
                  <span>
                    <IconButton
                      aria-label={t('tournament.live.editNameAria')}
                      size="small"
                      onClick={handleStartRename}
                      disabled={saving}
                    >
                      <EditIcon fontSize="small" />
                    </IconButton>
                  </span>
                </Tooltip>
              </>
            )}
          </Box>
          <Chip
            data-testid="tournament-status"
            label={
              isCompleted ? t('matchesPage.statusLabel.completed') : t('matchesPage.statusLabel.live')
            }
            // Use the same pastel red/pink accent as other LIVE indicators,
            // and mint green for completed tournaments.
            color={isCompleted ? 'success' : 'error'}
          />
        </Box>

        <Alert
          severity={isCompleted ? 'success' : isRunning ? 'warning' : 'info'}
          sx={{ mb: 3 }}
        >
          <Typography variant="body2" fontWeight={600} gutterBottom>
            {isCompleted
              ? t('tournament.live.alert.completedTitle')
              : isRunning
              ? t('tournament.live.alert.liveTitle')
              : t('tournament.live.alert.pendingTitle')}
          </Typography>
          <Typography variant="body2">
            {isCompleted
              ? t('tournament.live.alert.completedBody')
              : isRunning
              ? t('tournament.live.alert.liveBody')
              : t('tournament.live.alert.pendingBody')}
          </Typography>
        </Alert>

        <Grid container spacing={2} sx={{ mb: 3 }}>
          <Grid size={{ xs: 12, sm: 6 }}>
            <Typography variant="subtitle2" color="text.secondary">
              {t('tournament.labels.format')}
            </Typography>
            <Typography variant="body2">
              {TOURNAMENT_TYPES.some((tt) => tt.value === tournament.type)
                ? t(`tournament.typeSelector.types.${tournament.type}.label`)
                : tournament.type}{' '}
              •{' '}
              {MATCH_FORMATS.find((f) => f.value === tournament.format)?.label}
            </Typography>
          </Grid>
          {!isShuffle && (
            <Grid size={{ xs: 12, sm: 6 }}>
              <Typography variant="subtitle2" color="text.secondary">
                {t('tournament.labels.teams')}
              </Typography>
              <Typography variant="body2">
                {t('tournament.live.teamsCompeting', { count: tournament.teams.length })}
              </Typography>
            </Grid>
          )}
          {isShuffle && (
            <Grid size={{ xs: 12, sm: 6 }}>
              <Typography variant="subtitle2" color="text.secondary">
                {t('tournament.labels.players')}
              </Typography>
              <Typography variant="body2">
                {typeof playerCount === 'number'
                  ? t('tournament.live.playersCompeting', { count: playerCount })
                  : t('tournament.live.playersCompetingUnknown')}
              </Typography>
            </Grid>
          )}
          {!isShuffle && (
            <Grid size={{ xs: 12, sm: 6 }}>
              <Typography variant="subtitle2" color="text.secondary">
                {t('tournament.labels.maps')}
              </Typography>
              <Box display="flex" flexWrap="wrap" gap={1} mt={0.5}>
                {tournament.maps.map((mapId: string) => (
                  <Chip
                    key={mapId}
                    label={resolveDisplayName(mapId)}
                    size="small"
                    variant="outlined"
                  />
                ))}
              </Box>
            </Grid>
          )}
          {!isShuffle && (
            <Grid size={{ xs: 12, sm: 6 }}>
              <Typography variant="subtitle2" color="text.secondary">
                {t('tournament.labels.matchRules')}
              </Typography>
              <Typography variant="body2">
                {t('tournament.matchRules.value', {
                  maxRounds,
                  winRounds: Math.floor(maxRounds / 2) + 1,
                })}
              </Typography>
              <Typography variant="body2">{renderOvertimeLine()}</Typography>
              {overtimeMode === 'enabled' && typeof overtimeSegments === 'number' && (
                <Typography variant="body2">
                  {overtimeSegments > 0
                    ? t('tournament.matchRules.overtimeSegments', { count: overtimeSegments })
                    : t('tournament.matchRules.overtimeSegmentsDefault')}
                </Typography>
              )}
            </Grid>
          )}
          {isShuffle && (
            <>
              <Grid size={{ xs: 12, sm: 6 }}>
                <Typography variant="subtitle2" color="text.secondary">
                  {t('tournament.live.shuffleSettingsLabel')}
                </Typography>
                <Typography variant="body2">
                  {t('tournament.matchRules.teamSizeValue', { size: teamSize })}
                </Typography>
                <Typography variant="body2">
                  {t('tournament.live.maxRoundsPerMapValue', { rounds: maxRounds })}
                </Typography>
                <Typography variant="body2">{renderOvertimeLine()}</Typography>
                {overtimeMode === 'enabled' && typeof overtimeSegments === 'number' && (
                  <Typography variant="body2">
                    {overtimeSegments > 0
                      ? t('tournament.matchRules.overtimeSegments', { count: overtimeSegments })
                      : t('tournament.matchRules.overtimeSegmentsDefault')}
                  </Typography>
                )}
                {tournament.eloTemplateId && (
                  <Typography variant="body2">
                    {t('tournament.live.eloTemplateValue', { template: tournament.eloTemplateId })}
                  </Typography>
                )}
              </Grid>
              <Grid size={{ xs: 12, sm: 6 }}>
                <Typography variant="subtitle2" color="text.secondary">
                  {t('tournament.live.mapSequenceLabel')}
                </Typography>
                <Box display="flex" flexWrap="wrap" gap={1} mt={0.5}>
                  {shuffleMaps.length > 0 ? (
                    shuffleMaps.map((mapId: string, index: number) => (
                      <Chip
                        key={`${mapId}-${index}`}
                        label={`${index + 1}. ${resolveDisplayName(mapId)}`}
                        size="small"
                        variant="outlined"
                      />
                    ))
                  ) : (
                    <Typography variant="body2" color="text.secondary">
                      {t('tournament.live.noMapsConfigured')}
                    </Typography>
                  )}
                </Box>
              </Grid>
            </>
          )}
        </Grid>

        <Box display="flex" gap={2} flexWrap="wrap">
          <Tooltip
            title={t('tournament.live.viewBracketTooltip')}
            PopperProps={{ style: { zIndex: 1200 } }}
            enterDelay={500}
          >
            <span style={{ flex: 1, minWidth: 200 }}>
              <Button
                data-testid="view-bracket-button"
                variant="contained"
                fullWidth
                startIcon={<VisibilityIcon />}
                onClick={onViewBracket}
              >
                {t('tournament.live.viewBracket')}
              </Button>
            </span>
          </Tooltip>
          <Tooltip
            title={t('tournament.live.leaderboardTooltip')}
            PopperProps={{ style: { zIndex: 1200 } }}
            enterDelay={500}
          >
            <span style={{ flex: 1, minWidth: 200 }}>
              <Button
                variant="outlined"
                fullWidth
                startIcon={<EmojiEventsIcon />}
                onClick={() => window.open(tournamentTabPath(tournamentId, 'standings'), '_blank')}
              >
                {t('nav.leaderboard')}
              </Button>
            </span>
          </Tooltip>
        </Box>

        {/* What changes or ends the running tournament sits apart from the
            everyday buttons above, each with a line saying what it does. It
            used to be one row of five differently coloured buttons: filled
            orange, outlined, outlined amber, and two outlined red. */}
        <Box
          component="section"
          aria-labelledby="tournament-danger-zone-title"
          data-testid="tournament-danger-zone"
          sx={{
            mt: 3,
            p: 2,
            border: 1,
            borderColor: 'error.main',
            borderRadius: radii.lg,
          }}
        >
          <Typography
            id="tournament-danger-zone-title"
            variant="subtitle2"
            fontWeight={600}
            color="error.main"
            gutterBottom
          >
            {t('tournament.live.dangerZone')}
          </Typography>
          <Stack divider={<Divider flexItem />} spacing={1.5}>
            {tournament.status === 'in_progress' && (
              <DangerRow description={t('tournament.live.restartTooltip')}>
                <RestartTournamentButton variant="outlined" size="small" />
              </DangerRow>
            )}
            <DangerRow description={t('tournament.live.resetTooltip')}>
              <Button
                variant="outlined"
                color="error"
                size="small"
                startIcon={<RestartAltIcon />}
                onClick={onReset}
                disabled={saving}
              >
                {t('tournament.live.reset')}
              </Button>
            </DangerRow>
            <DangerRow description={t('tournament.tooltips.deleteTournament')}>
              <Button
                variant="outlined"
                color="error"
                size="small"
                startIcon={<DeleteForeverIcon />}
                onClick={onDelete}
                disabled={saving}
              >
                {t('common.delete')}
              </Button>
            </DangerRow>
          </Stack>
        </Box>
      </CardContent>
    </Card>
  );
};

/** One danger-zone action: what it does on the left, its button on the right. */
function DangerRow({ description, children }: { description: string; children: React.ReactNode }) {
  return (
    <Box
      display="flex"
      alignItems={{ xs: 'flex-start', sm: 'center' }}
      flexDirection={{ xs: 'column', sm: 'row' }}
      justifyContent="space-between"
      gap={1.5}
    >
      <Typography variant="body2" color="text.secondary" sx={{ flex: 1 }}>
        {description}
      </Typography>
      <Box sx={{ flexShrink: 0, '& .MuiButton-root': { whiteSpace: 'nowrap' } }}>{children}</Box>
    </Box>
  );
}
