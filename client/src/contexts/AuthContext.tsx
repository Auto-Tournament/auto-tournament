import React, { createContext, useContext, useState, useEffect } from 'react';

const PLAYER_AVATAR_CACHE_KEY_PREFIX = 'mat.playerAvatarUrl:';

function getPlayerAvatarCacheKey(steamId: string): string {
  return `${PLAYER_AVATAR_CACHE_KEY_PREFIX}${steamId}`;
}

function writeCachedPlayerAvatarUrl(steamId: string, avatarUrl: string): void {
  try {
    if (typeof window === 'undefined') return;
    const key = getPlayerAvatarCacheKey(steamId);
    window.localStorage.setItem(key, avatarUrl);
  } catch {
    // best-effort only
  }
}

function clearCachedPlayerAvatarUrl(steamId: string): void {
  try {
    if (typeof window === 'undefined') return;
    const key = getPlayerAvatarCacheKey(steamId);
    window.localStorage.removeItem(key);
  } catch {
    // best-effort only
  }
}

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
   * Why admin access was refused, in words, when it was.
   *
   * `/api/auth/admin/me` used to answer a bare `authenticated: false`, and the
   * router then bounced the user to their player page without saying anything.
   * Reports of "it sends me to my player profile even though I am an admin"
   * were undiagnosable because nothing was ever shown or collected.
   */
  adminDenialMessage: string | null;
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
  /**
   * Set when an admin is currently viewing the site as another player.
   * `playerSteamId` reflects the impersonated player while this is active, so
   * player-facing UI matches what the API will authorize.
   */
  impersonation: ImpersonationState | null;
  /**
   * Start viewing the site as `steamId` (admin only). Reloads identity on success.
   */
  startImpersonation: (steamId: string) => Promise<void>;
  /**
   * Return to the admin's own identity.
   */
  stopImpersonation: () => Promise<void>;
}

