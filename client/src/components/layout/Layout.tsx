import * as React from 'react';
import { styled, useTheme, Theme, CSSObject } from '@mui/material/styles';
import { tokens } from '../../theme/tokens';
import { AtIcon } from '../common/AtIcon';
import Box from '@mui/material/Box';
import MuiDrawer from '@mui/material/Drawer';
import MuiAppBar, { AppBarProps as MuiAppBarProps } from '@mui/material/AppBar';
import Toolbar from '@mui/material/Toolbar';
import List from '@mui/material/List';
import CssBaseline from '@mui/material/CssBaseline';
import Typography from '@mui/material/Typography';
import Divider from '@mui/material/Divider';
import IconButton from '@mui/material/IconButton';
import MenuIcon from '@mui/icons-material/Menu';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import ListItem from '@mui/material/ListItem';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import Tooltip from '@mui/material/Tooltip';
import ListSubheader from '@mui/material/ListSubheader';
import useMediaQuery from '@mui/material/useMediaQuery';
import { Outlet, useNavigate, useLocation, Link } from 'react-router-dom';
import {
  Home as HomeIcon,
  Dashboard as DashboardIcon,
  BugReport as BugReportIcon,
} from '@mui/icons-material';
import InboxIcon from '@mui/icons-material/Inbox';
import EmojiEventsIcon from '@mui/icons-material/EmojiEvents';
import AccountTreeIcon from '@mui/icons-material/AccountTree';
import GroupsIcon from '@mui/icons-material/Groups';
import PersonIcon from '@mui/icons-material/Person';
import SportsEsportsIcon from '@mui/icons-material/SportsEsports';
import CampaignIcon from '@mui/icons-material/Campaign';
import SettingsIcon from '@mui/icons-material/Settings';
import BuildIcon from '@mui/icons-material/Build';
import DescriptionIcon from '@mui/icons-material/Description';
import LibraryBooksIcon from '@mui/icons-material/LibraryBooks';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import GavelIcon from '@mui/icons-material/Gavel';
import ExtensionIcon from '@mui/icons-material/Extension';
import { usePageHeader } from '../../contexts/PageHeaderContext';
import { useSnackbar } from '../../contexts/SnackbarContext';
import { api } from '../../utils/api';
import { useIsDevelopment } from '../../hooks/useIsDevelopment';
import { useTranslation } from 'react-i18next';
import { SharedNavBar } from './SharedNavBar';
import { useShellIntegrations } from '../../hooks/useShellIntegrations';
import { moduleNavItems, navItemLabel } from '../../utils/moduleNavLabels';
import { ModuleNotInstalledNotice } from '../common/ModuleNotInstalledNotice';
import { paths } from '../../paths';

const drawerWidth = 240;

/**
 * Sidebar items are pills inset from the drawer edge. When the desktop drawer
 * is collapsed to icons, the pill shrinks to a centred icon button.
 */
const navItemSx = (open: boolean) => ({
  minHeight: 42,
  mx: open ? 1 : 0.75,
  my: 0.25,
  px: open ? 1.75 : 0,
  borderRadius: `${tokens.radius.pill}px`,
  justifyContent: open ? 'initial' : 'center',
  color: 'text.secondary',
  '&:hover': { color: 'text.primary' },
});

/** Active item: faint orange wash, ink label, orange icon. */
const navItemSelectedSx = {
  '&.Mui-selected': {
    color: 'text.primary',
    '& .MuiListItemIcon-root': { color: 'primary.main' },
  },
};

/**
 * Height of the impersonation banner (0px when it is not shown). The banner is
 * rendered above the whole app, so the fixed header and the drawers have to
 * start below it – otherwise the header covers the banner and its
 * "stop impersonating" button cannot be clicked.
 */
const bannerOffset = `var(--mat-impersonation-height, 0px)`;

const openedMixin = (theme: Theme): CSSObject => ({
  width: drawerWidth,
  top: bannerOffset,
  height: `calc(100% - ${bannerOffset})`,
  transition: theme.transitions.create('width', {
    easing: theme.transitions.easing.sharp,
    duration: theme.transitions.duration.enteringScreen,
  }),
  overflowX: 'hidden',
});

