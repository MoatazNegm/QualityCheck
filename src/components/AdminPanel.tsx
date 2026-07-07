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

const API_BASE = process.env.REACT_APP_API_URL || 'http://localhost:4006';

const AdminPanel: React.FC = () => {
  const { token } = useAuth();
  const [tests, setTests] = useState<Test[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [assignments, setAssignments] = useState<Record<number, number[]>>({});
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportedTest[] | null>(null);
  const [importError, setImportError] = useState('');
  const [activeTab, setActiveTab] = useState<'upload' | 'assign' | 'users'>('upload');
  const [historyUser, setHistoryUser] = useState<User | null>(null);
  const [historyResults, setHistoryResults] = useState<TestResult[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [userError, setUserError] = useState('');
  const [userSuccess, setUserSuccess] = useState('');
  const [creatingUser, setCreatingUser] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const authHeaders = { Authorization: `Bearer ${token}` };

  useEffect(() => {
    fetchTests();
    fetchUsers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const fetchTests = async () => {
    const res = await fetch(`${API_BASE}/api/tests`, { headers: authHeaders });
    if (res.ok) setTests(await res.json());
  };

  const fetchUsers = async () => {
    const res = await fetch(`${API_BASE}/api/users`, { headers: authHeaders });
    if (res.ok) setUsers(await res.json());
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

  const handleDeleteUser = async (userId: number, username: string) => {
    if (!window.confirm(`Delete user "${username}"? This cannot be undone.`)) return;
    await fetch(`${API_BASE}/api/users/${userId}`, { method: 'DELETE', headers: authHeaders });
    fetchUsers();
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
      </div>

      {activeTab === 'upload' && (
        <div className="admin-section">
          <h3>Import Tests from Excel</h3>
          <p className="admin-hint">
            Each sheet tab becomes a test. Columns used: <strong>Test case</strong> (step description) and <strong>Expected Success</strong> (success symptom).
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
                      onClick={() => handleDeleteUser(u.id, u.username)}
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

export default AdminPanel;