export interface ImpersonationState {
  /** Steam ID being impersonated. */
  steamId: string;
  /** Display name of the impersonated player, when known. */
  name: string | null;
  /** The admin's own Steam ID. */
  realSteamId: string | null;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [isAdmin, setIsAdmin] = useState(false);
  const [playerSteamId, setPlayerSteamId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [adminHasSteamLinked, setAdminHasSteamLinked] = useState(false);
  const [adminProvider, setAdminProvider] = useState<string | null>(null);
  const [adminDenialMessage, setAdminDenialMessage] = useState<string | null>(null);
  const [adminProfileName, setAdminProfileName] = useState<string | null>(null);
  const [adminProfileAvatarUrl, setAdminProfileAvatarUrl] = useState<string | null>(null);
  const [hasPlayerRecord, setHasPlayerRecord] = useState(false);
  const [impersonation, setImpersonation] = useState<ImpersonationState | null>(null);

  useEffect(() => {
    let isMounted = true;

    // Discover any existing admin session + player Steam cookie.
    const initializeAuth = async () => {
      // When both an admin session and a player cookie exist, prefer the admin's
      // Steam ID so we don't "flip" identities on reload if the cookie is stale.
      let adminSteamId: string | null = null;
      let cookieSteamId: string | null = null;
      let cookieHasPlayerRecord = false;

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
            avatarUrl?: string;
            impersonation?: {
              active?: boolean;
              steamId?: string;
              name?: string | null;
              realSteamId?: string | null;
            };
          } = await response.json();

          // /api/auth/me reports the *effective* identity, so an active
          // impersonation is authoritative even when an admin session exists.
          if (data.impersonation?.active && data.impersonation.steamId) {
            setImpersonation({
              steamId: data.impersonation.steamId,
              name: data.impersonation.name ?? null,
              realSteamId: data.impersonation.realSteamId ?? null,
            });
            setPlayerSteamId(data.impersonation.steamId);
            setHasPlayerRecord(true);
            cookieSteamId = data.impersonation.steamId;
            cookieHasPlayerRecord = true;
            return;
          }

          setImpersonation(null);
          if (adminSteamId) {
            // Admin already set playerSteamId; don't overwrite with /api/auth/me
            return;
          }
          if (
            data.authenticated &&
            typeof data.steamId === 'string' &&
            data.steamId.trim() !== ''
          ) {
            cookieSteamId = data.steamId;
            cookieHasPlayerRecord = Boolean(data.hasPlayerRecord);
            setPlayerSteamId(data.steamId);
            setHasPlayerRecord(Boolean(data.hasPlayerRecord));

            if (
              typeof data.avatarUrl === 'string' &&
              data.avatarUrl.trim() !== '' &&
              data.avatarUrl.startsWith('http')
            ) {
              writeCachedPlayerAvatarUrl(data.steamId, data.avatarUrl);
            }
          } else {
            cookieSteamId = null;
            cookieHasPlayerRecord = false;
            setPlayerSteamId(null);
            setHasPlayerRecord(false);
          }
        } catch (error) {
          if (!isMounted) return;
          console.warn('Failed to read player Steam identity from /api/auth/me', error);
          cookieSteamId = null;
          cookieHasPlayerRecord = false;
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
            reason?: string;
            message?: string;
          } = await response.json();

          setIsAdmin(Boolean(data.authenticated));
          // Keep the explanation only while it is true; a later successful
          // check must not leave a stale "you are not an admin" behind.
          setAdminDenialMessage(data.authenticated ? null : data.message ?? null);
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

      // If the user has a valid Steam cookie but no player record, and an admin
      // enables self-registration later, we want a simple refresh to "sign up"
      // without requiring a full Steam re-login.
      //
      // This call is idempotent and will no-op if self-registration is disabled.
      if (!adminSteamId && cookieSteamId && !cookieHasPlayerRecord) {
        try {
          const resp = await fetch('/api/auth/self-register', {
            method: 'POST',
            credentials: 'include',
          });

          // 200: created or already exists
          // 403: self-registration disabled (expected in private setups)
          // 401: not signed in (cookie missing/invalid)
          if (resp.ok) {
            // Re-read /api/auth/me so hasPlayerRecord is always consistent with server.
            await fetchPlayerIdentity();
          }
        } catch (err) {
          // Best-effort. If this fails, user can still re-login or be added by admin.
          console.debug('Auto self-registration attempt failed (best-effort)', err);
        }
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

  /**
   * Start/stop impersonation.
   *
   * Both do a hard reload afterwards: nearly every page caches identity-derived
   * data (team membership, veto turn, match CTAs) in component state, and a full
   * reload is the only way to guarantee none of the previous identity's data
   * leaks into the new view.
   */
  const startImpersonation = async (steamId: string) => {
    const response = await fetch('/api/auth/impersonate', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ steamId }),
    });

    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error || 'Failed to start impersonation');
    }

    window.location.reload();
  };

  const stopImpersonation = async () => {
    const response = await fetch('/api/auth/impersonate/stop', {
      method: 'POST',
      credentials: 'include',
    });

    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error || 'Failed to stop impersonation');
    }

    window.location.reload();
  };

  const logout = async () => {
    const steamIdToClear = playerSteamId;
    setIsAdmin(false);
    setPlayerSteamId(null);
    setImpersonation(null);
    setHasPlayerRecord(false);
    setAdminProvider(null);
    setAdminProfileName(null);
    setAdminProfileAvatarUrl(null);

    if (steamIdToClear) {
      clearCachedPlayerAvatarUrl(steamIdToClear);
    }

    try {
      // Drop any impersonation before tearing down the admin session, otherwise
      // the (admin-guarded) stop endpoint would no longer accept the request.
      await fetch('/api/auth/impersonate/stop', {
        method: 'POST',
        credentials: 'include',
      });
    } catch (error) {
      console.warn('Failed to call /api/auth/impersonate/stop', error);
    }

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
        adminDenialMessage,
        adminProfileName,
        adminProfileAvatarUrl,
        hasPlayerRecord,
        impersonation,
        startImpersonation,
        stopImpersonation,
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
