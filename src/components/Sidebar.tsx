import React, { useState, useEffect } from 'react';
import { NavLink } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const Sidebar: React.FC = () => {
  const { user } = useAuth();
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === '[' && e.ctrlKey) {
        setCollapsed((v) => !v);
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, []);

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
        <NavLink
          to='/dashboard'
          className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}
          title='Dashboard'
        >
          <span className='sidebar-link-icon'>📊</span>
          {!collapsed && <span className='sidebar-link-text'>Dashboard</span>}
        </NavLink>
        {user?.isAdmin && (
          <NavLink
            to='/admin'
            className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}
            title='Admin Panel'
          >
            <span className='sidebar-link-icon'>⚙️</span>
            {!collapsed && <span className='sidebar-link-text'>Admin Panel</span>}
          </NavLink>
        )}
      </nav>
    </aside>
  );
};

export default Sidebar;
