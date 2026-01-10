import React from 'react';
import { AppBar, Box, Button, IconButton, Menu, MenuItem, Toolbar, Typography } from '@mui/material';
import { Link as RouterLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { api } from '../../utils/api';
import { PlayerAvatar } from '../player/PlayerAvatar';
import { useTranslation } from 'react-i18next';

export function PlayerNavBar() {
  const { playerSteamId, isAuthenticated, logout } = useAuth();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [anchorEl, setAnchorEl] = React.useState<null | HTMLElement>(null);
  const [playerAvatarUrl, setPlayerAvatarUrl] = React.useState<string | undefined>(undefined);
  const [playerName, setPlayerName] = React.useState<string>('Player');
  const [isLoadingPlayer, setIsLoadingPlayer] = React.useState(false);

  const handleMenuOpen = (event: React.MouseEvent<HTMLElement>) => {
    setAnchorEl(event.currentTarget);
  };

  const handleMenuClose = () => {
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

        if (response.success && response.player && isMounted) {
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
    <AppBar position="static" color="default" elevation={1}>
      <Toolbar>
        <Box sx={{ flexGrow: 1, display: 'flex', alignItems: 'center', gap: 3 }}>
          <Box display="flex" alignItems="center" gap={1.5}>
            <Box
              component="img"
              src="/icon.svg"
              alt="MatchZy Auto Tournament Logo"
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
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            {isAuthenticated && (
              <Button color="inherit" component={RouterLink} to="/" size="small">
                Dashboard
              </Button>
            )}
            <Button color="inherit" component={RouterLink} to="/player" size="small">
              Players
            </Button>
            <Button
              color="inherit"
              component={RouterLink}
              to="/tournament/1/leaderboard"
              size="small"
            >
              Leaderboard
            </Button>
          </Box>
        </Box>
        {playerSteamId ? (
          <>
            <IconButton onClick={handleMenuOpen} size="small" sx={{ ml: 1 }}>
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
              onClose={handleMenuClose}
              anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
              transformOrigin={{ vertical: 'top', horizontal: 'right' }}
            >
              <MenuItem
                onClick={() => {
                  handleMenuClose();
                  navigate(`/player/${playerSteamId}`);
                }}
              >
                My profile
              </MenuItem>
              <MenuItem
                onClick={() => {
                  handleMenuClose();
                  handleLogout();
                }}
              >
                Sign out
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
            Sign in
          </Button>
        )}
      </Toolbar>
    </AppBar>
  );
}


