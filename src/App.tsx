import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { AppProvider, useApp } from './context/AppContext';
import LoginScreen from './components/LoginScreen';
import Dashboard from './components/Dashboard';
import TestExecution from './components/TestExecution';
import AdminPanel from './components/AdminPanel';
import ReportsView from './components/ReportsView';
import Header from './components/Header';
import Sidebar from './components/Sidebar';
import VersionFooter from './components/VersionFooter';

const AppContent: React.FC = () => {
  const { user, isLoading } = useAuth();
  const { isAdminPanelMode } = useApp();

  if (isLoading) {
    return <div>Loading...</div>;
  }

  const isAdmin = user?.isAdmin || user?.userGroups?.includes('admins');

  const getLastLandingPath = () => {
    const lastView = localStorage.getItem('qc_last_view');
    if (isAdmin) {
      if (isAdminPanelMode || localStorage.getItem('qc_admin_panel_mode') === 'true') {
        return '/admin';
      }
      if (lastView && lastView !== '/login') {
        return lastView;
      }
      return '/admin';
    } else {
      if (lastView && lastView !== '/login' && lastView !== '/admin') {
        return lastView;
      }
      return '/dashboard';
    }
  };

  const defaultLanding = getLastLandingPath();

  return (
    <div className='app-layout'>
      {user && <Sidebar />}
      <div className='app-main'>
        {user && <Header />}
        <div className='app-content'>
          <Routes>
            <Route path="/login" element={!user ? <LoginScreen /> : <Navigate to={defaultLanding} replace />} />
            <Route path="/dashboard" element={user ? <Dashboard /> : <Navigate to="/login" />} />
            <Route path="/reports" element={user ? <ReportsView /> : <Navigate to="/login" />} />
            <Route path="/test/:testId" element={user ? <TestExecution /> : <Navigate to="/login" />} />
            <Route path="/admin" element={isAdmin ? <AdminPanel /> : <Navigate to="/dashboard" />} />
            <Route path="/" element={user ? <Navigate to={defaultLanding} replace /> : <Navigate to="/login" />} />
          </Routes>
        </div>
        <VersionFooter />
      </div>
    </div>
  );
};

function App() {
  return (
    <AuthProvider>
      <AppProvider>
        <Router>
          <AppContent />
        </Router>
      </AppProvider>
    </AuthProvider>
  );
}

export default App;