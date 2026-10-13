import * as React from 'react';
import Box from '@mui/material/Box';
import CssBaseline from '@mui/material/CssBaseline';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { useSnackbar } from '../../contexts/SnackbarContext';
import { usePageHeader } from '../../contexts/PageHeaderContext';
import { ManageRailProvider } from '../../contexts/ManageRailContext';
import { ShellColumnProvider, useShellColumnSlot } from '../../contexts/ShellColumnContext';
import { api } from '../../utils/api';
import { useTranslation } from 'react-i18next';
import { AdminNoticeBell } from '../admin/AdminNoticeBell';
import { ManageRail } from '../manage/ManageRail';
import { TournamentBar, isTournamentPage } from '../manage/TournamentBar';
import { useShellIntegrations } from '../../hooks/useShellIntegrations';
import { ModuleNotInstalledNotice } from '../common/ModuleNotInstalledNotice';
import { RAIL_COLUMN_MIN_WIDTH, railColumnSx } from '../../constants/adminLayout';
import { paths } from '../../paths';
import { UpdateToast } from '../system/UpdateToast';
import { useTopic } from '../../hooks/useTopic';

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
 * The admin shell, Manage's dashboard: the rail (the whole admin menu, at the
 * window's full height; no public top bar) and beside it every admin page.
 *
 * 3.0 dropped the 2.x left drawer. The admin menu is the Manage rail
 * (`ManageRail`), and every admin page renders beside it, so an admin never
 * loses the way around. Its home is `/manage`.
 *
 * The shell prints no page title of its own: each page opens with its own
 * `PageHead` (eyebrow, H1, actions), and sets its own `document.title`
 * through `pageTitle()`. Rail and page share one wide wrap under the header.
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
  const [steamHealthSnackbarKey, setSteamHealthSnackbarKey] = React.useState<
    import('notistack').SnackbarKey | null
  >(null);
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

  // A page that brings its own left column (the setup wizard) puts it beside the page.
  const { claimed: columnClaimed, setColumn } = useShellColumnSlot();

  // Steam's health stays here rather than moving behind the game integration
  // with MatchZy Enhanced's database (3.0 phase E). The warning is about
  // sign-ins and vanity URL lookups: Steam is the platform's own login
  // provider, and an instance running a manually reported Rocket League
  // tournament signs its admins in with it exactly like a CS2 one.
  // Checked again when the server's own check sees the key change (the
  // `steam-health` topic), not on a timer.
  const [steamChecks, setSteamChecks] = React.useState(0);
  const recheckSteam = React.useCallback(() => setSteamChecks((n) => n + 1), []);
  useTopic('steam-health', recheckSteam, { admin: true });
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
        // Not set up yet is not a fault: a fresh install has no Steam key, and the
        // onboarding checklist points to Settings → Sign-in. Only warn when Steam
        // is set up but the key or the connection fails.
        const isUnhealthy = configured !== false && (valid === false || response.success === false);
        // Steam off on purpose is not a fault either, and a warning the admin
        // closed stays closed for this browser session.
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
    // Saving Settings → Sign-in rechecks at once, so a fixed key clears the warning.
    const onSignInChanged = () => void checkSteamHealth();
    window.addEventListener('at:sign-in-settings-changed', onSignInChanged);
    return () => {
      cancelled = true;
      window.removeEventListener('at:sign-in-settings-changed', onSignInChanged);
    };
  }, [steamHealthSnackbarKey, showPersistentError, closeSnackbar, t, steamChecks]);

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
      {/* Manage is its own dashboard: the rail is its whole menu, at the
          window's full height; no public top bar and no header over it. */}
      <Box
        data-testid="admin-shell-content"
        sx={{
          display: 'flex',
          flexDirection: 'column',
          minHeight: '100vh',
          [RAIL_COLUMN_MIN_WIDTH]: { flexDirection: 'row' },
        }}
      >
        <ManageRail />
        <Box
          component="main"
          sx={{
            flex: 1,
            minWidth: 0,
            px: { xs: 2, md: 4.5 },
            pt: { xs: 2, md: 3 },
            pb: 6,
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
            [RAIL_COLUMN_MIN_WIDTH]: { flexDirection: 'row', gap: 3 },
          }}
        >
          {/* A page that brings its own left column (the setup wizard). */}
          {columnClaimed && (
            <Box ref={setColumn} data-testid="admin-shell-column" sx={railColumnSx} />
          )}
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Box
              sx={{ display: 'flex', justifyContent: 'flex-end', mb: 1, minHeight: 40 }}
              data-testid="manage-utility-row"
            >
              <AdminNoticeBell />
            </Box>
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
              <Box
                sx={{
                  display: 'flex',
                  justifyContent: 'flex-end',
                  flexWrap: 'wrap',
                  gap: 1,
                  mb: 3,
                }}
              >
                {headerActions}
              </Box>
            )}
            {/* The tournament's own pages: which tournament, and its tabs. */}
            {isTournamentPage(location.pathname) && <TournamentBar />}
            <UpdateToast />
            <Outlet />
          </Box>
        </Box>
      </Box>
    </ManageRailProvider>
  );
}
