import React, { createContext, useContext, useState, useEffect, ReactNode, useMemo, useCallback } from 'react';
import { useAuth } from './AuthContext';

export interface AppItem {
  id: number;
  name: string;
  description?: string;
  created_at?: string;
  is_suspended?: boolean | number;
  is_deleted?: boolean | number;
  deleted_at?: string;
  suspended_at?: string;
  stats?: {
    testsCount: number;
    versionsCount: number;
    currentVersion: string;
    usersCount: number;
    executionsCount: number;
  };
}

interface AppContextType {
  apps: AppItem[];
  assignedApps: AppItem[];
  archivedApps: AppItem[];
  currentApp: AppItem | null;
  isAdminPanelMode: boolean;
  isLoadingApps: boolean;
  appHeaders: Record<string, string>;
  selectApp: (appOrId: AppItem | number) => void;
  selectAdminPanel: () => void;
  refreshApps: () => Promise<void>;
  createApp: (name: string, description?: string) => Promise<AppItem>;
  suspendApp: (appId: number, suspend?: boolean) => Promise<{ message: string; is_suspended: boolean }>;
  archiveApp: (appId: number) => Promise<{ message: string }>;
  restoreApp: (appId: number) => Promise<{ message: string }>;
  fetchArchivedApps: () => Promise<void>;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

export const useApp = () => {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useApp must be used within AppProvider');
  }
  return context;
};

export const AppProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const { token, user } = useAuth();
  const [apps, setApps] = useState<AppItem[]>([]);
  const [archivedApps, setArchivedApps] = useState<AppItem[]>([]);
  const [currentApp, setCurrentApp] = useState<AppItem | null>(null);
  const [isAdminPanelMode, setIsAdminPanelMode] = useState<boolean>(() => {
    return localStorage.getItem('qc_admin_panel_mode') === 'true';
  });
  const [isLoadingApps, setIsLoadingApps] = useState(false);

  const fetchApps = useCallback(async () => {
    if (!token) return;
    setIsLoadingApps(true);
    try {
      const res = await fetch('/api/apps', {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        const data: AppItem[] = await res.json();
        setApps(data);

        const isAdmin = !!(user?.isAdmin || user?.userGroups?.includes('admins'));
        if (!isAdmin) {
          setIsAdminPanelMode(false);
          localStorage.setItem('qc_admin_panel_mode', 'false');
        }

        // If no current app is set, or current app was deleted, resolve a valid one
        const savedAppId = localStorage.getItem('qc_current_app_id');
        const matched = savedAppId ? data.find((a: AppItem) => a.id === Number(savedAppId)) : null;
        if (matched) {
          setCurrentApp(matched);
        } else if (data.length > 0) {
          const topstor = data.find((a: AppItem) => a.name.toLowerCase() === 'topstor') || data[0];
          setCurrentApp(topstor);
          localStorage.setItem('qc_current_app_id', String(topstor.id));
        } else {
          setCurrentApp(null);
        }
      }
    } catch (e) {
      console.error('Failed to fetch apps:', e);
    } finally {
      setIsLoadingApps(false);
    }
  }, [token, user]);

  const fetchArchivedApps = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch('/api/apps/archived', {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        const data: AppItem[] = await res.json();
        setArchivedApps(data);
      }
    } catch (e) {
      console.error('Failed to fetch archived apps:', e);
    }
  }, [token]);

  useEffect(() => {
    if (token) {
      fetchApps();
      fetchArchivedApps();
    } else {
      setApps([]);
      setArchivedApps([]);
      setCurrentApp(null);
    }
  }, [token, fetchApps, fetchArchivedApps]);

  const selectApp = (appOrId: AppItem | number) => {
    const id = typeof appOrId === 'number' ? appOrId : appOrId.id;
    const found = apps.find(a => a.id === id);
    if (found) {
      setCurrentApp(found);
      setIsAdminPanelMode(false);
      localStorage.setItem('qc_current_app_id', String(found.id));
      localStorage.setItem('qc_admin_panel_mode', 'false');
    }
  };

  const selectAdminPanel = () => {
    setIsAdminPanelMode(true);
    localStorage.setItem('qc_admin_panel_mode', 'true');
  };

  const createApp = async (name: string, description?: string): Promise<AppItem> => {
    const res = await fetch('/api/apps', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ name, description })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to create app');
    }
    const newApp = await res.json();
    await fetchApps();
    return newApp;
  };

  const suspendApp = async (appId: number, suspend?: boolean) => {
    const res = await fetch(`/api/apps/${appId}/suspend`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ suspend })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to update app suspension status');
    }
    const data = await res.json();
    await fetchApps();
    return data;
  };

  const archiveApp = async (appId: number) => {
    const res = await fetch(`/api/apps/${appId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to archive app');
    }
    const data = await res.json();
    await fetchApps();
    await fetchArchivedApps();
    return data;
  };

  const restoreApp = async (appId: number) => {
    const res = await fetch(`/api/apps/${appId}/restore`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to restore app');
    }
    const data = await res.json();
    await fetchApps();
    await fetchArchivedApps();
    return data;
  };

  const appHeaders = useMemo(() => {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`
    };
    if (currentApp) {
      headers['x-app-id'] = String(currentApp.id);
    }
    return headers;
  }, [token, currentApp]);

  return (
    <AppContext.Provider
      value={{
        apps,
        assignedApps: apps,
        archivedApps,
        currentApp,
        isAdminPanelMode,
        isLoadingApps,
        appHeaders,
        selectApp,
        selectAdminPanel,
        refreshApps: fetchApps,
        createApp,
        suspendApp,
        archiveApp,
        restoreApp,
        fetchArchivedApps
      }}
    >
      {children}
    </AppContext.Provider>
  );
};
