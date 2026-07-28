import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';

interface Version {
  id: number;
  name: string;
  note: string | null;
  is_current: number;
  created_at: string;
}

interface Test {
  id: number;
  name: string;
  description: string;
}

interface User {
  id: number;
  username: string;
  is_admin: boolean;
  isSuspended: boolean;
  user_groups?: string[];
}

const API_BASE = '';

const ReportsView: React.FC = () => {
  const { user, token } = useAuth();
  const authHeaders = { Authorization: `Bearer ${token}` };

  const isFullAccess = !!(user?.isAdmin || user?.userGroups?.includes('admins') || user?.userGroups?.includes('developers'));

  const [reportsSubTab, setReportsSubTab] = useState<'user' | 'test' | 'passed' | 'points'>('user');

  const [users, setUsers] = useState<User[]>([]);
  const [tests, setTests] = useState<Test[]>([]);
  const [versions, setVersions] = useState<Version[]>([]);

  // --- User Report State ---
  const [reportUserIds, setReportUserIds] = useState<number[]>([]);
  const [reportUserSearch, setReportUserSearch] = useState('');
  const [showUserDropdown, setShowUserDropdown] = useState(false);

  const [reportVersionIds, setReportVersionIds] = useState<number[]>([]);
  const [reportVersionSearch, setReportVersionSearch] = useState('');
  const [showVersionDropdown, setShowVersionDropdown] = useState(false);

  const [reportPreset, setReportPreset] = useState<'current_month' | 'last_month' | 'current_year' | 'last_year' | 'custom'>('last_month');
  const [reportStartDate, setReportStartDate] = useState('');
  const [reportEndDate, setReportEndDate] = useState('');

  const [reportLoading, setReportLoading] = useState(false);
  const [reportData, setReportData] = useState<any>(null);
  const [reportError, setReportError] = useState('');
  const [expandedTests, setExpandedTests] = useState<Set<number>>(new Set());
  const [expandedReportSteps, setExpandedReportSteps] = useState<Set<string>>(new Set());

  // --- Test Report State ---
  const [testReportTestIds, setTestReportTestIds] = useState<number[]>([]);
  const [testReportTestSearch, setTestReportTestSearch] = useState('');
  const [showTestDropdown, setShowTestDropdown] = useState(false);

  const [testReportSteps, setTestReportSteps] = useState<any[]>([]);
  const [testReportSelectedStepId, setTestReportSelectedStepId] = useState<number | null>(null);
  const [testReportStepSearch, setTestReportStepSearch] = useState('');
  const [showStepDropdown, setShowStepDropdown] = useState(false);

  const [testReportVersionIds, setTestReportVersionIds] = useState<number[]>([]);
  const [testReportVersionSearch, setTestReportVersionSearch] = useState('');
  const [showTestVersionDropdown, setShowTestVersionDropdown] = useState(false);

  const [testReportPreset, setTestReportPreset] = useState<'current_month' | 'last_month' | 'current_year' | 'last_year' | 'custom'>('last_month');
  const [testReportStartDate, setTestReportStartDate] = useState('');
  const [testReportEndDate, setTestReportEndDate] = useState('');

  const [testReportLoading, setTestReportLoading] = useState(false);
  const [testReportData, setTestReportData] = useState<any>(null);
  const [testReportError, setTestReportError] = useState('');

  // --- Passed Steps Report State ---
  const [passedReportUserIds, setPassedReportUserIds] = useState<number[]>([]);
  const [passedReportUserSearch, setPassedReportUserSearch] = useState('');
  const [showPassedUserDropdown, setShowPassedUserDropdown] = useState(false);

  const [passedReportTestIds, setPassedReportTestIds] = useState<number[]>([]);
  const [passedReportTestSearch, setPassedReportTestSearch] = useState('');
  const [showPassedTestDropdown, setShowPassedTestDropdown] = useState(false);

  const [passedReportVersionIds, setPassedReportVersionIds] = useState<number[]>([]);
  const [passedReportVersionSearch, setPassedReportVersionSearch] = useState('');
  const [showPassedVersionDropdown, setShowPassedVersionDropdown] = useState(false);

  const [passedReportPreset, setPassedReportPreset] = useState<'current_month' | 'last_month' | 'current_year' | 'last_year' | 'custom'>('last_month');
  const [passedReportStartDate, setPassedReportStartDate] = useState('');
  const [passedReportEndDate, setPassedReportEndDate] = useState('');

  const [passedReportLoading, setPassedReportLoading] = useState(false);
  const [passedReportData, setPassedReportData] = useState<any>(null);
  const [passedReportError, setPassedReportError] = useState('');

  // --- Points Report State ---
  const [pointsReportUserIds, setPointsReportUserIds] = useState<number[]>([]);
  const [pointsReportUserSearch, setPointsReportUserSearch] = useState('');
  const [showPointsUserDropdown, setShowPointsUserDropdown] = useState(false);

  const [pointsReportTestIds, setPointsReportTestIds] = useState<number[]>([]);
  const [pointsReportTestSearch, setPointsReportTestSearch] = useState('');
  const [showPointsTestDropdown, setShowPointsTestDropdown] = useState(false);

  const [pointsReportVersionIds, setPointsReportVersionIds] = useState<number[]>([]);
  const [pointsReportVersionSearch, setPointsReportVersionSearch] = useState('');
  const [showPointsVersionDropdown, setShowPointsVersionDropdown] = useState(false);

  const [pointsReportPreset, setPointsReportPreset] = useState<'current_month' | 'last_month' | 'current_year' | 'last_year' | 'custom'>('last_month');
  const [pointsReportStartDate, setPointsReportStartDate] = useState('');
  const [pointsReportEndDate, setPointsReportEndDate] = useState('');

  const [pointsReportLoading, setPointsReportLoading] = useState(false);
  const [pointsReportData, setPointsReportData] = useState<any>(null);
  const [pointsReportError, setPointsReportError] = useState('');

  // --- User Progress Drill-Down State (Points Report) ---
  const [expandedPointsUser, setExpandedPointsUser] = useState<number | null>(null);
  const [userProgressCache, setUserProgressCache] = useState<Record<number, any>>({});
  const [userProgressLoading, setUserProgressLoading] = useState<number | null>(null);

  const getDefaultReportDates = (preset: 'current_month' | 'last_month' | 'current_year' | 'last_year' | 'custom') => {
    const now = new Date();
    const start = new Date();
    const end = new Date();

    switch (preset) {
      case 'current_month':
        start.setDate(1);
        start.setHours(0, 0, 0, 0);
        break;
      case 'last_month':
        start.setDate(1);
        start.setHours(0, 0, 0, 0);
        start.setMonth(start.getMonth() - 1);
        end.setDate(0);
        end.setHours(23, 59, 59, 999);
        break;
      case 'current_year':
        start.setMonth(0, 1);
        start.setHours(0, 0, 0, 0);
        break;
      case 'last_year':
        start.setFullYear(now.getFullYear() - 1, 0, 1);
        start.setHours(0, 0, 0, 0);
        end.setFullYear(now.getFullYear() - 1, 11, 31);
        end.setHours(23, 59, 59, 999);
        break;
      default:
        break;
    }

    return {
      start: start.toISOString().slice(0, 10),
      end: end.toISOString().slice(0, 10)
    };
  };

  useEffect(() => {
    const dates = getDefaultReportDates('last_month');
    setReportStartDate(dates.start);
    setReportEndDate(dates.end);
    setTestReportStartDate(dates.start);
    setTestReportEndDate(dates.end);
    setPassedReportStartDate(dates.start);
    setPassedReportEndDate(dates.end);
    setPointsReportStartDate(dates.start);
    setPointsReportEndDate(dates.end);

    fetchVersions();
    fetchTests();
    if (isFullAccess) {
      fetchUsers();
    } else if (user?.id) {
      setReportUserIds([user.id]);
      setPassedReportUserIds([user.id]);
      setPointsReportUserIds([user.id]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, isFullAccess]);

  const fetchVersions = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/versions`, { headers: authHeaders });
      if (res.ok) {
        const data = await res.json();
        setVersions(data);
        const curr = data.find((v: Version) => v.is_current);
        if (curr) {
          setReportVersionIds([curr.id]);
          setTestReportVersionIds([curr.id]);
          setPassedReportVersionIds([curr.id]);
          setPointsReportVersionIds([curr.id]);
        }
      }
    } catch {
      // ignore
    }
  };

  const fetchTests = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/tests`, { headers: authHeaders });
      if (res.ok) setTests(await res.json());
    } catch {
      // ignore
    }
  };

  const fetchUsers = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/users`, { headers: authHeaders });
      if (res.ok) {
        const data: User[] = await res.json();
        const testers = data.filter(u => !u.is_admin);
        setUsers(testers);
        const allIds = testers.map(u => u.id);
        setReportUserIds(allIds);
        setPassedReportUserIds(allIds);
        setPointsReportUserIds(allIds);
      }
    } catch {
      // ignore
    }
  };

  // --- Handlers & Toggles ---
  const handleUserPresetChange = (preset: 'current_month' | 'last_month' | 'current_year' | 'last_year' | 'custom') => {
    setReportPreset(preset);
    if (preset !== 'custom') {
      const dates = getDefaultReportDates(preset);
      setReportStartDate(dates.start);
      setReportEndDate(dates.end);
    }
    setReportData(null);
    setReportError('');
  };

  const handleTestPresetChange = (preset: 'current_month' | 'last_month' | 'current_year' | 'last_year' | 'custom') => {
    setTestReportPreset(preset);
    if (preset !== 'custom') {
      const dates = getDefaultReportDates(preset);
      setTestReportStartDate(dates.start);
      setTestReportEndDate(dates.end);
    }
    setTestReportData(null);
    setTestReportError('');
  };

  const handlePassedPresetChange = (preset: 'current_month' | 'last_month' | 'current_year' | 'last_year' | 'custom') => {
    setPassedReportPreset(preset);
    if (preset !== 'custom') {
      const dates = getDefaultReportDates(preset);
      setPassedReportStartDate(dates.start);
      setPassedReportEndDate(dates.end);
    }
    setPassedReportData(null);
    setPassedReportError('');
  };

  const handlePointsPresetChange = (preset: 'current_month' | 'last_month' | 'current_year' | 'last_year' | 'custom') => {
    setPointsReportPreset(preset);
    if (preset !== 'custom') {
      const dates = getDefaultReportDates(preset);
      setPointsReportStartDate(dates.start);
      setPointsReportEndDate(dates.end);
    }
    setPointsReportData(null);
    setPointsReportError('');
  };

  // User Report
  const fetchUserReport = async () => {
    const targetUserIds = isFullAccess ? reportUserIds : (user?.id ? [user.id] : []);
    if (targetUserIds.length === 0 || !reportStartDate || !reportEndDate) return;
    setReportLoading(true);
    setReportError('');
    setReportData(null);
    try {
      const url = new URL(`${API_BASE}/api/reports/user-report`, window.location.origin);
      url.searchParams.set('userId', targetUserIds.join(','));
      url.searchParams.set('startDate', reportStartDate);
      url.searchParams.set('endDate', reportEndDate);
      if (reportVersionIds.length > 0) url.searchParams.set('versionIds', reportVersionIds.join(','));

      const res = await fetch(url.toString(), { headers: authHeaders });
      const data = await res.json();
      if (!res.ok) {
        setReportError(data.error || 'Failed to load report');
      } else {
        setReportData(data);
      }
    } catch (err) {
      console.error('User report fetch failed:', err);
      setReportError('Network error');
    } finally {
      setReportLoading(false);
    }
  };

  const toggleTestExpand = (testId: number) => {
    setExpandedTests(prev => {
      const next = new Set(prev);
      if (next.has(testId)) next.delete(testId);
      else next.add(testId);
      return next;
    });
  };

  const toggleReportStepExpand = (testId: number, stepId: number) => {
    const key = `${testId}-${stepId}`;
    setExpandedReportSteps(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // Test Report
  const fetchTestReportSteps = async () => {
    try {
      const targetTests = testReportTestIds.length > 0 ? testReportTestIds : tests.map(t => t.id);
      const results = await Promise.all(
        targetTests.map(tid =>
          fetch(`${API_BASE}/api/tests/${tid}`, { headers: authHeaders })
            .then(r => r.ok ? r.json() : null)
        )
      );
      const list = results
        .filter(Boolean)
        .map((t: any) => ({
          testId: t.id,
          testName: t.name,
          steps: t.steps || []
        }));
      setTestReportSteps(list);
    } catch (err) {
      console.error('Failed to fetch test report steps:', err);
    }
  };

  const fetchTestReport = async () => {
    if (!testReportStartDate || !testReportEndDate) return;
    setTestReportLoading(true);
    setTestReportError('');
    setTestReportData(null);
    try {
      const url = new URL(`${API_BASE}/api/reports/test-report`, window.location.origin);
      if (testReportTestIds.length > 0) {
        url.searchParams.set('testId', testReportTestIds.join(','));
      } else {
        url.searchParams.set('testId', 'all');
      }
      url.searchParams.set('startDate', testReportStartDate);
      url.searchParams.set('endDate', testReportEndDate);
      if (testReportVersionIds.length > 0) url.searchParams.set('versionIds', testReportVersionIds.join(','));
      if (testReportSelectedStepId) url.searchParams.set('stepId', String(testReportSelectedStepId));

      const res = await fetch(url.toString(), { headers: authHeaders });
      const data = await res.json();
      if (!res.ok) {
        setTestReportError(data.error || 'Failed to load report');
      } else {
        setTestReportData(data);
      }
    } catch (err) {
      console.error('Test report fetch failed:', err);
      setTestReportError('Network error');
    } finally {
      setTestReportLoading(false);
    }
  };

  // Passed Steps Report
  const fetchPassedReport = async () => {
    if (!passedReportStartDate || !passedReportEndDate) return;
    setPassedReportLoading(true);
    setPassedReportError('');
    setPassedReportData(null);
    try {
      const url = new URL(`${API_BASE}/api/reports/passed-report`, window.location.origin);
      const targetUserIds = isFullAccess ? passedReportUserIds : (user?.id ? [user.id] : []);
      if (targetUserIds.length > 0) {
        url.searchParams.set('userId', targetUserIds.join(','));
      } else {
        url.searchParams.set('userId', 'all');
      }
      if (passedReportTestIds.length > 0) {
        url.searchParams.set('testId', passedReportTestIds.join(','));
      } else {
        url.searchParams.set('testId', 'all');
      }
      url.searchParams.set('startDate', passedReportStartDate);
      url.searchParams.set('endDate', passedReportEndDate);
      if (passedReportVersionIds.length > 0) url.searchParams.set('versionIds', passedReportVersionIds.join(','));

      const res = await fetch(url.toString(), { headers: authHeaders });
      const data = await res.json();
      if (!res.ok) {
        setPassedReportError(data.error || 'Failed to load report');
      } else {
        setPassedReportData(data);
      }
    } catch (err) {
      console.error('Passed report fetch failed:', err);
      setPassedReportError('Network error');
    } finally {
      setPassedReportLoading(false);
    }
  };

  // Points Report
  const fetchPointsReport = async () => {
    if (!pointsReportStartDate || !pointsReportEndDate) return;
    setPointsReportLoading(true);
    setPointsReportError('');
    setPointsReportData(null);
    try {
      const url = new URL(`${API_BASE}/api/reports/points`, window.location.origin);
      const targetUserIds = isFullAccess ? pointsReportUserIds : (user?.id ? [user.id] : []);
      if (targetUserIds.length > 0) {
        url.searchParams.set('userId', targetUserIds.join(','));
      } else {
        url.searchParams.set('userId', 'all');
      }
      if (pointsReportTestIds.length > 0) {
        url.searchParams.set('testId', pointsReportTestIds.join(','));
      } else {
        url.searchParams.set('testId', 'all');
      }
      if (pointsReportVersionIds.length > 0) {
        url.searchParams.set('versionIds', pointsReportVersionIds.join(','));
      }
      url.searchParams.set('startDate', pointsReportStartDate);
      url.searchParams.set('endDate', pointsReportEndDate);

      const res = await fetch(url.toString(), { headers: authHeaders });
      const data = await res.json();
      if (!res.ok) {
        setPointsReportError(data.error || 'Failed to load points report');
      } else {
        setPointsReportData(data);
      }
    } catch (err) {
      console.error('Points report fetch failed:', err);
      setPointsReportError('Network error');
    } finally {
      setPointsReportLoading(false);
    }
  };

  // Fetch per-user test progress for drill-down in Points Report
  const fetchUserProgress = async (userId: number) => {
    if (userProgressCache[userId]) {
      // Already cached — just toggle expand
      setExpandedPointsUser(prev => prev === userId ? null : userId);
      return;
    }
    setUserProgressLoading(userId);
    try {
      const url = new URL(`${API_BASE}/api/reports/user-progress/${userId}`, window.location.origin);
      url.searchParams.set('startDate', pointsReportStartDate);
      url.searchParams.set('endDate', pointsReportEndDate);
      if (pointsReportVersionIds.length > 0) url.searchParams.set('versionIds', pointsReportVersionIds.join(','));
      const res = await fetch(url.toString(), { headers: authHeaders });
      if (res.ok) {
        const data = await res.json();
        setUserProgressCache(prev => ({ ...prev, [userId]: data }));
        setExpandedPointsUser(userId);
      }
    } catch (err) {
      console.error('User progress fetch failed:', err);
    } finally {
      setUserProgressLoading(null);
    }
  };

  const togglePointsUserExpand = (userId: number) => {
    if (expandedPointsUser === userId) {
      setExpandedPointsUser(null);
    } else {
      fetchUserProgress(userId);
    }
  };

  return (
    <div className="admin-section">
      <div className="report-sub-tabs" style={{ display: 'flex', gap: '0.75rem', marginBottom: '1.5rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.5rem' }}>
        <button
          type="button"
          className={`tab-btn ${reportsSubTab === 'user' ? 'active' : ''}`}
          onClick={() => setReportsSubTab('user')}
          style={{ fontSize: '0.9rem', padding: '0.4rem 1rem' }}
        >
          User Reports
        </button>
        <button
          type="button"
          className={`tab-btn ${reportsSubTab === 'test' ? 'active' : ''}`}
          onClick={() => setReportsSubTab('test')}
          style={{ fontSize: '0.9rem', padding: '0.4rem 1rem' }}
        >
          Test Reports
        </button>
        <button
          type="button"
          className={`tab-btn ${reportsSubTab === 'passed' ? 'active' : ''}`}
          onClick={() => setReportsSubTab('passed')}
          style={{ fontSize: '0.9rem', padding: '0.4rem 1rem' }}
        >
          Passed Steps
        </button>
        <button
          type="button"
          className={`tab-btn ${reportsSubTab === 'points' ? 'active' : ''}`}
          onClick={() => setReportsSubTab('points')}
          style={{ fontSize: '0.9rem', padding: '0.4rem 1rem' }}
        >
          Points
        </button>
      </div>

      {/* ========================================================================= */}
      {/* 1. USER REPORTS SUB-TAB */}
      {/* ========================================================================= */}
      {reportsSubTab === 'user' && (
        <>
          <h3>User Report</h3>
          <p className="admin-hint">
            {isFullAccess
              ? 'Select users and a date range to view points earned, steps attempted, per-test breakdown, and fully passed tests.'
              : 'Select a date range to view your points earned, steps attempted, and per-test breakdown.'}
          </p>

          <div className="report-controls">
            <div className="report-selectors">
              {isFullAccess && (
                <div className="searchable-select">
                  <label>Users</label>
                  <input
                    type="text"
                    className="user-input"
                    placeholder="Search users..."
                    value={showUserDropdown ? reportUserSearch : (reportUserIds.length > 0 ? (reportUserIds.length === users.length ? 'All Users' : reportUserIds.map(id => users.find(x => x.id === id)?.username).filter(Boolean).join(', ')) : reportUserSearch)}
                    onChange={e => setReportUserSearch(e.target.value)}
                    onFocus={() => { setShowUserDropdown(true); setReportUserSearch(''); }}
                    onBlur={() => setTimeout(() => setShowUserDropdown(false), 150)}
                  />
                  {showUserDropdown && (
                    <div className="searchable-dropdown">
                      <label className="searchable-option" onMouseDown={e => e.preventDefault()}>
                        <input
                          type="checkbox"
                          checked={reportUserIds.length === users.length && users.length > 0}
                          onChange={() => {
                            if (reportUserIds.length === users.length) setReportUserIds([]);
                            else setReportUserIds(users.map(u => u.id));
                            setReportData(null);
                          }}
                        />
                        <strong>Select All Users</strong>
                      </label>
                      {users
                        .filter(u => u.username.toLowerCase().includes(reportUserSearch.toLowerCase()))
                        .map(u => (
                          <label
                            key={u.id}
                            className={`searchable-option ${reportUserIds.includes(u.id) ? 'selected' : ''}`}
                            onMouseDown={e => e.preventDefault()}
                          >
                            <input
                              type="checkbox"
                              checked={reportUserIds.includes(u.id)}
                              onChange={() => {
                                setReportUserIds(prev => prev.includes(u.id) ? prev.filter(id => id !== u.id) : [...prev, u.id]);
                                setReportData(null);
                              }}
                            />
                            {u.username}
                          </label>
                        ))}
                    </div>
                  )}
                </div>
              )}

              <div className="searchable-select">
                <label>Versions</label>
                <input
                  type="text"
                  className="user-input"
                  placeholder={reportVersionIds.length === 0 ? 'All Versions' : 'Search versions...'}
                  value={showVersionDropdown ? reportVersionSearch : (reportVersionIds.length > 0 ? reportVersionIds.map(id => versions.find(v => v.id === id)?.name).filter(Boolean).join(', ') : 'All Versions')}
                  onChange={e => setReportVersionSearch(e.target.value)}
                  onFocus={() => setShowVersionDropdown(true)}
                  onBlur={() => setTimeout(() => setShowVersionDropdown(false), 150)}
                />
                {showVersionDropdown && (
                  <div className="searchable-dropdown">
                    <label className="searchable-option" onMouseDown={e => e.preventDefault()}>
                      <input
                        type="checkbox"
                        checked={reportVersionIds.length === versions.length && versions.length > 0}
                        onChange={() => {
                          if (reportVersionIds.length === versions.length) setReportVersionIds([]);
                          else setReportVersionIds(versions.map(v => v.id));
                          setReportData(null);
                        }}
                      />
                      <strong>Select All</strong>
                    </label>
                    {versions
                      .filter(v => v.name.toLowerCase().includes(reportVersionSearch.toLowerCase()))
                      .map(v => (
                        <label
                          key={v.id}
                          className={`searchable-option ${reportVersionIds.includes(v.id) ? 'selected' : ''}`}
                          onMouseDown={e => e.preventDefault()}
                        >
                          <input
                            type="checkbox"
                            checked={reportVersionIds.includes(v.id)}
                            onChange={() => {
                              setReportVersionIds(prev => prev.includes(v.id) ? prev.filter(id => id !== v.id) : [...prev, v.id]);
                              setReportData(null);
                            }}
                          />
                          {v.name} {v.is_current ? '(current)' : ''}
                        </label>
                      ))}
                  </div>
                )}
              </div>
            </div>

            <div className="report-presets">
              {(['current_month', 'last_month', 'current_year', 'last_year', 'custom'] as const).map(p => (
                <button
                  key={p}
                  className={`btn-secondary report-preset-btn ${reportPreset === p ? 'active' : ''}`}
                  onClick={() => handleUserPresetChange(p)}
                >
                  {p.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase())}
                </button>
              ))}
            </div>

            <div className="report-dates">
              <input
                type="date"
                className="user-input"
                value={reportStartDate}
                onChange={e => { setReportStartDate(e.target.value); setReportPreset('custom'); setReportData(null); }}
              />
              <span className="report-date-sep">to</span>
              <input
                type="date"
                className="user-input"
                value={reportEndDate}
                onChange={e => { setReportEndDate(e.target.value); setReportPreset('custom'); setReportData(null); }}
              />
            </div>

            <button
              className="btn"
              onClick={fetchUserReport}
              disabled={reportLoading || (isFullAccess && reportUserIds.length === 0) || reportVersionIds.length === 0 || !reportStartDate || !reportEndDate}
            >
              {reportLoading ? 'Generating...' : 'Generate Report'}
            </button>
          </div>

          {reportError && <p className="error-msg">{reportError}</p>}

          {reportData && (
            <div className="report-results">
              <h4>
                Report for {reportData.users && reportData.users.length > 0
                  ? reportData.users.map((u: any) => u.userName).join(', ')
                  : (user?.username || 'user')}
                {' '}({reportData.startDate} — {reportData.endDate})
              </h4>

              <div className="report-summary">
                <div className="report-summary-card">
                  <span className="report-summary-value">{reportData.totalPointsEarned}</span>
                  <span className="report-summary-label">Points Earned</span>
                </div>
                <div className="report-summary-card">
                  <span className="report-summary-value">{reportData.totalSteps}</span>
                  <span className="report-summary-label">Steps Submitted</span>
                </div>
              </div>

              {reportData.tests.length === 0 ? (
                <p className="admin-hint">No test activity in this period.</p>
              ) : (
                <div className="report-tests-list">
                  {(reportData.tests || []).map((test: any) => {
                    const isOpen = expandedTests.has(test.testId);
                    const failedSteps = (test.steps || []).filter((s: any) => s.fails > 0);
                    return (
                      <div key={test.testId} className="report-test-row">
                        <div className="report-test-header" onClick={() => toggleTestExpand(test.testId)}>
                          <span className="report-test-name">{test.testName}</span>
                          <span className="report-test-stats">
                            <span className="report-stat">{test.rounds} rounds</span>
                            <span className="report-stat report-stat-pass">{test.passes} passed</span>
                            <span className="report-stat report-stat-fail">{test.fails} failed</span>
                          </span>
                          {test.fullyPassed && <span className="status-badge status-pass">FULLY PASSED</span>}
                          <span className="expand-icon">{isOpen ? '▲' : '▼'}</span>
                        </div>
                        {isOpen && (
                          <div className="report-test-body">
                            {failedSteps.length === 0 ? (
                              <p className="admin-hint" style={{ padding: '0.5rem 1rem' }}>No failed steps in this period.</p>
                            ) : (
                              <table className="report-steps-table">
                                <thead>
                                  <tr>
                                    <th>Step</th>
                                    <th>Description</th>
                                    <th>Fails</th>
                                    <th>Rounds</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {failedSteps.map((step: any) => {
                                    const stepKey = `${test.testId}-${step.stepId}`;
                                    const isStepOpen = expandedReportSteps.has(stepKey);
                                    return (
                                      <React.Fragment key={step.stepId}>
                                        <tr className="report-step-row-failed" style={{ cursor: 'pointer' }} onClick={() => toggleReportStepExpand(test.testId, step.stepId)}>
                                          <td className="step-num-cell">{step.stepNumber}</td>
                                          <td>{step.description}</td>
                                          <td><span className="status-badge status-fail">{step.fails}</span></td>
                                          <td>{step.rounds && step.rounds.length > 0 ? step.rounds.map((r: any) => `R${r}`).join(', ') : '—'}</td>
                                        </tr>
                                        {isStepOpen && step.submissions && step.submissions.length > 0 && (
                                          <tr key={`${step.stepId}-details`}>
                                            <td colSpan={4} style={{ padding: '0', background: 'transparent' }}>
                                              <div style={{ padding: '0.5rem 1rem' }}>
                                                <table className="report-steps-table" style={{ width: '100%' }}>
                                                  <thead>
                                                    <tr>
                                                      <th>Round</th>
                                                      <th>Comment</th>
                                                      <th>Config File</th>
                                                      <th>Time</th>
                                                    </tr>
                                                  </thead>
                                                  <tbody>
                                                    {step.submissions.map((sub: any, idx: number) => (
                                                      <tr key={idx} className="report-step-row-failed">
                                                        <td>{sub.roundId != null ? `R${sub.roundId}` : '—'}</td>
                                                        <td className="report-step-comment">{sub.comment || '—'}</td>
                                                        <td>
                                                          {sub.configFilePath ? (
                                                            <a
                                                              className="report-file-link"
                                                              href={`${API_BASE}${sub.configFilePath}`}
                                                              target="_blank"
                                                              rel="noopener noreferrer"
                                                              download
                                                            >
                                                              Download
                                                            </a>
                                                          ) : '—'}
                                                        </td>
                                                        <td>{sub.executed_at ? new Date(sub.executed_at).toLocaleString() : '—'}</td>
                                                      </tr>
                                                    ))}
                                                  </tbody>
                                                </table>
                                              </div>
                                            </td>
                                          </tr>
                                        )}
                                      </React.Fragment>
                                    );
                                  })}
                                </tbody>
                              </table>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* ========================================================================= */}
      {/* 2. TEST REPORTS SUB-TAB */}
      {/* ========================================================================= */}
      {reportsSubTab === 'test' && (
        <>
          <h3>Test Report</h3>
          <p className="admin-hint">
            Select tests, steps, versions, and a date range to view test execution breakdown and failed steps.
          </p>

          <div className="report-controls">
            <div className="report-selectors">
              <div className="searchable-select">
                <label>Tests</label>
                <input
                  type="text"
                  className="user-input"
                  placeholder={testReportTestIds.length === 0 ? 'All Tests' : 'Search tests...'}
                  value={showTestDropdown ? testReportTestSearch : (testReportTestIds.length > 0 ? (testReportTestIds.length === tests.length ? 'All Tests' : testReportTestIds.map(id => tests.find(t => t.id === id)?.name).filter(Boolean).join(', ')) : 'All Tests')}
                  onChange={e => setTestReportTestSearch(e.target.value)}
                  onFocus={() => { setShowTestDropdown(true); setTestReportTestSearch(''); }}
                  onBlur={() => setTimeout(() => setShowTestDropdown(false), 150)}
                />
                {showTestDropdown && (
                  <div className="searchable-dropdown">
                    <label className="searchable-option" onMouseDown={e => e.preventDefault()}>
                      <input
                        type="checkbox"
                        checked={testReportTestIds.length === 0 || testReportTestIds.length === tests.length}
                        onChange={() => {
                          setTestReportTestIds([]);
                          setTestReportData(null);
                        }}
                      />
                      <strong>All Tests</strong>
                    </label>
                    {tests
                      .filter(t => t.name.toLowerCase().includes(testReportTestSearch.toLowerCase()))
                      .map(t => (
                        <label
                          key={t.id}
                          className={`searchable-option ${testReportTestIds.includes(t.id) ? 'selected' : ''}`}
                          onMouseDown={e => e.preventDefault()}
                        >
                          <input
                            type="checkbox"
                            checked={testReportTestIds.includes(t.id)}
                            onChange={() => {
                              setTestReportTestIds(prev => prev.includes(t.id) ? prev.filter(id => id !== t.id) : [...prev, t.id]);
                              setTestReportData(null);
                            }}
                          />
                          {t.name}
                        </label>
                      ))}
                  </div>
                )}
              </div>

              <div className="searchable-select">
                <label>Steps</label>
                <input
                  type="text"
                  className="user-input"
                  placeholder={testReportSelectedStepId ? 'Search steps...' : 'All Steps'}
                  value={showStepDropdown ? testReportStepSearch : (testReportSelectedStepId ? (() => {
                    for (const test of testReportSteps) {
                      const step = test.steps.find((s: any) => s.id === testReportSelectedStepId);
                      if (step) return `${test.testName} - Step ${step.step_number}`;
                    }
                    return '';
                  })() : 'All Steps')}
                  onChange={e => setTestReportStepSearch(e.target.value)}
                  onFocus={() => { setShowStepDropdown(true); setTestReportStepSearch(''); fetchTestReportSteps(); }}
                  onBlur={() => setTimeout(() => setShowStepDropdown(false), 150)}
                />
                {showStepDropdown && (
                  <div className="searchable-dropdown">
                    <div
                      className={`searchable-option ${testReportSelectedStepId === null ? 'selected' : ''}`}
                      onMouseDown={e => e.preventDefault()}
                      onClick={() => setTestReportSelectedStepId(null)}
                    >
                      All Steps
                    </div>
                    {testReportSteps.map(test => (
                      test.steps.map((step: any) => (
                        <div
                          key={`${test.testId}-${step.id}`}
                          className={`searchable-option ${testReportSelectedStepId === step.id ? 'selected' : ''}`}
                          onMouseDown={e => e.preventDefault()}
                          onClick={() => setTestReportSelectedStepId(step.id)}
                        >
                          {test.testName} — Step {step.step_number}: {step.description}
                        </div>
                      ))
                    ))}
                  </div>
                )}
              </div>

              <div className="searchable-select">
                <label>Versions</label>
                <input
                  type="text"
                  className="user-input"
                  placeholder={testReportVersionIds.length === 0 ? 'All Versions' : 'Search versions...'}
                  value={showTestVersionDropdown ? testReportVersionSearch : (testReportVersionIds.length > 0 ? testReportVersionIds.map(id => versions.find(v => v.id === id)?.name).filter(Boolean).join(', ') : 'All Versions')}
                  onChange={e => setTestReportVersionSearch(e.target.value)}
                  onFocus={() => setShowTestVersionDropdown(true)}
                  onBlur={() => setTimeout(() => setShowTestVersionDropdown(false), 150)}
                />
                {showTestVersionDropdown && (
                  <div className="searchable-dropdown">
                    <label className="searchable-option" onMouseDown={e => e.preventDefault()}>
                      <input
                        type="checkbox"
                        checked={testReportVersionIds.length === versions.length && versions.length > 0}
                        onChange={() => {
                          if (testReportVersionIds.length === versions.length) setTestReportVersionIds([]);
                          else setTestReportVersionIds(versions.map(v => v.id));
                          setTestReportData(null);
                        }}
                      />
                      <strong>Select All</strong>
                    </label>
                    {versions
                      .filter(v => v.name.toLowerCase().includes(testReportVersionSearch.toLowerCase()))
                      .map(v => (
                        <label
                          key={v.id}
                          className={`searchable-option ${testReportVersionIds.includes(v.id) ? 'selected' : ''}`}
                          onMouseDown={e => e.preventDefault()}
                        >
                          <input
                            type="checkbox"
                            checked={testReportVersionIds.includes(v.id)}
                            onChange={() => {
                              setTestReportVersionIds(prev => prev.includes(v.id) ? prev.filter(id => id !== v.id) : [...prev, v.id]);
                              setTestReportData(null);
                            }}
                          />
                          {v.name} {v.is_current ? '(current)' : ''}
                        </label>
                      ))}
                  </div>
                )}
              </div>
            </div>

            <div className="report-presets">
              {(['current_month', 'last_month', 'current_year', 'last_year', 'custom'] as const).map(p => (
                <button
                  key={p}
                  className={`btn-secondary report-preset-btn ${testReportPreset === p ? 'active' : ''}`}
                  onClick={() => handleTestPresetChange(p)}
                >
                  {p.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase())}
                </button>
              ))}
            </div>

            <div className="report-dates">
              <input
                type="date"
                className="user-input"
                value={testReportStartDate}
                onChange={e => { setTestReportStartDate(e.target.value); setTestReportPreset('custom'); setTestReportData(null); }}
              />
              <span className="report-date-sep">to</span>
              <input
                type="date"
                className="user-input"
                value={testReportEndDate}
                onChange={e => { setTestReportEndDate(e.target.value); setTestReportPreset('custom'); setTestReportData(null); }}
              />
            </div>

            <button
              className="btn"
              onClick={fetchTestReport}
              disabled={testReportLoading || testReportVersionIds.length === 0 || !testReportStartDate || !testReportEndDate}
            >
              {testReportLoading ? 'Generating...' : 'Generate Report'}
            </button>
          </div>

          {testReportError && <p className="error-msg">{testReportError}</p>}

          {testReportData && (
            <div className="report-results">
              <h4>
                Test Report ({testReportData.startDate} — {testReportData.endDate})
              </h4>

              {testReportData.tests.length === 0 ? (
                <p className="admin-hint">No test results found for the selected filter.</p>
              ) : (
                <div className="report-tests-list">
                  {testReportData.tests.map((test: any) => (
                    <div key={test.testId} className="report-test-row">
                      <div className="report-test-header">
                        <span className="report-test-name">{test.testName}</span>
                        <span className="report-test-stats">
                          <span className="report-stat">{test.rounds} rounds</span>
                          <span className="report-stat report-stat-pass">{test.passes} passed</span>
                          <span className="report-stat report-stat-fail">{test.fails} failed</span>
                        </span>
                      </div>
                      {test.failedUsers && test.failedUsers.length > 0 && (
                        <div className="report-test-body">
                          <h4>Failed Step Submissions</h4>
                          {test.failedUsers.map((fu: any) => (
                            <div key={fu.userId} style={{ marginBottom: '1rem' }}>
                              {isFullAccess && <h5>{fu.userName}</h5>}
                              <table className="report-steps-table">
                                <thead>
                                  <tr>
                                    <th>Step</th>
                                    <th>Description</th>
                                    <th>Round</th>
                                    <th>Comment</th>
                                    <th>Config File</th>
                                    <th>Executed At</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {fu.submissions.map((sub: any, idx: number) => (
                                    <tr key={idx} className="report-step-row-failed">
                                      <td className="step-num-cell">{sub.stepNumber}</td>
                                      <td>{sub.description}</td>
                                      <td>{sub.roundId != null ? `R${sub.roundId}` : '—'}</td>
                                      <td className="report-step-comment">{sub.comment || '—'}</td>
                                      <td>
                                        {sub.configFilePath ? (
                                          <a
                                            className="report-file-link"
                                            href={`${API_BASE}${sub.configFilePath}`}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            download
                                          >
                                            Download
                                          </a>
                                        ) : '—'}
                                      </td>
                                      <td>{sub.executed_at ? new Date(sub.executed_at).toLocaleString() : '—'}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* ========================================================================= */}
      {/* 3. PASSED STEPS REPORT SUB-TAB */}
      {/* ========================================================================= */}
      {reportsSubTab === 'passed' && (
        <>
          <h3>Passed Steps Report</h3>
          <p className="admin-hint">
            View all passed steps with comments or compliance files, filtered by users, tests, versions, and date range.
          </p>

          <div className="report-controls">
            <div className="report-selectors">
              {isFullAccess && (
                <div className="searchable-select">
                  <label>Users</label>
                  <input
                    type="text"
                    className="user-input"
                    placeholder="Search users..."
                    value={showPassedUserDropdown ? passedReportUserSearch : (passedReportUserIds.length > 0 ? (passedReportUserIds.length === users.length ? 'All Users' : passedReportUserIds.map(id => users.find(x => x.id === id)?.username).filter(Boolean).join(', ')) : 'All Users')}
                    onChange={e => setPassedReportUserSearch(e.target.value)}
                    onFocus={() => { setShowPassedUserDropdown(true); setPassedReportUserSearch(''); }}
                    onBlur={() => setTimeout(() => setShowPassedUserDropdown(false), 150)}
                  />
                  {showPassedUserDropdown && (
                    <div className="searchable-dropdown">
                      <label className="searchable-option" onMouseDown={e => e.preventDefault()}>
                        <input
                          type="checkbox"
                          checked={passedReportUserIds.length === users.length && users.length > 0}
                          onChange={() => {
                            if (passedReportUserIds.length === users.length) setPassedReportUserIds([]);
                            else setPassedReportUserIds(users.map(u => u.id));
                            setPassedReportData(null);
                          }}
                        />
                        <strong>Select All Users</strong>
                      </label>
                      {users
                        .filter(u => u.username.toLowerCase().includes(passedReportUserSearch.toLowerCase()))
                        .map(u => (
                          <label
                            key={u.id}
                            className={`searchable-option ${passedReportUserIds.includes(u.id) ? 'selected' : ''}`}
                            onMouseDown={e => e.preventDefault()}
                          >
                            <input
                              type="checkbox"
                              checked={passedReportUserIds.includes(u.id)}
                              onChange={() => {
                                setPassedReportUserIds(prev => prev.includes(u.id) ? prev.filter(id => id !== u.id) : [...prev, u.id]);
                                setPassedReportData(null);
                              }}
                            />
                            {u.username}
                          </label>
                        ))}
                    </div>
                  )}
                </div>
              )}

              <div className="searchable-select">
                <label>Tests</label>
                <input
                  type="text"
                  className="user-input"
                  placeholder={passedReportTestIds.length === 0 ? 'All Tests' : 'Search tests...'}
                  value={showPassedTestDropdown ? passedReportTestSearch : (passedReportTestIds.length > 0 ? (passedReportTestIds.length === tests.length ? 'All Tests' : passedReportTestIds.map(id => tests.find(t => t.id === id)?.name).filter(Boolean).join(', ')) : 'All Tests')}
                  onChange={e => setPassedReportTestSearch(e.target.value)}
                  onFocus={() => { setShowPassedTestDropdown(true); setPassedReportTestSearch(''); }}
                  onBlur={() => setTimeout(() => setShowPassedTestDropdown(false), 150)}
                />
                {showPassedTestDropdown && (
                  <div className="searchable-dropdown">
                    <label className="searchable-option" onMouseDown={e => e.preventDefault()}>
                      <input
                        type="checkbox"
                        checked={passedReportTestIds.length === 0 || passedReportTestIds.length === tests.length}
                        onChange={() => {
                          setPassedReportTestIds([]);
                          setPassedReportData(null);
                        }}
                      />
                      <strong>All Tests</strong>
                    </label>
                    {tests
                      .filter(t => t.name.toLowerCase().includes(passedReportTestSearch.toLowerCase()))
                      .map(t => (
                        <label
                          key={t.id}
                          className={`searchable-option ${passedReportTestIds.includes(t.id) ? 'selected' : ''}`}
                          onMouseDown={e => e.preventDefault()}
                        >
                          <input
                            type="checkbox"
                            checked={passedReportTestIds.includes(t.id)}
                            onChange={() => {
                              setPassedReportTestIds(prev => prev.includes(t.id) ? prev.filter(id => id !== t.id) : [...prev, t.id]);
                              setPassedReportData(null);
                            }}
                          />
                          {t.name}
                        </label>
                      ))}
                  </div>
                )}
              </div>

              <div className="searchable-select">
                <label>Versions</label>
                <input
                  type="text"
                  className="user-input"
                  placeholder={passedReportVersionIds.length === 0 ? 'All Versions' : 'Search versions...'}
                  value={showPassedVersionDropdown ? passedReportVersionSearch : (passedReportVersionIds.length > 0 ? passedReportVersionIds.map(id => versions.find(v => v.id === id)?.name).filter(Boolean).join(', ') : 'All Versions')}
                  onChange={e => setPassedReportVersionSearch(e.target.value)}
                  onFocus={() => setShowPassedVersionDropdown(true)}
                  onBlur={() => setTimeout(() => setShowPassedVersionDropdown(false), 150)}
                />
                {showPassedVersionDropdown && (
                  <div className="searchable-dropdown">
                    <label className="searchable-option" onMouseDown={e => e.preventDefault()}>
                      <input
                        type="checkbox"
                        checked={passedReportVersionIds.length === versions.length && versions.length > 0}
                        onChange={() => {
                          if (passedReportVersionIds.length === versions.length) setPassedReportVersionIds([]);
                          else setPassedReportVersionIds(versions.map(v => v.id));
                          setPassedReportData(null);
                        }}
                      />
                      <strong>Select All</strong>
                    </label>
                    {versions
                      .filter(v => v.name.toLowerCase().includes(passedReportVersionSearch.toLowerCase()))
                      .map(v => (
                        <label
                          key={v.id}
                          className={`searchable-option ${passedReportVersionIds.includes(v.id) ? 'selected' : ''}`}
                          onMouseDown={e => e.preventDefault()}
                        >
                          <input
                            type="checkbox"
                            checked={passedReportVersionIds.includes(v.id)}
                            onChange={() => {
                              setPassedReportVersionIds(prev => prev.includes(v.id) ? prev.filter(id => id !== v.id) : [...prev, v.id]);
                              setPassedReportData(null);
                            }}
                          />
                          {v.name} {v.is_current ? '(current)' : ''}
                        </label>
                      ))}
                  </div>
                )}
              </div>
            </div>

            <div className="report-presets">
              {(['current_month', 'last_month', 'current_year', 'last_year', 'custom'] as const).map(p => (
                <button
                  key={p}
                  className={`btn-secondary report-preset-btn ${passedReportPreset === p ? 'active' : ''}`}
                  onClick={() => handlePassedPresetChange(p)}
                >
                  {p.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase())}
                </button>
              ))}
            </div>

            <div className="report-dates">
              <input
                type="date"
                className="user-input"
                value={passedReportStartDate}
                onChange={e => { setPassedReportStartDate(e.target.value); setPassedReportPreset('custom'); setPassedReportData(null); }}
              />
              <span className="report-date-sep">to</span>
              <input
                type="date"
                className="user-input"
                value={passedReportEndDate}
                onChange={e => { setPassedReportEndDate(e.target.value); setPassedReportPreset('custom'); setPassedReportData(null); }}
              />
            </div>

            <button className="btn" onClick={fetchPassedReport} disabled={passedReportLoading || (isFullAccess && passedReportUserIds.length === 0) || passedReportVersionIds.length === 0 || !passedReportStartDate || !passedReportEndDate}>
              {passedReportLoading ? 'Generating...' : 'Generate Report'}
            </button>
          </div>

          {passedReportError && <p className="error-msg">{passedReportError}</p>}

          {passedReportData && (
            <div className="report-results">
              <h4>Passed Steps ({passedReportData.startDate} — {passedReportData.endDate})</h4>
              {passedReportData.tests.length === 0 ? (
                <p className="admin-hint">No passed step submissions with comments or files found.</p>
              ) : (
                <div className="report-tests-list">
                  {passedReportData.tests.map((test: any) => (
                    <div key={test.testId} className="report-test-row">
                      <div className="report-test-header">
                        <span className="report-test-name">{test.testName}</span>
                      </div>
                      {test.passedUsers && test.passedUsers.length > 0 && (
                        <div className="report-test-body">
                          {test.passedUsers.map((pu: any) => (
                            <div key={pu.userId} style={{ marginBottom: '1rem' }}>
                              {isFullAccess && <h5>{pu.userName}</h5>}
                              <table className="report-steps-table">
                                <thead>
                                  <tr>
                                    <th>Step</th>
                                    <th>Description</th>
                                    <th>Round</th>
                                    <th>Comment</th>
                                    <th>Config File</th>
                                    <th>Executed At</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {pu.submissions.map((sub: any, idx: number) => (
                                    <tr key={idx}>
                                      <td className="step-num-cell">{sub.stepNumber}</td>
                                      <td>{sub.description}</td>
                                      <td>{sub.roundId != null ? `R${sub.roundId}` : '—'}</td>
                                      <td className="report-step-comment">{sub.comment || '—'}</td>
                                      <td>
                                        {sub.configFilePath ? (
                                          <a
                                            className="report-file-link"
                                            href={`${API_BASE}${sub.configFilePath}`}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            download
                                          >
                                            Download
                                          </a>
                                        ) : '—'}
                                      </td>
                                      <td>{sub.executed_at ? new Date(sub.executed_at).toLocaleString() : '—'}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* ========================================================================= */}
      {/* 4. POINTS REPORT SUB-TAB */}
      {/* ========================================================================= */}
      {reportsSubTab === 'points' && (
        <>
          <h3>Points Report</h3>
          <p className="admin-hint">
            {isFullAccess
              ? 'View total points earned by users, filtered by users, tests, versions, and date range.'
              : 'View your total points earned across the selected date range.'}
          </p>

          <div className="report-controls">
            <div className="report-selectors">
              {isFullAccess && (
                <div className="searchable-select">
                  <label>Users</label>
                  <input
                    type="text"
                    className="user-input"
                    placeholder="Search users..."
                    value={showPointsUserDropdown ? pointsReportUserSearch : (pointsReportUserIds.length > 0 ? (pointsReportUserIds.length === users.length ? 'All Users' : pointsReportUserIds.map(id => users.find(x => x.id === id)?.username).filter(Boolean).join(', ')) : 'All Users')}
                    onChange={e => setPointsReportUserSearch(e.target.value)}
                    onFocus={() => { setShowPointsUserDropdown(true); setPointsReportUserSearch(''); }}
                    onBlur={() => setTimeout(() => setShowPointsUserDropdown(false), 150)}
                  />
                  {showPointsUserDropdown && (
                    <div className="searchable-dropdown">
                      <label className="searchable-option" onMouseDown={e => e.preventDefault()}>
                        <input
                          type="checkbox"
                          checked={pointsReportUserIds.length === users.length && users.length > 0}
                          onChange={() => {
                            if (pointsReportUserIds.length === users.length) setPointsReportUserIds([]);
                            else setPointsReportUserIds(users.map(u => u.id));
                            setPointsReportData(null);
                          }}
                        />
                        <strong>Select All Users</strong>
                      </label>
                      {users
                        .filter(u => u.username.toLowerCase().includes(pointsReportUserSearch.toLowerCase()))
                        .map(u => (
                          <label
                            key={u.id}
                            className={`searchable-option ${pointsReportUserIds.includes(u.id) ? 'selected' : ''}`}
                            onMouseDown={e => e.preventDefault()}
                          >
                            <input
                              type="checkbox"
                              checked={pointsReportUserIds.includes(u.id)}
                              onChange={() => {
                                setPointsReportUserIds(prev => prev.includes(u.id) ? prev.filter(id => id !== u.id) : [...prev, u.id]);
                                setPointsReportData(null);
                              }}
                            />
                            {u.username}
                          </label>
                        ))}
                    </div>
                  )}
                </div>
              )}

              <div className="searchable-select">
                <label>Tests</label>
                <input
                  type="text"
                  className="user-input"
                  placeholder={pointsReportTestIds.length === 0 ? 'All Tests' : 'Search tests...'}
                  value={showPointsTestDropdown ? pointsReportTestSearch : (pointsReportTestIds.length > 0 ? (pointsReportTestIds.length === tests.length ? 'All Tests' : pointsReportTestIds.map(id => tests.find(t => t.id === id)?.name).filter(Boolean).join(', ')) : 'All Tests')}
                  onChange={e => setPointsReportTestSearch(e.target.value)}
                  onFocus={() => { setShowPointsTestDropdown(true); setPointsReportTestSearch(''); }}
                  onBlur={() => setTimeout(() => setShowPointsTestDropdown(false), 150)}
                />
                {showPointsTestDropdown && (
                  <div className="searchable-dropdown">
                    <label className="searchable-option" onMouseDown={e => e.preventDefault()}>
                      <input
                        type="checkbox"
                        checked={pointsReportTestIds.length === 0 || pointsReportTestIds.length === tests.length}
                        onChange={() => {
                          setPointsReportTestIds([]);
                          setPointsReportData(null);
                        }}
                      />
                      <strong>All Tests</strong>
                    </label>
                    {tests
                      .filter(t => t.name.toLowerCase().includes(pointsReportTestSearch.toLowerCase()))
                      .map(t => (
                        <label
                          key={t.id}
                          className={`searchable-option ${pointsReportTestIds.includes(t.id) ? 'selected' : ''}`}
                          onMouseDown={e => e.preventDefault()}
                        >
                          <input
                            type="checkbox"
                            checked={pointsReportTestIds.includes(t.id)}
                            onChange={() => {
                              setPointsReportTestIds(prev => prev.includes(t.id) ? prev.filter(id => id !== t.id) : [...prev, t.id]);
                              setPointsReportData(null);
                            }}
                          />
                          {t.name}
                        </label>
                      ))}
                  </div>
                )}
              </div>

              <div className="searchable-select">
                <label>Versions</label>
                <input
                  type="text"
                  className="user-input"
                  placeholder={pointsReportVersionIds.length === 0 ? 'All Versions' : 'Search versions...'}
                  value={showPointsVersionDropdown ? pointsReportVersionSearch : (pointsReportVersionIds.length > 0 ? pointsReportVersionIds.map(id => versions.find(v => v.id === id)?.name).filter(Boolean).join(', ') : 'All Versions')}
                  onChange={e => setPointsReportVersionSearch(e.target.value)}
                  onFocus={() => setShowPointsVersionDropdown(true)}
                  onBlur={() => setTimeout(() => setShowPointsVersionDropdown(false), 150)}
                />
                {showPointsVersionDropdown && (
                  <div className="searchable-dropdown">
                    <label className="searchable-option" onMouseDown={e => e.preventDefault()}>
                      <input
                        type="checkbox"
                        checked={pointsReportVersionIds.length === versions.length && versions.length > 0}
                        onChange={() => {
                          if (pointsReportVersionIds.length === versions.length) setPointsReportVersionIds([]);
                          else setPointsReportVersionIds(versions.map(v => v.id));
                          setPointsReportData(null);
                        }}
                      />
                      <strong>Select All</strong>
                    </label>
                    {versions
                      .filter(v => v.name.toLowerCase().includes(pointsReportVersionSearch.toLowerCase()))
                      .map(v => (
                        <label
                          key={v.id}
                          className={`searchable-option ${pointsReportVersionIds.includes(v.id) ? 'selected' : ''}`}
                          onMouseDown={e => e.preventDefault()}
                        >
                          <input
                            type="checkbox"
                            checked={pointsReportVersionIds.includes(v.id)}
                            onChange={() => {
                              setPointsReportVersionIds(prev => prev.includes(v.id) ? prev.filter(id => id !== v.id) : [...prev, v.id]);
                              setPointsReportData(null);
                            }}
                          />
                          {v.name} {v.is_current ? '(current)' : ''}
                        </label>
                      ))}
                  </div>
                )}
              </div>
            </div>

            <div className="report-presets">
              {(['current_month', 'last_month', 'current_year', 'last_year', 'custom'] as const).map(p => (
                <button
                  key={p}
                  className={`btn-secondary report-preset-btn ${pointsReportPreset === p ? 'active' : ''}`}
                  onClick={() => handlePointsPresetChange(p)}
                >
                  {p.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase())}
                </button>
              ))}
            </div>

            <div className="report-dates">
              <input
                type="date"
                className="user-input"
                value={pointsReportStartDate}
                onChange={e => { setPointsReportStartDate(e.target.value); setPointsReportPreset('custom'); setPointsReportData(null); setPointsReportError(''); }}
              />
              <span className="report-date-sep">to</span>
              <input
                type="date"
                className="user-input"
                value={pointsReportEndDate}
                onChange={e => { setPointsReportEndDate(e.target.value); setPointsReportPreset('custom'); setPointsReportData(null); setPointsReportError(''); }}
              />
            </div>

            <button className="btn" onClick={fetchPointsReport} disabled={pointsReportLoading || (isFullAccess && pointsReportUserIds.length === 0) || pointsReportVersionIds.length === 0 || !pointsReportStartDate || !pointsReportEndDate}>
              {pointsReportLoading ? 'Generating...' : 'Generate Points Report'}
            </button>
          </div>

          {pointsReportError && <p className="error-msg">{pointsReportError}</p>}

          {pointsReportData && (
            <div className="report-results">
              <h4>Points Summary ({pointsReportData.startDate} — {pointsReportData.endDate})</h4>
              <div className="report-summary">
                <div className="report-summary-card">
                  <span className="report-summary-value">{pointsReportData.totalPointsEarned}</span>
                  <span className="report-summary-label">Total Points</span>
                </div>
                <div className="report-summary-card">
                  <span className="report-summary-value">{pointsReportData.totalSteps}</span>
                  <span className="report-summary-label">Total Steps Executed</span>
                </div>
              </div>

              {pointsReportData.users && pointsReportData.users.length > 0 && (
                <table className="versions-table" style={{ marginTop: '1.5rem' }}>
                  <thead>
                    <tr>
                      {isFullAccess && <th>User</th>}
                      <th>Points Earned</th>
                      <th>Steps Executed</th>
                      {isFullAccess && <th></th>}
                    </tr>
                  </thead>
                  <tbody>
                    {pointsReportData.users.map((u: any) => {
                      const isExpanded = expandedPointsUser === u.userId;
                      const isLoadingThis = userProgressLoading === u.userId;
                      const progress = userProgressCache[u.userId];
                      return (
                        <React.Fragment key={u.userId}>
                          <tr
                            style={isFullAccess ? { cursor: 'pointer', transition: 'background 0.15s' } : {}}
                            className={isExpanded ? 'report-step-row-selected' : ''}
                            onClick={isFullAccess ? () => togglePointsUserExpand(u.userId) : undefined}
                          >
                            {isFullAccess && (
                              <td style={{ fontWeight: 600 }}>
                                {isLoadingThis ? '⏳ ' : (isExpanded ? '▲ ' : '▼ ')}{u.userName}
                              </td>
                            )}
                            <td><strong>{u.pointsEarned}</strong> pts</td>
                            <td>{u.steps} steps</td>
                            {isFullAccess && (
                              <td style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                                {isExpanded ? 'Collapse' : 'Details'}
                              </td>
                            )}
                          </tr>
                          {isFullAccess && isExpanded && progress && (
                            <tr>
                              <td colSpan={4} style={{ padding: 0, background: 'transparent' }}>
                                <div style={{
                                  background: 'var(--card-bg, #1e2433)',
                                  border: '1px solid var(--border-color)',
                                  borderRadius: '8px',
                                  margin: '0.25rem 0.5rem 0.75rem',
                                  padding: '1rem 1.25rem'
                                }}>
                                  {/* Active Test Banner */}
                                  {progress.activeTestId && (
                                    <div style={{
                                      display: 'flex',
                                      alignItems: 'center',
                                      gap: '0.6rem',
                                      background: 'rgba(99,179,237,0.12)',
                                      border: '1px solid rgba(99,179,237,0.35)',
                                      borderRadius: '6px',
                                      padding: '0.6rem 1rem',
                                      marginBottom: '1rem',
                                      fontSize: '0.92rem'
                                    }}>
                                      <span style={{ fontSize: '1.1rem' }}>🔄</span>
                                      <span>
                                        <strong>Currently working on:</strong>{' '}
                                        <span style={{ color: 'var(--accent, #63b3ed)' }}>{progress.activeTestName}</span>
                                        {progress.currentStepNumber != null && (
                                          <span style={{ color: 'var(--text-muted)' }}>
                                            {' '}— Step {progress.currentStepNumber}: {progress.currentStepDescription}
                                          </span>
                                        )}
                                      </span>
                                    </div>
                                  )}

                                  {/* Test Breakdown Table */}
                                  <table className="report-steps-table" style={{ width: '100%' }}>
                                    <thead>
                                      <tr>
                                        <th>Test</th>
                                        <th>Status</th>
                                        <th>Rounds</th>
                                        <th>Points</th>
                                        <th>Failed Steps</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {(progress.tests || []).map((t: any) => {
                                        const statusBadge = (() => {
                                          switch (t.status) {
                                            case 'fully_passed':
                                              return <span className="status-badge status-pass">✅ Fully Passed</span>;
                                            case 'failed':
                                              return <span className="status-badge status-fail">⚠️ Has Failures</span>;
                                            case 'in_progress':
                                              return <span className="status-badge" style={{ background: 'rgba(99,179,237,0.2)', color: '#63b3ed', borderColor: '#63b3ed' }}>🔄 In Progress</span>;
                                            default:
                                              return <span style={{ color: 'var(--text-muted)' }}>— Not Started</span>;
                                          }
                                        })();

                                        const failedStepsSummary = t.failedSteps && t.failedSteps.length > 0
                                          ? t.failedSteps.map((fs: any) =>
                                              `Step ${fs.stepNumber}${fs.roundId != null ? ` (R${fs.roundId})` : ''}`
                                            ).join(', ')
                                          : '—';

                                        return (
                                          <tr
                                            key={t.testId}
                                            className={t.status === 'failed' ? 'report-step-row-failed' : ''}
                                          >
                                            <td style={{ fontWeight: 500 }}>{t.testName}</td>
                                            <td>{statusBadge}</td>
                                            <td>{t.rounds > 0 ? t.rounds : '—'}</td>
                                            <td><strong>{t.pointsEarned}</strong> pts</td>
                                            <td style={{ fontSize: '0.85rem', color: t.failedSteps && t.failedSteps.length > 0 ? 'var(--danger, #fc8181)' : 'inherit' }}>
                                              {failedStepsSummary}
                                            </td>
                                          </tr>
                                        );
                                      })}
                                    </tbody>
                                  </table>
                                </div>
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default ReportsView;
