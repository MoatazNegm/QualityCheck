import React, { useState, useEffect } from 'react';
import { NavLink } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const API_BASE = process.env.REACT_APP_API_URL || '';

const Header: React.FC = () => {
  const { user, token, logout } = useAuth();
  const [currentVersion, setCurrentVersion] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    const fetchVersion = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/versions/current`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (res.ok) {
          const data = await res.json();
          setCurrentVersion(data.version ? data.version.name : null);
        }
      } catch (err) {
        console.error('Failed to load current version:', err);
      }
    };
    fetchVersion();
  }, [token]);

  return (
    <header className='header'>
      <div className='header-content'>
        <div className='header-left'>
          <img src='/Q.png' alt='Q logo' className='header-q-logo' />
          <NavLink to='/dashboard' className='logo'>
            QualityCheck
          </NavLink>
        </div>
        <div className='header-center'>
          <span className='current-version-badge' title='The version users are currently testing'>
            {currentVersion ? `Version: ${currentVersion}` : 'No version set'}
          </span>
        </div>
        <div className='header-nav'>
          {user?.isAdmin ? (
            <>
              <NavLink to='/dashboard' className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
                Dashboard
              </NavLink>
              <NavLink to='/admin' className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
                Admin Panel
              </NavLink>
            </>
          ) : null}
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
