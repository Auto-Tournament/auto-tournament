import * as React from 'react';
import { styled, useTheme, Theme, CSSObject } from '@mui/material/styles';
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
import Button from '@mui/material/Button';
import Tooltip from '@mui/material/Tooltip';
import Stack from '@mui/material/Stack';
import ListSubheader from '@mui/material/ListSubheader';
import useMediaQuery from '@mui/material/useMediaQuery';
import { Outlet, useNavigate, useLocation, Link } from 'react-router-dom';
import {
  LibraryBooks,
  Logout,
  Home as HomeIcon,
  Dashboard as DashboardIcon,
  BugReport as BugReportIcon,
} from '@mui/icons-material';
import EmojiEventsIcon from '@mui/icons-material/EmojiEvents';
import AccountTreeIcon from '@mui/icons-material/AccountTree';
import GroupsIcon from '@mui/icons-material/Groups';
import PersonIcon from '@mui/icons-material/Person';
import StorageIcon from '@mui/icons-material/Storage';
import SportsEsportsIcon from '@mui/icons-material/SportsEsports';
import CampaignIcon from '@mui/icons-material/Campaign';
import SettingsIcon from '@mui/icons-material/Settings';
import BuildIcon from '@mui/icons-material/Build';
import MapIcon from '@mui/icons-material/Map';
import DescriptionIcon from '@mui/icons-material/Description';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import PublicIcon from '@mui/icons-material/Public';
import { useAuth } from '../../contexts/AuthContext';
import { usePageHeader } from '../../contexts/PageHeaderContext';
import { useSnackbar } from '../../contexts/SnackbarContext';
import { api } from '../../utils/api';
import type { SettingsResponse } from '../../types/api.types';
import { useIsDevelopment } from '../../hooks/useIsDevelopment';
import { useTranslation } from 'react-i18next';
import { LanguageSwitcher } from '../common/LanguageSwitcher';

const drawerWidth = 240;

