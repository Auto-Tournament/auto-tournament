import { Box, Card, CardContent, Typography, IconButton, Tooltip } from '@mui/material';
import VolumeUpIcon from '@mui/icons-material/VolumeUp';
import VolumeOffIcon from '@mui/icons-material/VolumeOff';
import SettingsIcon from '@mui/icons-material/Settings';
import { useTranslation } from 'react-i18next';
import type { Team } from '../../types';
import { mono } from '../../theme/tokens';

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
    <Card>
      <CardContent>
        <Box display="flex" justifyContent="space-between" alignItems="center">
          <Box flex={1} display="flex" alignItems="center" gap={1}>
            <Typography
              variant="h3"
              component="p"
              sx={{ fontSize: { xs: '1.5rem', sm: '1.875rem' }, minWidth: 0, overflowWrap: 'anywhere' }}
            >
              {team?.tag && (
                <Box component="span" sx={{ ...mono, color: 'primary.main', fontSize: '0.7em', mr: 1 }}>
                  [{team.tag}]
                </Box>
              )}
              {team?.name}
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
