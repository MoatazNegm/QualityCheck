import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

interface Test {
  id: number;
  name: string;
  description: string;
  locked: boolean;
  isActive: boolean;
  completed: boolean;
  totalPoints: number;
  monthlyRounds?: number;
  maxMonthlyRounds?: number;
  isMonthlyLocked?: boolean;
}

interface UserWarning {
  id: number;
  message: string;
  created_round: number;
  created_at: string;
}

const Dashboard: React.FC = () => {
  const { token, user } = useAuth();
  const navigate = useNavigate();
  const [tests, setTests] = useState<Test[]>([]);
  const [loading, setLoading] = useState(true);
  const [monthEarned, setMonthEarned] = useState<number | null>(null);
  const [currentVersionId, setCurrentVersionId] = useState<number | null>(null);
  const [warnings, setWarnings] = useState<UserWarning[]>([]);

  const API_BASE = '';
  const authHeaders = { Authorization: `Bearer ${token}` };

  useEffect(() => {
    fetchTests();
    fetchSummary();
    fetchWarnings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => {
    if (!token) return;
    let mounted = true;
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`${API_BASE}/api/versions/current`, { headers: authHeaders });
        if (res.ok && mounted) {
          const data = await res.json();
          const vid = data.version ? data.version.id : null;
          if (vid !== currentVersionId) {
            setCurrentVersionId(vid);
            const testsRes = await fetch(`${API_BASE}/api/tests`, { headers: authHeaders });
            if (testsRes.ok) {
              setTests(await testsRes.json());
            }
          }
        }
      } catch (err) {
        console.error('Failed to poll current version:', err);
      }
    }, 5000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, currentVersionId]);

  const fetchTests = async () => {
    try {
      const response = await fetch(`${API_BASE}/api/tests`, {
        headers: authHeaders
      });

      if (response.ok) {
        const data = await response.json();
        setTests(data);
      }
    } catch (error) {
      console.error('Error fetching tests:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchSummary = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/test-results/summary`, { headers: authHeaders });
      if (res.ok) {
        const data = await res.json();
        setMonthEarned(data.monthEarned);
      }
    } catch (error) {
      console.error('Error fetching points summary:', error);
    }
  };

  const fetchWarnings = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/test-results/warnings`, { headers: authHeaders });
      if (res.ok) {
        const data = await res.json();
        setWarnings(data.warnings || []);
      }
    } catch (error) {
      console.error('Error fetching warnings:', error);
    }
  };

  if (loading) return <div>Loading tests...</div>;

  if (tests.length === 0) {
    return (
      <div className='dashboard-empty'>
        <h2>No Tests Available</h2>
        <p>There are currently no tests assigned to you.</p>
        <p>Contact your administrator for test assignments.</p>
      </div>
    );
  }

  const allMonthlyTestsLocked = !user?.isAdmin && tests.length > 0 && tests.every(t => t.isMonthlyLocked);

  const handleCardClick = (test: Test) => {
    if (test.locked) return;
    if (user?.isSuspended) return;
    navigate(`/test/${test.id}`);
  };

  const handleContinue = () => {
    const activeTest = tests.find(t => t.isActive);
    if (activeTest && !activeTest.locked && !user?.isSuspended) {
      navigate(`/test/${activeTest.id}`);
    }
  };

  return (
    <div className='dashboard'>
      <h2>Available Tests</h2>
      <p className='loop-hint'>
        Complete each test in order. Only the current test is unlocked; finish it to unlock the next. The cycle repeats endlessly.
      </p>

      {allMonthlyTestsLocked && (
        <div className='all-tests-locked-banner' style={{
          background: 'rgba(245, 101, 101, 0.12)',
          border: '2px solid #f56565',
          borderRadius: '12px',
          padding: '1.5rem',
          margin: '1.5rem 0',
          textAlign: 'center',
          boxShadow: '0 4px 12px rgba(245, 101, 101, 0.2)'
        }}>
          <div style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>⛔</div>
          <h3 style={{ color: '#f56565', margin: '0 0 0.5rem 0', fontSize: '1.4rem' }}>
            All Test Rounds Consumed For This Month
          </h3>
          <p style={{ fontSize: '1.05rem', margin: '0 0 0.5rem 0', fontWeight: 500 }}>
            You have consumed all your allowed test rounds for this month. Please refer to management.
          </p>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', margin: 0 }}>
            <em>Every assigned test has reached its monthly round limit. Access will reset automatically next month or when updated by an administrator.</em>
          </p>
        </div>
      )}

      {warnings.length > 0 && (
        <div className='user-warnings-area'>
          {warnings.map(w => (
            <div key={w.id} className='warning-banner'>
              <span className='warning-icon'>⚠️</span>
              <div className='warning-content'>
                <strong>Points Not Counted Notice</strong>
                <p>{w.message}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className='points-summary'>
        Points earned this month: <strong>{monthEarned !== null ? monthEarned : '—'}</strong>
      </div>
      {(() => {
        const activeTest = tests.find(t => t.isActive);
        if (!activeTest || activeTest.locked || user?.isSuspended) return null;
        return (
          <button className='btn btn-continue' onClick={handleContinue} style={{ marginBottom: '1rem' }}>
            Continue {activeTest.name} →
          </button>
        );
      })()}
      <div className='tests-list'>
        {tests.map(test => (
          <div
            key={test.id}
            className={`test-card ${test.locked ? 'locked' : ''} ${test.isActive ? 'active' : ''}`}
            onClick={() => handleCardClick(test)}
          >
            {test.locked && (
              <div className='lock-overlay' title={test.isMonthlyLocked ? 'Monthly test round limit reached' : 'Locked — finish the previous test first'}>
                <svg width='34' height='34' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2' strokeLinecap='round' strokeLinejoin='round'>
                  <rect x='3' y='11' width='18' height='11' rx='2' ry='2' />
                  <path d='M7 11V7a5 5 0 0 1 10 0v4' />
                </svg>
              </div>
            )}
            <div className='test-card-body'>
              <h3>{test.name}</h3>
              <p>{test.description}</p>
            </div>
            <div className='test-card-footer'>
              {test.isActive && <span className='badge badge-current'>Current</span>}
              {test.completed && !test.isActive && <span className='badge badge-done'>Completed</span>}
              {typeof test.monthlyRounds === 'number' && typeof test.maxMonthlyRounds === 'number' && (
                <span className={`badge ${test.isMonthlyLocked ? 'badge-monthly-locked' : 'badge-rounds'}`} style={{
                  background: test.isMonthlyLocked ? 'rgba(245, 101, 101, 0.2)' : 'rgba(255, 255, 255, 0.08)',
                  color: test.isMonthlyLocked ? '#feb2b2' : 'inherit',
                  border: test.isMonthlyLocked ? '1px solid #f56565' : '1px solid rgba(255, 255, 255, 0.15)'
                }}>
                  {test.isMonthlyLocked ? `🔒 Monthly Limit (${test.monthlyRounds}/${test.maxMonthlyRounds})` : `🔄 Rounds: ${test.monthlyRounds}/${test.maxMonthlyRounds}`}
                </span>
              )}
              <span className='badge badge-points'>★ {test.totalPoints} pts</span>
              {test.locked || user?.isSuspended ? (
                <span className='btn btn-locked' aria-disabled='true'>{user?.isSuspended ? '🚫 Suspended' : (test.isMonthlyLocked ? '🔒 Limit Reached' : '🔒 Locked')}</span>
              ) : (
                <span className='btn'>Start Test</span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default Dashboard;