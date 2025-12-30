import React, { createContext, useContext, useState, useEffect } from 'react';

interface AuthContextType {
  token: string | null;
  login: (token: string) => void;
  logout: () => void;
  isAuthenticated: boolean;
  isLoading: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Verify token on mount
    const verifyStoredToken = async () => {
      const savedToken = localStorage.getItem('api_token');

      if (!savedToken) {
        setIsLoading(false);
        return;
      }

      try {
        // Verify the token is valid by making a test API call
        const response = await fetch('/api/auth/verify', {
          headers: { Authorization: `Bearer ${savedToken}` },
        });

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
        // Network error or API down: keep the existing token so the admin
        // stays signed in. Individual pages will surface API errors via their
        // own snackbars when requests fail.
        console.error('Token verification failed (network/API unavailable):', error);
        setToken(savedToken);
      } finally {
        setIsLoading(false);
      }
    };

    verifyStoredToken();
  }, []);

  const login = (newToken: string) => {
    localStorage.setItem('api_token', newToken);
    setToken(newToken);
  };

  const logout = () => {
    localStorage.removeItem('api_token');
    setToken(null);
  };

  return (
    <AuthContext.Provider
      value={{
        token,
        login,
        logout,
        isAuthenticated: !!token,
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