const closedMixin = (theme: Theme): CSSObject => ({
  transition: theme.transitions.create('width', {
    easing: theme.transitions.easing.sharp,
    duration: theme.transitions.duration.leavingScreen,
  }),
  overflowX: 'hidden',
  top: bannerOffset,
  height: `calc(100% - ${bannerOffset})`,
  width: `calc(${theme.spacing(7)} + 1px)`,
  [theme.breakpoints.up('sm')]: {
    width: `calc(${theme.spacing(8)} + 1px)`,
  },
});

const DrawerHeader = styled('div')(({ theme }) => ({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'flex-end',
  padding: theme.spacing(0, 1),
  // necessary for content to be below app bar
  ...theme.mixins.toolbar,
}));

interface AppBarProps extends MuiAppBarProps {
  open?: boolean;
}

const AppBar = styled(MuiAppBar, {
  shouldForwardProp: (prop) => prop !== 'open',
})<AppBarProps>(({ theme }) => ({
  zIndex: theme.zIndex.drawer + 1,
  top: bannerOffset,
  transition: theme.transitions.create(['width', 'margin'], {
    easing: theme.transitions.easing.sharp,
    duration: theme.transitions.duration.leavingScreen,
  }),
  variants: [
    {
      props: ({ open }) => open,
      style: {
        marginLeft: drawerWidth,
        width: `calc(100% - ${drawerWidth}px)`,
        transition: theme.transitions.create(['width', 'margin'], {
          easing: theme.transitions.easing.sharp,
          duration: theme.transitions.duration.enteringScreen,
        }),
      },
    },
  ],
}));

const Drawer = styled(MuiDrawer, { shouldForwardProp: (prop) => prop !== 'open' })(({ theme }) => ({
  width: drawerWidth,
  flexShrink: 0,
  whiteSpace: 'nowrap',
  boxSizing: 'border-box',
  variants: [
    {
      props: ({ open }) => open,
      style: {
        ...openedMixin(theme),
        '& .MuiDrawer-paper': openedMixin(theme),
      },
    },
    {
      props: ({ open }) => !open,
      style: {
        ...closedMixin(theme),
        '& .MuiDrawer-paper': closedMixin(theme),
      },
    },
  ],
}));