const openedMixin = (theme: Theme): CSSObject => ({
  width: drawerWidth,
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
  const { logout, needsSteamLink, loginWithSteam } = useAuth();
  const { headerActions } = usePageHeader();
  const { showError } = useSnackbar();
  const hasShownWebhookWarningRef = React.useRef(false);
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const contentContainerRef = React.useRef<HTMLDivElement>(null);
  const [webhookConfigured, setWebhookConfigured] = React.useState<boolean | null>(null);
  const [open, setOpen] = React.useState(() => {
    if (typeof window !== 'undefined') {
      // Check localStorage first, then fall back to screen size
      const stored = localStorage.getItem('sidebarOpen');
      if (stored !== null) {
        return stored === 'true';
      }
      return window.innerWidth >= theme.breakpoints.values.md;
    }
    return false;
  });

  const isDevelopment = useIsDevelopment();

  // Page header configuration - maps routes to their titles and icons
  const pageHeaders: Record<string, { title: string; icon: React.ComponentType; color?: string }> =
    {
      '/': { title: t('layout.pageTitle.dashboard'), icon: DashboardIcon },
      '/tournament': { title: t('layout.pageTitle.tournament'), icon: EmojiEventsIcon },
      '/bracket': { title: t('layout.pageTitle.bracket'), icon: AccountTreeIcon },
      '/matches': { title: t('layout.pageTitle.matches'), icon: SportsEsportsIcon },
      '/teams': { title: t('layout.pageTitle.teams'), icon: GroupsIcon },
      '/players': { title: t('layout.pageTitle.players'), icon: PersonIcon },
      '/servers': { title: t('layout.pageTitle.servers'), icon: StorageIcon },
      '/maps': { title: t('layout.pageTitle.maps'), icon: MapIcon },
      '/templates': { title: t('layout.pageTitle.templates'), icon: DescriptionIcon },
      '/elo-templates': { title: t('layout.pageTitle.eloTemplates'), icon: TrendingUpIcon },
      '/admin': { title: t('layout.pageTitle.adminTools'), icon: CampaignIcon },
      '/settings': { title: t('layout.pageTitle.settings'), icon: SettingsIcon },
      '/dev': {
        title: t('layout.pageTitle.devTools'),
        icon: BugReportIcon,
        color: 'warning.main',
      },
      '/public': { title: t('layout.pageTitle.publicLinks'), icon: PublicIcon },
    };

  // Get current page header config
  const currentPageHeader = pageHeaders[location.pathname];

  // Group navigation items logically
  const mainNavItems = [
    { label: t('nav.tournament'), path: '/tournament', icon: EmojiEventsIcon },
    { label: t('nav.bracket'), path: '/bracket', icon: AccountTreeIcon },
    { label: t('nav.matches'), path: '/matches', icon: SportsEsportsIcon },
  ];

  const resourcesNavItems = [
    { label: t('nav.teams'), path: '/teams', icon: GroupsIcon },
    { label: t('nav.players'), path: '/players', icon: PersonIcon },
    { label: t('nav.servers'), path: '/servers', icon: StorageIcon },
    { label: t('nav.maps'), path: '/maps', icon: MapIcon },
  ];

  const configurationNavItems = [
    { label: t('nav.templates'), path: '/templates', icon: DescriptionIcon },
    { label: t('nav.eloTemplates'), path: '/elo-templates', icon: TrendingUpIcon },
    { label: t('nav.settings'), path: '/settings', icon: SettingsIcon },
  ];

  const systemNavItems = [
    { label: t('nav.adminTools'), path: '/admin', icon: CampaignIcon },
    { label: t('nav.publicLinks'), path: '/public', icon: PublicIcon },
    ...(isDevelopment ? [{ label: t('nav.devTools'), path: '/dev', icon: BuildIcon }] : []),
  ];

  React.useEffect(() => {
    let isMounted = true;

    const loadSettings = async () => {
      try {
        const response = await api.get<SettingsResponse>('/api/settings');
        if (isMounted) {
          setWebhookConfigured(Boolean(response.settings?.webhookConfigured));
        }
      } catch {
        if (isMounted) {
          setWebhookConfigured(false);
        }
      }
    };

    loadSettings();

    const handleSettingsUpdated = (event: Event) => {
      const customEvent = event as CustomEvent<SettingsResponse['settings']>;
      setWebhookConfigured(Boolean(customEvent.detail?.webhookConfigured));
    };

    window.addEventListener('matchzy:settingsUpdated', handleSettingsUpdated);

    return () => {
      isMounted = false;
      window.removeEventListener('matchzy:settingsUpdated', handleSettingsUpdated);
    };
  }, []);

  // Show a single global snackbar when webhook is not configured
  const handleOpenSettingsFromSnackbar = React.useCallback(() => {
    navigate('/settings');
  }, [navigate]);

  React.useEffect(() => {
    if (webhookConfigured === false && !hasShownWebhookWarningRef.current) {
      hasShownWebhookWarningRef.current = true;
      showError(
        <Box display="flex" alignItems="center" gap={1}>
          <Box component="span" sx={{ mr: 1 }}>
            {t('layout.webhookNotConfigured')}
          </Box>
          <Button
            color="inherit"
            size="small"
            onClick={handleOpenSettingsFromSnackbar}
            sx={{ textDecoration: 'underline' }}
          >
            {t('layout.openSettings')}
          </Button>
        </Box>
      );
    }

    if (webhookConfigured === true) {
      hasShownWebhookWarningRef.current = false;
    }
  }, [webhookConfigured, showError, handleOpenSettingsFromSnackbar, t]);

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

  const handleLogout = () => {
    // Best-effort async logout; navigation does not wait on the network call.
    void logout();
    navigate('/login');
  };

  // Persist sidebar state to localStorage
  React.useEffect(() => {
    // Only persist on desktop (md and up), not mobile
    if (!isMobile) {
      localStorage.setItem('sidebarOpen', open.toString());
    }
  }, [open, isMobile]);

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
                {
                  minHeight: 48,
                  px: 2.5,
                },
                open
                  ? {
                      justifyContent: 'initial',
                    }
                  : {
                      justifyContent: 'center',
                    },
                {
                  '&.Mui-selected': {
                    backgroundColor: 'primary.main',
                    color: 'primary.contrastText',
                    '&:hover': {
                      backgroundColor: 'primary.dark',
                    },
                    '& .MuiListItemIcon-root': {
                      color: 'primary.contrastText',
                    },
                  },
                },
              ]}
            >
              <ListItemIcon
                sx={[
                  {
                    minWidth: 0,
                    justifyContent: 'center',
                    color: isActive(item.path)
                      ? open
                        ? 'primary.contrastText'
                        : 'primary.main'
                      : 'inherit',
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
    <Box sx={{ display: 'flex', minHeight: '100vh' }}>
      <CssBaseline />
      {/* Mobile Drawer (temporary) */}
      <MuiDrawer
        variant="temporary"
        open={open}
        onClose={handleDrawerClose}
        ModalProps={{
          keepMounted: true,
        }}
        sx={{
          display: { xs: 'block', md: 'none' },
          '& .MuiDrawer-paper': {
            width: drawerWidth,
            boxSizing: 'border-box',
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
              <Box component="img" src="/icon.svg" alt="Logo" sx={{ width: 32, height: 32 }} />
              <Typography variant="body2" noWrap component="div" sx={{ fontWeight: 600 }}>
                Matchzy Auto Tournament
              </Typography>
            </Box>
            <IconButton onClick={handleDrawerClose}>
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
                  {
                    minHeight: 48,
                    px: 2.5,
                    justifyContent: 'initial',
                  },
                  {
                    '&.Mui-selected': {
                      backgroundColor: 'primary.main',
                      color: 'primary.contrastText',
                      '&:hover': {
                        backgroundColor: 'primary.dark',
                      },
                      '& .MuiListItemIcon-root': {
                        color: 'primary.contrastText',
                      },
                    },
                  },
                ]}
              >
                <ListItemIcon
                  sx={{
                    minWidth: 0,
                    justifyContent: 'center',
                    mr: 3,
                    color: location.pathname === '/' ? 'primary.contrastText' : 'inherit',
                  }}
                >
                  <HomeIcon />
                </ListItemIcon>
                <ListItemText primary={t('nav.dashboard')} />
              </ListItemButton>
            </ListItem>
          </Tooltip>
        </List>
        <Divider />
        <List>
          <ListSubheader
            sx={{
              fontSize: 12,
              fontWeight: 600,
              height: 36,
              px: 2.5,
              py: 0,
              lineHeight: '36px',
            }}
          >
            {t('nav.tournamentSection')}
          </ListSubheader>
          {renderNavItems(mainNavItems)}
        </List>
        <Divider />
        <List>
          <ListSubheader
            sx={{
              fontSize: 12,
              fontWeight: 600,
              height: 36,
              px: 2.5,
              py: 0,
              lineHeight: '36px',
            }}
          >
            {t('nav.resourcesSection')}
          </ListSubheader>
          {renderNavItems(resourcesNavItems)}
        </List>
        <Divider />
        <List>
          <ListSubheader
            sx={{
              fontSize: 12,
              fontWeight: 600,
              height: 36,
              px: 2.5,
              py: 0,
              lineHeight: '36px',
            }}
          >
            {t('nav.configurationSection')}
          </ListSubheader>
          {renderNavItems(configurationNavItems)}
        </List>
        <Divider />
        <List>
          <ListSubheader
            sx={{
              fontSize: 12,
              fontWeight: 600,
              height: 36,
              px: 2.5,
              py: 0,
              lineHeight: '36px',
            }}
          >
            {t('nav.systemSection')}
          </ListSubheader>
          {renderNavItems(systemNavItems)}
        </List>
      </MuiDrawer>

      {/* Desktop Drawer (permanent mini variant) */}
      <Drawer variant="permanent" open={open}>
        <DrawerHeader>
          <IconButton onClick={handleDrawerClose}>
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
                  {
                    minHeight: 48,
                    px: 2.5,
                  },
                  open
                    ? {
                        justifyContent: 'initial',
                      }
                    : {
                        justifyContent: 'center',
                      },
                  {
                    '&.Mui-selected': {
                      backgroundColor: 'primary.main',
                      color: 'primary.contrastText',
                      '&:hover': {
                        backgroundColor: 'primary.dark',
                      },
                      '& .MuiListItemIcon-root': {
                        color: 'primary.contrastText',
                      },
                    },
                  },
                ]}
              >
                <ListItemIcon
                  sx={[
                    {
                      minWidth: 0,
                      justifyContent: 'center',
                      color:
                        location.pathname === '/'
                          ? open
                            ? 'primary.contrastText'
                            : 'primary.main'
                          : 'inherit',
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
        </List>
        <Divider />
        <List>
          {open && (
            <ListSubheader
              sx={{
                fontSize: 12,
                fontWeight: 600,
                height: 36,
                px: 2.5,
                py: 0,
                lineHeight: '36px',
              }}
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
              sx={{
                fontSize: 12,
                fontWeight: 600,
                height: 36,
                px: 2.5,
                py: 0,
                lineHeight: '36px',
              }}
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
              sx={{
                fontSize: 12,
                fontWeight: 600,
                height: 36,
                px: 2.5,
                py: 0,
                lineHeight: '36px',
              }}
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
              sx={{
                fontSize: 12,
                fontWeight: 600,
                height: 36,
                px: 2.5,
                py: 0,
                lineHeight: '36px',
              }}
            >
              {t('nav.systemSection')}
            </ListSubheader>
          )}
          {renderNavItems(systemNavItems)}
        </List>
      </Drawer>

      <Box
        component="main"
        sx={{
          flexGrow: 1,
          display: 'flex',
          flexDirection: 'column',
          width: '100%',
          height: '100vh',
          overflow: 'hidden',
        }}
      >
        <AppBar position="fixed" open={open} color="inherit" sx={{ displayPrint: 'none' }}>
          <Toolbar>
            <IconButton
              color="inherit"
              aria-label="open drawer"
              onClick={handleDrawerOpen}
              edge="start"
              sx={[
                {
                  marginRight: 5,
                },
                open && { display: { xs: 'block', md: 'none' } },
              ]}
            >
              <MenuIcon />
            </IconButton>
            <Link to="/" style={{ textDecoration: 'none', display: 'flex', alignItems: 'center' }}>
              <Box component="img" src="/icon.svg" alt="Logo" sx={{ maxHeight: 40, mr: 1 }} />
              <Typography
                variant="body2"
                noWrap
                component="div"
                sx={{ fontWeight: 600, color: 'text.primary' }}
              >
                {t('app.name')}
              </Typography>
            </Link>
            <Box sx={{ flexGrow: 1 }} />
            <Stack direction="row" alignItems="center" spacing={1}>
              <LanguageSwitcher />
              {needsSteamLink && (
                <Button
                  color="warning"
                  variant="outlined"
                  onClick={loginWithSteam}
                  size="small"
                >
                  {t('nav.linkSteam')}
                </Button>
              )}
              <Button
                color="inherit"
                href="https://mat.sivert.io/"
                target="_blank"
                rel="noopener noreferrer"
                startIcon={<LibraryBooks />}
              >
                {t('nav.documentation')}
              </Button>
              <Button
                color="error"
                onClick={handleLogout}
                startIcon={<Logout />}
                data-testid="sign-out-button"
              >
                {t('nav.signOut')}
              </Button>
            </Stack>
          </Toolbar>
        </AppBar>
        <DrawerHeader />
        <Box
          ref={contentContainerRef}
          sx={{
            width: '100%',
            flexGrow: 1,
            overflow: 'auto',
            p: 3,
            display: 'flex',
            justifyContent: 'center',
          }}
        >
          <Box sx={{ width: '100%', maxWidth: (theme) => theme.breakpoints.values.lg }}>
            {/* Page Header */}
            {currentPageHeader && (
              <Box display="flex" justifyContent="space-between" alignItems="center" mb={4}>
                <Box display="flex" alignItems="center" gap={2}>
                  <Box
                    sx={{
                      width: 48,
                      height: 48,
                      display: 'grid',
                      placeItems: 'center',
                    }}
                  >
                    <Box
                      component={currentPageHeader.icon}
                      sx={{
                        fontSize: 40,
                        color: currentPageHeader.color || 'primary.main',
                      }}
                    />
                  </Box>
                  <Typography variant="h4" fontWeight={600}>
                    {currentPageHeader.title}
                  </Typography>
                </Box>
                {headerActions && <Box>{headerActions}</Box>}
              </Box>
            )}
            <Outlet />
          </Box>
        </Box>
      </Box>
    </Box>
  );
}
