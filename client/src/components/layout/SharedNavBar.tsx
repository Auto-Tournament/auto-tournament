import React from 'react';
import {
  Avatar,
  Box,
  Button,
  Divider,
  IconButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
} from '@mui/material';
import ExploreOutlinedIcon from '@mui/icons-material/ExploreOutlined';
import SportsEsportsIcon from '@mui/icons-material/SportsEsports';
import PersonOutlineIcon from '@mui/icons-material/PersonOutline';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import { Link as RouterLink, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../contexts/AuthContext';
import { useSnackbar } from '../../contexts/SnackbarContext';
import { useCurrentMatchStatus } from '../../hooks/useCurrentMatchStatus';
import { CURRENT_TOURNAMENT_ID } from '../../hooks/useTournamentList';
import { FlagIcon, LanguageMenu, useCurrentLanguage } from '../common/LanguageSwitcher';
import { ThemeMenu, ThemeSwatch, activeTheme } from '../common/ThemeSwitcher';
import { DevAccountSwitcherGate } from '../dev/DevAccountSwitcherGate';
import { AtIcon } from '../common/AtIcon';
import { PlayerAvatar } from '../player/PlayerAvatar';
import { generateAvatarDataUrl } from '../../generation/avatar';
import { api } from '../../utils/api';
import { fontDisplay, textSize } from '../../theme/tokens';
import { paths, playerProfilePath, tournamentTabPath } from '../../paths';

/** Top-bar text links: ink2 at rest, ink on hover and on the current page (the drafts' `.nav-links`). */
const navLinkSx = {
  color: 'text.secondary',
  fontWeight: 500,
  fontSize: textSize.sm,
  px: 1.25,
  minWidth: 0,
  whiteSpace: 'nowrap',
  '&:hover': { color: 'text.primary', backgroundColor: 'action.hover' },
} as const;

const PLAYER_AVATAR_CACHE_KEY_PREFIX = 'mat.playerAvatarUrl:';

function readCachedPlayerAvatarUrl(steamId: string): string | undefined {
  try {
    if (typeof window === 'undefined') return undefined;
    const raw = window.localStorage.getItem(`${PLAYER_AVATAR_CACHE_KEY_PREFIX}${steamId}`);
    if (typeof raw !== 'string') return undefined;
    const value = raw.trim();
    if (value === '') return undefined;
    // Only accept http(s) URLs as cached avatars.
    if (!value.startsWith('http')) return undefined;
    return value;
  } catch {
    return undefined;
  }
}

type SiteLink = { to: string; label: string; testId: string; current: boolean };

interface SharedNavBarProps {
  /**
   * Set by the admin shell on the pages its rail lists, so "Manage" reads as
   * where the admin is.
   */
  adminArea?: boolean;
}

/**
 * What goes inside the top bar (`TopNavBar`, the pill): the logo, the site
 * links for the viewer's role, and the account menu, which also holds the
 * theme and language pickers.
 *
 * Links follow the 3.0 drafts: an admin gets Admin, Manage and Browse; a
 * player (or an admin impersonating one) gets Home, Browse, and the current
 * tournament's Teams and Standings tabs.
 */
export const SharedNavBar: React.FC<SharedNavBarProps> = ({ adminArea = false }) => {
  const {
    playerSteamId,
    isAuthenticated,
    needsSteamLink,
    loginWithSteam,
    logout,
    adminProfileName,
    adminProfileAvatarUrl,
    impersonation,
  } = useAuth();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const {
    status: matchStatus,
    label: matchStatusLabel,
    loading: matchStatusLoading,
    viewerTeam,
    vetoActionCount,
    lastVetoActionTeam,
  } = useCurrentMatchStatus(playerSteamId ?? null);
  const { showSnackbar } = useSnackbar();
  const currentLanguage = useCurrentLanguage();

  const [anchorEl, setAnchorEl] = React.useState<null | HTMLElement>(null);
  // The theme and language pickers open from the account menu, anchored to
  // the same button, so they read as its sub-menus.
  const [themeMenuAnchor, setThemeMenuAnchor] = React.useState<null | HTMLElement>(null);
  const [languageMenuAnchor, setLanguageMenuAnchor] = React.useState<null | HTMLElement>(null);
  // Below `md` the site links do not fit next to the account button, so they
  // fold into one menu there.
  const [siteMenuAnchor, setSiteMenuAnchor] = React.useState<null | HTMLElement>(null);
  const location = useLocation();
  const prevMatchRef = React.useRef<{
    status: string;
    label: string | null;
    vetoActionCount: number | null;
  } | null>(null);
  const [playerAvatarUrl, setPlayerAvatarUrl] = React.useState<string | undefined>(undefined);
  const [playerName, setPlayerName] = React.useState<string>('Player');
  const [isLoadingPlayer, setIsLoadingPlayer] = React.useState(false);

  // The admin links are for a real admin session only. While impersonating,
  // the UI behaves as the player and shows the player's links.
  const showAdminLinks = isAuthenticated && !impersonation;

  const handleAvatarMenuOpen = (event: React.MouseEvent<HTMLElement>) => {
    setAnchorEl(event.currentTarget);
  };

  const handleAvatarMenuClose = () => {
    setAnchorEl(null);
  };

  const openSubMenu = (open: (el: HTMLElement) => void) => {
    const anchor = anchorEl;
    setAnchorEl(null);
    if (anchor) open(anchor);
  };

  const handleLogout = () => {
    void logout();
    navigate('/login');
  };

  React.useEffect(() => {
    if (!playerSteamId) {
      setPlayerAvatarUrl(undefined);
      setIsLoadingPlayer(false);
      return;
    }

    let isMounted = true;
    const cachedAvatarUrl = readCachedPlayerAvatarUrl(playerSteamId);
    if (cachedAvatarUrl) {
      setPlayerAvatarUrl(cachedAvatarUrl);
    }
    setIsLoadingPlayer(true);

    const loadPlayerSummary = async () => {
      try {
        const response = await api.get<{
          success: boolean;
          player?: { name: string; avatar?: string | null };
        }>(`/api/players/${playerSteamId}/summary`);

        if (!isMounted) return;

        if (response.success && response.player) {
          setPlayerName(response.player.name);
          const avatarCandidate = response.player.avatar ?? undefined;
          if (typeof avatarCandidate === 'string' && avatarCandidate.trim() !== '') {
            setPlayerAvatarUrl(avatarCandidate);
          } else if (cachedAvatarUrl) {
            setPlayerAvatarUrl(cachedAvatarUrl);
          } else {
            setPlayerAvatarUrl(undefined);
          }
        }
      } catch {
        // Best-effort only; fall back to deterministic SVG avatar.
        if (isMounted) {
          setPlayerAvatarUrl(cachedAvatarUrl);
        }
      } finally {
        if (isMounted) {
          setIsLoadingPlayer(false);
        }
      }
    };

    void loadPlayerSummary();

    return () => {
      isMounted = false;
    };
  }, [playerSteamId]);

  React.useEffect(() => {
    if (!playerSteamId) {
      prevMatchRef.current = null;
      return;
    }
    if (matchStatusLoading) return;
    const prev = prevMatchRef.current;
    const now = { status: matchStatus, label: matchStatusLabel, vetoActionCount };
    // A new veto action landed since the last status we saw. Only credit the
    // opponent when the latest action was actually made by the other team —
    // after the viewer's own ban/pick/side pick the label also flips to
    // "waiting", which previously produced a bogus "opponent moved" toast.
    const newVetoAction =
      prev !== null &&
      typeof prev.vetoActionCount === 'number' &&
      typeof now.vetoActionCount === 'number' &&
      now.vetoActionCount > prev.vetoActionCount;
    const opponentActed =
      newVetoAction && !!viewerTeam && !!lastVetoActionTeam && lastVetoActionTeam !== viewerTeam;
    const labelChanged = !!prev && (prev.status !== now.status || prev.label !== now.label);
    if (prev && (labelChanged || (opponentActed && now.label === 'waiting_veto'))) {
      const msg =
        now.label === 'your_turn_veto'
          ? t('nav.matchStatus.yourTurnVeto')
          : now.label === 'waiting_veto' && opponentActed
            ? t('nav.matchStatus.snackbarOpponentMoved')
            : now.label === 'waiting_veto'
              ? t('nav.matchStatus.waitingVeto')
              : now.label === 'match_ready'
                ? t('nav.matchStatus.matchReady')
                : now.label === 'waiting_server'
                  ? t('nav.matchStatus.waitingServer')
                  : null;
      if (msg) {
        showSnackbar(msg, now.label === 'match_ready' ? 'success' : 'info');
      }
    }
    prevMatchRef.current = now;
  }, [
    playerSteamId,
    matchStatusLoading,
    matchStatus,
    matchStatusLabel,
    vetoActionCount,
    viewerTeam,
    lastVetoActionTeam,
    showSnackbar,
    t,
  ]);

  const ctaLabels: Record<string, string> = {
    your_turn_veto: t('nav.matchStatus.yourTurnVeto'),
    waiting_veto: t('nav.matchStatus.waitingVeto'),
    waiting_server: t('nav.matchStatus.waitingServer'),
    match_ready: t('nav.matchStatus.matchReady'),
  };

  const { pathname } = location;
  const browseLink: SiteLink = {
    to: paths.browse,
    label: t('nav.browse'),
    testId: 'nav-browse',
    current: pathname === paths.browse,
  };
  // The current tournament's Teams and Standings tabs. 3.0 hosts one
  // tournament (`CURRENT_TOURNAMENT_ID`); its page says so when it has none.
  const teamsPath = tournamentTabPath(CURRENT_TOURNAMENT_ID, 'teams');
  const standingsPath = tournamentTabPath(CURRENT_TOURNAMENT_ID, 'standings');
  const siteLinks: SiteLink[] = showAdminLinks
    ? [
        { to: paths.root, label: t('nav.admin'), testId: 'nav-admin', current: pathname === paths.root },
        { to: paths.manage, label: t('nav.manage'), testId: 'nav-manage', current: adminArea },
        browseLink,
      ]
    : [
        { to: paths.root, label: t('nav.home'), testId: 'nav-home', current: pathname === paths.root },
        browseLink,
        { to: teamsPath, label: t('nav.teams'), testId: 'nav-teams', current: pathname === teamsPath },
        {
          to: standingsPath,
          label: t('nav.leaderboards'),
          testId: 'nav-leaderboards',
          current: pathname === standingsPath,
        },
      ];

  const ctaLabel =
    playerSteamId &&
    matchStatus !== 'none' &&
    matchStatusLabel &&
    ctaLabels[matchStatusLabel];

  const signedIn = Boolean(playerSteamId || isAuthenticated);

  return (
    <>
      <Box
        component={RouterLink}
        to={paths.root}
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          minWidth: 0,
          textDecoration: 'none',
          color: 'text.primary',
          fontFamily: fontDisplay,
          fontWeight: 600,
          whiteSpace: 'nowrap',
        }}
      >
        <Box sx={{ height: 26, width: 26, flex: 'none', borderRadius: '7px', overflow: 'hidden', display: 'flex' }}>
          <AtIcon size={26} title="Auto Tournament" />
        </Box>
        <Box
          component="span"
          aria-hidden
          sx={{ display: { xs: 'none', sm: 'inline' }, overflow: 'hidden', textOverflow: 'ellipsis' }}
        >
          Auto Tournament
        </Box>
      </Box>

      <Box
        component="nav"
        aria-label={t('nav.siteMenu')}
        sx={{ display: { xs: 'none', md: 'flex' }, alignItems: 'center', gap: 0.5, flexShrink: 0 }}
      >
        {siteLinks.map((link) => (
          <Button
            key={link.testId}
            color="inherit"
            component={RouterLink}
            to={link.to}
            size="small"
            sx={[navLinkSx, link.current && { color: 'text.primary' }]}
            aria-current={link.current ? 'page' : undefined}
            data-testid={link.testId}
          >
            {link.label}
          </Button>
        ))}
      </Box>
      <Box sx={{ display: { xs: 'flex', md: 'none' } }}>
        <IconButton
          color="inherit"
          size="small"
          aria-label={t('nav.siteMenu')}
          aria-haspopup="menu"
          aria-controls={siteMenuAnchor ? 'site-nav-menu' : undefined}
          aria-expanded={siteMenuAnchor ? 'true' : undefined}
          onClick={(event) => setSiteMenuAnchor(event.currentTarget)}
          sx={{ color: 'text.secondary' }}
          data-testid="nav-site-menu-button"
        >
          <ExploreOutlinedIcon />
        </IconButton>
        <Menu
          id="site-nav-menu"
          anchorEl={siteMenuAnchor}
          open={Boolean(siteMenuAnchor)}
          onClose={() => setSiteMenuAnchor(null)}
          anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
          transformOrigin={{ vertical: 'top', horizontal: 'left' }}
        >
          {siteLinks.map((link) => (
            <MenuItem
              key={link.testId}
              component={RouterLink}
              to={link.to}
              selected={link.current}
              aria-current={link.current ? 'page' : undefined}
              onClick={() => setSiteMenuAnchor(null)}
              data-testid={`${link.testId}-menu-item`}
            >
              {link.label}
            </MenuItem>
          ))}
        </Menu>
      </Box>

      <Box sx={{ ml: 'auto', display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
        {ctaLabel ? (
          <Button
            component={RouterLink}
            to={playerProfilePath(playerSteamId as string)}
            variant="contained"
            color="primary"
            size="small"
            startIcon={<SportsEsportsIcon />}
            sx={{ display: { xs: 'none', sm: 'inline-flex' }, px: 2, whiteSpace: 'nowrap' }}
          >
            {ctaLabel}
          </Button>
        ) : null}
        <DevAccountSwitcherGate />

        {needsSteamLink && (
          <Button color="warning" variant="outlined" onClick={loginWithSteam} size="small">
            {t('nav.linkSteam')}
          </Button>
        )}

        <IconButton
          onClick={handleAvatarMenuOpen}
          size="small"
          sx={{ p: 0 }}
          aria-label={t('nav.accountMenu')}
          aria-haspopup="menu"
          aria-controls={anchorEl ? 'account-menu' : undefined}
          aria-expanded={anchorEl ? 'true' : undefined}
          data-testid="nav-avatar-button"
        >
          {playerSteamId ? (
            <PlayerAvatar
              id={playerSteamId}
              name={playerName}
              avatarUrl={playerAvatarUrl}
              size={32}
              isLoading={isLoadingPlayer}
            />
          ) : isAuthenticated ? (
            <Avatar
              src={
                adminProfileAvatarUrl ||
                generateAvatarDataUrl(`admin:${adminProfileName || 'Admin'}`)
              }
              alt={adminProfileName || 'Admin'}
              sx={{ width: 32, height: 32, bgcolor: 'action.hover' }}
            />
          ) : (
            // Signed out: the menu still holds the theme and language.
            <Avatar sx={{ width: 32, height: 32, bgcolor: 'background.paper', color: 'text.secondary', border: 1, borderColor: 'divider' }}>
              <PersonOutlineIcon fontSize="small" />
            </Avatar>
          )}
        </IconButton>
        <Menu
          id="account-menu"
          anchorEl={anchorEl}
          open={Boolean(anchorEl)}
          onClose={handleAvatarMenuClose}
          anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
          transformOrigin={{ vertical: 'top', horizontal: 'right' }}
          slotProps={{ paper: { sx: { minWidth: 220 } } }}
        >
          {playerSteamId && (
            <MenuItem
              onClick={() => {
                handleAvatarMenuClose();
                navigate(playerProfilePath(playerSteamId));
              }}
            >
              {t('nav.myProfile')}
            </MenuItem>
          )}
          {playerSteamId && (
            <MenuItem
              onClick={() => {
                handleAvatarMenuClose();
                navigate(paths.meConnections);
              }}
              data-testid="nav-account-connections"
            >
              {t('nav.accountConnections')}
            </MenuItem>
          )}
          {playerSteamId && <Divider />}
          <MenuItem
            onClick={() => openSubMenu(setThemeMenuAnchor)}
            aria-haspopup="menu"
            data-testid="theme-switcher-button"
          >
            <ListItemIcon>
              <ThemeSwatch id={activeTheme.id} />
            </ListItemIcon>
            <ListItemText primary={t('nav.theme')} secondary={activeTheme.name} />
            <ChevronRightIcon fontSize="small" sx={{ color: 'text.secondary', ml: 1 }} />
          </MenuItem>
          <MenuItem
            onClick={() => openSubMenu(setLanguageMenuAnchor)}
            aria-haspopup="menu"
            data-testid="language-switcher-button"
          >
            <ListItemIcon>
              <FlagIcon code={currentLanguage.flagCode} />
            </ListItemIcon>
            <ListItemText primary={t('nav.language')} secondary={currentLanguage.label} />
            <ChevronRightIcon fontSize="small" sx={{ color: 'text.secondary', ml: 1 }} />
          </MenuItem>
          <Divider />
          {signedIn ? (
            <MenuItem
              onClick={() => {
                handleAvatarMenuClose();
                handleLogout();
              }}
              data-testid="sign-out-button"
            >
              {t('nav.signOut')}
            </MenuItem>
          ) : (
            <MenuItem
              onClick={() => {
                handleAvatarMenuClose();
                navigate(paths.login);
              }}
              data-testid="sign-in-button"
            >
              {t('nav.signIn')}
            </MenuItem>
          )}
        </Menu>
        <ThemeMenu anchorEl={themeMenuAnchor} onClose={() => setThemeMenuAnchor(null)} />
        <LanguageMenu anchorEl={languageMenuAnchor} onClose={() => setLanguageMenuAnchor(null)} />
      </Box>
    </>
  );
};
