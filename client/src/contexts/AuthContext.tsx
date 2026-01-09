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
   * Existing admin login using the API token. Kept for backwards compatibility
   * while we migrate towards Steam/SSO-based flows.
   */
  login: (token: string) => void;
  /**
   * Helper for starting the Steam login flow. This simply redirects the user
   * to /api/auth/steam and lets the backend/OpenID process take over.
   */
  loginWithSteam: () => void;
  /**
   * Logs out the current session:
   * - clears the admin API token (if any)
   * - calls the lightweight Steam logout endpoint to clear player_steam_id
   */
  logout: () => Promise<void>;
  /**
   * Whether an admin API token has been verified and is currently active.
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
  const [token, setToken] = useState<string | null>(null);
  const [playerSteamId, setPlayerSteamId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [needsSteamLink, setNeedsSteamLink] = useState(false);

  useEffect(() => {
    let isMounted = true;

    // Verify the admin API token and discover any existing player Steam cookie.
    const initializeAuth = async () => {
      const verifyStoredToken = async () => {
        const savedToken = localStorage.getItem('api_token');

        if (!savedToken) {
          if (isMounted) {
            setToken(null);
          }
          return;
        }

        try {
          // Verify the token is valid by making a test API call
          const response = await fetch('/api/auth/verify', {
            headers: { Authorization: `Bearer ${savedToken}` },
          });

          if (!isMounted) return;

          if (response.ok) {
            // Token is valid – keep the admin signed in.
            setToken(savedToken);
          } else if (response.status === 401 || response.status === 403) {
            // Unauthorized / forbidden: token is invalid, clear it so the admin
            // is prompted to log in again.
            localStorage.removeItem('api_token');
            setToken(null);
          } else {
            // Any other error (5xx, bad gateway, etc.): assume the API is
            // temporarily unavailable. Keep the token so the admin is not logged
            // out just because the backend is down.
            console.error('Token verification failed with non-auth error:', response.status);
            setToken(savedToken);
          }
        } catch (error) {
          if (!isMounted) return;
          // Network error or API down: keep the existing token so the admin
          // stays signed in. Individual pages will surface API errors via their
          // own snackbars when requests fail.
          console.error('Token verification failed (network/API unavailable):', error);
          setToken(savedToken);
        }
      };

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

      await Promise.allSettled([verifyStoredToken(), fetchPlayerIdentity()]);

      if (isMounted) {
        // If we have an admin token but no linked Steam ID, and Steam is
        // available as a provider, the UI can prompt for a one-time Steam
        // login to link identities.
        setNeedsSteamLink(
          Boolean(localStorage.getItem('api_token')) && !playerSteamId
        );
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

  const login = (newToken: string) => {
    localStorage.setItem('api_token', newToken);
    setToken(newToken);
  };

  const loginWithSteam = () => {
    window.location.href = '/api/auth/steam';
  };

  const logout = async () => {
    localStorage.removeItem('api_token');
    setToken(null);
    setPlayerSteamId(null);
    setNeedsSteamLink(false);

    try {
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
        token,
        login,
        loginWithSteam,
        logout,
        isAuthenticated: !!token,
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
