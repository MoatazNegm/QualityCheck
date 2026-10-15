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
  assignedApps: any[];
  allApps: any[];
  login: (username: string, password?: string) => Promise<any>;
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
  const [assignedApps, setAssignedApps] = useState<any[]>([]);
  const [allApps, setAllApps] = useState<any[]>([]);
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
        if (data.assignedApps) setAssignedApps(data.assignedApps);
        if (data.allApps) setAllApps(data.allApps);
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
        if (data.assignedApps) setAssignedApps(data.assignedApps);
        if (data.allApps) setAllApps(data.allApps);
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

    const savedAppId = localStorage.getItem('qc_current_app_id');
    const savedAdminMode = localStorage.getItem('qc_admin_panel_mode');

    const response = await fetch(`${API_BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: username.trim(),
        password: password || '',
        selectedApp: savedAdminMode === 'true' ? 'admin' : (savedAppId || undefined)
      })
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(errData.error || 'Invalid username or password');
    }

    const data = await response.json();
    setToken(data.token);
    setUser(data.user);
    if (data.assignedApps) setAssignedApps(data.assignedApps);
    if (data.allApps) setAllApps(data.allApps);

    // If user is non-admin, ensure admin panel mode is false and current app is one of their assigned apps
    if (!data.user.isAdmin) {
      localStorage.setItem('qc_admin_panel_mode', 'false');
      const assigned = data.assignedApps || [];
      const hasSaved = assigned.some((a: any) => String(a.id) === String(savedAppId));
      if (!hasSaved && assigned.length > 0) {
        localStorage.setItem('qc_current_app_id', String(assigned[0].id));
      }
    } else {
      // If admin and no mode saved yet, default to admin panel mode
      if (!savedAdminMode) {
        localStorage.setItem('qc_admin_panel_mode', 'true');
      }
    }

    localStorage.setItem('token', data.token);
    syncCookieToken(data.token);
    return data;
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
    if (data.assignedApps) setAssignedApps(data.assignedApps);
    if (data.allApps) setAllApps(data.allApps);
    localStorage.setItem('token', data.token);
    syncCookieToken(data.token);
  };

  const logout = () => {
    setToken(null);
    setUser(null);
    setAssignedApps([]);
    setAllApps([]);
    localStorage.removeItem('token');
    localStorage.removeItem('qc_admin_panel_mode');
    localStorage.removeItem('qc_current_app_id');
    sessionStorage.clear();
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
    <AuthContext.Provider value={{ user, token, assignedApps, allApps, login, loginWithKey, logout, changePassword, refreshUser, isLoading }}>
      {children}
    </AuthContext.Provider>
  );
};