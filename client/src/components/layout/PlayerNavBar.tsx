import React from 'react';
import {
  AppBar,
  Avatar,
  Box,
  Button,
  IconButton,
  Menu,
  MenuItem,
  Toolbar,
  Typography,
} from '@mui/material';
import { Link as RouterLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';

export function PlayerNavBar() {
  const { playerSteamId, logout, loginWithSteam } = useAuth();
  const navigate = useNavigate();
  const [anchorEl, setAnchorEl] = React.useState<null | HTMLElement>(null);

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

  return (
    <AppBar position="static" color="default" elevation={1}>
      <Toolbar>
        <Box sx={{ flexGrow: 1, display: 'flex', alignItems: 'center', gap: 2 }}>
          <Typography variant="subtitle2" color="text.secondary" sx={{ mr: 2 }}>
            Player area
          </Typography>
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
        {playerSteamId ? (
          <>
            <IconButton onClick={handleMenuOpen} size="small" sx={{ ml: 1 }}>
              <Avatar
                src={`/api/players/${playerSteamId}/avatar.svg`}
                alt="Player avatar"
                sx={{ width: 32, height: 32 }}
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
        ) : (
          <Button
            color="primary"
            variant="outlined"
            size="small"
            onClick={loginWithSteam}
          >
            Sign in
          </Button>
        )}
      </Toolbar>
    </AppBar>
  );
}


