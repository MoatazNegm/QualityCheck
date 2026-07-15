import React from 'react';
import { NavLink } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const Sidebar: React.FC = () => {
  const { user } = useAuth();

  return (
    <aside className='sidebar'>
      <div className='sidebar-header'>
        <img src='/Q.png' alt='Q logo' className='sidebar-logo' />
        <span className='sidebar-title'>QualityCheck</span>
      </div>
      <nav className='sidebar-nav'>
        <NavLink
          to='/dashboard'
          className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}
        >
          <span className='sidebar-link-icon'>📊</span>
          Dashboard
        </NavLink>
        {user?.isAdmin && (
          <NavLink
            to='/admin'
            className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}
          >
            <span className='sidebar-link-icon'>⚙️</span>
            Admin Panel
          </NavLink>
        )}
      </nav>
    </aside>
  );
};

export default Sidebar;