export default function Layout() {
  const theme = useTheme();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const { headerActions } = usePageHeader();
  const { showPersistentError, closeSnackbar } = useSnackbar();
  const [steamHealthSnackbarKey, setSteamHealthSnackbarKey] = React.useState<import('notistack').SnackbarKey | null>(
    null
  );
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const contentContainerRef = React.useRef<HTMLDivElement>(null);
  // The saved preference is for the desktop mini/full sidebar only. Reusing it
  // on phones kept the 240px permanent drawer and opened the temporary one on
  // top, leaving ~135px of content at 375px wide. Small screens use only the
  // temporary drawer, closed by default.
  const [desktopOpen, setDesktopOpen] = React.useState(() => {
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem('sidebarOpen');
      if (stored !== null) {
        return stored === 'true';
      }
      return window.innerWidth >= theme.breakpoints.values.md;
    }
    return false;
  });
  const [mobileOpen, setMobileOpen] = React.useState(false);
  const open = isMobile ? mobileOpen : desktopOpen;
  const setOpen = (value: boolean) => (isMobile ? setMobileOpen(value) : setDesktopOpen(value));

  const isDevelopment = useIsDevelopment();

  // One read of the tournament for all three of the shell's game-dependent
  // parts: the pages the game's module adds (CS2: Servers, Maps), whether a
  // result here can be disputed at all (3.0 phase D, PR D8), and what the
  // module needs an admin to fix before it can run (phase E: CS2's webhook
  // URL and its plugin's database). `useDisputesEntry` is the same decision
  // for the pages that need only that one.
  //
  // The nav items are the shell's — every installed module until a tournament
  // says which one this instance runs, then only that one's. The other two
  // are the tournament's own, and null until there is one, so an instance
  // that has not said what it runs yet is not warned about the settings of a
  // game it may not be running.
  //
  // Each item is labelled from its module's own strings (`cs2:nav.servers`,
  // `cs2:layout.pageTitle.servers`), never from core's.
  const {
    shell,
    tournament: tournamentIntegration,
    loading: tournamentGameLoading,
  } = useShellIntegrations();
  const integrationNavItems = moduleNavItems(shell);
  const showDisputes = !tournamentGameLoading && Boolean(tournamentIntegration?.adminDisputesView);
  const AdminGlobalWarning = tournamentGameLoading
    ? undefined
    : tournamentIntegration?.adminGlobalWarning;

  // Page header configuration - maps routes to their titles and icons
  const pageHeaders: Record<string, { title: string; icon: React.ComponentType; color?: string }> =
    {
      '/': { title: t('layout.pageTitle.dashboard'), icon: DashboardIcon },
      '/manage': { title: t('layout.pageTitle.manage'), icon: InboxIcon },
      '/tournament': { title: t('layout.pageTitle.tournament'), icon: EmojiEventsIcon },
      '/bracket': { title: t('layout.pageTitle.bracket'), icon: AccountTreeIcon },
      '/matches': { title: t('layout.pageTitle.matches'), icon: SportsEsportsIcon },
      '/disputes': { title: t('layout.pageTitle.disputes'), icon: GavelIcon },
      '/modules': { title: t('layout.pageTitle.modules'), icon: ExtensionIcon },
      '/teams': { title: t('layout.pageTitle.teams'), icon: GroupsIcon },
      '/players': { title: t('layout.pageTitle.players'), icon: PersonIcon },
      ...Object.fromEntries(
        integrationNavItems.map((item) => [
          item.path,
          { title: navItemLabel(t, item, 'pageTitle'), icon: item.icon },
        ])
      ),
      '/templates': { title: t('layout.pageTitle.templates'), icon: DescriptionIcon },
      '/elo-templates': { title: t('layout.pageTitle.eloTemplates'), icon: TrendingUpIcon },
      '/admin': { title: t('layout.pageTitle.adminTools'), icon: CampaignIcon },
      '/settings': { title: t('layout.pageTitle.settings'), icon: SettingsIcon },
      '/dev': {
        title: t('layout.pageTitle.devTools'),
        icon: BugReportIcon,
        color: 'warning.main',
      },
    };

  // Get current page header config
  const currentPageHeader = pageHeaders[location.pathname];

  // Group navigation items logically
  const mainNavItems = [
    { label: t('nav.tournament'), path: '/tournament', icon: EmojiEventsIcon },
    { label: t('nav.bracket'), path: '/bracket', icon: AccountTreeIcon },
    { label: t('nav.matches'), path: '/matches', icon: SportsEsportsIcon },
    // Only where a result can be argued about at all (3.0 phase D, PR D8).
    // A CS2 result comes from the game server, so linking a page that can
    // never have a row on it would be nav clutter with no answer behind it.
    ...(showDisputes ? [{ label: t('nav.disputes'), path: '/disputes', icon: GavelIcon }] : []),
  ];

  const resourcesNavItems = [
    { label: t('nav.teams'), path: '/teams', icon: GroupsIcon },
    { label: t('nav.players'), path: '/players', icon: PersonIcon },
    ...integrationNavItems.map((item) => ({
      label: navItemLabel(t, item, 'nav'),
      path: item.path,
      icon: item.icon,
    })),
  ];

  const configurationNavItems = [
    { label: t('nav.modules'), path: '/modules', icon: ExtensionIcon },
    { label: t('nav.templates'), path: '/templates', icon: DescriptionIcon },
    { label: t('nav.eloTemplates'), path: '/elo-templates', icon: TrendingUpIcon },
    { label: t('nav.settings'), path: '/settings', icon: SettingsIcon },
  ];

  const systemNavItems = [
    { label: t('nav.adminTools'), path: '/admin', icon: CampaignIcon },
    ...(isDevelopment ? [{ label: t('nav.devTools'), path: '/dev', icon: BuildIcon }] : []),
  ];

  // Steam's health stays here rather than moving behind the game integration
  // with the MatchZy plugin's database (3.0 phase E). The warning is about
  // sign-ins and vanity URL lookups: Steam is the platform's own login
  // provider, and an instance running a manually reported Rocket League
  // tournament signs its admins in with it exactly like a CS2 one.
  // Global admin warning: keep a persistent snackbar while Steam integration is unhealthy.
  React.useEffect(() => {
    let cancelled = false;

    const checkSteamHealth = async () => {
      try {
        const response = await api.get<{
          success?: boolean;
          configured?: boolean;
          valid?: boolean;
          errorType?: string;
          error?: string;
        }>('/api/steam/status');

        if (cancelled) return;

        const configured = response.configured;
        const valid = response.valid;
        const isUnhealthy =
          configured === false || valid === false || response.success === false;

        if (isUnhealthy) {
          if (!steamHealthSnackbarKey) {
            const key = showPersistentError(
              <span>
                <strong>{t('layout.steamUnavailable.title')}</strong> —{' '}
                {t('layout.steamUnavailable.body')}
              </span>,
              'steam-api-health'
            );
            setSteamHealthSnackbarKey(key);
          }
        } else if (steamHealthSnackbarKey) {
          closeSnackbar(steamHealthSnackbarKey);
          setSteamHealthSnackbarKey(null);
        }
      } catch {
        // Non-fatal. This endpoint is admin-authenticated and can fail during login bootstrap.
      }
    };

    void checkSteamHealth();
    const interval = window.setInterval(checkSteamHealth, 5 * 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [steamHealthSnackbarKey, showPersistentError, closeSnackbar, t]);

  // What the game's own module needs an admin to fix, wherever they are (3.0
  // phase E). The shell owns the settings route and nothing else about it.
  const handleOpenSettingsFromSnackbar = React.useCallback(() => {
    navigate(paths.settings);
  }, [navigate]);

  // Fallback page title handling for critical routes (e.g. Matches)
  React.useEffect(() => {
    // Let individual pages manage their own titles where possible, but ensure that
    // the Matches page always exposes a stable, human‑readable title for tests.
    if (location.pathname.startsWith('/matches')) {
      document.title = t('layout.pageTitle.matches');
    }
  }, [location.pathname, t]);

  const isActive = (path: string) => {
    return location.pathname === path || location.pathname === path + '/';
  };

  // Persist sidebar state to localStorage
  React.useEffect(() => {
    // Only persist on desktop (md and up), not mobile
    localStorage.setItem('sidebarOpen', desktopOpen.toString());
  }, [desktopOpen]);

  // Leaving the small layout must not leave a stale temporary drawer open.
  React.useEffect(() => {
    if (!isMobile) setMobileOpen(false);
  }, [isMobile]);

  // Scroll to top when route changes
  React.useEffect(() => {
    if (contentContainerRef.current) {
      contentContainerRef.current.scrollTo({
        top: 0,
        behavior: 'smooth',
      });
    }
  }, [location.pathname]);

  const handleDrawerOpen = () => {
    setOpen(true);
  };

  const handleDrawerClose = () => {
    setOpen(false);
  };

  const handleNavClick = (path: string) => {
    navigate(path);
    if (isMobile) {
      setOpen(false);
    }
  };

  const renderNavItems = (items: typeof mainNavItems) => {
    return items.map((item) => {
      const Icon = item.icon;
      return (
        <ListItem key={item.path} disablePadding sx={{ display: 'block' }}>
          <Tooltip title={!open ? item.label : ''} placement="right">
            <ListItemButton
              selected={isActive(item.path)}
              onClick={() => handleNavClick(item.path)}
              component={Link}
              to={item.path}
              sx={[
                navItemSx(open),
                navItemSelectedSx,
              ]}
            >
              <ListItemIcon
                sx={[
                  {
                    minWidth: 0,
                    justifyContent: 'center',
                    color: isActive(item.path) ? 'primary.main' : 'inherit',
                  },
                  open
                    ? {
                        mr: 3,
                      }
                    : {
                        mr: 'auto',
                      },
                ]}
              >
                <Icon />
              </ListItemIcon>
              <ListItemText
                primary={item.label}
                sx={[
                  open
                    ? {
                        opacity: 1,
                      }
                    : {
                        opacity: 0,
                      },
                ]}
              />
            </ListItemButton>
          </Tooltip>
        </ListItem>
      );
    });
  };

  return (
    <Box sx={{ display: 'flex', minHeight: `calc(100vh - ${bannerOffset})` }}>
      <CssBaseline />
      {/* The game module's own global warning, or nothing (3.0 phase E). */}
      {AdminGlobalWarning && <AdminGlobalWarning onOpenSettings={handleOpenSettingsFromSnackbar} />}
      {/* Mobile Drawer (temporary) */}
      <MuiDrawer
        variant="temporary"
        open={isMobile && mobileOpen}
        onClose={handleDrawerClose}
        ModalProps={{
          keepMounted: true,
        }}
        sx={{
          display: { xs: 'block', md: 'none' },
          '& .MuiDrawer-paper': {
            width: drawerWidth,
            boxSizing: 'border-box',
            top: bannerOffset,
            height: `calc(100% - ${bannerOffset})`,
          },
        }}
      >
        <DrawerHeader>
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 1,
              width: '100%',
              px: 2,
              justifyContent: 'space-between',
            }}
          >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Box sx={{ width: 32, height: 32, display: 'flex' }}>
                <AtIcon size={32} title="Logo" />
              </Box>
              <Typography variant="body2" noWrap component="div" sx={{ fontWeight: 600 }}>
                Auto Tournament
              </Typography>
            </Box>
            <IconButton onClick={handleDrawerClose} aria-label={t('layout.closeDrawer')}>
              {theme.direction === 'rtl' ? <ChevronRightIcon /> : <ChevronLeftIcon />}
            </IconButton>
          </Box>
        </DrawerHeader>
        <Divider />
        <List>
          <Tooltip title={!open ? t('nav.dashboard') : ''} placement="right">
            <ListItem disablePadding sx={{ display: 'block' }}>
              <ListItemButton
                selected={location.pathname === '/'}
                onClick={() => handleNavClick('/')}
                component={Link}
                to="/"
                sx={[
                  navItemSx(true),
                  navItemSelectedSx,
                ]}
              >
                <ListItemIcon
                  sx={{
                    minWidth: 0,
                    justifyContent: 'center',
                    mr: 3,
                    color: location.pathname === '/' ? 'primary.main' : 'inherit',
                  }}
                >
                  <HomeIcon />
                </ListItemIcon>
                <ListItemText primary={t('nav.dashboard')} />
              </ListItemButton>
            </ListItem>
          </Tooltip>
          <Tooltip title={!open ? t('nav.manage') : ''} placement="right">
            <ListItem disablePadding sx={{ display: 'block' }}>
              <ListItemButton
                selected={location.pathname === '/manage'}
                onClick={() => handleNavClick('/manage')}
                component={Link}
                to="/manage"
                sx={[
                  navItemSx(true),
                  navItemSelectedSx,
                ]}
              >
                <ListItemIcon
                  sx={{
                    minWidth: 0,
                    justifyContent: 'center',
                    mr: 3,
                    color: location.pathname === '/manage' ? 'primary.main' : 'inherit',
                  }}
                >
                  <InboxIcon />
                </ListItemIcon>
                <ListItemText primary={t('nav.manage')} />
              </ListItemButton>
            </ListItem>
          </Tooltip>
        </List>
        <Divider />
        <List>
          <ListSubheader
            sx={{ px: 2.5 }}
          >
            {t('nav.tournamentSection')}
          </ListSubheader>
          {renderNavItems(mainNavItems)}
        </List>
        <Divider />
        <List>
          <ListSubheader
            sx={{ px: 2.5 }}
          >
            {t('nav.resourcesSection')}
          </ListSubheader>
          {renderNavItems(resourcesNavItems)}
        </List>
        <Divider />
        <List>
          <ListSubheader
            sx={{ px: 2.5 }}
          >
            {t('nav.configurationSection')}
          </ListSubheader>
          {renderNavItems(configurationNavItems)}
        </List>
        <Divider />
        <List>
          <ListSubheader
            sx={{ px: 2.5 }}
          >
            {t('nav.systemSection')}
          </ListSubheader>
          {renderNavItems(systemNavItems)}
        </List>
        <Divider />
        <List>
          <ListItem disablePadding sx={{ display: 'block' }}>
            <ListItemButton
              component="a"
                href="https://docs.autotournament.gg"
              target="_blank"
              rel="noopener noreferrer"
              sx={navItemSx(true)}
            >
              <ListItemIcon sx={{ minWidth: 0, justifyContent: 'center', mr: 3 }}>
                <LibraryBooksIcon />
              </ListItemIcon>
              <ListItemText primary={t('nav.documentation')} />
            </ListItemButton>
          </ListItem>
        </List>
      </MuiDrawer>

      {/* Desktop Drawer (permanent mini variant) */}
      <Drawer variant="permanent" open={open} sx={{ display: { xs: 'none', md: 'block' } }}>
        <DrawerHeader>
          <IconButton onClick={handleDrawerClose} aria-label={t('layout.closeDrawer')}>
            {theme.direction === 'rtl' ? <ChevronRightIcon /> : <ChevronLeftIcon />}
          </IconButton>
        </DrawerHeader>
        <Divider />
        <List>
          <Tooltip title={!open ? t('nav.dashboard') : ''} placement="right">
            <ListItem disablePadding sx={{ display: 'block' }}>
              <ListItemButton
                selected={location.pathname === '/'}
                onClick={() => handleNavClick('/')}
                component={Link}
                to="/"
                sx={[
                  navItemSx(open),
                  navItemSelectedSx,
                ]}
              >
                <ListItemIcon
                  sx={[
                    {
                      minWidth: 0,
                      justifyContent: 'center',
                      color: location.pathname === '/' ? 'primary.main' : 'inherit',
                    },
                    open
                      ? {
                          mr: 3,
                        }
                      : {
                          mr: 'auto',
                        },
                  ]}
                >
                  <HomeIcon />
                </ListItemIcon>
                <ListItemText
                  primary={t('nav.dashboard')}
                  sx={[
                    open
                      ? {
                          opacity: 1,
                        }
                      : {
                          opacity: 0,
                        },
                  ]}
                />
              </ListItemButton>
            </ListItem>
          </Tooltip>
          <Tooltip title={!open ? t('nav.manage') : ''} placement="right">
            <ListItem disablePadding sx={{ display: 'block' }}>
              <ListItemButton
                selected={location.pathname === '/manage'}
                onClick={() => handleNavClick('/manage')}
                component={Link}
                to="/manage"
                sx={[
                  navItemSx(open),
                  navItemSelectedSx,
                ]}
              >
                <ListItemIcon
                  sx={[
                    {
                      minWidth: 0,
                      justifyContent: 'center',
                      color: location.pathname === '/manage' ? 'primary.main' : 'inherit',
                    },
                    open
                      ? {
                          mr: 3,
                        }
                      : {
                          mr: 'auto',
                        },
                  ]}
                >
                  <InboxIcon />
                </ListItemIcon>
                <ListItemText
                  primary={t('nav.manage')}
                  sx={[
                    open
                      ? {
                          opacity: 1,
                        }
                      : {
                          opacity: 0,
                        },
                  ]}
                />
              </ListItemButton>
            </ListItem>
          </Tooltip>
        </List>
        <Divider />
        <List>
          {open && (
            <ListSubheader
              sx={{ px: 2.5 }}
            >
              {t('nav.tournamentSection')}
            </ListSubheader>
          )}
          {renderNavItems(mainNavItems)}
        </List>
        <Divider />
        <List>
          {open && (
            <ListSubheader
              sx={{ px: 2.5 }}
            >
              {t('nav.resourcesSection')}
            </ListSubheader>
          )}
          {renderNavItems(resourcesNavItems)}
        </List>
        <Divider />
        <List>
          {open && (
            <ListSubheader
              sx={{ px: 2.5 }}
            >
              {t('nav.configurationSection')}
            </ListSubheader>
          )}
          {renderNavItems(configurationNavItems)}
        </List>
        <Divider />
        <List>
          {open && (
            <ListSubheader
              sx={{ px: 2.5 }}
            >
              {t('nav.systemSection')}
            </ListSubheader>
          )}
          {renderNavItems(systemNavItems)}
        </List>
        <Divider />
        <List>
          <ListItem disablePadding sx={{ display: 'block' }}>
            <Tooltip title={!open ? t('nav.documentation') : ''} placement="right">
              <ListItemButton
                component="a"
                href="https://docs.autotournament.gg"
                target="_blank"
                rel="noopener noreferrer"
                sx={[
                  navItemSx(open),
                ]}
              >
                <ListItemIcon
                  sx={[
                    { minWidth: 0, justifyContent: 'center' },
                    open ? { mr: 3 } : { mr: 'auto' },
                  ]}
                >
                  <LibraryBooksIcon />
                </ListItemIcon>
                <ListItemText
                  primary={t('nav.documentation')}
                  sx={open ? { opacity: 1 } : { opacity: 0 }}
                />
              </ListItemButton>
            </Tooltip>
          </ListItem>
        </List>
      </Drawer>

      <Box
        component="main"
        sx={{
          flexGrow: 1,
          display: 'flex',
          flexDirection: 'column',
          width: '100%',
          height: `calc(100vh - ${bannerOffset})`,
          overflow: 'hidden',
        }}
      >
        <AppBar position="fixed" open={!isMobile && open} color="inherit" sx={{ displayPrint: 'none' }}>
          <Toolbar>
            <IconButton
              color="inherit"
              aria-label={t('layout.openDrawer')}
              onClick={handleDrawerOpen}
              edge="start"
              sx={[
                {
                  marginRight: 2,
                },
                open && { display: { xs: 'block', md: 'none' } },
              ]}
            >
              <MenuIcon />
            </IconButton>
            <SharedNavBar />
          </Toolbar>
        </AppBar>
        <DrawerHeader />
        <Box
          ref={contentContainerRef}
          sx={{
            width: '100%',
            flexGrow: 1,
            overflow: 'auto',
            p: { xs: 2, sm: 3 },
            display: 'flex',
            justifyContent: 'center',
          }}
        >
          <Box sx={{ width: '100%', maxWidth: (theme) => theme.breakpoints.values.lg }}>
            {/* Page Header */}
            {currentPageHeader && (
              <Box
                sx={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  gap: 2,
                  mb: { xs: 3, md: 4 },
                }}
              >
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.75, minWidth: 0 }}>
                  <Box
                    sx={{
                      width: 44,
                      height: 44,
                      flex: 'none',
                      display: 'grid',
                      placeItems: 'center',
                      borderRadius: `${tokens.radius.md}px`,
                      bgcolor: 'background.paper',
                      border: 1,
                      borderColor: 'divider',
                    }}
                  >
                    <Box
                      component={currentPageHeader.icon}
                      sx={{
                        fontSize: 24,
                        color: currentPageHeader.color || 'primary.main',
                      }}
                    />
                  </Box>
                  <Typography variant="h4" sx={{ minWidth: 0 }}>
                    {currentPageHeader.title}
                  </Typography>
                </Box>
                {headerActions && <Box>{headerActions}</Box>}
              </Box>
            )}
            {/* The tournament's game module is not installed (or may still be
                loading): say so once, on every admin page. */}
            {!tournamentGameLoading &&
              (tournamentIntegration?.notInstalled || tournamentIntegration?.modulePending) && (
              <Box sx={{ mb: 3 }}>
                <ModuleNotInstalledNotice integration={tournamentIntegration} />
              </Box>
            )}
            <Outlet />
          </Box>
        </Box>
      </Box>
    </Box>
  );
}
