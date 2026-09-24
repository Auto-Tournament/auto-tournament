import React from 'react';
import {
  Avatar,
  Box,
  Button,
  IconButton,
  Menu,
  MenuItem,
} from '@mui/material';
import ExploreOutlinedIcon from '@mui/icons-material/ExploreOutlined';
import SportsEsportsIcon from '@mui/icons-material/SportsEsports';
import { Link as RouterLink, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../contexts/AuthContext';
import { useSnackbar } from '../../contexts/SnackbarContext';
import { useCurrentMatchStatus } from '../../hooks/useCurrentMatchStatus';
import { LanguageSwitcher } from '../common/LanguageSwitcher';
import { ThemeSwitcher } from '../common/ThemeSwitcher';
import { DevAccountSwitcherGate } from '../dev/DevAccountSwitcherGate';
import { AtIcon } from '../common/AtIcon';
import { PlayerAvatar } from '../player/PlayerAvatar';
import { generateAvatarDataUrl } from '../../generation/avatar';
import { api } from '../../utils/api';
import { fontDisplay } from '../../theme/tokens';
import { paths } from '../../paths';

/** Top-bar text links: ink2 at rest, ink on hover, like the website nav. */
const navLinkSx = {
  color: 'text.secondary',
  fontWeight: 500,
  px: { xs: 1, sm: 1.5 },
  minWidth: 0,
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

interface SharedNavBarProps {
  /**
   * Set by the admin shell on the pages its rail lists, so "Manage" reads as
   * where the admin is.
   */
  adminArea?: boolean;
}

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

  const [anchorEl, setAnchorEl] = React.useState<null | HTMLElement>(null);
  // Below `md` the four site links do not fit next to the theme, language and
  // account buttons (at 375px they were drawn under them), so they fold into
  // one menu there.
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

  const handleAvatarMenuOpen = (event: React.MouseEvent<HTMLElement>) => {
    setAnchorEl(event.currentTarget);
  };

  const handleAvatarMenuClose = () => {
    setAnchorEl(null);
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
  // The way into the admin pages: only for a real admin session. While
  // impersonating, the UI behaves as the player and shows no admin links.
  const showAdminLinks = isAuthenticated && !impersonation;
  const siteLinks: { to: string; label: string; testId?: string; current: boolean }[] = [
    { to: '/', label: t('nav.home'), testId: 'nav-home', current: location.pathname === '/' },
    ...(showAdminLinks
      ? [{ to: paths.manage, label: t('nav.manage'), testId: 'nav-manage', current: adminArea }]
      : []),
    {
      to: '/browse',
      label: t('nav.browse'),
      testId: 'nav-browse',
      current: location.pathname === '/browse',
    },
    { to: '/player', label: t('nav.players'), current: location.pathname === '/player' },
    {
      to: '/tournament/1/leaderboard',
      label: t('nav.leaderboard'),
      current: location.pathname === '/tournament/1/leaderboard',
    },
  ];

  const ctaLabel =
    playerSteamId &&
    matchStatus !== 'none' &&
    matchStatusLabel &&
    ctaLabels[matchStatusLabel];

  return (
    <>
      <Box
        sx={{
          flexGrow: 1,
          display: 'flex',
          alignItems: 'center',
          gap: { xs: 1.5, sm: 3 },
          minWidth: 0,
        }}
      >
        <Box
          component={RouterLink}
          to="/"
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            textDecoration: 'none',
            color: 'text.primary',
            fontFamily: fontDisplay,
            fontWeight: 600,
            whiteSpace: 'nowrap',
          }}
        >
          <Box sx={{ height: 30, width: 30, borderRadius: '8px', overflow: 'hidden', display: 'flex' }}>
            <AtIcon size={30} title="Auto Tournament" />
          </Box>
          <Box component="span" aria-hidden sx={{ display: { xs: 'none', lg: 'inline' } }}>
            Auto Tournament
          </Box>
        </Box>

        <Box
          sx={{
            display: { xs: 'none', md: 'flex' },
            alignItems: 'center',
            gap: 1.5,
            flexShrink: 0,
          }}
        >
          {siteLinks.map((link) => (
            <Button
              key={link.to}
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
                key={link.to}
                component={RouterLink}
                to={link.to}
                selected={link.current}
                aria-current={link.current ? 'page' : undefined}
                onClick={() => setSiteMenuAnchor(null)}
                data-testid={link.testId ? `${link.testId}-menu-item` : undefined}
              >
                {link.label}
              </MenuItem>
            ))}
          </Menu>
        </Box>
      </Box>

      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        {/* Reserve space for CTA so match-status changes don't "jump" the header layout */}
        <Box
          sx={{
            display: { xs: 'none', sm: 'flex' },
            alignItems: 'center',
            minWidth: 210,
          }}
        >
          {ctaLabel ? (
            <Button
              component={RouterLink}
              to={`/player/${playerSteamId}`}
              variant="contained"
              color="primary"
              size="small"
              startIcon={<SportsEsportsIcon />}
              sx={{ px: 2 }}
            >
              {ctaLabel}
            </Button>
          ) : null}
        </Box>
        <ThemeSwitcher />
        <LanguageSwitcher />
        <DevAccountSwitcherGate />

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

        {playerSteamId || isAuthenticated ? (
          <>
            <IconButton
              onClick={handleAvatarMenuOpen}
              size="small"
              sx={{ ml: 1 }}
              aria-label={t('nav.accountMenu')}
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
              ) : (
                <Avatar
                  src={
                    adminProfileAvatarUrl ||
                    generateAvatarDataUrl(`admin:${adminProfileName || 'Admin'}`)
                  }
                  alt={adminProfileName || 'Admin'}
                  sx={{ width: 32, height: 32, bgcolor: 'action.hover' }}
                />
              )}
            </IconButton>
            <Menu
              anchorEl={anchorEl}
              open={Boolean(anchorEl)}
              onClose={handleAvatarMenuClose}
              anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
              transformOrigin={{ vertical: 'top', horizontal: 'right' }}
            >
              {/* While impersonating, the UI behaves as the player: no admin entry. */}
              {isAuthenticated && !impersonation && (
                <MenuItem
                  onClick={() => {
                    handleAvatarMenuClose();
                    navigate('/');
                  }}
                >
                  {t('nav.dashboard')}
                </MenuItem>
              )}
              {playerSteamId && (
                <MenuItem
                  onClick={() => {
                    handleAvatarMenuClose();
                    navigate(`/player/${playerSteamId}`);
                  }}
                >
                  {t('nav.myProfile')}
                </MenuItem>
              )}
              {playerSteamId && (
                <MenuItem
                  onClick={() => {
                    handleAvatarMenuClose();
                    navigate('/me/connections');
                  }}
                  data-testid="nav-account-connections"
                >
                  {t('nav.accountConnections')}
                </MenuItem>
              )}
              <MenuItem
                onClick={() => {
                  handleAvatarMenuClose();
                  handleLogout();
                }}
                data-testid="sign-out-button"
              >
                {t('nav.signOut')}
              </MenuItem>
            </Menu>
          </>
        ) : null}
      </Box>
    </>
  );
};

