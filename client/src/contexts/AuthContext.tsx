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
          setToken(savedToken);
        } else {
          // Invalid token, clear it
          localStorage.removeItem('api_token');
        }
      } catch (error) {
        // Network error or API down, clear invalid token
        console.error('Token verification failed:', error);
        localStorage.removeItem('api_token');
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
