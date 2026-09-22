import React from 'react';
import { IconButton, Menu, MenuItem, ListItemText, Divider, Tooltip } from '@mui/material';
import SwitchAccountIcon from '@mui/icons-material/SwitchAccount';
import CheckIcon from '@mui/icons-material/Check';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../contexts/AuthContext';
import { useSnackbar } from '../../contexts/SnackbarContext';

/**
 * Dev-only "Switch account" menu, next to the theme/language switchers in the
 * top bar.
 *
 * Lets the maintainer jump between an admin session and a handful of fixed
 * test player accounts in the local preview, without opening private browser
 * windows. Built entirely on the same `/api/test/login-admin` and
 * `/api/test/login-player` helpers the Playwright suite uses.
 *
 * This component must never render (or ship) in production: the only caller,
 * `DevAccountSwitcherGate`, checks `import.meta.env.DEV` before even importing
 * this module, and Vite strips both from a production build.
 */

const ADMIN_TEST_STEAM_ID = '76561198000000001';
const PLAYER_A_STEAM_ID = '76561198000000101';
const PLAYER_B_STEAM_ID = '76561198000000102';
const PLAYER_C_STEAM_ID = '76561198000000103';

const FIXED_PLAYERS = [
  { steamId: PLAYER_A_STEAM_ID, nameKey: 'devAccountSwitcher.playerA', name: 'Player A' },
  { steamId: PLAYER_B_STEAM_ID, nameKey: 'devAccountSwitcher.playerB', name: 'Player B' },
  { steamId: PLAYER_C_STEAM_ID, nameKey: 'devAccountSwitcher.playerC', name: 'Player C' },
] as const;

/** In the 7656119900xxxxxxx range requested for the "first visit" flow. */
function randomNewPlayerSteamId(): string {
  const suffix = Math.floor(Math.random() * 1_000_000_000)
    .toString()
    .padStart(9, '0');
  return `7656119900${suffix}`;
}

export const DevAccountSwitcher: React.FC = () => {
  const { t } = useTranslation();
  const { playerSteamId, logout } = useAuth();
  const { showError } = useSnackbar();
  const [anchorEl, setAnchorEl] = React.useState<null | HTMLElement>(null);

  const handleOpen = (event: React.MouseEvent<HTMLElement>) => {
    setAnchorEl(event.currentTarget);
  };

  const handleClose = () => {
    setAnchorEl(null);
  };

  const isTestSignInDisabled = (status: number): boolean => status === 403;

  const handleAdminTest = async () => {
    handleClose();
    await logout();
    try {
      const response = await fetch('/api/test/login-admin', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ steamId: ADMIN_TEST_STEAM_ID }),
      });
      if (isTestSignInDisabled(response.status)) {
        showError(t('devAccountSwitcher.disabled'));
        return;
      }
    } catch {
      showError(t('devAccountSwitcher.disabled'));
      return;
    }
    window.location.href = '/';
  };

  const handleFixedPlayer = async (steamId: string, name: string) => {
    handleClose();
    await logout();
    try {
      const response = await fetch('/api/test/login-player', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ steamId, name }),
      });
      if (isTestSignInDisabled(response.status)) {
        showError(t('devAccountSwitcher.disabled'));
        return;
      }
    } catch {
      showError(t('devAccountSwitcher.disabled'));
      return;
    }
    // eslint-disable-next-line react-hooks/immutability -- full-page navigation after a dev-only test sign-in
    window.location.href = '/me/connections';
  };

  const handleNewPlayer = async () => {
    handleClose();
    await logout();
    try {
      const response = await fetch('/api/test/login-player', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ steamId: randomNewPlayerSteamId(), gamesPrompt: true }),
      });
      if (isTestSignInDisabled(response.status)) {
        showError(t('devAccountSwitcher.disabled'));
        return;
      }
    } catch {
      showError(t('devAccountSwitcher.disabled'));
      return;
    }
    window.location.href = '/';
  };

  const handleSignOut = async () => {
    handleClose();
    await logout();
    window.location.href = '/login';
  };

  const label = t('devAccountSwitcher.tooltip');

  return (
    <>
      <Tooltip title={label}>
        <IconButton
          onClick={handleOpen}
          size="small"
          aria-label={label}
          data-testid="dev-account-switcher-button"
          sx={{ p: 0.75 }}
        >
          <SwitchAccountIcon fontSize="small" />
        </IconButton>
      </Tooltip>
      <Menu
        anchorEl={anchorEl}
        open={Boolean(anchorEl)}
        onClose={handleClose}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      >
        <MenuItem
          onClick={() => void handleAdminTest()}
          data-testid="dev-account-switcher-admin"
          sx={{ minHeight: 40, gap: 1.25 }}
        >
          <ListItemText primary={t('devAccountSwitcher.adminTest')} />
          {playerSteamId === ADMIN_TEST_STEAM_ID ? (
            <CheckIcon fontSize="small" sx={{ ml: 1, color: 'primary.main' }} />
          ) : null}
        </MenuItem>
        {FIXED_PLAYERS.map((player) => (
          <MenuItem
            key={player.steamId}
            onClick={() => void handleFixedPlayer(player.steamId, player.name)}
            data-testid={`dev-account-switcher-${player.name.toLowerCase().replace(/\s+/g, '-')}`}
            sx={{ minHeight: 40, gap: 1.25 }}
          >
            <ListItemText primary={t(player.nameKey)} />
            {playerSteamId === player.steamId ? (
              <CheckIcon fontSize="small" sx={{ ml: 1, color: 'primary.main' }} />
            ) : null}
          </MenuItem>
        ))}
        <MenuItem
          onClick={() => void handleNewPlayer()}
          data-testid="dev-account-switcher-new-player"
          sx={{ minHeight: 40, gap: 1.25 }}
        >
          <ListItemText primary={t('devAccountSwitcher.newPlayer')} />
        </MenuItem>
        <Divider />
        <MenuItem
          onClick={() => void handleSignOut()}
          data-testid="dev-account-switcher-sign-out"
          sx={{ minHeight: 40, gap: 1.25 }}
        >
          <ListItemText primary={t('devAccountSwitcher.signOut')} />
        </MenuItem>
      </Menu>
    </>
  );
};
