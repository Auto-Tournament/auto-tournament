import React from 'react';
import { Box, Paper, List, ListItemButton, ListItemIcon, ListItemText, Chip } from '@mui/material';
import { useNavigate, useLocation } from 'react-router-dom';
import InboxIcon from '@mui/icons-material/Inbox';
import SportsEsportsIcon from '@mui/icons-material/SportsEsports';
import AccountTreeIcon from '@mui/icons-material/AccountTree';
import GroupsIcon from '@mui/icons-material/Groups';
import PersonIcon from '@mui/icons-material/Person';
import StorageIcon from '@mui/icons-material/Storage';
import MapIcon from '@mui/icons-material/Map';
import EmojiEventsIcon from '@mui/icons-material/EmojiEvents';
import SettingsIcon from '@mui/icons-material/Settings';
import { useTranslation } from 'react-i18next';

interface ManageRailItem {
  key: string;
  label: string;
  path: string;
  icon: React.ReactNode;
  /** Only set where a real count exists; omitted items show no badge. */
  count?: number;
}

interface ManageRailProps {
  needsYouCount: number;
}

/**
 * Left rail linking to the existing pages that already own this data.
 * "Needs you" is the only item with a live count wired up here; the rest are
 * plain navigation, per the task's "show counts only where real data exists".
 */
export const ManageRail: React.FC<ManageRailProps> = ({ needsYouCount }) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();

  const items: ManageRailItem[] = [
    {
      key: 'needsYou',
      label: t('managePage.rail.needsYou'),
      path: '/manage',
      icon: <InboxIcon />,
      count: needsYouCount,
    },
    { key: 'matches', label: t('managePage.rail.matches'), path: '/matches', icon: <SportsEsportsIcon /> },
    { key: 'bracket', label: t('managePage.rail.bracket'), path: '/bracket', icon: <AccountTreeIcon /> },
    { key: 'teams', label: t('managePage.rail.teams'), path: '/teams', icon: <GroupsIcon /> },
    { key: 'players', label: t('managePage.rail.players'), path: '/players', icon: <PersonIcon /> },
    { key: 'servers', label: t('managePage.rail.servers'), path: '/servers', icon: <StorageIcon /> },
    { key: 'maps', label: t('managePage.rail.maps'), path: '/maps', icon: <MapIcon /> },
    { key: 'tournament', label: t('managePage.rail.tournament'), path: '/tournament', icon: <EmojiEventsIcon /> },
    { key: 'settings', label: t('managePage.rail.settings'), path: '/settings', icon: <SettingsIcon /> },
  ];

  return (
    <Paper
      variant="outlined"
      data-testid="manage-rail"
      sx={{
        p: 1,
        // Sticky column on desktop; horizontal scroller under 820px so it
        // never forces the page to scroll sideways.
        position: 'static',
        width: '100%',
        flex: '0 0 auto',
        '@media (min-width: 820.1px)': {
          position: 'sticky',
          top: 88,
          width: 220,
          flex: '0 0 220px',
        },
      }}
    >
      <Box
        sx={{
          display: 'flex',
          overflowX: 'auto',
          gap: 0.5,
          '@media (min-width: 820.1px)': {
            display: 'block',
            overflowX: 'visible',
            gap: 0,
          },
        }}
      >
        <List
          dense
          disablePadding
          sx={{
            display: 'flex',
            '@media (min-width: 820.1px)': { display: 'block' },
          }}
        >
          {items.map((item) => {
            const selected = location.pathname === item.path;
            return (
              <ListItemButton
                key={item.key}
                selected={selected}
                onClick={() => navigate(item.path)}
                sx={{
                  borderRadius: 1,
                  mb: { md: 0.25 },
                  whiteSpace: 'nowrap',
                }}
              >
                <ListItemIcon sx={{ minWidth: 32 }}>{item.icon}</ListItemIcon>
                <ListItemText primary={item.label} />
                {typeof item.count === 'number' && item.count > 0 && (
                  <Chip label={item.count} size="small" color="primary" sx={{ ml: 1 }} />
                )}
              </ListItemButton>
            );
          })}
        </List>
      </Box>
    </Paper>
  );
};
