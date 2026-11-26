import { Box, Button, Typography } from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { paths } from '../../paths';
import { fontDisplay, tokens } from '../../theme/tokens';

const { color, radius } = tokens;

/** The parts of the signed-in player's settings, one page each (/me/...). */
export type SettingsSection = 'account' | 'notifications' | 'games' | 'cs2';

export const SETTINGS_PATHS: Record<SettingsSection, string> = {
  account: paths.meConnections,
  notifications: paths.meNotifications,
  games: paths.meGames,
  cs2: paths.meCs2,
};

function RailLink({
  section,
  current,
  label,
}: {
  section: SettingsSection;
  current: SettingsSection;
  label: string;
}) {
  const on = section === current;
  return (
    <Button
      component={RouterLink}
      to={SETTINGS_PATHS[section]}
      aria-current={on ? 'page' : undefined}
      data-testid={`settings-rail-${section}`}
      sx={{
        justifyContent: 'flex-start',
        borderRadius: `${radius.sm}px`,
        px: 1.5,
        minHeight: 40,
        whiteSpace: 'nowrap',
        fontWeight: on ? 600 : 500,
        color: on ? 'text.primary' : 'text.secondary',
        bgcolor: on ? color.paper3 : 'transparent',
        '&:hover': { bgcolor: on ? color.paper3 : color.paper2, color: 'text.primary' },
      }}
    >
      {label}
    </Button>
  );
}

/**
 * The settings menu: Account, Notifications, Games, then a CS2 group for what only
 * applies in CS2 matches on our servers (HUD, teammate colour). A row of links on a
 * phone, a column beside the page from md up.
 */
export function SettingsRail({ current }: { current: SettingsSection }) {
  const { t } = useTranslation();
  return (
    <Box
      component="nav"
      aria-label={t('account.rail.label')}
      sx={{
        display: 'flex',
        flexDirection: { xs: 'row', md: 'column' },
        alignItems: { xs: 'center', md: 'stretch' },
        gap: 0.5,
        alignSelf: 'start',
        position: { md: 'sticky' },
        top: { md: 96 },
        overflowX: { xs: 'auto', md: 'visible' },
      }}
    >
      <Typography
        component="h1"
        sx={{
          display: { xs: 'none', md: 'block' },
          fontFamily: fontDisplay,
          fontWeight: 700,
          fontSize: '1.5rem',
          px: 1.5,
          mb: 2,
        }}
      >
        {t('account.rail.label')}
      </Typography>
      <RailLink section="account" current={current} label={t('account.rail.account')} />
      <RailLink section="notifications" current={current} label={t('account.rail.notifications')} />
      <RailLink section="games" current={current} label={t('account.rail.games')} />
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          px: 1.5,
          mt: { xs: 0, md: 2.5 },
          mb: { xs: 0, md: 0.75 },
          ml: { xs: 1, md: 0 },
          flex: 'none',
        }}
      >
        <Box
          component="span"
          sx={{
            px: 0.75,
            py: 0.25,
            borderRadius: '6px',
            bgcolor: color.accent,
            color: color.accentInk,
            fontSize: '0.75rem',
            fontWeight: 700,
            letterSpacing: '0.02em',
          }}
        >
          CS2
        </Box>
        <Typography
          component="span"
          sx={{
            display: { xs: 'none', md: 'inline' },
            fontSize: '0.75rem',
            fontWeight: 600,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            color: 'text.secondary',
          }}
        >
          {t('account.rail.cs2Group')}
        </Typography>
      </Box>
      <RailLink section="cs2" current={current} label={t('account.rail.cs2')} />
    </Box>
  );
}
