import { useEffect, useState } from 'react';
import { Box, Typography, Card, CardContent, Divider, Alert } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { GameControllerIcon, HardDrivesIcon, UsersThreeIcon } from '@phosphor-icons/react';
import { api } from '../../utils/api';

interface ShuffleTournamentStatsProps {
  playerCount: number;
  teamSize: number;
}

export function ShuffleTournamentStats({ playerCount, teamSize }: ShuffleTournamentStatsProps) {
  const { t } = useTranslation();
  const [availableServerCount, setAvailableServerCount] = useState<number | null>(null);

  // Calculate teams: divide players by team size (round down)
  const numberOfTeams = Math.floor(playerCount / teamSize);

  // Calculate matches per round: teams / 2 (round down)
  const matchesPerRound = Math.floor(numberOfTeams / 2);

  // Servers needed = matches per round (each match needs a server)
  const serversNeeded = matchesPerRound;

  useEffect(() => {
    let cancelled = false;
    const loadServerAvailability = async () => {
      try {
        const response = await api.get<{
          success: boolean;
          availableServerCount: number;
        }>('/api/tournament/server-availability');
        if (!cancelled && response.success) {
          setAvailableServerCount(response.availableServerCount);
        }
      } catch (err) {
        console.error('Error loading server availability:', err);
        if (!cancelled) setAvailableServerCount(null);
      }
    };
    void loadServerAvailability();
    return () => {
      cancelled = true;
    };
  }, []);

  const showServerShortageWarning =
    playerCount >= teamSize * 2 &&
    serversNeeded > 0 &&
    availableServerCount !== null &&
    availableServerCount < serversNeeded;

  return (
    <Card sx={{ width: '100%', display: 'flex', flexDirection: 'column', minHeight: '100%' }}>
      <CardContent sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', flex: 1, minHeight: 0 }}>
        <Typography variant="h6" fontWeight={600} mb={3}>
          Tournament Stats
        </Typography>

        <Box sx={{ width: '100%' }}>
          <Box display="flex" alignItems="center" justifyContent="space-between" mb={2}>
            <Box display="flex" alignItems="center" gap={1}>
              <Box component={UsersThreeIcon} size={20} sx={{ color: 'action.active' }} />
              <Typography variant="body2" color="text.secondary">
                Teams per Round
              </Typography>
            </Box>
            <Typography variant="h6" fontWeight={600}>
              {playerCount >= teamSize * 2 ? numberOfTeams : 0}
            </Typography>
          </Box>

          <Divider sx={{ my: 2 }} />

          <Box display="flex" alignItems="center" justifyContent="space-between" mb={2}>
            <Box display="flex" alignItems="center" gap={1}>
              <Box component={GameControllerIcon} size={20} sx={{ color: 'action.active' }} />
              <Typography variant="body2" color="text.secondary">
                Matches per Round
              </Typography>
            </Box>
            <Typography variant="h6" fontWeight={600}>
              {playerCount >= teamSize * 2 ? matchesPerRound : 0}
            </Typography>
          </Box>

          <Divider sx={{ my: 2 }} />

          <Box display="flex" alignItems="center" justifyContent="space-between">
            <Box display="flex" alignItems="center" gap={1}>
              <Box component={HardDrivesIcon} size={20} sx={{ color: 'action.active' }} />
              <Typography variant="body2" color="text.secondary">
                Servers Needed
              </Typography>
            </Box>
            <Typography variant="h6" fontWeight={600}>
              {playerCount >= teamSize * 2 ? serversNeeded : 0}
            </Typography>
          </Box>

          {showServerShortageWarning && (
            <Alert severity="warning" sx={{ mt: 2, textAlign: 'left' }}>
              {t('tournament.shuffleStats.serverShortageWarning', {
                available: availableServerCount,
                needed: serversNeeded,
              })}
            </Alert>
          )}
        </Box>
      </CardContent>
    </Card>
  );
}

