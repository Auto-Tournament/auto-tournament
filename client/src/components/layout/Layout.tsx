import * as React from 'react';
import Box from '@mui/material/Box';
import Container from '@mui/material/Container';
import CssBaseline from '@mui/material/CssBaseline';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { useSnackbar } from '../../contexts/SnackbarContext';
import { usePageHeader } from '../../contexts/PageHeaderContext';
import { ManageRailProvider } from '../../contexts/ManageRailContext';
import { ShellColumnProvider, useShellColumnSlot } from '../../contexts/ShellColumnContext';
import { api } from '../../utils/api';
import { useTranslation } from 'react-i18next';
import { TopNavBar } from './TopNavBar';
import { ManageRail } from '../manage/ManageRail';
import { useShellIntegrations } from '../../hooks/useShellIntegrations';
import { ModuleNotInstalledNotice } from '../common/ModuleNotInstalledNotice';
import { RAIL_COLUMN_MIN_WIDTH, railColumnSx } from '../../constants/adminLayout';
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
 * The admin shell: the top bar, and below it every admin page.
 *
 * 3.0 dropped the 2.x left drawer. The admin menu is the Manage rail
 * (`ManageRail`), and every admin page renders beside it, so an admin never
 * loses the way around. The admin home ("/") is the landing page with its own
 * links to everything, and has no rail, as in the 3.0 designs.
 *
 * The shell prints no page title of its own: each page opens with its own
 * `PageHead` (eyebrow, H1, actions), and sets its own `document.title`
 * through `pageTitle()`. Rail and page share the one 1200px wrap every page
 * uses, under the same floating top bar as the public pages.
 *
 * A page can take the rail's column for its own navigation (the tournament
 * setup wizard, through `useShellColumn`): the shell then renders the column
 * empty, and the page fills it.
 */
export default function Layout() {
  return (
    <ShellColumnProvider>
      <AdminShell />
    </ShellColumnProvider>
  );
}

function AdminShell() {
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

  // One read of the tournament for the shell's game-dependent parts: what the
  // game's module needs an admin to fix before it can run (phase E: CS2's
  // webhook URL and its plugin's database), and whether the module is there
  // at all. The rail reads the same hook for its links.
  const { tournament: tournamentIntegration, loading: tournamentGameLoading } =
    useShellIntegrations();
  const AdminGlobalWarning = tournamentGameLoading
    ? undefined
    : tournamentIntegration?.adminGlobalWarning;

  // The admin home is the landing page and links to everything itself.
  const showRail = location.pathname !== paths.root;
  // A page that brings its own left column (the setup wizard) replaces the rail.
  const { claimed: columnClaimed, setColumn } = useShellColumnSlot();

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

  // A new page starts at the top, as a full page load would.
  React.useEffect(() => {
    window.scrollTo(0, 0);
  }, [location.pathname]);

  return (
    <ManageRailProvider>
      <CssBaseline />
      {/* The game module's own global warning, or nothing (3.0 phase E). */}
      {AdminGlobalWarning && <AdminGlobalWarning onOpenSettings={handleOpenSettingsFromSnackbar} />}
      <TopNavBar adminArea={showRail} />
      <Container component="main" maxWidth="lg" sx={{ py: { xs: 3, md: 6 } }}>
        <Box
          data-testid="admin-shell-content"
          sx={{
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
            minWidth: 0,
            [RAIL_COLUMN_MIN_WIDTH]: showRail ? { flexDirection: 'row', gap: 3 } : {},
          }}
        >
          {showRail &&
            (columnClaimed ? (
              <Box ref={setColumn} data-testid="admin-shell-column" sx={railColumnSx} />
            ) : (
              <ManageRail />
            ))}
          <Box sx={{ flex: 1, minWidth: 0 }}>
            {/* The tournament's game module is not installed (or may still be
                loading): say so once, on every admin page. */}
            {!tournamentGameLoading &&
              (tournamentIntegration?.notInstalled || tournamentIntegration?.modulePending) && (
              <Box sx={{ mb: 3 }}>
                <ModuleNotInstalledNotice integration={tournamentIntegration} />
              </Box>
            )}
            {/* Deprecated (client API 0.2.3): buttons a module page on the
                old API hands the shell. Core's pages and CS2's put theirs in
                their own PageHead. */}
            {headerActions && (
              <Box sx={{ display: 'flex', justifyContent: 'flex-end', flexWrap: 'wrap', gap: 1, mb: 3 }}>
                {headerActions}
              </Box>
            )}
            <Outlet />
          </Box>
        </Box>
      </Container>
    </ManageRailProvider>
  );
}
