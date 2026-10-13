import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';

interface User {
  id: number;
  username: string;
  isAdmin: boolean;
  isSuspended: boolean;
  userGroups: string[];
  isApiKey?: boolean;
  apiKeyId?: number | null;
}

interface AuthContextType {
  user: User | null;
  token: string | null;
  login: (username: string, password?: string) => Promise<void>;
  loginWithKey: (apiKey: string) => Promise<void>;
  logout: () => void;
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
  refreshUser: () => Promise<void>;
  isLoading: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
};

const API_BASE = '';

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Sync token to document.cookie helper
  const syncCookieToken = (tok: string | null) => {
    try {
      if (tok) {
        document.cookie = `token=${encodeURIComponent(tok)}; path=/; max-age=86400; SameSite=Lax`;
        document.cookie = `auth_token=${encodeURIComponent(tok)}; path=/; max-age=86400; SameSite=Lax`;
      } else {
        document.cookie = 'token=; path=/; max-age=0; SameSite=Lax';
        document.cookie = 'auth_token=; path=/; max-age=0; SameSite=Lax';
        document.cookie = 'jwt=; path=/; max-age=0; SameSite=Lax';
      }
    } catch (e) {
      // Ignore in non-browser environments
    }
  };

  useEffect(() => {
    let storedToken = localStorage.getItem('token');
    if (!storedToken && typeof document !== 'undefined' && document.cookie) {
      const match = document.cookie.match(/(?:^|;\s*)(?:token|auth_token)=([^;]+)/);
      if (match) {
        storedToken = decodeURIComponent(match[1]);
        localStorage.setItem('token', storedToken);
      }
    }
    if (storedToken) {
      setToken(storedToken);
      syncCookieToken(storedToken);
      validateToken(storedToken);
    } else {
      setIsLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const validateToken = async (tok: string) => {
    try {
      const response = await fetch(`${API_BASE}/api/auth/verify`, {
        headers: { Authorization: `Bearer ${tok}` }
      });
      if (response.ok) {
        const data = await response.json();
        setUser(data.user);
        syncCookieToken(tok);
      } else {
        localStorage.removeItem('token');
        syncCookieToken(null);
        setToken(null);
        setUser(null);
      }
    } catch (error) {
      console.error('Token validation failed:', error);
      localStorage.removeItem('token');
      syncCookieToken(null);
      setToken(null);
      setUser(null);
    } finally {
      setIsLoading(false);
    }
  };

  const refreshUser = async () => {
    if (!token) return;
    try {
      const response = await fetch(`${API_BASE}/api/auth/verify`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (response.ok) {
        const data = await response.json();
        setUser(data.user);
        syncCookieToken(token);
      } else {
        localStorage.removeItem('token');
        syncCookieToken(null);
        setToken(null);
        setUser(null);
      }
    } catch (error) {
      console.error('Failed to refresh user:', error);
    }
  };

  const login = async (username: string, password?: string) => {
    // If username is an API key (e.g. starts with qc_ or single parameter) and password is empty, delegate to loginWithKey
    if ((!password || !password.trim()) && username.trim().startsWith('qc_')) {
      return loginWithKey(username);
    }

    const response = await fetch(`${API_BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: username.trim(), password: password || '' })
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(errData.error || 'Invalid username or password');
    }

    const data = await response.json();
    setToken(data.token);
    setUser(data.user);
    localStorage.setItem('token', data.token);
    syncCookieToken(data.token);
  };

  const loginWithKey = async (apiKey: string) => {
    const cleanKey = apiKey.trim();
    if (!cleanKey) {
      throw new Error('Please enter a valid API key');
    }

    const response = await fetch(`${API_BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey: cleanKey })
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(errData.error || 'Failed to logon with key');
    }

    const data = await response.json();
    setToken(data.token);
    setUser(data.user);
    localStorage.setItem('token', data.token);
    syncCookieToken(data.token);
  };

  const logout = () => {
    setToken(null);
    setUser(null);
    localStorage.removeItem('token');
    syncCookieToken(null);
    fetch(`${API_BASE}/api/auth/logout`, { method: 'POST' }).catch(() => {});
  };

  const changePassword = async (currentPassword: string, newPassword: string) => {
    const response = await fetch(`${API_BASE}/api/auth/change-password`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ currentPassword, newPassword })
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || 'Failed to change password');
    }
  };

  return (
    <AuthContext.Provider value={{ user, token, login, loginWithKey, logout, changePassword, refreshUser, isLoading }}>
      {children}
    </AuthContext.Provider>
  );
};