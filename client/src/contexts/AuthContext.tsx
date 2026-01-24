import React, { createContext, useContext, useState, useEffect } from 'react';

interface AuthContextType {
  /**
   * Steam ID for the current player (if any), derived from the lightweight
   * player_steam_id cookie exposed by /api/auth/me.
   *
   * Note: this is not a security boundary – it is convenience identity only.
   */
  playerSteamId: string | null;
  /**
   * Helper for starting the Steam login flow. This simply redirects the user
   * to /api/auth/steam and lets the backend/Passport process take over.
   */
  loginWithSteam: () => void;
  /**
   * Logs out the current session:
   * - destroys the admin Passport session
   * - clears the lightweight Steam cookie (player_steam_id)
   */
  logout: () => Promise<void>;
  /**
   * Whether an admin session has been verified and is currently active.
   * This controls access to the main dashboard routes.
   */
  isAuthenticated: boolean;
  /**
   * Whether the current admin session still needs to be linked with a Steam ID
   * (e.g. logged in via Keycloak/Discord/GitHub without a Steam account).
   * Admins who logged in directly with Steam will never see this as true.
   */
  needsSteamLink: boolean;
  /**
   * Whether a player Steam identity is present via cookie.
   * This does not grant admin rights by itself.
   */
  isPlayerAuthenticated: boolean;
  /**
   * True while we bootstrap authentication state on app load (verifying the
   * admin API token and checking for an existing player_steam_id cookie).
   */
  isLoading: boolean;
  /**
   * The auth provider backing the current admin session (e.g. 'steam',
   * 'discord', 'github', 'keycloak'), if any.
   */
  adminProvider: string | null;
  /**
   * Lightweight profile preview for the current admin provider – used for
   * UI hints like the /connect-steam page.
   */
  adminProfileName: string | null;
  adminProfileAvatarUrl: string | null;
  /**
   * True when the current Steam identity (playerSteamId) has a row in the
   * players table. False for "unregistered" users who signed in with Steam
   * but were never added by an admin (or self‑registration is off).
   */
  hasPlayerRecord: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [isAdmin, setIsAdmin] = useState(false);
  const [playerSteamId, setPlayerSteamId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [adminHasSteamLinked, setAdminHasSteamLinked] = useState(false);
  const [adminProvider, setAdminProvider] = useState<string | null>(null);
  const [adminProfileName, setAdminProfileName] = useState<string | null>(null);
  const [adminProfileAvatarUrl, setAdminProfileAvatarUrl] = useState<string | null>(null);
  const [hasPlayerRecord, setHasPlayerRecord] = useState(false);

  useEffect(() => {
    let isMounted = true;

    // Discover any existing admin session + player Steam cookie.
    const initializeAuth = async () => {
      // When both an admin session and a player cookie exist, prefer the admin's
      // Steam ID so we don't "flip" identities on reload if the cookie is stale.
      let adminSteamId: string | null = null;

      const fetchPlayerIdentity = async () => {
        try {
          const response = await fetch('/api/auth/me', {
            credentials: 'include',
          });

          if (!isMounted) return;

          if (!response.ok) {
            setPlayerSteamId(null);
            setHasPlayerRecord(false);
            return;
          }

          const data: {
            authenticated?: boolean;
            steamId?: string;
            hasPlayerRecord?: boolean;
          } = await response.json();
          if (
            data.authenticated &&
            typeof data.steamId === 'string' &&
            data.steamId.trim() !== '' &&
            !adminSteamId // don't override an admin-linked Steam ID
          ) {
            setPlayerSteamId(data.steamId);
            setHasPlayerRecord(Boolean(data.hasPlayerRecord));
          } else {
            setPlayerSteamId(null);
            setHasPlayerRecord(false);
          }
        } catch (error) {
          if (!isMounted) return;
          console.warn('Failed to read player Steam identity from /api/auth/me', error);
          setPlayerSteamId(null);
          setHasPlayerRecord(false);
        }
      };

      const fetchAdminIdentity = async () => {
        try {
          const response = await fetch('/api/auth/admin/me', {
            credentials: 'include',
          });

          if (!isMounted) return;

          if (!response.ok) {
            setIsAdmin(false);
            setAdminProvider(null);
            setAdminProfileName(null);
            setAdminProfileAvatarUrl(null);
            setHasPlayerRecord(false);
            return;
          }

          const data: {
            authenticated?: boolean;
            steamId?: string | null;
            provider?: string;
            providerProfile?: { name?: string | null; avatarUrl?: string | null };
          } = await response.json();

          setIsAdmin(Boolean(data.authenticated));
          setAdminProvider(data.provider ?? null);
          if (data.authenticated) setHasPlayerRecord(true);

          const profile = data.providerProfile || {};
          const profileName =
            typeof profile.name === 'string' && profile.name.trim() !== ''
              ? profile.name
              : null;
          const profileAvatarUrl =
            typeof profile.avatarUrl === 'string' && profile.avatarUrl.trim() !== ''
              ? profile.avatarUrl
              : null;

          setAdminProfileName(profileName);
          setAdminProfileAvatarUrl(profileAvatarUrl);
          // If admin session also exposes a Steam ID, keep it in sync.
          if (data.steamId && typeof data.steamId === 'string' && data.steamId.trim() !== '') {
            adminSteamId = data.steamId;
            setPlayerSteamId(data.steamId);
            setAdminHasSteamLinked(true);
          } else {
            setAdminHasSteamLinked(false);
          }
        } catch (error) {
          if (!isMounted) return;
          console.warn('Failed to read admin identity from /api/auth/admin/me', error);
          setIsAdmin(false);
          setAdminHasSteamLinked(false);
          setAdminProvider(null);
          setAdminProfileName(null);
          setAdminProfileAvatarUrl(null);
          setHasPlayerRecord(false);
        }
      };

      // Always resolve the admin identity first so we know whether to trust the
      // lightweight /api/auth/me cookie. This avoids cases where a stale cookie
      // "wins the race" and makes it look like you're logged in as a different
      // Steam user after a reload.
      await fetchAdminIdentity();
      await fetchPlayerIdentity();

      if (isMounted) {
        setIsLoading(false);
      }
    };

    void initializeAuth();

    return () => {
      isMounted = false;
    };
  }, []);

  const loginWithSteam = () => {
    window.location.href = '/api/auth/steam';
  };

  const logout = async () => {
    setIsAdmin(false);
    setPlayerSteamId(null);
    setHasPlayerRecord(false);
    setAdminProvider(null);
    setAdminProfileName(null);
    setAdminProfileAvatarUrl(null);

    try {
      // Destroy admin session
      await fetch('/api/auth/admin/logout', {
        method: 'POST',
        credentials: 'include',
      });
    } catch (error) {
      console.warn('Failed to call /api/auth/admin/logout', error);
    }

    try {
      // Clear player Steam cookie
      await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'include',
      });
    } catch (error) {
      // This is a best-effort helper; failure to clear the cookie on the server
      // should not block the UI from logging out.
      console.warn('Failed to call /api/auth/logout', error);
    }
  };

  return (
    <AuthContext.Provider
      value={{
        loginWithSteam,
        logout,
        isAuthenticated: isAdmin,
        playerSteamId,
        isPlayerAuthenticated: !!playerSteamId,
        needsSteamLink: isAdmin && !adminHasSteamLinked,
        isLoading,
        adminProvider,
        adminProfileName,
        adminProfileAvatarUrl,
        hasPlayerRecord,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
}
