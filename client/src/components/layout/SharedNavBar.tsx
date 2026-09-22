import React from 'react';
import {
  Avatar,
  Box,
  Button,
  IconButton,
  Menu,
  MenuItem,
} from '@mui/material';
import MenuIcon from '@mui/icons-material/Menu';
import SportsEsportsIcon from '@mui/icons-material/SportsEsports';
import { Link as RouterLink, useNavigate } from 'react-router-dom';
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
   * Optional sidebar menu button for admin layouts.
   * When rendered in public layouts, this is typically omitted.
   */
  showMenuButton?: boolean;
  onMenuClick?: () => void;
}

export const SharedNavBar: React.FC<SharedNavBarProps> = ({
  showMenuButton,
  onMenuClick,
}) => {
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
  const ctaLabel =
    playerSteamId &&
    matchStatus !== 'none' &&
    matchStatusLabel &&
    ctaLabels[matchStatusLabel];

  return (
    <>
      {showMenuButton && (
        <IconButton
          color="inherit"
          aria-label={t('layout.openDrawer')}
          onClick={onMenuClick}
          edge="start"
          sx={{ mr: 2 }}
        >
          <MenuIcon />
        </IconButton>
      )}

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
            display: 'flex',
            alignItems: 'center',
            gap: { xs: 0, sm: 1.5 },
            flexShrink: 0,
          }}
        >
          <Button
            color="inherit"
            component={RouterLink}
            to="/"
            size="small"
            sx={navLinkSx}
            data-testid="nav-home"
          >
            {t('nav.home')}
          </Button>
          <Button
            color="inherit"
            component={RouterLink}
            to="/browse"
            size="small"
            sx={navLinkSx}
            data-testid="nav-browse"
          >
            {t('nav.browse')}
          </Button>
          <Button color="inherit" component={RouterLink} to="/player" size="small" sx={navLinkSx}>
            {t('nav.players')}
          </Button>
          <Button
            color="inherit"
            component={RouterLink}
            to="/tournament/1/leaderboard"
            size="small"
            sx={navLinkSx}
          >
            {t('nav.leaderboard')}
          </Button>
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

