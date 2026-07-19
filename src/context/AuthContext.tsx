import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';

interface User {
  id: number;
  username: string;
  isAdmin: boolean;
  isSuspended: boolean;
}

interface AuthContextType {
  user: User | null;
  token: string | null;
  login: (username: string, password: string) => Promise<void>;
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

  useEffect(() => {
    const storedToken = localStorage.getItem('token');
    if (storedToken) {
      setToken(storedToken);
      validateToken(storedToken);
    } else {
      setIsLoading(false);
    }
  }, []);

  const validateToken = async (tok: string) => {
    try {
      const response = await fetch(`${API_BASE}/api/auth/verify`, {
        headers: { Authorization: `Bearer ${tok}` }
      });
      if (response.ok) {
        const data = await response.json();
        setUser(data.user);
      }
    } catch (error) {
      console.error('Token validation failed:', error);
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
      }
    } catch (error) {
      console.error('Failed to refresh user:', error);
    }
  };

  const login = async (username: string, password: string) => {
    const response = await fetch(`${API_BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });

    if (!response.ok) {
      throw new Error('Login failed');
    }

    const data = await response.json();
    setToken(data.token);
    setUser(data.user);
    localStorage.setItem('token', data.token);
  };

  const logout = () => {
    setToken(null);
    setUser(null);
    localStorage.removeItem('token');
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
    <AuthContext.Provider value={{ user, token, login, logout, changePassword, refreshUser, isLoading }}>
      {children}
    </AuthContext.Provider>
  );
};