import React from 'react';
import {
  Avatar,
  Box,
  Divider,
  IconButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
} from '@mui/material';
import { CaretRightIcon, UserIcon } from '@phosphor-icons/react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../contexts/AuthContext';
import { FlagIcon, LanguageMenu, useCurrentLanguage } from '../common/LanguageSwitcher';
import { ThemeMenu, ThemeSwatch, activeTheme } from '../common/ThemeSwitcher';
import { PlayerAvatar } from '../player/PlayerAvatar';
import { generateAvatarDataUrl } from '../../generation/avatar';
import { api } from '../../utils/api';
import { paths, playerProfilePath } from '../../paths';
import { useSocial } from '../social/socialStore';

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

/**
 * The account button and its menu: the viewer's own pages (profile, friends,
 * a module's, connections), theme and language, the notices, and signing in
 * or out. The public top bar and the Manage dashboard's header both use it.
 */
/**
 * `wide`: a full-width row with the avatar and the name (the Manage rail's
 * footer); otherwise the avatar alone (the top bar).
 */
export function AccountMenu({ wide = false }: { wide?: boolean } = {}) {
  const {
    playerSteamId,
    isAuthenticated,
    logout,
    adminProfileName,
    adminProfileAvatarUrl,
    impersonation,
  } = useAuth();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const friendRequests = useSocial(Boolean(playerSteamId) && !impersonation).incoming.length;
  const currentLanguage = useCurrentLanguage();

  const [anchorEl, setAnchorEl] = React.useState<null | HTMLElement>(null);
  // The theme and language pickers open from the account menu, anchored to
  // the same button, so they read as its sub-menus.
  const [themeMenuAnchor, setThemeMenuAnchor] = React.useState<null | HTMLElement>(null);
  const [languageMenuAnchor, setLanguageMenuAnchor] = React.useState<null | HTMLElement>(null);
  const [playerAvatarUrl, setPlayerAvatarUrl] = React.useState<string | undefined>(undefined);
  const [playerName, setPlayerName] = React.useState<string>('Player');
  const [isLoadingPlayer, setIsLoadingPlayer] = React.useState(false);

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

  const signedIn = Boolean(playerSteamId || isAuthenticated);

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

  return (
    <>
      <IconButton
        onClick={handleAvatarMenuOpen}
        size="small"
        sx={
          wide
            ? {
                width: '100%',
                minWidth: 0,
                overflow: 'hidden',
                justifyContent: 'flex-start',
                gap: 1.25,
                px: 1,
                py: 0.75,
                borderRadius: 1.5,
                fontSize: 14,
                fontWeight: 500,
                color: 'text.primary',
              }
            : { p: 0 }
        }
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
              adminProfileAvatarUrl || generateAvatarDataUrl(`admin:${adminProfileName || 'Admin'}`)
            }
            alt={adminProfileName || 'Admin'}
            sx={{ width: 32, height: 32, bgcolor: 'action.hover' }}
          />
        ) : (
          // Signed out: the menu still holds the theme and language.
          <Avatar
            sx={{
              width: 32,
              height: 32,
              bgcolor: 'background.paper',
              color: 'text.secondary',
              border: 1,
              borderColor: 'divider',
            }}
          >
            <UserIcon size={20} />
          </Avatar>
        )}
        {wide && (
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {(playerSteamId ? playerName : adminProfileName) || t('nav.accountMenu')}
          </span>
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
              navigate(paths.friends);
            }}
            data-testid="nav-friends"
          >
            <ListItemText primary={t('social.friends.title')} />
            {friendRequests > 0 && (
              <Box
                component="span"
                sx={{ ml: 2, fontSize: '0.6875rem', fontWeight: 600, color: 'primary.main' }}
              >
                {t('social.friends.requestCount', { count: friendRequests })}
              </Box>
            )}
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
          <Box component={CaretRightIcon} size={20} sx={{ color: 'text.secondary', ml: 1 }} />
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
          <Box component={CaretRightIcon} size={20} sx={{ color: 'text.secondary', ml: 1 }} />
        </MenuItem>
        {/* The licenses of the third-party code this app is built from (they ask for it). */}
        <MenuItem
          component="a"
          href="/third-party-notices.txt"
          target="_blank"
          rel="noopener"
          onClick={handleAvatarMenuClose}
          data-testid="nav-third-party-notices"
        >
          <ListItemText
            primary={t('nav.thirdPartyNotices')}
            slotProps={{ primary: { sx: { fontSize: '0.8125rem', color: 'text.secondary' } } }}
          />
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
    </>
  );
}
