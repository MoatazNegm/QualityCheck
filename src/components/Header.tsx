import React, { useState, useEffect, useRef } from 'react';
import { NavLink } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const API_BASE = '';

const Header: React.FC = () => {
  const { user, token, logout, changePassword } = useAuth();
  const [currentVersion, setCurrentVersion] = useState<string | null>(null);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [changePasswordLoading, setChangePasswordLoading] = useState(false);
  const [changePasswordError, setChangePasswordError] = useState<string | null>(null);
  const [changePasswordSuccess, setChangePasswordSuccess] = useState<string | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!token) return;
    let mounted = true;
    const fetchVersion = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/versions/current`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (res.ok && mounted) {
          const data = await res.json();
          setCurrentVersion(data.version ? data.version.name : null);
        }
      } catch (err) {
        console.error('Failed to load current version:', err);
      }
    };
    fetchVersion();
    const interval = setInterval(fetchVersion, 5000);
    return () => clearInterval(interval);
  }, [token]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setChangePasswordLoading(true);
    setChangePasswordError(null);
    setChangePasswordSuccess(null);

    try {
      await changePassword(currentPassword, newPassword);
      setChangePasswordSuccess('Password changed successfully');
      setCurrentPassword('');
      setNewPassword('');
      setTimeout(() => {
        setShowChangePassword(false);
        setChangePasswordSuccess(null);
      }, 1200);
    } catch (err: any) {
      setChangePasswordError(err.message || 'Failed to change password');
    } finally {
      setChangePasswordLoading(false);
    }
  };

  const handleLogout = () => {
    setDropdownOpen(false);
    logout();
  };

  return (
    <>
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
          <div className='user-info' ref={dropdownRef}>
            {user && (
              <div className='user-dropdown'>
                <button
                  className='user-dropdown-toggle'
                  onClick={() => setDropdownOpen(!dropdownOpen)}
                >
                  {user.username}
                  <span className={`user-dropdown-arrow ${dropdownOpen ? 'open' : ''}`}>▼</span>
                </button>
                {dropdownOpen && (
                  <div className='user-dropdown-menu'>
                    <button
                      className='user-dropdown-item'
                      onClick={() => {
                        setDropdownOpen(false);
                        setShowChangePassword(true);
                        setChangePasswordError(null);
                        setChangePasswordSuccess(null);
                        setCurrentPassword('');
                        setNewPassword('');
                      }}
                    >
                      Change Password
                    </button>
                    <button
                      className='user-dropdown-item user-dropdown-item-danger'
                      onClick={handleLogout}
                    >
                      Logout
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </header>

      {showChangePassword && (
        <div className='modal-overlay' onClick={() => setShowChangePassword(false)}>
          <div className='modal' onClick={(e) => e.stopPropagation()}>
            <div className='modal-header'>
              <h3>Change Password</h3>
              <button className='modal-close' onClick={() => setShowChangePassword(false)}>×</button>
            </div>
            <form onSubmit={handleChangePassword}>
              <div className='modal-body'>
                {changePasswordError && <div className='error-msg'>{changePasswordError}</div>}
                {changePasswordSuccess && <div className='success-msg'>{changePasswordSuccess}</div>}
                <div className='change-password-form'>
                  <label>Current Password</label>
                  <input
                    type='password'
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    required
                  />
                  <label>New Password</label>
                  <input
                    type='password'
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    required
                  />
                </div>
              </div>
              <div className='modal-actions'>
                <button type='button' className='btn-secondary' onClick={() => setShowChangePassword(false)}>
                  Cancel
                </button>
                <button type='submit' className='btn' disabled={changePasswordLoading}>
                  {changePasswordLoading ? 'Saving...' : 'Change Password'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
};

export default Header;
