import * as React from 'react';
import { tokens } from '../../theme/tokens';
import Box from '@mui/material/Box';
import AppBar from '@mui/material/AppBar';
import Toolbar from '@mui/material/Toolbar';
import CssBaseline from '@mui/material/CssBaseline';
import Typography from '@mui/material/Typography';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { Dashboard as DashboardIcon, BugReport as BugReportIcon } from '@mui/icons-material';
import InboxIcon from '@mui/icons-material/Inbox';
import EmojiEventsIcon from '@mui/icons-material/EmojiEvents';
import AccountTreeIcon from '@mui/icons-material/AccountTree';
import GroupsIcon from '@mui/icons-material/Groups';
import PersonIcon from '@mui/icons-material/Person';
import SportsEsportsIcon from '@mui/icons-material/SportsEsports';
import CampaignIcon from '@mui/icons-material/Campaign';
import SettingsIcon from '@mui/icons-material/Settings';
import DescriptionIcon from '@mui/icons-material/Description';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import GavelIcon from '@mui/icons-material/Gavel';
import ExtensionIcon from '@mui/icons-material/Extension';
import { usePageHeader } from '../../contexts/PageHeaderContext';
import { useSnackbar } from '../../contexts/SnackbarContext';
import { ManageRailProvider } from '../../contexts/ManageRailContext';
import { api } from '../../utils/api';
import { useTranslation } from 'react-i18next';
import { SharedNavBar } from './SharedNavBar';
import { ManageRail } from '../manage/ManageRail';
import { useShellIntegrations } from '../../hooks/useShellIntegrations';
import { moduleNavItems, navItemLabel } from '../../utils/moduleNavLabels';
import { ModuleNotInstalledNotice } from '../common/ModuleNotInstalledNotice';
import { RAIL_COLUMN_MIN_WIDTH } from '../../constants/adminLayout';
import { paths } from '../../paths';


/**
 * Set for the rest of the browser session once an admin closes the Steam
 * warning: it said what it had to say, and it came back on every page load.
 * Storage can be missing or refuse (private mode): the warning then simply
 * shows again next load.
 */
const STEAM_WARNING_DISMISSED_KEY = 'mat.steamWarningDismissed';

function steamWarningDismissed(): boolean {
  try {
    return window.sessionStorage.getItem(STEAM_WARNING_DISMISSED_KEY) === '1';
  } catch {
    return false;
  }
}

function rememberSteamWarningDismissed(): void {
  try {
    window.sessionStorage.setItem(STEAM_WARNING_DISMISSED_KEY, '1');
  } catch {
    // Not remembered; it shows again next load.
  }
}

/**
 * Height of the impersonation banner (0px when it is not shown). The banner is
 * rendered above the whole app, so the fixed header has to start below it –
 * otherwise the header covers the banner and its "stop impersonating" button
 * cannot be clicked.
 */
const bannerOffset = `var(--mat-impersonation-height, 0px)`;

/** Rail column + the gap beside it, on top of the page's own max width. */
const RAIL_COLUMN_SPACE = 220 + 24;

/**
 * The admin shell: the top bar, and below it every admin page.
 *
 * 3.0 dropped the 2.x left drawer. The admin menu is the Manage rail
 * (`ManageRail`), and every admin page renders beside it, so an admin never
 * loses the way around. The admin home ("/") is the landing page with its own
 * links to everything, and has no rail, as in the 3.0 designs.
 */
