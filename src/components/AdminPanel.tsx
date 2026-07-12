import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../context/AuthContext';

interface Test {
  id: number;
  name: string;
  description: string;
}

interface User {
  id: number;
  username: string;
  is_admin: boolean;
}

interface ImportedTest {
  id: number;
  name: string;
  stepsCount: number;
}

interface TestResult {
  id: number;
  test_name: string;
  step_number: number;
  step_description: string;
  result: 'pass' | 'fail';
  comment: string | null;
  executed_at: string;
}

interface TestStepAdmin {
  id: number;
  step_number: number;
  description: string;
  success_symptom: string;
  value: number;
  points: number;
  on_failure: string;
}

interface Version {
  id: number;
  name: string;
  note: string | null;
  is_current: number;
  created_at: string;
}

const API_BASE = '';

const AdminPanel: React.FC = () => {
  const { token } = useAuth();
  const [tests, setTests] = useState<Test[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [assignments, setAssignments] = useState<Record<number, number[]>>({});
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportedTest[] | null>(null);
  const [importError, setImportError] = useState('');
  const [activeTab, setActiveTab] = useState<'upload' | 'assign' | 'users' | 'manage' | 'versions' | 'reports' | 'test-reports' | 'backup'>('upload');
  const [historyUser, setHistoryUser] = useState<User | null>(null);
  const [historyResults, setHistoryResults] = useState<TestResult[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [managedSteps, setManagedSteps] = useState<Record<number, TestStepAdmin[]>>({});
  const [loadingSteps, setLoadingSteps] = useState<Set<number>>(new Set());
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [userError, setUserError] = useState('');
  const [userSuccess, setUserSuccess] = useState('');
  const [creatingUser, setCreatingUser] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const backupFileRef = useRef<HTMLInputElement>(null);
  const [backupLoading, setBackupLoading] = useState(false);
  const [backupMessage, setBackupMessage] = useState('');
  const [backupError, setBackupError] = useState('');
  const [versions, setVersions] = useState<Version[]>([]);
  const [currentVersion, setCurrentVersion] = useState<Version | null>(null);
  const [newVersionName, setNewVersionName] = useState('');
  const [newVersionNote, setNewVersionNote] = useState('');
  const [versionBusy, setVersionBusy] = useState(false);
  const [versionMessage, setVersionMessage] = useState('');
  const [versionError, setVersionError] = useState('');
  const [reportUserIds, setReportUserIds] = useState<number[]>([]);
  const [reportPreset, setReportPreset] = useState<'current_month' | 'last_month' | 'current_year' | 'last_year' | 'custom'>('last_month');
  const [reportStartDate, setReportStartDate] = useState('');
  const [reportEndDate, setReportEndDate] = useState('');
  const [reportVersionId, setReportVersionId] = useState<number | null>(null);
  const [reportUserSearch, setReportUserSearch] = useState('');
  const [reportVersionSearch, setReportVersionSearch] = useState('');
  const [showUserDropdown, setShowUserDropdown] = useState(false);
  const [showVersionDropdown, setShowVersionDropdown] = useState(false);
  const [reportData, setReportData] = useState<any | null>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportError, setReportError] = useState('');
  const [expandedTests, setExpandedTests] = useState<Set<number>>(new Set());
  const [testReportTestIds, setTestReportTestIds] = useState<number[]>([]);
  const [testReportPreset, setTestReportPreset] = useState<'current_month' | 'last_month' | 'current_year' | 'last_year' | 'custom'>('last_month');
  const [testReportStartDate, setTestReportStartDate] = useState('');
  const [testReportEndDate, setTestReportEndDate] = useState('');
  const [testReportVersionId, setTestReportVersionId] = useState<number | null>(null);
  const [testReportTestSearch, setTestReportTestSearch] = useState('');
  const [testReportVersionSearch, setTestReportVersionSearch] = useState('');
  const [showTestDropdown, setShowTestDropdown] = useState(false);
  const [showTestVersionDropdown, setShowTestVersionDropdown] = useState(false);
  const [testReportData, setTestReportData] = useState<any | null>(null);
  const [testReportLoading, setTestReportLoading] = useState(false);
  const [testReportError, setTestReportError] = useState('');
  const [expandedTestReportTests, setExpandedTestReportTests] = useState<Set<number>>(new Set());
  const [deleteTarget, setDeleteTarget] = useState<User | null>(null);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [deletingUser, setDeletingUser] = useState(false);

  const authHeaders = { Authorization: `Bearer ${token}` };

  useEffect(() => {
    fetchTests();
    fetchUsers();
    fetchVersions();
    const dates = getDefaultReportDates('last_month');
    setReportStartDate(dates.start);
    setReportEndDate(dates.end);
    setTestReportStartDate(dates.start);
    setTestReportEndDate(dates.end);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const fetchVersions = async () => {
    try {
      const [allRes, curRes] = await Promise.all([
        fetch(`${API_BASE}/api/versions`, { headers: authHeaders }),
        fetch(`${API_BASE}/api/versions/current`, { headers: authHeaders })
      ]);
      if (allRes.ok) setVersions(await allRes.json());
      if (curRes.ok) {
        const data = await curRes.json();
        const cv = data.version || null;
        setCurrentVersion(cv);
        if (cv && reportVersionId === null) {
          setReportVersionId(cv.id);
        }
      }
    } catch {
      // ignore
    }
  };

  const handleCreateVersion = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newVersionName.trim()) return;
    setVersionBusy(true);
    setVersionError('');
    setVersionMessage('');
    try {
      const res = await fetch(`${API_BASE}/api/versions`, {
        method: 'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newVersionName.trim(), note: newVersionNote.trim() })
      });
      const data = await res.json();
      if (!res.ok) {
        setVersionError(data.error || 'Failed to create version');
      } else {
        setVersionMessage(`Version "${data.version.name}" created${data.version.is_current ? ' and set as current' : ''}.`);
        setNewVersionName('');
        setNewVersionNote('');
        fetchVersions();
      }
    } catch {
      setVersionError('Network error');
    } finally {
      setVersionBusy(false);
    }
  };

  const handleSetCurrent = async (versionId: number) => {
    setVersionBusy(true);
    setVersionError('');
    setVersionMessage('');
    try {
      const res = await fetch(`${API_BASE}/api/versions/${versionId}/set-current`, {
        method: 'POST',
        headers: authHeaders
      });
      const data = await res.json();
      if (!res.ok) {
        setVersionError(data.error || 'Failed to set current version');
      } else {
        setVersionMessage(`Current version is now "${data.version.name}".`);
        fetchVersions();
      }
    } catch {
      setVersionError('Network error');
    } finally {
      setVersionBusy(false);
    }
  };

  const handleDeleteVersion = async (version: Version) => {
    if (!window.confirm(`Delete version "${version.name}"? Only versions with no recorded results can be deleted.`)) return;
    setVersionBusy(true);
    setVersionError('');
    setVersionMessage('');
    try {
      const res = await fetch(`${API_BASE}/api/versions/${version.id}`, {
        method: 'DELETE',
        headers: authHeaders
      });
      const data = await res.json();
      if (!res.ok) {
        setVersionError(data.error || 'Failed to delete version');
      } else {
        setVersionMessage('Version deleted.');
        fetchVersions();
      }
    } catch {
      setVersionError('Network error');
    } finally {
      setVersionBusy(false);
    }
  };

  const fetchTests = async () => {
    const res = await fetch(`${API_BASE}/api/tests`, { headers: authHeaders });
    if (res.ok) setTests(await res.json());
  };

  const fetchUsers = async () => {
    const res = await fetch(`${API_BASE}/api/users`, { headers: authHeaders });
    if (res.ok) setUsers(await res.json());
  };

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

  const handlePresetChange = (preset: 'current_month' | 'last_month' | 'current_year' | 'last_year' | 'custom') => {
    setReportPreset(preset);
    if (preset !== 'custom') {
      const dates = getDefaultReportDates(preset);
      setReportStartDate(dates.start);
      setReportEndDate(dates.end);
    }
    setReportData(null);
    setReportError('');
  };

  const fetchUserReport = async () => {
    if (reportUserIds.length === 0 || !reportStartDate || !reportEndDate) return;
    setReportLoading(true);
    setReportError('');
    setReportData(null);
    try {
      const url = new URL(`${API_BASE}/api/reports/user-report`);
      url.searchParams.set('userId', reportUserIds.join(','));
      url.searchParams.set('startDate', reportStartDate);
      url.searchParams.set('endDate', reportEndDate);
      if (reportVersionId) url.searchParams.set('versionId', String(reportVersionId));

      const res = await fetch(url.toString(), {
        headers: authHeaders
      });
      const data = await res.json();
      if (!res.ok) {
        setReportError(data.error || 'Failed to load report');
      } else {
        setReportData(data);
      }
    } catch {
      setReportError('Network error');
    } finally {
      setReportLoading(false);
    }
  };

  const toggleUserSelect = (userId: number) => {
    setReportUserIds(prev => {
      if (prev.includes(userId)) return prev.filter(id => id !== userId);
      return [...prev, userId];
    });
    setReportData(null);
    setReportError('');
  };

  const toggleTestExpand = (testId: number) => {
    setExpandedTests(prev => {
      const next = new Set(prev);
      if (next.has(testId)) next.delete(testId);
      else next.add(testId);
      return next;
    });
  };

  const fetchTestReport = async () => {
    if ((testReportTestIds.length === 0 && testReportTestIds.length !== 0) || !testReportStartDate || !testReportEndDate) return;
    setTestReportLoading(true);
    setTestReportError('');
    setTestReportData(null);
    try {
      const url = new URL(`${API_BASE}/api/reports/test-report`);
      if (testReportTestIds.length > 0) {
        url.searchParams.set('testId', testReportTestIds.join(','));
      } else {
        url.searchParams.set('testId', 'all');
      }
      url.searchParams.set('startDate', testReportStartDate);
      url.searchParams.set('endDate', testReportEndDate);
      if (testReportVersionId) url.searchParams.set('versionId', String(testReportVersionId));

      const res = await fetch(url.toString(), {
        headers: authHeaders
      });
      const data = await res.json();
      if (!res.ok) {
        setTestReportError(data.error || 'Failed to load report');
      } else {
        setTestReportData(data);
      }
    } catch {
      setTestReportError('Network error');
    } finally {
      setTestReportLoading(false);
    }
  };

  const toggleTestSelect = (testId: number) => {
    setTestReportTestIds(prev => {
      if (prev.includes(testId)) return prev.filter(id => id !== testId);
      return [...prev, testId];
    });
    setTestReportData(null);
    setTestReportError('');
  };

  const toggleAllTests = () => {
    if (testReportTestIds.length === tests.length) {
      setTestReportTestIds([]);
    } else {
      setTestReportTestIds(tests.map(t => t.id));
    }
    setTestReportData(null);
    setTestReportError('');
  };

  const toggleTestReportExpand = (testId: number) => {
    setExpandedTestReportTests(prev => {
      const next = new Set(prev);
      if (next.has(testId)) next.delete(testId);
      else next.add(testId);
      return next;
    });
  };

  const fetchAssignmentsForTest = async (testId: number) => {
    const res = await fetch(`${API_BASE}/api/tests/${testId}/assignments`, { headers: authHeaders });
    if (res.ok) {
      const userIds: number[] = await res.json();
      setAssignments(prev => ({ ...prev, [testId]: userIds }));
    }
  };

  const handleImport = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const file = fileInputRef.current?.files?.[0];
    if (!file) return;

    setImporting(true);
    setImportError('');
    setImportResult(null);

    const formData = new FormData();
    formData.append('file', file);

    try {
      const res = await fetch(`${API_BASE}/api/tests/import`, {
        method: 'POST',
        headers: authHeaders,
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) {
        setImportError(data.error || 'Import failed');
      } else {
        setImportResult(data.imported);
        fetchTests();
        if (fileInputRef.current) fileInputRef.current.value = '';
      }
    } catch {
      setImportError('Network error during import');
    } finally {
      setImporting(false);
    }
  };

  const toggleAssignment = async (testId: number, userId: number, isAssigned: boolean) => {
    if (isAssigned) {
      await fetch(`${API_BASE}/api/tests/${testId}/assignments/${userId}`, {
        method: 'DELETE',
        headers: authHeaders,
      });
    } else {
      await fetch(`${API_BASE}/api/tests/${testId}/assignments`, {
        method: 'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId }),
      });
    }
    fetchAssignmentsForTest(testId);
  };

  const handleExpandTest = (testId: number) => {
    if (assignments[testId] === undefined) {
      fetchAssignmentsForTest(testId);
    }
  };

  const nonAdminUsers = users.filter(u => !u.is_admin);

  const handleCreateUser = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!newUsername.trim() || !newPassword.trim()) return;
    setCreatingUser(true);
    setUserError('');
    setUserSuccess('');
    try {
      const res = await fetch(`${API_BASE}/api/users`, {
        method: 'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: newUsername.trim(), password: newPassword, isAdmin: false }),
      });
      const data = await res.json();
      if (!res.ok) {
        setUserError(data.error || 'Failed to create user');
      } else {
        setUserSuccess(`User "${newUsername.trim()}" created successfully.`);
        setNewUsername('');
        setNewPassword('');
        fetchUsers();
      }
    } catch {
      setUserError('Network error');
    } finally {
      setCreatingUser(false);
    }
  };

  const fetchTestSteps = async (testId: number) => {
    if (managedSteps[testId] !== undefined) return;
    setLoadingSteps(prev => new Set(prev).add(testId));
    try {
      const res = await fetch(`${API_BASE}/api/tests/${testId}`, { headers: authHeaders });
      if (res.ok) {
        const data = await res.json();
        setManagedSteps(prev => ({ ...prev, [testId]: data.steps || [] }));
      }
    } finally {
      setLoadingSteps(prev => { const s = new Set(prev); s.delete(testId); return s; });
    }
  };

  // Renumber a test's steps sequentially (1..n) after an insert/delete.
  const normalizeSteps = async (testId: number) => {
    try {
      const res = await fetch(`${API_BASE}/api/tests/${testId}`, { headers: authHeaders });
      if (!res.ok) { setManagedSteps(prev => ({ ...prev, [testId]: [] })); return; }
      const data = await res.json();
      const ordered = (data.steps || []).slice().sort((a: TestStepAdmin, b: TestStepAdmin) => a.step_number - b.step_number);
      const stepOrder = ordered.map((s: TestStepAdmin, i: number) => ({ id: s.id, step_number: i + 1 }));
      await fetch(`${API_BASE}/api/tests/${testId}/steps/reorder`, {
        method: 'PUT',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ stepOrder })
      });
      setManagedSteps(prev => ({ ...prev, [testId]: ordered.map((s: TestStepAdmin, i: number) => ({ ...s, step_number: i + 1 })) }));
    } catch {
      fetchTestSteps(testId);
    }
  };

  const saveStep = async (testId: number, step: TestStepAdmin) => {
    const pointsVal = Number(step.value) || 0;
    await fetch(`${API_BASE}/api/tests/${testId}/steps/${step.id}`, {
      method: 'PUT',
      headers: { ...authHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        step_number: step.step_number,
        description: step.description,
        success_symptom: step.success_symptom || '',
        value: pointsVal,
        on_failure: step.on_failure
      })
    });
    setManagedSteps(prev => ({
      ...prev,
      [testId]: (prev[testId] || []).map(s => s.id === step.id ? {
        ...s,
        description: step.description,
        value: pointsVal,
        points: pointsVal,
        on_failure: step.on_failure
      } : s)
    }));
  };

  const deleteStep = async (testId: number, stepId: number) => {
    if (!window.confirm('Delete this step? This cannot be undone.')) return;
    await fetch(`${API_BASE}/api/tests/${testId}/steps/${stepId}`, { method: 'DELETE', headers: authHeaders });
    await normalizeSteps(testId);
  };

  const addStep = async (
    testId: number,
    payload: { afterStepNumber: number | null; description: string; points: number; on_failure: string }
  ) => {
    const steps = managedSteps[testId] || [];
    const maxStep = steps.length ? Math.max(...steps.map(s => s.step_number)) : 0;
    const stepNumber = payload.afterStepNumber === null ? maxStep + 1 : payload.afterStepNumber + 0.5;
    await fetch(`${API_BASE}/api/tests/${testId}/steps`, {
      method: 'POST',
      headers: { ...authHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        step_number: stepNumber,
        description: payload.description.trim(),
        success_symptom: '',
        value: payload.points,
        on_failure: payload.on_failure
      })
    });
    await normalizeSteps(testId);
  };

  const handleDeleteTest = async (testId: number, testName: string) => {
    if (!window.confirm(`Delete test "${testName}" and all its steps? This cannot be undone.`)) return;
    await fetch(`${API_BASE}/api/tests/${testId}`, { method: 'DELETE', headers: authHeaders });
    setTests(prev => prev.filter(t => t.id !== testId));
    setManagedSteps(prev => { const n = { ...prev }; delete n[testId]; return n; });
  };

  const openHistory = async (user: User) => {
    setHistoryUser(user);
    setHistoryResults([]);
    setHistoryLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/test-results/user/${user.id}`, { headers: authHeaders });
      if (res.ok) setHistoryResults(await res.json());
    } finally {
      setHistoryLoading(false);
    }
  };

  // Opening the delete flow requires a deliberate double confirmation: the admin must
  // first acknowledge, then type the exact username to confirm. This wipes the user
  // AND all of their data (results, points, assignments, loop state, uploads).
  const openDeleteUser = (user: User) => {
    setDeleteConfirmText('');
    setDeleteTarget(user);
  };

  const closeDeleteUser = () => {
    setDeleteTarget(null);
    setDeleteConfirmText('');
    setDeletingUser(false);
  };

  const confirmDeleteUser = async () => {
    if (!deleteTarget) return;
    if (deleteConfirmText.trim() !== deleteTarget.username) return;
    setDeletingUser(true);
    try {
      const res = await fetch(`${API_BASE}/api/users/${deleteTarget.id}`, { method: 'DELETE', headers: authHeaders });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setUserError(data.error || 'Failed to delete user');
      } else {
        closeDeleteUser();
        fetchUsers();
      }
    } catch {
      setUserError('Network error');
    } finally {
      setDeletingUser(false);
    }
  };

  const handleBackupExport = async () => {
    setBackupLoading(true);
    setBackupError('');
    setBackupMessage('');
    try {
      const res = await fetch(`${API_BASE}/api/backup/export`, {
        headers: authHeaders,
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Export failed');
      }
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const disposition = res.headers.get('Content-Disposition');
      let filename = 'qualitycheck-backup.json';
      if (disposition && disposition.includes('filename=')) {
        filename = disposition.split('filename=')[1].replace(/"/g, '').trim();
      }
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
      setBackupMessage('Backup downloaded successfully.');
    } catch (err: any) {
      setBackupError(err.message || 'Network error during export');
    } finally {
      setBackupLoading(false);
    }
  };

  const handleBackupImport = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const file = backupFileRef.current?.files?.[0];
    if (!file) return;

    if (!window.confirm('This will replace all current data with the backup. This cannot be undone. Continue?')) return;

    setBackupLoading(true);
    setBackupError('');
    setBackupMessage('');

    const formData = new FormData();
    formData.append('file', file);

    try {
      const res = await fetch(`${API_BASE}/api/backup/import`, {
        method: 'POST',
        headers: authHeaders,
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) {
        setBackupError(data.error || 'Restore failed');
      } else {
        setBackupMessage('Backup restored successfully.');
        if (backupFileRef.current) backupFileRef.current.value = '';
        fetchTests();
        fetchUsers();
      }
    } catch {
      setBackupError('Network error during restore');
    } finally {
      setBackupLoading(false);
    }
  };

  return (
    <div className="admin-panel">
      <h2>Admin Panel</h2>

      <div className="admin-tabs">
        <button
          className={`tab-btn ${activeTab === 'upload' ? 'active' : ''}`}
          onClick={() => setActiveTab('upload')}
        >
          Upload Tests
        </button>
        <button
          className={`tab-btn ${activeTab === 'assign' ? 'active' : ''}`}
          onClick={() => setActiveTab('assign')}
        >
          Assign Tests
        </button>
        <button
          className={`tab-btn ${activeTab === 'users' ? 'active' : ''}`}
          onClick={() => setActiveTab('users')}
        >
          Users
        </button>
        <button
          className={`tab-btn ${activeTab === 'manage' ? 'active' : ''}`}
          onClick={() => setActiveTab('manage')}
        >
          Manage Tests
        </button>
        <button
          className={`tab-btn ${activeTab === 'versions' ? 'active' : ''}`}
          onClick={() => setActiveTab('versions')}
        >
          Versions
        </button>
        <button
          className={`tab-btn ${activeTab === 'reports' ? 'active' : ''}`}
          onClick={() => setActiveTab('reports')}
        >
          Reports
        </button>
        <button
          className={`tab-btn ${activeTab === 'test-reports' ? 'active' : ''}`}
          onClick={() => setActiveTab('test-reports')}
        >
          Test Reports
        </button>
        <button
          className={`tab-btn ${activeTab === 'backup' ? 'active' : ''}`}
          onClick={() => setActiveTab('backup')}
        >
          Backup / Restore
        </button>
      </div>

      {activeTab === 'upload' && (
        <div className="admin-section">
          <h3>Import Tests from Excel</h3>
          <p className="admin-hint">
          Each sheet tab becomes a test. Columns used: <strong>Test case</strong> (step description), <strong>Expected Success</strong> (success symptom), and <strong>Points</strong> (defaults to 10 if missing).
          </p>
          <form onSubmit={handleImport} className="upload-form">
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls"
              className="file-input"
            />
            <button type="submit" className="btn" disabled={importing}>
              {importing ? 'Importing...' : 'Import'}
            </button>
          </form>

          {importError && <p className="error-msg">{importError}</p>}

          {importResult && (
            <div className="import-result">
              <h4>Import successful — {importResult.length} test(s) added:</h4>
              <ul>
                {importResult.map(t => (
                  <li key={t.id}>
                    <strong>{t.name}</strong> — {t.stepsCount} step(s)
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {activeTab === 'users' && (
        <div className="admin-section">
          <h3>Create New User</h3>
          <form onSubmit={handleCreateUser} className="create-user-form">
            <input
              type="text"
              placeholder="Username"
              value={newUsername}
              onChange={e => { setNewUsername(e.target.value); setUserError(''); setUserSuccess(''); }}
              className="user-input"
              autoComplete="off"
            />
            <input
              type="password"
              placeholder="Password"
              value={newPassword}
              onChange={e => { setNewPassword(e.target.value); setUserError(''); setUserSuccess(''); }}
              className="user-input"
              autoComplete="new-password"
            />
            <button type="submit" className="btn" disabled={creatingUser || !newUsername.trim() || !newPassword.trim()}>
              {creatingUser ? 'Creating...' : 'Create User'}
            </button>
          </form>
          {userError && <p className="error-msg">{userError}</p>}
          {userSuccess && <p className="success-msg">{userSuccess}</p>}

          <h3 style={{ marginTop: '2rem' }}>Existing Users</h3>
          {nonAdminUsers.length === 0 ? (
            <p className="admin-hint">No non-admin users yet.</p>
          ) : (
            <div className="users-list">
              {nonAdminUsers.map(u => (
                <div key={u.id} className="user-row">
                  <span className="user-row-name">{u.username}</span>
                  <div className="user-row-actions">
                    <button
                      className="btn-icon"
                      title="View test history"
                      onClick={() => openHistory(u)}
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                    </button>
                      <button
                        className="btn-danger"
                        onClick={() => openDeleteUser(u)}
                      >
                        Delete
                      </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === 'manage' && (
        <div className="admin-section">
          <h3>Manage Test Steps</h3>
          <p className="admin-hint">
            Expand a test to edit its steps. Change the description and the points awarded per step,
            and choose what happens when a step fails: <strong>continue</strong> to the next step or
            <strong> hard-stop</strong> the whole test. Insert a new step between existing ones, or delete a step.
            Step numbers are kept sequential automatically.
          </p>
          {tests.length === 0 ? (
            <p>No tests available. Upload an Excel file first.</p>
          ) : (
            <div className="assignment-list">
              {tests.map(test => (
                <ManageTestRow
                  key={test.id}
                  test={test}
                  steps={managedSteps[test.id]}
                  loading={loadingSteps.has(test.id)}
                  onExpand={() => fetchTestSteps(test.id)}
                  onSaveStep={(step) => saveStep(test.id, step)}
                  onDeleteStep={(stepId) => deleteStep(test.id, stepId)}
                  onAddStep={(payload) => addStep(test.id, payload)}
                  onDelete={() => handleDeleteTest(test.id, test.name)}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === 'assign' && (
        <div className="admin-section">
          <h3>Assign Tests to Users</h3>
          {tests.length === 0 ? (
            <p>No tests available. Upload an Excel file first.</p>
          ) : (
            <div className="assignment-list">
              {tests.map(test => (
                <AssignmentRow
                  key={test.id}
                  test={test}
                  users={nonAdminUsers}
                  assignedUserIds={assignments[test.id]}
                  onExpand={() => handleExpandTest(test.id)}
                  onToggle={(userId, isAssigned) => toggleAssignment(test.id, userId, isAssigned)}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === 'versions' && (
        <div className="admin-section">
          <h3>Testing Versions</h3>
          <p className="admin-hint">
            Create the version users should run tests for, then mark it <strong>current</strong>.
            Every submitted result and earned point is tagged with the current version so you can
            report pass/fail, tests done, and points per version later. Only one version is current at a time.
          </p>

          {versionMessage && <p className="success-msg">{versionMessage}</p>}
          {versionError && <p className="error-msg">{versionError}</p>}

          <form onSubmit={handleCreateVersion} className="create-version-form">
            <input
              type="text"
              placeholder="Version name (e.g. v2.3.1)"
              value={newVersionName}
              onChange={e => { setNewVersionName(e.target.value); setVersionError(''); setVersionMessage(''); }}
              className="user-input"
              autoComplete="off"
            />
            <input
              type="text"
              placeholder="Note (optional)"
              value={newVersionNote}
              onChange={e => setNewVersionNote(e.target.value)}
              className="user-input"
              autoComplete="off"
            />
            <button type="submit" className="btn" disabled={versionBusy || !newVersionName.trim()}>
              {versionBusy ? 'Saving...' : 'Create Version'}
            </button>
          </form>

          <h3 style={{ marginTop: '2rem' }}>
            Versions
            {currentVersion && (
              <span className="current-version-pill"> Current: {currentVersion.name}</span>
            )}
          </h3>
          {versions.length === 0 ? (
            <p className="admin-hint">No versions created yet.</p>
          ) : (
            <table className="versions-table">
              <thead>
                <tr>
                  <th>Version</th>
                  <th>Note</th>
                  <th>Created</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {versions.map(v => (
                  <tr key={v.id} className={v.is_current ? 'version-current-row' : ''}>
                    <td>
                      {v.name}
                      {v.is_current ? <span className="status-badge status-pass"> CURRENT</span> : null}
                    </td>
                    <td>{v.note || '—'}</td>
                    <td>{new Date(v.created_at).toLocaleString()}</td>
                    <td className="version-actions-cell">
                      {!v.is_current && (
                        <button className="btn-secondary" onClick={() => handleSetCurrent(v.id)} disabled={versionBusy}>
                          Set Current
                        </button>
                      )}
                      <button className="btn-danger" onClick={() => handleDeleteVersion(v)} disabled={versionBusy}>
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {activeTab === 'reports' && (
        <div className="admin-section">
          <h3>User Report</h3>
          <p className="admin-hint">
            Select a user and a date range to view their points earned, steps attempted, per-test breakdown, and fully passed tests.
          </p>

          <div className="report-controls">
            <div className="report-selectors">
              <div className="searchable-select">
                <label>Users</label>
                <input
                  type="text"
                  className="user-input"
                  placeholder="Search users..."
                  value={showUserDropdown ? reportUserSearch : (reportUserIds.length > 0 ? reportUserIds.map(id => nonAdminUsers.find(x => x.id === id)?.username).filter(Boolean).join(', ') : reportUserSearch)}
                  onChange={e => setReportUserSearch(e.target.value)}
                  onFocus={() => { setShowUserDropdown(true); setReportUserSearch(''); }}
                  onBlur={() => setTimeout(() => setShowUserDropdown(false), 150)}
                />
                {showUserDropdown && (
                  <div className="searchable-dropdown">
                    {nonAdminUsers
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
                              toggleUserSelect(u.id);
                              setReportUserSearch('');
                            }}
                          />
                          {u.username}
                        </label>
                      ))}
                    {nonAdminUsers.filter(u => u.username.toLowerCase().includes(reportUserSearch.toLowerCase())).length === 0 && (
                      <div className="searchable-no-results">No users found</div>
                    )}
                  </div>
                )}
                {reportUserIds.length > 0 && (
                  <div className="selected-tags">
                    {reportUserIds.map(id => {
                      const u = nonAdminUsers.find(x => x.id === id);
                      return u ? (
                        <span key={id} className="selected-tag">
                          {u.username}
                          <button type="button" onClick={() => toggleUserSelect(id)}>×</button>
                        </span>
                      ) : null;
                    })}
                  </div>
                )}
              </div>

              <div className="searchable-select">
                <label>Version</label>
                <input
                  type="text"
                  className="user-input"
                  placeholder="Search versions..."
                  value={showVersionDropdown ? reportVersionSearch : (reportVersionId ? (versions.find(v => v.id === reportVersionId)?.name || '') : reportVersionSearch)}
                  onChange={e => setReportVersionSearch(e.target.value)}
                  onFocus={() => setShowVersionDropdown(true)}
                  onBlur={() => setTimeout(() => setShowVersionDropdown(false), 150)}
                />
                {showVersionDropdown && (
                  <div className="searchable-dropdown">
                    {versions
                      .filter(v => v.name.toLowerCase().includes(reportVersionSearch.toLowerCase()))
                      .map(v => (
                        <div
                          key={v.id}
                          className={`searchable-option ${reportVersionId === v.id ? 'selected' : ''}`}
                          onMouseDown={() => {
                            setReportVersionId(v.id);
                            setShowVersionDropdown(false);
                            setReportVersionSearch('');
                          }}
                        >
                          {v.name} {v.is_current ? '(current)' : ''}
                        </div>
                      ))}
                    {versions.filter(v => v.name.toLowerCase().includes(reportVersionSearch.toLowerCase())).length === 0 && (
                      <div className="searchable-no-results">No versions found</div>
                    )}
                  </div>
                )}
              </div>
            </div>

            <div className="report-presets">
              <button
                className={`btn-secondary report-preset-btn ${reportPreset === 'current_month' ? 'active' : ''}`}
                onClick={() => handlePresetChange('current_month')}
              >
                Current Month
              </button>
              <button
                className={`btn-secondary report-preset-btn ${reportPreset === 'last_month' ? 'active' : ''}`}
                onClick={() => handlePresetChange('last_month')}
              >
                Last Month
              </button>
              <button
                className={`btn-secondary report-preset-btn ${reportPreset === 'current_year' ? 'active' : ''}`}
                onClick={() => handlePresetChange('current_year')}
              >
                Current Year
              </button>
              <button
                className={`btn-secondary report-preset-btn ${reportPreset === 'last_year' ? 'active' : ''}`}
                onClick={() => handlePresetChange('last_year')}
              >
                Last Year
              </button>
              <button
                className={`btn-secondary report-preset-btn ${reportPreset === 'custom' ? 'active' : ''}`}
                onClick={() => handlePresetChange('custom')}
              >
                Custom
              </button>
            </div>

            <div className="report-dates">
              <input
                type="date"
                className="user-input"
                value={reportStartDate}
                onChange={e => { setReportStartDate(e.target.value); setReportPreset('custom'); setReportData(null); setReportError(''); }}
              />
              <span className="report-date-sep">to</span>
              <input
                type="date"
                className="user-input"
                value={reportEndDate}
                onChange={e => { setReportEndDate(e.target.value); setReportPreset('custom'); setReportData(null); setReportError(''); }}
              />
            </div>

            <button
              className="btn"
              onClick={fetchUserReport}
              disabled={reportLoading || reportUserIds.length === 0 || !reportVersionId || !reportStartDate || !reportEndDate}
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
                  : 'selected users'}
                {' '}({reportData.startDate} — {reportData.endDate})
                {reportData.versionId && (
                  <span className="report-version-tag">
                    Version {versions.find(v => v.id === reportData.versionId)?.name || reportData.versionId}
                  </span>
                )}
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
                     const failedSubmissions = test.failedSubmissions || [];
                     return (
                       <div key={test.testId} className="report-test-row">
                         <div className="report-test-header" onClick={() => toggleTestExpand(test.testId)}>
                           <span className="report-test-name">{test.testName}</span>
                           <span className="report-test-stats">
                             <span className="report-stat">{test.rounds} rounds</span>
                             <span className="report-stat report-stat-pass">{test.passes} passed</span>
                             <span className="report-stat report-stat-fail">{test.fails} failed</span>
                           </span>
                           {test.fullyPassed && (
                             <span className="status-badge status-pass">FULLY PASSED</span>
                           )}
                           <span className="expand-icon">{isOpen ? '▲' : '▼'}</span>
                         </div>
                         {isOpen && (
                           <div className="report-test-body">
                             {failedSubmissions.length === 0 ? (
                               <p className="admin-hint" style={{ padding: '0.5rem 1rem' }}>No failed steps in this period.</p>
                             ) : (
                               <table className="report-steps-table">
                                 <thead>
                                   <tr>
                                     <th>Step</th>
                                     <th>Round</th>
                                     <th>Description</th>
                                     <th>Comment</th>
                                     <th>File</th>
                                     <th>Time</th>
                                   </tr>
                                 </thead>
                                 <tbody>
                                   {failedSubmissions.map((sub: any) => (
                                     <tr key={`${sub.stepId}-${sub.roundId}-${sub.executed_at}`} className="report-step-row-failed">
                                       <td className="step-num-cell">{sub.stepNumber}</td>
                                       <td>{sub.roundId != null ? `R${sub.roundId}` : '—'}</td>
                                       <td>{sub.description}</td>
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
                                         ) : (
                                           '—'
                                         )}
                                       </td>
                                       <td>{sub.executed_at ? new Date(sub.executed_at).toLocaleString() : '—'}</td>
                                     </tr>
                                   ))}
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
        </div>
      )}

      {activeTab === 'test-reports' && (
        <div className="admin-section">
          <h3>Test Report</h3>
          <p className="admin-hint">
            Select tests and a date range to view how many times each test was run, how many passed/failed, and which users failed at which steps.
          </p>

          <div className="report-controls">
            <div className="report-selectors">
              <div className="searchable-select">
                <label>Tests</label>
                <div className="test-select-header">
                  <button type="button" className="btn-secondary" onClick={toggleAllTests}>
                    {testReportTestIds.length === tests.length ? 'Deselect All' : 'Select All'}
                  </button>
                </div>
                <input
                  type="text"
                  className="user-input"
                  placeholder="Search tests..."
                  value={showTestDropdown ? testReportTestSearch : (testReportTestIds.length > 0 ? testReportTestIds.map(id => tests.find(t => t.id === id)?.name).filter(Boolean).join(', ') : testReportTestSearch)}
                  onChange={e => setTestReportTestSearch(e.target.value)}
                  onFocus={() => { setShowTestDropdown(true); setTestReportTestSearch(''); }}
                  onBlur={() => setTimeout(() => setShowTestDropdown(false), 150)}
                />
                {showTestDropdown && (
                  <div className="searchable-dropdown">
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
                            onChange={() => toggleTestSelect(t.id)}
                          />
                          {t.name}
                        </label>
                      ))}
                    {tests.filter(t => t.name.toLowerCase().includes(testReportTestSearch.toLowerCase())).length === 0 && (
                      <div className="searchable-no-results">No tests found</div>
                    )}
                  </div>
                )}
                {testReportTestIds.length > 0 && (
                  <div className="selected-tags">
                    {testReportTestIds.map(id => {
                      const t = tests.find(x => x.id === id);
                      return t ? (
                        <span key={id} className="selected-tag">
                          {t.name}
                          <button type="button" onClick={() => toggleTestSelect(id)}>×</button>
                        </span>
                      ) : null;
                    })}
                  </div>
                )}
              </div>

              <div className="searchable-select">
                <label>Version</label>
                <input
                  type="text"
                  className="user-input"
                  placeholder="Search versions..."
                  value={showTestVersionDropdown ? testReportVersionSearch : (testReportVersionId ? (versions.find(v => v.id === testReportVersionId)?.name || '') : testReportVersionSearch)}
                  onChange={e => setTestReportVersionSearch(e.target.value)}
                  onFocus={() => setShowTestVersionDropdown(true)}
                  onBlur={() => setTimeout(() => setShowTestVersionDropdown(false), 150)}
                />
                {showTestVersionDropdown && (
                  <div className="searchable-dropdown">
                    {versions
                      .filter(v => v.name.toLowerCase().includes(testReportVersionSearch.toLowerCase()))
                      .map(v => (
                        <div
                          key={v.id}
                          className={`searchable-option ${testReportVersionId === v.id ? 'selected' : ''}`}
                          onMouseDown={() => {
                            setTestReportVersionId(v.id);
                            setShowTestVersionDropdown(false);
                            setTestReportVersionSearch('');
                          }}
                        >
                          {v.name} {v.is_current ? '(current)' : ''}
                        </div>
                      ))}
                    {versions.filter(v => v.name.toLowerCase().includes(testReportVersionSearch.toLowerCase())).length === 0 && (
                      <div className="searchable-no-results">No versions found</div>
                    )}
                  </div>
                )}
              </div>
            </div>

            <div className="report-presets">
              <button
                className={`btn-secondary report-preset-btn ${testReportPreset === 'current_month' ? 'active' : ''}`}
                onClick={() => {
                  setTestReportPreset('current_month');
                  const dates = getDefaultReportDates('current_month');
                  setTestReportStartDate(dates.start);
                  setTestReportEndDate(dates.end);
                  setTestReportData(null);
                  setTestReportError('');
                }}
              >
                Current Month
              </button>
              <button
                className={`btn-secondary report-preset-btn ${testReportPreset === 'last_month' ? 'active' : ''}`}
                onClick={() => {
                  setTestReportPreset('last_month');
                  const dates = getDefaultReportDates('last_month');
                  setTestReportStartDate(dates.start);
                  setTestReportEndDate(dates.end);
                  setTestReportData(null);
                  setTestReportError('');
                }}
              >
                Last Month
              </button>
              <button
                className={`btn-secondary report-preset-btn ${testReportPreset === 'current_year' ? 'active' : ''}`}
                onClick={() => {
                  setTestReportPreset('current_year');
                  const dates = getDefaultReportDates('current_year');
                  setTestReportStartDate(dates.start);
                  setTestReportEndDate(dates.end);
                  setTestReportData(null);
                  setTestReportError('');
                }}
              >
                Current Year
              </button>
              <button
                className={`btn-secondary report-preset-btn ${testReportPreset === 'last_year' ? 'active' : ''}`}
                onClick={() => {
                  setTestReportPreset('last_year');
                  const dates = getDefaultReportDates('last_year');
                  setTestReportStartDate(dates.start);
                  setTestReportEndDate(dates.end);
                  setTestReportData(null);
                  setTestReportError('');
                }}
              >
                Last Year
              </button>
              <button
                className={`btn-secondary report-preset-btn ${testReportPreset === 'custom' ? 'active' : ''}`}
                onClick={() => {
                  setTestReportPreset('custom');
                  setTestReportData(null);
                  setTestReportError('');
                }}
              >
                Custom
              </button>
            </div>

            <div className="report-dates">
              <input
                type="date"
                className="user-input"
                value={testReportStartDate}
                onChange={e => { setTestReportStartDate(e.target.value); setTestReportPreset('custom'); setTestReportData(null); setTestReportError(''); }}
              />
              <span className="report-date-sep">to</span>
              <input
                type="date"
                className="user-input"
                value={testReportEndDate}
                onChange={e => { setTestReportEndDate(e.target.value); setTestReportPreset('custom'); setTestReportData(null); setTestReportError(''); }}
              />
            </div>

            <button
              className="btn"
              onClick={fetchTestReport}
              disabled={testReportLoading || (testReportTestIds.length === 0 && tests.length > 0) || !testReportVersionId || !testReportStartDate || !testReportEndDate}
            >
              {testReportLoading ? 'Generating...' : 'Generate Report'}
            </button>
          </div>

          {testReportError && <p className="error-msg">{testReportError}</p>}

          {testReportData && (
            <div className="report-results">
              <h4>
                Test Report ({testReportData.startDate} — {testReportData.endDate})
                {testReportData.versionId && (
                  <span className="report-version-tag">
                    Version {versions.find(v => v.id === testReportData.versionId)?.name || testReportData.versionId}
                  </span>
                )}
              </h4>

              {testReportData.tests.length === 0 ? (
                <p className="admin-hint">No test activity in this period.</p>
              ) : (
                <div className="report-tests-list">
                   {testReportData.tests.map((test: any) => {
                     const isOpen = expandedTestReportTests.has(test.testId);
                     const failedUsers = test.failedUsers || [];
                     return (
                       <div key={test.testId} className="report-test-row">
                         <div className="report-test-header" onClick={() => toggleTestReportExpand(test.testId)}>
                           <span className="report-test-name">{test.testName}</span>
                           <span className="report-test-stats">
                             <span className="report-stat">{test.rounds} rounds</span>
                             <span className="report-stat report-stat-pass">{test.passes} passed</span>
                             <span className="report-stat report-stat-fail">{test.fails} failed</span>
                           </span>
                           <span className="expand-icon">{isOpen ? '▲' : '▼'}</span>
                         </div>
                         {isOpen && (
                           <div className="report-test-body">
                             {failedUsers.length === 0 ? (
                               <p className="admin-hint" style={{ padding: '0.5rem 1rem' }}>No failed users in this period.</p>
                             ) : (
                               <table className="report-steps-table">
                                 <thead>
                                   <tr>
                                     <th>User</th>
                                     <th>Step</th>
                                     <th>Round</th>
                                     <th>Description</th>
                                     <th>Comment</th>
                                     <th>File</th>
                                     <th>Time</th>
                                   </tr>
                                 </thead>
                                 <tbody>
                                   {failedUsers.map((fu: any) =>
                                     (fu.submissions || []).map((sub: any) => (
                                       <tr key={`${fu.userId}-${sub.stepId}-${sub.roundId}-${sub.executed_at}`} className="report-step-row-failed">
                                         <td>{fu.userName}</td>
                                         <td className="step-num-cell">{sub.stepNumber}</td>
                                         <td>{sub.roundId != null ? `R${sub.roundId}` : '—'}</td>
                                         <td>{sub.description}</td>
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
                                           ) : (
                                             '—'
                                           )}
                                         </td>
                                         <td>{sub.executed_at ? new Date(sub.executed_at).toLocaleString() : '—'}</td>
                                       </tr>
                                     ))
                                   )}
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
        </div>
      )}

      {activeTab === 'backup' && (
        <div className="admin-section">
          <h3>Backup All Data</h3>
          <p className="admin-hint">
            Download a JSON backup containing all users, tests, steps, results, assignments, loop
            state, points, versions — and every uploaded config file referenced by a failed step,
            so restoring reproduces the system exactly (comments and their attachments included).
          </p>
          <button className="btn" onClick={handleBackupExport} disabled={backupLoading}>
            {backupLoading ? 'Preparing...' : 'Download Backup'}
          </button>

          <h3 style={{ marginTop: '2rem' }}>Restore from Backup</h3>
          <p className="admin-hint">
            Upload a previously exported backup file to restore all data. This will replace all current data.
          </p>
          <form onSubmit={handleBackupImport} className="upload-form">
            <input
              ref={backupFileRef}
              type="file"
              accept=".json"
              className="file-input"
            />
            <button type="submit" className="btn" disabled={backupLoading}>
              {backupLoading ? 'Restoring...' : 'Restore Backup'}
            </button>
          </form>

          {backupError && <p className="error-msg">{backupError}</p>}
          {backupMessage && <p className="success-msg">{backupMessage}</p>}
        </div>
      )}
      {deleteTarget && (
        <div className="modal-overlay" onClick={closeDeleteUser}>
          <div className="modal modal-danger" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Delete User — Final Confirmation</h3>
              <button className="modal-close" onClick={closeDeleteUser}>✕</button>
            </div>
            <div className="modal-body">
              <p className="admin-hint">
                This will permanently delete <strong>{deleteTarget.username}</strong> and <strong>all</strong> of
                their data: test results, points, assignments, loop state, and every uploaded config file.
                This cannot be undone.
              </p>
              <p className="admin-hint">
                To confirm, type the username <strong>{deleteTarget.username}</strong> below:
              </p>
              <input
                type="text"
                className="user-input"
                placeholder={deleteTarget.username}
                value={deleteConfirmText}
                onChange={e => setDeleteConfirmText(e.target.value)}
                autoFocus
              />
              <div className="modal-actions">
                <button className="btn-secondary" onClick={closeDeleteUser} disabled={deletingUser}>
                  Cancel
                </button>
                <button
                  className="btn-danger"
                  onClick={confirmDeleteUser}
                  disabled={deletingUser || deleteConfirmText.trim() !== deleteTarget.username}
                >
                  {deletingUser ? 'Deleting...' : 'Delete User Permanently'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {historyUser && (
        <div className="modal-overlay" onClick={() => setHistoryUser(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Test History — {historyUser.username}</h3>
              <button className="modal-close" onClick={() => setHistoryUser(null)}>✕</button>
            </div>
            <div className="modal-body">
              {historyLoading ? (
                <p className="admin-hint">Loading...</p>
              ) : historyResults.length === 0 ? (
                <p className="admin-hint">No tests performed yet.</p>
              ) : (
                <table className="history-table">
                  <thead>
                    <tr>
                      <th>Sheet (Test)</th>
                      <th>Step #</th>
                      <th>Status</th>
                      <th>Timestamp</th>
                    </tr>
                  </thead>
                  <tbody>
                    {historyResults.map(r => (
                      <tr key={r.id}>
                        <td>{r.test_name}</td>
                        <td>{r.step_number}</td>
                        <td>
                          <span className={`status-badge status-${r.result}`}>
                            {r.result.toUpperCase()}
                          </span>
                        </td>
                        <td>{new Date(r.executed_at).toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

interface AssignmentRowProps {
  test: Test;
  users: User[];
  assignedUserIds: number[] | undefined;
  onExpand: () => void;
  onToggle: (userId: number, isAssigned: boolean) => void;
}

const AssignmentRow: React.FC<AssignmentRowProps> = ({ test, users, assignedUserIds, onExpand, onToggle }) => {
  const [open, setOpen] = useState(false);

  const handleToggle = () => {
    if (!open) onExpand();
    setOpen(o => !o);
  };

  return (
    <div className="assignment-row">
      <div className="assignment-header" onClick={handleToggle}>
        <span className="test-name">{test.name}</span>
        <span className="assignment-summary">
          {assignedUserIds !== undefined
            ? `${assignedUserIds.length} user(s) assigned`
            : ''}
        </span>
        <span className="expand-icon">{open ? '▲' : '▼'}</span>
      </div>
      {open && (
        <div className="user-checkboxes">
          {users.length === 0 ? (
            <p className="admin-hint">No non-admin users found.</p>
          ) : (
            users.map(user => {
              const isAssigned = assignedUserIds?.includes(user.id) ?? false;
              return (
                <label key={user.id} className="user-checkbox-label">
                  <input
                    type="checkbox"
                    checked={isAssigned}
                    onChange={() => onToggle(user.id, isAssigned)}
                  />
                  {user.username}
                </label>
              );
            })
          )}
        </div>
      )}
    </div>
  );
};

interface ManageTestRowProps {
  test: Test;
  steps: TestStepAdmin[] | undefined;
  loading: boolean;
  onExpand: () => void;
  onSaveStep: (step: TestStepAdmin) => void;
  onDeleteStep: (stepId: number) => void;
  onAddStep: (payload: { afterStepNumber: number | null; description: string; points: number; on_failure: string }) => void;
  onDelete: () => void;
}

const ManageTestRow: React.FC<ManageTestRowProps> = ({ test, steps, loading, onExpand, onSaveStep, onDeleteStep, onAddStep, onDelete }) => {
  const [open, setOpen] = useState(false);
  const [drafts, setDrafts] = useState<Record<number, { description: string; points: string; on_failure: string }>>({});

  // Add-step form state
  const [newDesc, setNewDesc] = useState('');
  const [newPoints, setNewPoints] = useState('0');
  const [newOnFailure, setNewOnFailure] = useState<'continue' | 'stop'>('continue');
  const [insertAfter, setInsertAfter] = useState<string>('end');
  const [adding, setAdding] = useState(false);

  const handleToggle = () => {
    if (!open) onExpand();
    setOpen(o => !o);
  };

  const getDraft = (step: TestStepAdmin) =>
    drafts[step.id] || {
      description: step.description,
      points: String(step.points ?? step.value ?? 0),
      on_failure: step.on_failure
    };

  const setDraft = (step: TestStepAdmin, patch: Partial<{ description: string; points: string; on_failure: string }>) =>
    setDrafts(prev => ({ ...prev, [step.id]: { ...getDraft(step), ...patch } }));

  const handleSave = (step: TestStepAdmin) => {
    const d = getDraft(step);
    onSaveStep({
      ...step,
      description: d.description,
      value: Number(d.points) || 0,
      on_failure: d.on_failure
    });
  };

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newDesc.trim()) return;
    setAdding(true);
    try {
      await onAddStep({
        afterStepNumber: insertAfter === 'end' ? null : parseFloat(insertAfter),
        description: newDesc,
        points: Number(newPoints) || 0,
        on_failure: newOnFailure
      });
      setNewDesc('');
      setNewPoints('0');
      setNewOnFailure('continue');
      setInsertAfter('end');
    } finally {
      setAdding(false);
    }
  };

  const sortedSteps = steps ? steps.slice().sort((a, b) => a.step_number - b.step_number) : steps;

  return (
    <div className="assignment-row">
      <div className="assignment-header" onClick={handleToggle}>
        <span className="test-name">{test.name}</span>
        <span className="assignment-summary">
          {steps !== undefined ? `${steps.length} step(s)` : ''}
        </span>
        <button
          className="btn-icon btn-icon-danger"
          title="Delete this test"
          onClick={e => { e.stopPropagation(); onDelete(); }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>
        </button>
        <span className="expand-icon">{open ? '▲' : '▼'}</span>
      </div>
      {open && (
        <div className="manage-steps-body">
          {loading ? (
            <p className="admin-hint">Loading steps...</p>
          ) : !sortedSteps || sortedSteps.length === 0 ? (
            <p className="admin-hint">No steps found.</p>
          ) : (
            <table className="manage-steps-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Description</th>
                  <th>Points</th>
                  <th>If Fails</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {sortedSteps.map(step => {
                  const d = getDraft(step);
                  return (
                    <tr key={step.id}>
                      <td className="step-num-cell">{step.step_number}</td>
                      <td className="step-desc-cell">
                        <input
                          type="text"
                          className="step-desc-input"
                          value={d.description}
                          onChange={e => setDraft(step, { description: e.target.value })}
                        />
                      </td>
                      <td className="step-points-cell">
                        <input
                          type="number"
                          min={0}
                          className="points-input"
                          value={d.points}
                          onChange={e => setDraft(step, { points: e.target.value })}
                        />
                      </td>
                      <td className="step-failure-cell">
                        <select
                          className="failure-select"
                          value={d.on_failure}
                          onChange={e => setDraft(step, { on_failure: e.target.value })}
                        >
                          <option value="continue">Continue</option>
                          <option value="stop">Hard Stop</option>
                        </select>
                      </td>
                      <td className="step-actions-cell">
                        <button className="btn-secondary" onClick={() => handleSave(step)}>Save</button>
                        <button className="btn-danger" onClick={() => onDeleteStep(step.id)}>Delete</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}

          <form onSubmit={handleAdd} className="add-step-form">
            <h4>Add Step</h4>
            <div className="add-step-row">
              <label>Insert after:</label>
              <select value={insertAfter} onChange={e => setInsertAfter(e.target.value)}>
                <option value="end">At the end</option>
                {sortedSteps && sortedSteps.map(s => (
                  <option key={s.id} value={s.step_number}>After step {s.step_number}</option>
                ))}
              </select>
            </div>
            <input
              type="text"
              placeholder="Step description"
              className="user-input"
              value={newDesc}
              onChange={e => setNewDesc(e.target.value)}
            />
            <input
              type="number"
              min={0}
              placeholder="Points"
              className="user-input step-points-add"
              value={newPoints}
              onChange={e => setNewPoints(e.target.value)}
            />
            <select className="failure-select" value={newOnFailure} onChange={e => setNewOnFailure(e.target.value as 'continue' | 'stop')}>
              <option value="continue">Continue on failure</option>
              <option value="stop">Hard stop on failure</option>
            </select>
            <button type="submit" className="btn" disabled={adding || !newDesc.trim()}>
              {adding ? 'Adding...' : 'Add Step'}
            </button>
          </form>
        </div>
      )}
    </div>
  );
};

export default AdminPanel;
