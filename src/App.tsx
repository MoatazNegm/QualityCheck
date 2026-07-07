import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import LoginScreen from './components/LoginScreen';
import Dashboard from './components/Dashboard';
import TestExecution from './components/TestExecution';
import AdminPanel from './components/AdminPanel';
import Header from './components/Header';
import VersionFooter from './components/VersionFooter';

const AppContent: React.FC = () => {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return <div>Loading...</div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      {user && <Header />}
      <div style={{ flex: 1 }}>
        <Routes>
          <Route path="/login" element={!user ? <LoginScreen /> : <Navigate to={user.isAdmin ? "/admin" : "/dashboard"} />} />
          <Route path="/dashboard" element={user ? <Dashboard /> : <Navigate to="/login" />} />
          <Route path="/test/:testId" element={user ? <TestExecution /> : <Navigate to="/login" />} />
          <Route path="/admin" element={user?.isAdmin ? <AdminPanel /> : <Navigate to="/dashboard" />} />
          <Route path="/" element={user ? <Navigate to={user.isAdmin ? "/admin" : "/dashboard"} /> : <Navigate to="/login" />} />
        </Routes>
      </div>
      <VersionFooter />
    </div>
  );
};

function App() {
  return (
    <AuthProvider>
      <Router>
        <AppContent />
      </Router>
    </AuthProvider>
  );
}

export default App;