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
}

const Dashboard: React.FC = () => {
  const { token, user } = useAuth();
  const navigate = useNavigate();
  const [tests, setTests] = useState<Test[]>([]);
  const [loading, setLoading] = useState(true);
  const [monthEarned, setMonthEarned] = useState<number | null>(null);
  const [currentVersionId, setCurrentVersionId] = useState<number | null>(null);

  const API_BASE = process.env.REACT_APP_API_URL || '';
  const authHeaders = { Authorization: `Bearer ${token}` };

  useEffect(() => {
    fetchTests();
    fetchSummary();
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

  const handleCardClick = (test: Test) => {
    if (test.locked) return;
    navigate(`/test/${test.id}`);
  };

  return (
    <div className='dashboard'>
      <h2>Available Tests</h2>
      <p className='loop-hint'>
        Complete each test in order. Only the current test is unlocked; finish it to unlock the next. The cycle repeats endlessly.
      </p>
      <div className='points-summary'>
        Points earned this month: <strong>{monthEarned !== null ? monthEarned : '—'}</strong>
      </div>
      <div className='tests-list'>
        {tests.map(test => (
          <div
            key={test.id}
            className={`test-card ${test.locked ? 'locked' : ''} ${test.isActive ? 'active' : ''}`}
            onClick={() => handleCardClick(test)}
          >
            {test.locked && (
              <div className='lock-overlay' title='Locked — finish the previous test first'>
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
              <span className='badge badge-points'>★ {test.totalPoints} pts</span>
              {test.locked ? (
                <span className='btn btn-locked' aria-disabled='true'>🔒 Locked</span>
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