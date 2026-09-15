import { Box, Card, CardContent, Typography, IconButton, Tooltip } from '@mui/material';
import VolumeUpIcon from '@mui/icons-material/VolumeUp';
import VolumeOffIcon from '@mui/icons-material/VolumeOff';
import SettingsIcon from '@mui/icons-material/Settings';
import { useTranslation } from 'react-i18next';
import type { Team } from '../../types';

interface TeamHeaderProps {
  team: Team | null;
  isMuted?: boolean;
  onToggleMute?: () => void;
  onToggleSettings?: () => void;
  /** When true, sound controls are hidden (e.g. team page used only for stats/roster). */
  hideSoundControls?: boolean;
}

export function TeamHeader({
  team,
  isMuted,
  onToggleMute,
  onToggleSettings,
  hideSoundControls,
}: TeamHeaderProps) {
  const { t } = useTranslation();

  return (
    <Card
      sx={{
        background:
          'linear-gradient(135deg, rgba(103, 80, 164, 0.1) 0%, rgba(103, 80, 164, 0.05) 100%)',
      }}
    >
      <CardContent>
        <Box display="flex" justifyContent="space-between" alignItems="center">
          <Box flex={1} display="flex" alignItems="center" gap={1}>
            <Typography variant="h2" fontWeight={600} color="primary">
              {team?.tag ? `[${team.tag}] ${team.name}` : team?.name}
            </Typography>
          </Box>
          {!hideSoundControls && onToggleMute != null && onToggleSettings != null && (
            <Box display="flex" gap={1}>
              <Tooltip title={t('teamHeader.soundSettings')}>
                <IconButton onClick={onToggleSettings} color="primary">
                  <SettingsIcon />
                </IconButton>
              </Tooltip>
              <Tooltip
                title={
                  isMuted ? t('teamHeader.unmuteNotifications') : t('teamHeader.muteNotifications')
                }
              >
                <IconButton onClick={onToggleMute} color={isMuted ? 'default' : 'primary'}>
                  {isMuted ? <VolumeOffIcon /> : <VolumeUpIcon />}
                </IconButton>
              </Tooltip>
            </Box>
          )}
        </Box>
      </CardContent>
    </Card>
  );
}
