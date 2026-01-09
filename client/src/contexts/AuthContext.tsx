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
   * Whether the current admin session was established via a non-Steam SSO
   * provider (Keycloak, Discord, etc.) and still needs to be linked with a
   * Steam ID for full player context.
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
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [isAdmin, setIsAdmin] = useState(false);
  const [playerSteamId, setPlayerSteamId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [needsSteamLink, setNeedsSteamLink] = useState(false);

  useEffect(() => {
    let isMounted = true;

    // Discover any existing admin session + player Steam cookie.
    const initializeAuth = async () => {
      const fetchPlayerIdentity = async () => {
        try {
          const response = await fetch('/api/auth/me', {
            credentials: 'include',
          });

          if (!isMounted) return;

          if (!response.ok) {
            setPlayerSteamId(null);
            return;
          }

          const data: { authenticated?: boolean; steamId?: string } = await response.json();
          if (data.authenticated && typeof data.steamId === 'string' && data.steamId.trim() !== '') {
            setPlayerSteamId(data.steamId);
          } else {
            setPlayerSteamId(null);
          }
        } catch (error) {
          if (!isMounted) return;
          console.warn('Failed to read player Steam identity from /api/auth/me', error);
          setPlayerSteamId(null);
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
            return;
          }

          const data: { authenticated?: boolean; steamId?: string | null } = await response.json();
          setIsAdmin(Boolean(data.authenticated));
          // If admin session also exposes a Steam ID, keep it in sync.
          if (data.steamId && typeof data.steamId === 'string' && data.steamId.trim() !== '') {
            setPlayerSteamId(data.steamId);
          }
        } catch (error) {
          if (!isMounted) return;
          console.warn('Failed to read admin identity from /api/auth/admin/me', error);
          setIsAdmin(false);
        }
      };

      await Promise.allSettled([fetchPlayerIdentity(), fetchAdminIdentity()]);

      if (isMounted) {
        // If we have an admin session but no linked Steam ID, and Steam is
        // available as a provider, the UI can prompt for a one-time Steam
        // login to link identities.
        setNeedsSteamLink(isAdmin && !playerSteamId);
      }

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
    setNeedsSteamLink(false);

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
        needsSteamLink,
        isLoading,
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
