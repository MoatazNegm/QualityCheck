import React, { useState, useEffect } from 'react';
import { NavLink, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useApp } from '../context/AppContext';

const Sidebar: React.FC = () => {
  const { user } = useAuth();
  const { apps, currentApp, selectApp, selectAdminPanel, isAdminPanelMode } = useApp();
  const [collapsed, setCollapsed] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === '[' && e.ctrlKey) {
        setCollapsed((v) => !v);
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, []);

  useEffect(() => {
    if (location.pathname && location.pathname !== '/login') {
      localStorage.setItem('qc_last_view', location.pathname);
    }
  }, [location.pathname]);

  const isAdmin = !!(user?.isAdmin || user?.userGroups?.includes('admins'));
  const isDevOrAdmin = isAdmin || user?.userGroups?.includes('developers');

  const handleAdminPanelClick = () => {
    selectAdminPanel();
    localStorage.setItem('qc_last_view', '/admin');
    navigate('/admin');
  };

  const handleAppClick = (app: any) => {
    selectApp(app);
    if (location.pathname === '/admin') {
      // Stay on /admin but now scoped to this app solution
    } else {
      navigate('/dashboard');
      localStorage.setItem('qc_last_view', '/dashboard');
    }
  };

  return (
    <aside className={`sidebar ${collapsed ? 'collapsed' : ''}`}>
      <div className='sidebar-header'>
        <img src='/Q.png' alt='Q logo' className='sidebar-logo' />
        {!collapsed && <span className='sidebar-title'>QualityCheck</span>}
        <button
          className='sidebar-toggle'
          onClick={() => setCollapsed((v) => !v)}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? '▸' : '◂'}
        </button>
      </div>

      <nav className='sidebar-nav'>
        {/* Admin Panel button at top for Admins */}
        {isAdmin && (
          <button
            onClick={handleAdminPanelClick}
            className={`sidebar-link sidebar-app-btn ${isAdminPanelMode && location.pathname === '/admin' ? 'active' : ''}`}
            title='Admin Panel (Global View)'
            style={{
              cursor: 'pointer',
              background: isAdminPanelMode && location.pathname === '/admin' ? 'rgba(99, 102, 241, 0.22)' : 'rgba(255, 255, 255, 0.04)',
              border: isAdminPanelMode && location.pathname === '/admin' ? '1px solid #6366f1' : '1px solid rgba(255, 255, 255, 0.08)',
              marginBottom: '0.4rem',
              color: 'inherit'
            }}
          >
            <span className='sidebar-link-icon'>⚙️</span>
            {!collapsed && (
              <span className='sidebar-link-text' style={{ fontWeight: 600 }}>
                Admin Panel
              </span>
            )}
          </button>
        )}

        {/* Regular navigation links */}
        <NavLink
          to='/dashboard'
          className={({ isActive }) => `sidebar-link ${isActive && !isAdminPanelMode ? 'active' : ''}`}
          title='Dashboard'
        >
          <span className='sidebar-link-icon'>📊</span>
          {!collapsed && <span className='sidebar-link-text'>Dashboard</span>}
        </NavLink>

        <NavLink
          to='/reports'
          className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}
          title='Reports'
        >
          <span className='sidebar-link-icon'>📈</span>
          {!collapsed && <span className='sidebar-link-text'>Reports</span>}
        </NavLink>

        {isDevOrAdmin && (
          <a
            href='/api/docs'
            target='_blank'
            rel='noopener noreferrer'
            className='sidebar-link'
            title='Interactive REST API Documentation'
          >
            <span className='sidebar-link-icon'>📖</span>
            {!collapsed && <span className='sidebar-link-text'>API Docs ↗</span>}
          </a>
        )}

        {/* Apps Selector Section */}
        <div style={{
          marginTop: '1rem',
          paddingTop: '0.75rem',
          borderTop: '1px solid rgba(255, 255, 255, 0.08)'
        }}>
          <div style={{
            padding: '0.3rem 0.6rem',
            fontSize: '0.72rem',
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
            color: '#9ca3af',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between'
          }}>
            {!collapsed ? <span>APPS</span> : <span style={{ fontSize: '0.65rem' }}>APPS</span>}
            {!collapsed && apps.length > 0 && (
              <span style={{ fontSize: '0.68rem', color: '#6b7280' }}>({apps.length})</span>
            )}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem', marginTop: '0.2rem' }}>
            {apps.map((app) => {
              const isSelected = !isAdminPanelMode && currentApp?.id === app.id;
              const isSuspended = !!app.is_suspended;
              return (
                <button
                  key={app.id}
                  onClick={() => {
                    if (isSuspended && !isAdmin) {
                      alert(`Application "${app.name}" is currently suspended by system administrators. Testing and execution activities are temporarily disabled.`);
                      return;
                    }
                    handleAppClick(app);
                  }}
                  className={`sidebar-link sidebar-app-btn ${isSelected ? 'active' : ''}`}
                  title={isSuspended ? `${app.name} (Suspended)` : `Select ${app.name}`}
                  style={{
                    cursor: 'pointer',
                    width: '100%',
                    textAlign: 'left',
                    background: isSelected ? 'rgba(99, 102, 241, 0.2)' : isSuspended ? 'rgba(245, 158, 11, 0.08)' : 'transparent',
                    border: isSelected ? '1px solid rgba(99, 102, 241, 0.45)' : isSuspended ? '1px solid rgba(245, 158, 11, 0.25)' : '1px solid transparent',
                    color: isSelected ? '#a5b4fc' : isSuspended ? '#fbbf24' : 'inherit',
                    opacity: isSuspended && !isAdmin ? 0.75 : 1
                  }}
                >
                  <span className='sidebar-link-icon'>{isSuspended ? '⏸️' : '📱'}</span>
                  {!collapsed && (
                    <span className='sidebar-link-text' style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', gap: '0.4rem' }}>
                      <span style={{ fontWeight: isSelected ? 600 : 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{app.name}</span>
                      {isSelected ? (
                        <span style={{ fontSize: '0.62rem', background: '#10b981', color: '#000', padding: '0.1rem 0.35rem', borderRadius: '4px', fontWeight: 700 }}>
                          ACTIVE
                        </span>
                      ) : isSuspended ? (
                        <span style={{ fontSize: '0.62rem', background: 'rgba(245, 158, 11, 0.2)', color: '#fbbf24', border: '1px solid #f59e0b', padding: '0.05rem 0.3rem', borderRadius: '4px', fontWeight: 700 }}>
                          PAUSED
                        </span>
                      ) : null}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </nav>
    </aside>
  );
};

export default Sidebar;
