import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';

const LoginScreen: React.FC = () => {
  const { login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: any) => {
    e.preventDefault();
    setLoading(true);

    try {
      await login(username, password);
      // Navigate to dashboard after successful login
    } catch (error: any) {
      alert('Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className='login-container'>
      <img src='/quickstor-logo.png' alt='Quickstor Logo' className='login-logo' />
      <h2>QualityCheck Login</h2>
      <form onSubmit={handleSubmit}>
        <div>
          <label>Username:</label>
          <input type='text' value={username} onChange={e => setUsername(e.target.value)} required/>
        </div>
        <div>
          <label>Password:</label>
          <input type='password' value={password} onChange={e => setPassword(e.target.value)} required/>
        </div>
        <button type='submit' disabled={loading}>Login</button>
      </form>
    </div>
  );
};

export default LoginScreen;