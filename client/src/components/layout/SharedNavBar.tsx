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
import { PlayerAvatar } from '../player/PlayerAvatar';
import { generateAvatarDataUrl } from '../../generation/avatar';
import { api } from '../../utils/api';

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
  } = useAuth();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { status: matchStatus, label: matchStatusLabel, loading: matchStatusLoading } =
    useCurrentMatchStatus(playerSteamId ?? null);
  const { showSnackbar } = useSnackbar();

  const [anchorEl, setAnchorEl] = React.useState<null | HTMLElement>(null);
  const prevMatchRef = React.useRef<{ status: string; label: string | null } | null>(null);
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
          setPlayerAvatarUrl(response.player.avatar ?? undefined);
        }
      } catch {
        // Best-effort only; fall back to deterministic SVG avatar.
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
    const now = { status: matchStatus, label: matchStatusLabel };
    if (prev && (prev.status !== now.status || prev.label !== now.label)) {
      const msg =
        now.label === 'your_turn_veto'
          ? t('nav.matchStatus.yourTurnVeto')
          : now.label === 'waiting_veto' && prev.label === 'your_turn_veto'
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
  }, [playerSteamId, matchStatusLoading, matchStatus, matchStatusLabel, showSnackbar, t]);

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
          aria-label="open drawer"
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
          gap: 3,
          minWidth: 0,
        }}
      >
        <Box
          component={RouterLink}
          to="/"
          sx={{
            display: 'flex',
            alignItems: 'center',
            textDecoration: 'none',
          }}
        >
          <Box
            component="img"
            src="/icon.svg"
            alt="Matchzy Auto Tournament"
            sx={{ height: 32 }}
          />
        </Box>

        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1.5,
            flexShrink: 0,
          }}
        >
          <Button color="inherit" component={RouterLink} to="/player" size="small">
            {t('nav.players')}
          </Button>
          <Button
            color="inherit"
            component={RouterLink}
            to="/tournament/1/leaderboard"
            size="small"
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
              sx={{ fontWeight: 600, textTransform: 'none', px: 2 }}
            >
              {ctaLabel}
            </Button>
          ) : null}
        </Box>
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
              {isAuthenticated && (
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

