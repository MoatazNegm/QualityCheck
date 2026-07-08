import React from 'react';
import { NavLink } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const Header: React.FC = () => {
  const { user, logout } = useAuth();

  return (
    <header className='header'>
      <div className='header-content'>
        <div className='header-left'>
          <img src='/Q.png' alt='Q logo' className='header-q-logo' />
          <NavLink to='/dashboard' className='logo'>
            QualityCheck
          </NavLink>
        </div>
        <div className='header-nav'>
          {user?.isAdmin && (
            <>
              <NavLink to='/dashboard' className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
                Dashboard
              </NavLink>
              <NavLink to='/admin' className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
                Admin Panel
              </NavLink>
            </>
          )}
        </div>
        <div className='user-info'>
          {user && (
            <>
              <span>Welcome, {user.username}</span>
              <button onClick={logout}>Logout</button>
            </>
          )}
        </div>
      </div>
    </header>
  );
};

export default Header;