export default function Layout() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const { headerActions } = usePageHeader();
  const { showPersistentError, closeSnackbar } = useSnackbar();
  const [steamHealthSnackbarKey, setSteamHealthSnackbarKey] = React.useState<import('notistack').SnackbarKey | null>(
    null
  );
  // True while the shell itself closes the Steam warning (Steam recovered, or
  // the shell unmounts), so that close is not taken for the admin's dismissal.
  const closingSteamWarningRef = React.useRef(false);
  // Whether the warning is on screen right now, for the unmount cleanup below
  // (which cannot read state). Only a warning that is showing gets closed by
  // the shell: otherwise React's development double-mount would arm
  // `closingSteamWarningRef` with nothing to close, and swallow the admin's
  // real dismissal later.
  const steamWarningShownRef = React.useRef(false);
  const contentContainerRef = React.useRef<HTMLDivElement>(null);

  // One read of the tournament for the shell's game-dependent parts: the
  // pages the game's module adds (CS2: Servers, Maps) for the page titles
  // below, and what the module needs an admin to fix before it can run
  // (phase E: CS2's webhook URL and its plugin's database). The rail reads
  // the same hook for its links.
  //
  // Each title is labelled from its module's own strings
  // (`cs2:layout.pageTitle.servers`), never from core's.
  const {
    shell,
    tournament: tournamentIntegration,
    loading: tournamentGameLoading,
  } = useShellIntegrations();
  const integrationNavItems = moduleNavItems(shell);
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
      [paths.eloTemplates]: { title: t('layout.pageTitle.eloTemplates'), icon: TrendingUpIcon },
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

  // The admin home is the landing page and links to everything itself.
  const showRail = location.pathname !== paths.root;

  // Steam's health stays here rather than moving behind the game integration
  // with the Auto Tournament CS2 plugin's database (3.0 phase E). The warning is about
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
          /** False when Steam sign-in is turned off on purpose (AUTH_STEAM_ENABLED=false). */
          signInEnabled?: boolean;
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
        // Steam off on purpose is not a fault, and a warning the admin closed
        // stays closed for this browser session.
        const shouldWarn =
          isUnhealthy && response.signInEnabled !== false && !steamWarningDismissed();

        if (shouldWarn) {
          if (!steamHealthSnackbarKey) {
            const key = showPersistentError(
              <span>
                <strong>{t('layout.steamUnavailable.title')}</strong> —{' '}
                {t('layout.steamUnavailable.body')}
              </span>,
              'steam-api-health',
              {
                onClose: () => {
                  steamWarningShownRef.current = false;
                  if (closingSteamWarningRef.current) {
                    closingSteamWarningRef.current = false;
                    return;
                  }
                  rememberSteamWarningDismissed();
                  setSteamHealthSnackbarKey(null);
                },
              }
            );
            steamWarningShownRef.current = true;
            setSteamHealthSnackbarKey(key);
          }
        } else if (steamHealthSnackbarKey) {
          if (steamWarningShownRef.current) {
            closingSteamWarningRef.current = true;
            closeSnackbar(steamHealthSnackbarKey);
          }
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

  // The Steam warning belongs to the admin shell. Without this it outlived the
  // shell: after "Sign out" it was still on the login page, in front of a
  // visitor who can do nothing about it.
  React.useEffect(() => {
    return () => {
      if (!steamWarningShownRef.current) return;
      closingSteamWarningRef.current = true;
      closeSnackbar('steam-api-health');
    };
  }, [closeSnackbar]);

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

  // Scroll to top when route changes
  React.useEffect(() => {
    if (contentContainerRef.current) {
      contentContainerRef.current.scrollTo({
        top: 0,
        behavior: 'smooth',
      });
    }
  }, [location.pathname]);

  return (
    <ManageRailProvider>
      <Box
        sx={{
          display: 'flex',
          flexDirection: 'column',
          height: `calc(100vh - ${bannerOffset})`,
          overflow: 'hidden',
        }}
      >
        <CssBaseline />
        {/* The game module's own global warning, or nothing (3.0 phase E). */}
        {AdminGlobalWarning && <AdminGlobalWarning onOpenSettings={handleOpenSettingsFromSnackbar} />}
        <AppBar position="fixed" color="inherit" sx={{ top: bannerOffset, displayPrint: 'none' }}>
          <Toolbar>
            <SharedNavBar adminArea={showRail} />
          </Toolbar>
        </AppBar>
        {/* Room for the fixed top bar. */}
        <Toolbar aria-hidden sx={{ flex: 'none', displayPrint: 'none' }} />
        <Box
          component="main"
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
          <Box
            data-testid="admin-shell-content"
            sx={(theme) => ({
              width: '100%',
              minWidth: 0,
              maxWidth: showRail
                ? theme.breakpoints.values.lg + RAIL_COLUMN_SPACE
                : theme.breakpoints.values.lg,
              display: 'flex',
              flexDirection: 'column',
              gap: 2,
              [RAIL_COLUMN_MIN_WIDTH]: showRail ? { flexDirection: 'row', gap: 3 } : {},
            })}
          >
            {showRail && <ManageRail />}
            <Box sx={{ flex: 1, minWidth: 0 }}>
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
                  {/* Pages hand in a flex row of buttons. On a phone that row
                      is wider than the screen: let it wrap instead of squeezing
                      every label onto two or three lines (or off the edge). */}
                  {headerActions && (
                    <Box
                      sx={(theme) => ({
                        maxWidth: '100%',
                        // `&&` outranks the page's own `gap` on the same element.
                        '&& > *': { flexWrap: 'wrap' },
                        '& .MuiButton-root': { whiteSpace: 'nowrap' },
                        [theme.breakpoints.down('sm')]: { '&& > *': { gap: theme.spacing(1) } },
                      })}
                    >
                      {headerActions}
                    </Box>
                  )}
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
    </ManageRailProvider>
  );
}
