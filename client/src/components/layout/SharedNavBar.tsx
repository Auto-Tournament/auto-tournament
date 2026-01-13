import React from 'react';
import {
  Box,
  Button,
  IconButton,
  Menu,
  MenuItem,
  Typography,
} from '@mui/material';
import MenuIcon from '@mui/icons-material/Menu';
import LibraryBooksIcon from '@mui/icons-material/LibraryBooks';
import LogoutIcon from '@mui/icons-material/Logout';
import { Link as RouterLink, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../contexts/AuthContext';
import { LanguageSwitcher } from '../common/LanguageSwitcher';
import { PlayerAvatar } from '../player/PlayerAvatar';
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
  } = useAuth();
  const { t } = useTranslation();
  const navigate = useNavigate();

  const [anchorEl, setAnchorEl] = React.useState<null | HTMLElement>(null);
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
            gap: 1.5,
            textDecoration: 'none',
          }}
        >
          <Box
            component="img"
            src="/icon.svg"
            alt="Matchzy Auto Tournament Logo"
            sx={{ height: 32 }}
          />
          <Typography
            variant="subtitle2"
            noWrap
            sx={{ fontWeight: 600, color: 'text.primary' }}
          >
            {t('app.name')}
          </Typography>
        </Box>

        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1.5,
            flexShrink: 0,
          }}
        >
          {isAuthenticated && (
            <Button color="inherit" component={RouterLink} to="/" size="small">
              {t('nav.dashboard')}
            </Button>
          )}
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

        {isAuthenticated && (
          <>
            <Button
              color="inherit"
              href="https://mat.sivert.io/"
              target="_blank"
              rel="noopener noreferrer"
              startIcon={<LibraryBooksIcon />}
            >
              {t('nav.documentation')}
            </Button>
            <Button
              color="error"
              onClick={handleLogout}
              startIcon={<LogoutIcon />}
              data-testid="sign-out-button"
            >
              {t('nav.signOut')}
            </Button>
          </>
        )}

        {playerSteamId ? (
          <>
            <IconButton onClick={handleAvatarMenuOpen} size="small" sx={{ ml: 1 }}>
              <PlayerAvatar
                id={playerSteamId}
                name={playerName}
                avatarUrl={playerAvatarUrl}
                size={32}
                isLoading={isLoadingPlayer}
              />
            </IconButton>
            <Menu
              anchorEl={anchorEl}
              open={Boolean(anchorEl)}
              onClose={handleAvatarMenuClose}
              anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
              transformOrigin={{ vertical: 'top', horizontal: 'right' }}
            >
              <MenuItem
                onClick={() => {
                  handleAvatarMenuClose();
                  navigate(`/player/${playerSteamId}`);
                }}
              >
                {t('nav.myProfile')}
              </MenuItem>
              <MenuItem
                onClick={() => {
                  handleAvatarMenuClose();
                  handleLogout();
                }}
              >
                {t('nav.signOut')}
              </MenuItem>
            </Menu>
          </>
        ) : isAuthenticated ? null : (
          <Button
            color="primary"
            variant="outlined"
            size="small"
            onClick={() => navigate('/login')}
          >
            {t('login.signIn')}
          </Button>
        )}
      </Box>
    </>
  );
};

