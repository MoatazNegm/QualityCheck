import React, { useState, useEffect, useRef, useLayoutEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import ReportsView from './ReportsView';

interface Test {
  id: number;
  name: string;
  description: string;
  totalPoints?: number;
}

interface User {
  id: number;
  username: string;
  is_admin: boolean;
  isSuspended: boolean;
  user_groups?: string[];
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
  attachment_path?: string | null;
  attachment_name?: string | null;
}

interface Version {
  id: number;
  name: string;
  note: string | null;
  is_current: number;
  created_at: string;
}

const API_BASE = '';

// Gzip a string using the browser's native CompressionStream. Returns a
// Uint8Array of the compressed bytes. No npm dependency needed — available
// in all modern browsers (Chrome 80+, Firefox 113+, Safari 16.4+).
// (Type declaration lives in src/compressionStream.d.ts — TypeScript 4.9.5
// doesn't include this type in lib.dom.d.ts.)
async function gzipString(text: string): Promise<Uint8Array> {
  const blob = new Blob([text]);
  const stream = blob.stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

const AdminPanel: React.FC = () => {
  const { token } = useAuth();
  const [tests, setTests] = useState<Test[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [assignments, setAssignments] = useState<Record<number, number[]>>({});
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportedTest[] | null>(null);
  const [importNames, setImportNames] = useState<Record<number, string>>({});
  const [importSaving, setImportSaving] = useState(false);
  const [importSaveError, setImportSaveError] = useState('');
  const [importSaveSuccess, setImportSaveSuccess] = useState('');
  const [importError, setImportError] = useState('');
  const [activeTab, setActiveTab] = useState<'upload' | 'assign' | 'users' | 'manage' | 'versions' | 'reports' | 'test-reports' | 'backup' | 'settings'>('upload');
  const [thresholdMinutes, setThresholdMinutes] = useState<string>('3');
  const [maxMonthlyRounds, setMaxMonthlyRounds] = useState<string>('8');
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsSuccess, setSettingsSuccess] = useState('');
  const [settingsError, setSettingsError] = useState('');
  // Dropbox Storage Settings State
  const [dropboxEnabled, setDropboxEnabled] = useState<boolean>(false);
  const [dropboxAppKey, setDropboxAppKey] = useState<string>('');
  const [dropboxAppSecret, setDropboxAppSecret] = useState<string>('');
  const [dropboxFolderPath, setDropboxFolderPath] = useState<string>('/QualityCheck_Uploads');
  const [dropboxIsConfigured, setDropboxIsConfigured] = useState<boolean>(false);
  const [dropboxTesting, setDropboxTesting] = useState<boolean>(false);
  const [dropboxTestResult, setDropboxTestResult] = useState<{ success: boolean; message: string; accountName?: string } | null>(null);
  const [historyUser, setHistoryUser] = useState<User | null>(null);
  const [historyResults, setHistoryResults] = useState<TestResult[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [managedSteps, setManagedSteps] = useState<Record<number, TestStepAdmin[]>>({});
  const [loadingSteps, setLoadingSteps] = useState<Set<number>>(new Set());
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newUserGroups, setNewUserGroups] = useState<string[]>(['testers']);
  const [userError, setUserError] = useState('');
  const [userSuccess, setUserSuccess] = useState('');
  const [creatingUser, setCreatingUser] = useState(false);
  const [userSummaries, setUserSummaries] = useState<Record<number, { assignedCount: number; completedCount: number; failedHardStopCount: number; completedRounds: number }>>({});
  const [userSummariesLoading, setUserSummariesLoading] = useState(false);
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
  const [reportPreset, setReportPreset] = useState<'current_month' | 'last_month' | 'current_year' | 'last_year' | 'custom'>('current_month');
  const [reportStartDate, setReportStartDate] = useState('');
  const [reportEndDate, setReportEndDate] = useState('');
  const [reportVersionIds, setReportVersionIds] = useState<number[]>([]);
  const [reportUserSearch, setReportUserSearch] = useState('');
  const [reportVersionSearch, setReportVersionSearch] = useState('');
  const [showUserDropdown, setShowUserDropdown] = useState(false);
  const [showVersionDropdown, setShowVersionDropdown] = useState(false);
  const [reportData, setReportData] = useState<any | null>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportError, setReportError] = useState('');
  const [expandedTests, setExpandedTests] = useState<Set<number>>(new Set());
  const [expandedReportSteps, setExpandedReportSteps] = useState<Set<string>>(new Set());
  const [testReportTestIds, setTestReportTestIds] = useState<number[]>([]);
  const [testReportPreset, setTestReportPreset] = useState<'current_month' | 'last_month' | 'current_year' | 'last_year' | 'custom'>('current_month');
  const [testReportStartDate, setTestReportStartDate] = useState('');
  const [testReportEndDate, setTestReportEndDate] = useState('');
  const [testReportVersionIds, setTestReportVersionIds] = useState<number[]>([]);
  const [testReportTestSearch, setTestReportTestSearch] = useState('');
  const [testReportVersionSearch, setTestReportVersionSearch] = useState('');
  const [showTestDropdown, setShowTestDropdown] = useState(false);
  const [showTestVersionDropdown, setShowTestVersionDropdown] = useState(false);
  const [testReportData, setTestReportData] = useState<any | null>(null);
  const [testReportLoading, setTestReportLoading] = useState(false);
  const [testReportError, setTestReportError] = useState('');
  const [expandedTestReportTests, setExpandedTestReportTests] = useState<Set<number>>(new Set());
  const [reportsSubTab, setReportsSubTab] = useState<'user' | 'test' | 'passed' | 'points'>('user');
  const [pointsUserIds, setPointsUserIds] = useState<number[]>([]);
  const [pointsPreset, setPointsPreset] = useState<'current_month' | 'last_month' | 'current_year' | 'last_year' | 'custom'>('current_month');
  const [pointsStartDate, setPointsStartDate] = useState('');
  const [pointsEndDate, setPointsEndDate] = useState('');
  const [pointsUserSearch, setPointsUserSearch] = useState('');
  const [showPointsUserDropdown, setShowPointsUserDropdown] = useState(false);
  const [pointsData, setPointsData] = useState<any | null>(null);
  const [pointsLoading, setPointsLoading] = useState(false);
  const [pointsError, setPointsError] = useState('');
  const [testReportLineSearch] = useState('');
  const [testReportSteps, setTestReportSteps] = useState<any[]>([]);
  const [testReportSelectedStepId, setTestReportSelectedStepId] = useState<number | null>(null);
  const [testReportStepSearch, setTestReportStepSearch] = useState('');
  const [showStepDropdown, setShowStepDropdown] = useState(false);
  const testReportInitialMount = useRef(true);
  const [passedReportTestIds, setPassedReportTestIds] = useState<number[]>([]);
  const [passedReportPreset, setPassedReportPreset] = useState<'current_month' | 'last_month' | 'current_year' | 'last_year' | 'custom'>('current_month');
  const [passedReportStartDate, setPassedReportStartDate] = useState('');
  const [passedReportEndDate, setPassedReportEndDate] = useState('');
  const [passedReportVersionIds, setPassedReportVersionIds] = useState<number[]>([]);
  const [passedReportTestSearch, setPassedReportTestSearch] = useState('');
  const [passedReportVersionSearch, setPassedReportVersionSearch] = useState('');
  const [showPassedTestDropdown, setShowPassedTestDropdown] = useState(false);
  const [showPassedTestVersionDropdown, setShowPassedTestVersionDropdown] = useState(false);
  const [passedReportData, setPassedReportData] = useState<any | null>(null);
  const [passedReportLoading, setPassedReportLoading] = useState(false);
  const [passedReportError, setPassedReportError] = useState('');
  const [expandedPassedReportTests, setExpandedPassedReportTests] = useState<Set<number>>(new Set());
  const [passedReportSteps, setPassedReportSteps] = useState<any[]>([]);
  const [passedReportSelectedStepId, setPassedReportSelectedStepId] = useState<number | null>(null);
  const [passedReportStepSearch, setPassedReportStepSearch] = useState('');
  const [showPassedStepDropdown, setShowPassedStepDropdown] = useState(false);
  const passedReportInitialMount = useRef(true);
  const [deleteTarget, setDeleteTarget] = useState<User | null>(null);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [deletingUser, setDeletingUser] = useState(false);
  const [detailUser, setDetailUser] = useState<User | null>(null);
  const [detailUserAssignments, setDetailUserAssignments] = useState<Record<number, boolean>>({});
  const [detailUserLoading, setDetailUserLoading] = useState(false);
  const [passwordTarget, setPasswordTarget] = useState<User | null>(null);
  const [newUserPassword, setNewUserPassword] = useState('');
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [passwordError, setPasswordError] = useState('');
  const [passwordSuccess, setPasswordSuccess] = useState('');
  const [payPointsUser, setPayPointsUser] = useState<User | null>(null);
  const [payPointsData, setPayPointsData] = useState<any | null>(null);
  const [payPointsLoading, setPayPointsLoading] = useState(false);
  const [payPointsAmount, setPayPointsAmount] = useState<string>('');
  const [payPointsSubmitting, setPayPointsSubmitting] = useState(false);
  const [payPointsError, setPayPointsError] = useState('');
  const [payPointsSuccess, setPayPointsSuccess] = useState('');

  const authHeaders = { Authorization: `Bearer ${token}` };

  useEffect(() => {
    fetchTests();
    fetchUsers();
    fetchVersions();
    fetchSettings();
    const dates = getDefaultReportDates('current_month');
    setReportStartDate(dates.start);
    setReportEndDate(dates.end);
    setTestReportStartDate(dates.start);
    setTestReportEndDate(dates.end);
    setPassedReportStartDate(dates.start);
    setPassedReportEndDate(dates.end);
    setPointsStartDate(dates.start);
    setPointsEndDate(dates.end);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => {
    if (!tests.length) return;
    // Batch fetch all steps and assignments in two calls instead of 2N calls
    const fetchAllStepsAndAssignments = async () => {
      try {
        const [stepsRes, assignRes] = await Promise.all([
          fetch(`${API_BASE}/api/tests/steps?testIds=all`, { headers: authHeaders }),
          fetch(`${API_BASE}/api/tests/assignments/bulk`, { headers: authHeaders })
        ]);
        if (stepsRes.ok) {
          const stepsData = await stepsRes.json();
          const stepsMap: Record<number, TestStepAdmin[]> = {};
          for (const entry of stepsData) {
            stepsMap[entry.testId] = entry.steps || [];
          }
          setManagedSteps(prev => ({ ...prev, ...stepsMap }));
        }
        if (assignRes.ok) {
          const assignData = await assignRes.json();
          setAssignments(assignData);
        }
      } catch {
        // Fallback: fetch individually if bulk fails
        tests.forEach(t => {
          fetchTestSteps(t.id);
          fetchAssignmentsForTest(t.id);
        });
      }
    };
    fetchAllStepsAndAssignments();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tests]);

  useEffect(() => {
    if (testReportInitialMount.current) {
      testReportInitialMount.current = false;
      return;
    }
    fetchTestReportSteps();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [testReportTestIds]);

  useEffect(() => {
    if (passedReportInitialMount.current) {
      passedReportInitialMount.current = false;
      return;
    }
    fetchPassedReportSteps();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [passedReportTestIds]);

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
        if (cv) {
          if (reportVersionIds.length === 0) setReportVersionIds([cv.id]);
          if (testReportVersionIds.length === 0) setTestReportVersionIds([cv.id]);
          if (passedReportVersionIds.length === 0) setPassedReportVersionIds([cv.id]);
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
    if (res.ok) {
      const data = await res.json();
      setUsers(data);
      if (data.length) {
        fetchUserSummaries(data.map((u: User) => u.id));
      }
    }
  };

  const fetchUserSummaries = async (_userIds?: number[]) => {
    setUserSummariesLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/users/summaries`, { headers: authHeaders });
      if (res.ok) {
        const data = await res.json();
        setUserSummaries(data);
      }
    } catch {
      // ignore
    } finally {
      setUserSummariesLoading(false);
    }
  };

  const getDefaultReportDates = (preset: 'current_month' | 'last_month' | 'current_year' | 'last_year' | 'custom') => {
    const now = new Date();
    let start: Date;
    let end: Date;

    switch (preset) {
      case 'current_month':
        start = new Date(now.getFullYear(), now.getMonth(), 1);
        end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
        break;
      case 'last_month':
        start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        end = new Date(now.getFullYear(), now.getMonth(), 0);
        break;
      case 'current_year':
        start = new Date(now.getFullYear(), 0, 1);
        end = new Date(now.getFullYear(), 11, 31);
        break;
      case 'last_year':
        start = new Date(now.getFullYear() - 1, 0, 1);
        end = new Date(now.getFullYear() - 1, 11, 31);
        break;
      default:
        start = new Date(now.getFullYear(), now.getMonth(), 1);
        end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
        break;
    }

    const formatLocalDate = (d: Date) => {
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    };

    return {
      start: formatLocalDate(start),
      end: formatLocalDate(end)
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
      const url = new URL(`${API_BASE}/api/reports/user-report`, window.location.origin);
      url.searchParams.set('userId', reportUserIds.join(','));
      url.searchParams.set('startDate', reportStartDate);
      url.searchParams.set('endDate', reportEndDate);
      if (reportVersionIds.length > 0) url.searchParams.set('versionIds', reportVersionIds.join(','));

      const res = await fetch(url.toString(), {
        headers: authHeaders
      });
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

  const toggleReportStepExpand = (testId: number, stepId: number) => {
    const key = `${testId}-${stepId}`;
    setExpandedReportSteps(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const fetchTestReport = async () => {
    if ((testReportTestIds.length === 0 && testReportTestIds.length !== 0) || !testReportStartDate || !testReportEndDate) return;
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

      const res = await fetch(url.toString(), {
        headers: authHeaders
      });
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

  const handlePointsPresetChange = (preset: 'current_month' | 'last_month' | 'current_year' | 'last_year' | 'custom') => {
    setPointsPreset(preset);
    if (preset !== 'custom') {
      const dates = getDefaultReportDates(preset);
      setPointsStartDate(dates.start);
      setPointsEndDate(dates.end);
    }
    setPointsData(null);
    setPointsError('');
  };

  const togglePointsUserSelect = (userId: number) => {
    setPointsUserIds(prev => {
      if (prev.includes(userId)) return prev.filter(id => id !== userId);
      return [...prev, userId];
    });
    setPointsData(null);
    setPointsError('');
  };

  const toggleAllPointsUsers = () => {
    setPointsUserIds(prev => prev.length === nonAdminUsers.length ? [] : nonAdminUsers.map(u => u.id));
    setPointsData(null);
    setPointsError('');
  };

  const fetchPointsReport = async () => {
    if (!pointsStartDate || !pointsEndDate) return;
    setPointsLoading(true);
    setPointsError('');
    setPointsData(null);
    try {
      const url = new URL(`${API_BASE}/api/reports/points`, window.location.origin);
      if (pointsUserIds.length > 0) {
        url.searchParams.set('userId', pointsUserIds.join(','));
      }
      url.searchParams.set('startDate', pointsStartDate);
      url.searchParams.set('endDate', pointsEndDate);

      const res = await fetch(url.toString(), {
        headers: authHeaders
      });
      const data = await res.json();
      if (!res.ok) {
        setPointsError(data.error || 'Failed to load report');
      } else {
        setPointsData(data);
      }
    } catch (err) {
      console.error('Points report fetch failed:', err);
      setPointsError('Network error');
    } finally {
      setPointsLoading(false);
    }
  };

  const fetchTestReportSteps = async () => {
    if (testReportTestIds.length === 0) {
      setTestReportSteps([]);
      setTestReportSelectedStepId(null);
      return;
    }
    try {
      const url = new URL(`${API_BASE}/api/tests/steps`, window.location.origin);
      url.searchParams.set('testIds', testReportTestIds.join(','));
      const res = await fetch(url.toString(), { headers: authHeaders });
      if (res.ok) {
        const data = await res.json();
        setTestReportSteps(data);
        setTestReportSelectedStepId(null);
      }
    } catch {
      // ignore
    }
  };

  const toggleTestSelect = (testId: number) => {
    setTestReportTestIds(prev => {
      if (prev.includes(testId)) return prev.filter(id => id !== testId);
      return [...prev, testId];
    });
    setTestReportData(null);
    setTestReportError('');
    setTestReportSteps([]);
    setTestReportSelectedStepId(null);
  };

  const fetchPassedReport = async () => {
    if ((passedReportTestIds.length === 0 && passedReportTestIds.length !== 0) || !passedReportStartDate || !passedReportEndDate) return;
    setPassedReportLoading(true);
    setPassedReportError('');
    setPassedReportData(null);
    try {
      const url = new URL(`${API_BASE}/api/reports/passed-report`, window.location.origin);
      if (passedReportTestIds.length > 0) {
        url.searchParams.set('testId', passedReportTestIds.join(','));
      } else {
        url.searchParams.set('testId', 'all');
      }
      url.searchParams.set('startDate', passedReportStartDate);
      url.searchParams.set('endDate', passedReportEndDate);
      if (passedReportVersionIds.length > 0) url.searchParams.set('versionIds', passedReportVersionIds.join(','));
      if (passedReportSelectedStepId) url.searchParams.set('stepId', String(passedReportSelectedStepId));

      const res = await fetch(url.toString(), {
        headers: authHeaders
      });
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

  const fetchPassedReportSteps = async () => {
    if (passedReportTestIds.length === 0) {
      setPassedReportSteps([]);
      setPassedReportSelectedStepId(null);
      return;
    }
    try {
      const url = new URL(`${API_BASE}/api/tests/steps`, window.location.origin);
      url.searchParams.set('testIds', passedReportTestIds.join(','));
      const res = await fetch(url.toString(), { headers: authHeaders });
      if (res.ok) {
        const data = await res.json();
        setPassedReportSteps(data);
        setPassedReportSelectedStepId(null);
      }
    } catch {
      // ignore
    }
  };

  const togglePassedTestSelect = (testId: number) => {
    setPassedReportTestIds(prev => {
      if (prev.includes(testId)) return prev.filter(id => id !== testId);
      return [...prev, testId];
    });
    setPassedReportData(null);
    setPassedReportError('');
    setPassedReportSteps([]);
    setPassedReportSelectedStepId(null);
  };

  const togglePassedTestReportExpand = (testId: number) => {
    setExpandedPassedReportTests(prev => {
      const next = new Set(prev);
      if (next.has(testId)) next.delete(testId);
      else next.add(testId);
      return next;
    });
  };

  const toggleAllUsers = () => {
    if (reportUserIds.length === nonAdminUsers.length) {
      setReportUserIds([]);
    } else {
      setReportUserIds(nonAdminUsers.map(u => u.id));
    }
    setReportData(null);
    setReportError('');
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

  const openUserDetail = async (user: User) => {
    setDetailUser(user);
    setDetailUserLoading(true);
    setDetailUserAssignments({});
    try {
      const [testsRes, assignmentsRes] = await Promise.all([
        fetch(`${API_BASE}/api/tests`, { headers: authHeaders }),
        fetch(`${API_BASE}/api/tests/user/${user.id}/assignments`, { headers: authHeaders })
      ]);
      if (testsRes.ok && assignmentsRes.ok) {
        const allTests: any[] = await testsRes.json();
        const assignedIds = new Set(await assignmentsRes.json());
        const map: Record<number, boolean> = {};
        allTests.forEach(t => { map[t.id] = assignedIds.has(t.id); });
        setDetailUserAssignments(map);
      }
    } catch {
      // ignore
    } finally {
      setDetailUserLoading(false);
    }
  };

  const toggleDetailAssignment = async (testId: number, currentlyAssigned: boolean) => {
    try {
      if (currentlyAssigned) {
        await fetch(`${API_BASE}/api/tests/${testId}/assignments/${detailUser?.id}`, {
          method: 'DELETE',
          headers: authHeaders,
        });
      } else {
        await fetch(`${API_BASE}/api/tests/${testId}/assignments`, {
          method: 'POST',
          headers: { ...authHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: detailUser?.id }),
        });
      }
      setDetailUserAssignments(prev => ({ ...prev, [testId]: !currentlyAssigned }));
      setAssignments({});
    } catch {
      // ignore
    }
  };

  const openPayPoints = async (user: User) => {
    setPayPointsUser(user);
    setPayPointsAmount('');
    setPayPointsError('');
    setPayPointsSuccess('');
    await fetchPayPointsData(user.id);
  };

  const fetchPayPointsData = async (userId: number) => {
    setPayPointsLoading(true);
    setPayPointsError('');
    setPayPointsData(null);
    try {
      const start = '2025-01-01';
      const end = new Date().toISOString().slice(0, 10);
      const url = new URL(`${API_BASE}/api/reports/points`, window.location.origin);
      url.searchParams.set('userId', userId.toString());
      url.searchParams.set('startDate', start);
      url.searchParams.set('endDate', end);
      const res = await fetch(url.toString(), { headers: authHeaders });
      const data = await res.json();
      if (!res.ok) {
        setPayPointsError(data.error || 'Failed to load points data');
      } else {
        setPayPointsData(data);
        if (data.users && data.users.length > 0) {
          setPayPointsAmount(String(data.users[0].unpaidPoints || 0));
        }
      }
    } catch (err) {
      setPayPointsError('Network error');
    } finally {
      setPayPointsLoading(false);
    }
  };

  const handlePayPointsSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!payPointsUser) return;
    const points = parseFloat(payPointsAmount);
    if (isNaN(points) || points <= 0) {
      setPayPointsError('Please enter a valid positive amount.');
      return;
    }
    setPayPointsSubmitting(true);
    setPayPointsError('');
    setPayPointsSuccess('');
    try {
      const res = await fetch(`${API_BASE}/api/users/${payPointsUser.id}/pay-points`, {
        method: 'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ points })
      });
      const data = await res.json();
      if (!res.ok) {
        setPayPointsError(data.error || 'Failed to submit payment');
      } else {
        setPayPointsSuccess('Payment confirmed successfully.');
        await fetchPayPointsData(payPointsUser.id);
      }
    } catch (err) {
      setPayPointsError('Network error');
    } finally {
      setPayPointsSubmitting(false);
    }
  };

  const openChangePassword = (user: User) => {
    setPasswordTarget(user);
    setNewUserPassword('');
    setPasswordError('');
    setPasswordSuccess('');
  };

  const toggleSuspension = async (user: User) => {
    try {
      const res = await fetch(`${API_BASE}/api/users/${user.id}/suspend`, {
        method: 'PUT',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_suspended: !user.isSuspended })
      });
      const data = await res.json();
      if (!res.ok) {
        setUserError(data.error || 'Failed to update suspension');
      } else {
        setUsers(prev => prev.map(u => u.id === user.id ? { ...u, isSuspended: !user.isSuspended } : u));
        setUserSuccess(`User ${user.username} ${!user.isSuspended ? 'suspended' : 'unsuspended'} successfully.`);
      }
    } catch {
      setUserError('Network error');
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!passwordTarget || !newUserPassword.trim()) return;
    setPasswordLoading(true);
    setPasswordError('');
    setPasswordSuccess('');
    try {
      const res = await fetch(`${API_BASE}/api/users/${passwordTarget.id}/password`, {
        method: 'PUT',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: newUserPassword.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setPasswordError(data.error || 'Failed to change password');
      } else {
        setPasswordSuccess('Password updated successfully.');
        setNewUserPassword('');
      }
    } catch {
      setPasswordError('Network error');
    } finally {
      setPasswordLoading(false);
    }
  };

  const handleImport = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const file = fileInputRef.current?.files?.[0];
    if (!file) return;

    setImporting(true);
    setImportError('');
    setImportResult(null);
    setImportNames({});
    setImportSaveError('');
    setImportSaveSuccess('');

    const formData = new FormData();
    formData.append('file', file);
    formData.append('fileName', file.name);

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
        const nameMap: Record<number, string> = {};
        data.imported.forEach((t: ImportedTest) => { nameMap[t.id] = t.name; });
        setImportNames(nameMap);
        fetchTests();
        if (fileInputRef.current) fileInputRef.current.value = '';
      }
    } catch {
      setImportError('Network error during import');
    } finally {
      setImporting(false);
    }
  };

  const handleRenameImport = async () => {
    if (!importResult) return;
    setImportSaving(true);
    setImportSaveError('');
    setImportSaveSuccess('');
    try {
      await Promise.all(importResult.map(t => fetch(`${API_BASE}/api/tests/${t.id}`, {
        method: 'PUT',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: importNames[t.id] || t.name })
      })));
      setImportSaveSuccess('Test names updated');
      fetchTests();
    } catch {
      setImportSaveError('Failed to rename tests');
    } finally {
      setImportSaving(false);
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
  // duplicate state removed






  const nonAdminUsers = users.filter(u => !u.is_admin);

  const handleCreateUser = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!newUsername.trim() || !newPassword.trim()) return;
    setCreatingUser(true);
    setUserError('');
    setUserSuccess('');
    const isAdmin = newUserGroups.includes('admins');
    try {
      const res = await fetch(`${API_BASE}/api/users`, {
        method: 'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: newUsername.trim(), password: newPassword, isAdmin, user_groups: newUserGroups }),
      });
      const data = await res.json();
      if (!res.ok) {
        setUserError(data.error || 'Failed to create user');
      } else {
        setUserSuccess(`User "${newUsername.trim()}" created successfully.`);
        setNewUsername('');
        setNewPassword('');
        setNewUserGroups(['testers']);
        fetchUsers();
      }
    } catch {
      setUserError('Network error');
    } finally {
      setCreatingUser(false);
    }
  };

  const handleToggleUserGroup = async (u: User, groupName: string) => {
    const current = u.user_groups || (u.is_admin ? ['admins'] : ['testers']);
    const updated = current.includes(groupName)
      ? current.filter(g => g !== groupName)
      : [...current, groupName];
    if (updated.length === 0) {
      setUserError('A user must belong to at least one group');
      return;
    }
    const isAdmin = updated.includes('admins');
    try {
      const res = await fetch(`${API_BASE}/api/users/${u.id}`, {
        method: 'PUT',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_admin: isAdmin, user_groups: updated })
      });
      if (res.ok) {
        fetchUsers();
      }
    } catch {
      // ignore
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
    const rawPts = step.points !== undefined && step.points !== null ? step.points : step.value;
    const pointsVal = isNaN(Number(rawPts)) ? 0 : Number(rawPts);
    const symptomVal = (step.success_symptom && step.success_symptom.trim()) ? step.success_symptom.trim() : 'N/A';
    await fetch(`${API_BASE}/api/tests/${testId}/steps/${step.id}`, {
      method: 'PUT',
      headers: { ...authHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        step_number: step.step_number,
        description: step.description,
        success_symptom: symptomVal,
        value: pointsVal,
        points: pointsVal,
        on_failure: step.on_failure,
        attachment_path: step.attachment_path || null,
        attachment_name: step.attachment_name || null
      })
    });
    setManagedSteps(prev => ({
      ...prev,
      [testId]: (prev[testId] || []).map(s => s.id === step.id ? {
        ...s,
        description: step.description,
        success_symptom: symptomVal,
        value: pointsVal,
        points: pointsVal,
        on_failure: step.on_failure,
        attachment_path: step.attachment_path || null,
        attachment_name: step.attachment_name || null
      } : s)
    }));
  };

  const uploadStepAttachment = async (testId: number, stepId: number, file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    try {
      const res = await fetch(`${API_BASE}/api/tests/${testId}/steps/${stepId}/attachment`, {
        method: 'POST',
        headers: authHeaders,
        body: formData
      });
      if (res.ok) {
        const data = await res.json();
        setManagedSteps(prev => ({
          ...prev,
          [testId]: (prev[testId] || []).map(s => s.id === stepId ? {
            ...s,
            attachment_path: data.attachment_path,
            attachment_name: data.attachment_name
          } : s)
        }));
      } else {
        const err = await res.json().catch(() => ({}));
        alert(err.error || 'Failed to upload step attachment');
      }
    } catch (e) {
      console.error('Failed to upload step attachment:', e);
      alert('Network error uploading step attachment');
    }
  };

  const removeStepAttachment = async (testId: number, stepId: number) => {
    if (!window.confirm('Remove reference attachment from this step?')) return;
    try {
      const res = await fetch(`${API_BASE}/api/tests/${testId}/steps/${stepId}/attachment`, {
        method: 'DELETE',
        headers: authHeaders
      });
      if (res.ok) {
        setManagedSteps(prev => ({
          ...prev,
          [testId]: (prev[testId] || []).map(s => s.id === stepId ? {
            ...s,
            attachment_path: null,
            attachment_name: null
          } : s)
        }));
      } else {
        alert('Failed to remove step attachment');
      }
    } catch (e) {
      console.error('Failed to remove step attachment:', e);
      alert('Network error removing step attachment');
    }
  };

  const deleteStep = async (testId: number, stepId: number) => {
    if (!window.confirm('Delete this step? This cannot be undone.')) return;
    await fetch(`${API_BASE}/api/tests/${testId}/steps/${stepId}`, { method: 'DELETE', headers: authHeaders });
    await normalizeSteps(testId);
  };

  const addStep = async (
    testId: number,
    payload: { afterStepNumber: number | null; description: string; success_symptom?: string; points: number; on_failure: string; attachmentFile?: File | null }
  ) => {
    const steps = managedSteps[testId] || [];
    const maxStep = steps.length ? Math.max(...steps.map(s => s.step_number)) : 0;
    const stepNumber = payload.afterStepNumber === null ? maxStep + 1 : payload.afterStepNumber + 0.5;
    const symptomVal = (payload.success_symptom && payload.success_symptom.trim()) ? payload.success_symptom.trim() : 'N/A';
    const res = await fetch(`${API_BASE}/api/tests/${testId}/steps`, {
      method: 'POST',
      headers: { ...authHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        step_number: stepNumber,
        description: payload.description.trim(),
        success_symptom: symptomVal,
        value: payload.points,
        points: payload.points,
        on_failure: payload.on_failure
      })
    });
    if (res.ok && payload.attachmentFile) {
      const newStep = await res.json().catch(() => null);
      if (newStep && newStep.id) {
        await uploadStepAttachment(testId, newStep.id, payload.attachmentFile);
      }
    }
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

    try {
      // Read the file, gzip it, then upload in chunks. Vercel hard-caps
      // serverless function request bodies at 4.5 MB, so any backup with
      // embedded base64 files is guaranteed to exceed that without chunking.
      const text = await file.text();
      const gzipped = await gzipString(text);

      // 3 MB per chunk keeps every individual request well under the 4.5 MB
      // Vercel limit even after multipart overhead.
      const CHUNK_SIZE = 3 * 1024 * 1024;
      const totalChunks = Math.max(1, Math.ceil(gzipped.byteLength / CHUNK_SIZE));
      const uploadId = `upload-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

      for (let i = 0; i < totalChunks; i++) {
        const start = i * CHUNK_SIZE;
        const end = Math.min(start + CHUNK_SIZE, gzipped.byteLength);
        const chunk = gzipped.slice(start, end);

        const formData = new FormData();
        formData.append('uploadId', uploadId);
        formData.append('chunkIndex', String(i));
        formData.append('totalChunks', String(totalChunks));
        formData.append('chunk', new Blob([chunk], { type: 'application/octet-stream' }));

        const res = await fetch(`${API_BASE}/api/backup/import-chunk`, {
          method: 'POST',
          headers: authHeaders,
          body: formData,
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || `Chunk ${i + 1}/${totalChunks} upload failed (HTTP ${res.status})`);
        }
      }

      const res = await fetch(`${API_BASE}/api/backup/import-finalize`, {
        method: 'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ uploadId, totalChunks }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || `Restore failed (HTTP ${res.status})`);
      }

      setBackupMessage(`Backup restored successfully (${data.restoredFiles} files restored).`);
      if (backupFileRef.current) backupFileRef.current.value = '';
      fetchTests();
      fetchUsers();
    } catch (err: any) {
      console.error('Backup import failed:', err);
      setBackupError(err?.message || 'Network error during restore');
    } finally {
      setBackupLoading(false);
    }
  };

  const fetchSettings = async () => {
    setSettingsLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/settings`, { headers: authHeaders });
      if (res.ok) {
        const data = await res.json();
        const thresh = data['consecutive_failure_threshold_seconds'];
        if (thresh && thresh.value) {
          const sec = parseInt(thresh.value, 10);
          if (!isNaN(sec)) {
            setThresholdMinutes((sec / 60).toString());
          }
        }
        const maxRoundsSetting = data['max_monthly_test_rounds'];
        if (maxRoundsSetting && maxRoundsSetting.value) {
          setMaxMonthlyRounds(maxRoundsSetting.value);
        }

        // Dropbox Settings
        const dbEnabled = data['dropbox_enabled'];
        if (dbEnabled) {
          setDropboxEnabled(dbEnabled.value === 'true');
        }
        const dbAppKey = data['dropbox_app_key'];
        if (dbAppKey && dbAppKey.value) {
          setDropboxAppKey(dbAppKey.value);
        }
        const dbAppSecret = data['dropbox_app_secret'];
        if (dbAppSecret) {
          setDropboxIsConfigured(Boolean(dbAppSecret.isConfigured));
          setDropboxAppSecret(dbAppSecret.isConfigured ? '●●●●●●●●' : '');
        }
        const dbFolder = data['dropbox_folder_path'];
        if (dbFolder && dbFolder.value) {
          setDropboxFolderPath(dbFolder.value);
        }
      }
    } catch (err) {
      console.error('Failed to fetch settings:', err);
    } finally {
      setSettingsLoading(false);
    }
  };

  useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search);
    const code = searchParams.get('code');
    if (code) {
      const handleAuth = async () => {
        try {
          const res = await fetch(`${API_BASE}/api/settings/dropbox-auth`, {
            method: 'POST',
            headers: { ...authHeaders, 'Content-Type': 'application/json' },
            body: JSON.stringify({ code, redirectUri: window.location.origin + '/admin' })
          });
          const data = await res.json();
          if (res.ok) {
            setSettingsSuccess('Dropbox authorized successfully!');
            fetchSettings();
          } else {
            setSettingsError(data.error || 'Failed to authorize Dropbox');
          }
        } catch (err) {
          setSettingsError('Network error authorizing Dropbox');
        } finally {
          window.history.replaceState({}, document.title, window.location.pathname);
        }
      };
      handleAuth();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const handleTestDropbox = async () => {
    setDropboxTesting(true);
    setDropboxTestResult(null);

    try {
      const res = await fetch(`${API_BASE}/api/settings/test-dropbox`, {
        method: 'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          folderPath: dropboxFolderPath.trim(),
          appKey: dropboxAppKey.trim(),
          appSecret: dropboxAppSecret.trim()
        })
      });
      const data = await res.json();
      if (res.ok) {
        setDropboxTestResult({
          success: true,
          message: data.message || `Successfully connected to Dropbox folder!`,
          accountName: data.accountName
        });
      } else {
        setDropboxTestResult({
          success: false,
          message: data.error || 'Failed to connect to Dropbox'
        });
      }
    } catch (err: any) {
      setDropboxTestResult({
        success: false,
        message: err.message || 'Network error while testing Dropbox connection'
      });
    } finally {
      setDropboxTesting(false);
    }
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setSettingsSaving(true);
    setSettingsError('');
    setSettingsSuccess('');

    const min = parseFloat(thresholdMinutes);
    if (isNaN(min) || min < 0) {
      setSettingsError('Please enter a valid non-negative number of minutes.');
      setSettingsSaving(false);
      return;
    }

    const rounds = parseInt(maxMonthlyRounds, 10);
    if (isNaN(rounds) || rounds < 1) {
      setSettingsError('Please enter a valid positive number for maximum monthly test rounds.');
      setSettingsSaving(false);
      return;
    }

    const sec = Math.round(min * 60);

    try {
      // 1. Update consecutive failure threshold setting
      const res1 = await fetch(`${API_BASE}/api/settings`, {
        method: 'PUT',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          key: 'consecutive_failure_threshold_seconds',
          value: sec.toString()
        })
      });

      // 2. Update max monthly test rounds setting
      const res2 = await fetch(`${API_BASE}/api/settings`, {
        method: 'PUT',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          key: 'max_monthly_test_rounds',
          value: rounds.toString()
        })
      });

      // 3. Update Dropbox enabled flag
      const res3 = await fetch(`${API_BASE}/api/settings`, {
        method: 'PUT',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          key: 'dropbox_enabled',
          value: dropboxEnabled ? 'true' : 'false'
        })
      });

      // 4. Update Dropbox folder path
      const res4 = await fetch(`${API_BASE}/api/settings`, {
        method: 'PUT',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          key: 'dropbox_folder_path',
          value: dropboxFolderPath.trim()
        })
      });

      // 5. Update Dropbox App Key
      let res5Ok = true;
      if (dropboxAppKey.trim()) {
        const res5 = await fetch(`${API_BASE}/api/settings`, {
          method: 'PUT',
          headers: { ...authHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            key: 'dropbox_app_key',
            value: dropboxAppKey.trim()
          })
        });
        if (!res5.ok) res5Ok = false;
      }

      // 6. Update Dropbox App Secret
      let res6Ok = true;
      if (dropboxAppSecret.trim() && dropboxAppSecret !== '●●●●●●●●') {
        const res6 = await fetch(`${API_BASE}/api/settings`, {
          method: 'PUT',
          headers: { ...authHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            key: 'dropbox_app_secret',
            value: dropboxAppSecret.trim()
          })
        });
        if (res6.ok) {
          setDropboxIsConfigured(true);
          setDropboxAppSecret('●●●●●●●●');
        } else {
          res6Ok = false;
        }
      }

      if (!res1.ok || !res2.ok || !res3.ok || !res4.ok || !res5Ok || !res6Ok) {
        setSettingsError('Failed to save one or more settings');
      } else {
        setSettingsSuccess(`Settings successfully updated! Failure window: ${min}m, Max rounds: ${rounds}/mo, Dropbox Storage: ${dropboxEnabled ? 'Enabled' : 'Disabled'}.`);
      }
    } catch (err) {
      console.error('Save settings error:', err);
      setSettingsError('Network error while saving settings');
    } finally {
      setSettingsSaving(false);
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
          className={`tab-btn ${activeTab === 'backup' ? 'active' : ''}`}
          onClick={() => setActiveTab('backup')}
        >
          Backup / Restore
        </button>
        <button
          className={`tab-btn ${activeTab === 'settings' ? 'active' : ''}`}
          onClick={() => setActiveTab('settings')}
        >
          Settings
        </button>
      </div>

      {activeTab === 'upload' && (
        <div className="admin-section">
          <h3>Import Tests from Excel</h3>
          <p className="admin-hint">
          Each sheet tab becomes a test. Columns used: <strong>Step Description</strong> (or Test case), <strong>Success Symptom</strong> (or Expected Success, defaults to 'N/A' if omitted), and <strong>Points</strong> (defaults to 10 if missing).
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
                    <input
                      type="text"
                      value={importNames[t.id] ?? t.name}
                      onChange={e => setImportNames(prev => ({ ...prev, [t.id]: e.target.value }))}
                    />
                    <span> — {t.stepsCount} step(s)</span>
                  </li>
                ))}
              </ul>
              {importSaveError && <p className="error-msg">{importSaveError}</p>}
              {importSaveSuccess && <p className="success-msg">{importSaveSuccess}</p>}
              <button type="button" className="btn" disabled={importSaving} onClick={handleRenameImport} style={{ marginTop: '1rem' }}>
                {importSaving ? 'Saving...' : 'Save Names'}
              </button>
            </div>
          )}
        </div>
      )}

      {activeTab === 'users' && (
        <div className="admin-section">
          <h3>Create New User</h3>
          <form onSubmit={handleCreateUser} className="create-user-form" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: '1rem' }}>
            <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', width: '100%' }}>
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
            </div>
            <div style={{ display: 'flex', gap: '1.5rem', alignItems: 'center' }}>
              <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>Groups:</span>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={newUserGroups.includes('testers')}
                  onChange={() => setNewUserGroups(prev => prev.includes('testers') ? prev.filter(g => g !== 'testers') : [...prev, 'testers'])}
                />
                <span>Testers</span>
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={newUserGroups.includes('admins')}
                  onChange={() => setNewUserGroups(prev => prev.includes('admins') ? prev.filter(g => g !== 'admins') : [...prev, 'admins'])}
                />
                <span>Administrators</span>
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={newUserGroups.includes('developers')}
                  onChange={() => setNewUserGroups(prev => prev.includes('developers') ? prev.filter(g => g !== 'developers') : [...prev, 'developers'])}
                />
                <span>Developers</span>
              </label>
            </div>
            <button type="submit" className="btn" disabled={creatingUser || !newUsername.trim() || !newPassword.trim() || newUserGroups.length === 0}>
              {creatingUser ? 'Creating...' : 'Create User'}
            </button>
          </form>
          {userError && <p className="error-msg">{userError}</p>}
          {userSuccess && <p className="success-msg">{userSuccess}</p>}

          <h3 style={{ marginTop: '2rem' }}>Existing Users</h3>
          {users.length === 0 ? (
            <p className="admin-hint">No users yet.</p>
          ) : (
            <div className="users-list">
              {users.map(u => {
                const summary = userSummaries[u.id];
                const currentGroups = u.user_groups || (u.is_admin ? ['admins'] : ['testers']);
                return (
                  <div key={u.id} className="user-row" style={{ flexWrap: 'wrap' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                      <span className="user-row-name">{u.username}</span>
                      <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                        {['testers', 'admins', 'developers'].map(g => {
                          const isMember = currentGroups.includes(g);
                          return (
                            <label
                              key={g}
                              title={`Toggle ${g} group`}
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '0.25rem',
                                fontSize: '0.75rem',
                                padding: '0.15rem 0.5rem',
                                borderRadius: '12px',
                                border: '1px solid var(--border-color)',
                                background: isMember ? 'var(--accent-color, #4f46e5)' : 'transparent',
                                color: isMember ? '#fff' : 'inherit',
                                cursor: 'pointer'
                              }}
                            >
                              <input
                                type="checkbox"
                                checked={isMember}
                                onChange={() => handleToggleUserGroup(u, g)}
                                style={{ margin: 0, width: '12px', height: '12px' }}
                              />
                              {g}
                            </label>
                          );
                        })}
                      </div>
                    </div>
                    <div className="user-row-summary">
                      {summary ? (
                        <>
                          <span className="user-summary-badge" title="Assigned tests">{summary.assignedCount} assigned</span>
                          <span className="user-summary-badge user-summary-pass" title="Completed tests">{summary.completedCount} passed</span>
                          <span className="user-summary-badge user-summary-fail" title="Hard-stop failed tests">{summary.failedHardStopCount} failed</span>
                          <span className="user-summary-badge user-summary-rounds" title="Completed rounds">{summary.completedRounds} rounds</span>
                        </>
                      ) : userSummariesLoading ? (
                        <span className="admin-hint">Loading...</span>
                      ) : null}
                    </div>
                    <div className="user-row-actions">
                      <label className="suspend-toggle" title={u.isSuspended ? 'Unsuspend user' : 'Suspend user'}>
                        <input
                          type="checkbox"
                          checked={!!u.isSuspended}
                          onChange={() => toggleSuspension(u)}
                        />
                        <span>{u.isSuspended ? 'Suspended' : 'Active'}</span>
                      </label>
                      <button
                        className="btn-icon"
                        title="Pay points"
                        onClick={() => openPayPoints(u)}
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
                      </button>
                      <button
                        className="btn-icon"
                        title="View test history"
                        onClick={() => openHistory(u)}
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                      </button>
                      <button
                        className="btn-icon"
                        title="Manage user tests"
                        onClick={() => openUserDetail(u)}
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>
                      </button>
                      <button
                        className="btn-icon"
                        title="Change password"
                        onClick={() => openChangePassword(u)}
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                      </button>
                      <button
                        className="btn-danger"
                        onClick={() => openDeleteUser(u)}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                );
              })}
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
                  authHeaders={authHeaders}
                  onExpand={() => fetchTestSteps(test.id)}
                  onSaveStep={(step) => saveStep(test.id, step)}
                  onDeleteStep={(stepId) => deleteStep(test.id, stepId)}
                  onAddStep={(payload) => addStep(test.id, payload)}
                  onUploadAttachment={(stepId, file) => uploadStepAttachment(test.id, stepId, file)}
                  onRemoveAttachment={(stepId) => removeStepAttachment(test.id, stepId)}
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

      {activeTab === 'reports' && <ReportsView />}
      {false && activeTab === 'reports' && (
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

          {reportsSubTab === 'user' && (
            <>
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
                        <label className="searchable-option" onMouseDown={e => e.preventDefault()}>
                          <input
                            type="checkbox"
                            checked={reportUserIds.length === nonAdminUsers.length && nonAdminUsers.length > 0}
                            onChange={toggleAllUsers}
                          />
                          <strong>Select All Users</strong>
                        </label>
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
                                onChange={() => toggleUserSelect(u.id)}
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
                              if (reportVersionIds.length === versions.length) {
                                setReportVersionIds([]);
                              } else {
                                setReportVersionIds(versions.map(v => v.id));
                              }
                              setReportData(null);
                              setReportError('');
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
                                  setReportVersionIds(prev => {
                                    if (prev.includes(v.id)) {
                                      return prev.filter(id => id !== v.id);
                                    }
                                    return [...prev, v.id];
                                  });
                                  setReportData(null);
                                  setReportError('');
                                }}
                              />
                              {v.name} {v.is_current ? '(current)' : ''}
                            </label>
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
                  disabled={reportLoading || reportUserIds.length === 0 || reportVersionIds.length === 0 || !reportStartDate || !reportEndDate}
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
                    {reportData.versionIds && reportData.versionIds.length > 0 && (
                      <span className="report-version-tag">
                        Versions {reportData.versionIds.map((vid: number) => versions.find(v => v.id === vid)?.name || vid).join(', ')}
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
                              {test.fullyPassed && (
                                <span className="status-badge status-pass">FULLY PASSED</span>
                              )}
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
                                           <>
                                             <tr key={step.stepId} className="report-step-row-failed" style={{ cursor: 'pointer' }} onClick={() => toggleReportStepExpand(test.testId, step.stepId)}>
                                               <td className="step-num-cell">{step.stepNumber}</td>
                                               <td>{step.description}</td>
                                               <td><span className="status-badge status-fail">{step.fails}</span></td>
                                               <td>{step.rounds && step.rounds.length > 0 ? step.rounds.map((r: any) => `R${r}`).join(', ') : '—'}</td>
                                             </tr>
                                             {isStepOpen && step.submissions && step.submissions.length > 0 && (
                                               <tr key={`${step.stepId}-details`}>
                                                 <td colSpan={5} style={{ padding: '0', background: 'transparent' }}>
                                                   <div style={{ padding: '0.5rem 1rem' }}>
                                                     <table className="report-steps-table" style={{ width: '100%' }}>
                                                       <thead>
                                                         <tr>
                                                           <th>User</th>
                                                           <th>Round</th>
                                                           <th>Comment</th>
                                                           <th>Config File</th>
                                                           <th>Time</th>
                                                         </tr>
                                                       </thead>
                                                       <tbody>
                                                         {step.submissions.map((sub: any, idx: number) => (
                                                           <tr key={idx} className="report-step-row-failed">
                                                             <td><strong>{sub.userName || sub.username || sub.user_name || (sub.userId ? `User ${sub.userId}` : '—')}</strong></td>
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
                                                                   📥 Download
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
                                                   </div>
                                                 </td>
                                               </tr>
                                             )}
                                           </>
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

          {reportsSubTab === 'test' && (
            <>
              <h3>Test Report</h3>
               <p className="admin-hint">
                 Select tests, steps, and a date range to view how many times each test was run, how many passed/failed, and which users failed at which steps.
               </p>

              <div className="report-controls">
                <div className="report-selectors">
                   <div className="searchable-select">
                     <label>Tests</label>
                     <input
                       type="text"
                       className="user-input"
                       placeholder={testReportTestIds.length === 0 ? 'All Tests' : 'Search tests...'}
                       value={showTestDropdown ? testReportTestSearch : (testReportTestIds.length > 0 ? testReportTestIds.map(id => tests.find(t => t.id === id)?.name).filter(Boolean).join(', ') : 'All Tests')}
                       onChange={e => setTestReportTestSearch(e.target.value)}
                       onFocus={() => { setShowTestDropdown(true); setTestReportTestSearch(''); }}
                       onBlur={() => setTimeout(() => setShowTestDropdown(false), 150)}
                     />
                     {showTestDropdown && (
                       <div className="searchable-dropdown">
                         <label
                           className={`searchable-option ${testReportTestIds.length === 0 ? 'selected' : ''}`}
                           onMouseDown={e => e.preventDefault()}
                         >
                           <input
                             type="checkbox"
                             checked={testReportTestIds.length === 0}
                             onChange={() => {
                               if (testReportTestIds.length > 0) {
                                 setTestReportTestIds([]);
                                 setTestReportData(null);
                                 setTestReportError('');
                                 setTestReportSteps([]);
                                 setTestReportSelectedStepId(null);
                               }
                             }}
                           />
                           All Tests
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
                         {testReportSteps.length === 0 && testReportTestIds.length > 0 && (
                           <div className="searchable-no-results">No steps found</div>
                         )}
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
                                if (testReportVersionIds.length === versions.length) {
                                  setTestReportVersionIds([]);
                                } else {
                                  setTestReportVersionIds(versions.map(v => v.id));
                                }
                                setTestReportData(null);
                                setTestReportError('');
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
                                    setTestReportVersionIds(prev => {
                                      if (prev.includes(v.id)) {
                                        return prev.filter(id => id !== v.id);
                                      }
                                      return [...prev, v.id];
                                    });
                                    setTestReportData(null);
                                    setTestReportError('');
                                  }}
                                />
                                {v.name} {v.is_current ? '(current)' : ''}
                              </label>
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
                    {testReportData.versionIds && testReportData.versionIds.length > 0 && (
                      <span className="report-version-tag">
                        Versions {testReportData.versionIds.map((vid: number) => versions.find(v => v.id === vid)?.name || vid).join(', ')}
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
                                      {failedUsers.map((fu: any) => {
                                        const filteredSubs = (fu.submissions || []).filter((sub: any) => {
                                          if (!testReportLineSearch || testReportLineSearch.trim() === '' || testReportLineSearch.toLowerCase() === 'all lines') return true;
                                          const term = testReportLineSearch.toLowerCase().trim();
                                          return String(sub.stepNumber) === term ||
                                                 `line ${sub.stepNumber}`.includes(term) ||
                                                 `step ${sub.stepNumber}`.includes(term) ||
                                                 sub.description.toLowerCase().includes(term);
                                        });

                                        return filteredSubs.map((sub: any) => (
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
                                                  📥 Download
                                                </a>
                                              ) : (
                                                '—'
                                              )}
                                            </td>
                                            <td>{sub.executed_at ? new Date(sub.executed_at).toLocaleString() : '—'}</td>
                                          </tr>
                                        ));
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

          {reportsSubTab === 'passed' && (
            <>
              <h3>Passed Steps Report</h3>
               <p className="admin-hint">
                 Select tests, steps, and a date range to view passed steps that have comments or uploaded configuration files.
               </p>

               <div className="report-controls">
                 <div className="report-selectors">
                    <div className="searchable-select">
                      <label>Tests</label>
                      <input
                        type="text"
                        className="user-input"
                        placeholder={passedReportTestIds.length === 0 ? 'All Tests' : 'Search tests...'}
                        value={showPassedTestDropdown ? passedReportTestSearch : (passedReportTestIds.length > 0 ? passedReportTestIds.map(id => tests.find(t => t.id === id)?.name).filter(Boolean).join(', ') : 'All Tests')}
                        onChange={e => setPassedReportTestSearch(e.target.value)}
                        onFocus={() => { setShowPassedTestDropdown(true); setPassedReportTestSearch(''); }}
                        onBlur={() => setTimeout(() => setShowPassedTestDropdown(false), 150)}
                      />
                      {showPassedTestDropdown && (
                        <div className="searchable-dropdown">
                          <label
                            className={`searchable-option ${passedReportTestIds.length === 0 ? 'selected' : ''}`}
                            onMouseDown={e => e.preventDefault()}
                          >
                            <input
                              type="checkbox"
                              checked={passedReportTestIds.length === 0}
                              onChange={() => {
                                if (passedReportTestIds.length > 0) {
                                  setPassedReportTestIds([]);
                                  setPassedReportData(null);
                                  setPassedReportError('');
                                  setPassedReportSteps([]);
                                  setPassedReportSelectedStepId(null);
                                }
                              }}
                            />
                            All Tests
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
                                  onChange={() => togglePassedTestSelect(t.id)}
                                />
                                {t.name}
                              </label>
                            ))}
                          {tests.filter(t => t.name.toLowerCase().includes(passedReportTestSearch.toLowerCase())).length === 0 && (
                            <div className="searchable-no-results">No tests found</div>
                          )}
                        </div>
                      )}
                      {passedReportTestIds.length > 0 && (
                        <div className="selected-tags">
                          {passedReportTestIds.map(id => {
                            const t = tests.find(x => x.id === id);
                            return t ? (
                              <span key={id} className="selected-tag">
                                {t.name}
                                <button type="button" onClick={() => togglePassedTestSelect(id)}>×</button>
                              </span>
                            ) : null;
                          })}
                        </div>
                      )}
                    </div>

                    <div className="searchable-select">
                      <label>Steps</label>
                      <input
                        type="text"
                        className="user-input"
                        placeholder={passedReportSelectedStepId ? 'Search steps...' : 'All Steps'}
                        value={showPassedStepDropdown ? passedReportStepSearch : (passedReportSelectedStepId ? (() => {
                          for (const test of passedReportSteps) {
                            const step = test.steps.find((s: any) => s.id === passedReportSelectedStepId);
                            if (step) return `${test.testName} - Step ${step.step_number}`;
                          }
                          return '';
                        })() : 'All Steps')}
                        onChange={e => setPassedReportStepSearch(e.target.value)}
                        onFocus={() => { setShowPassedStepDropdown(true); setPassedReportStepSearch(''); fetchPassedReportSteps(); }}
                        onBlur={() => setTimeout(() => setShowPassedStepDropdown(false), 150)}
                      />
                      {showPassedStepDropdown && (
                        <div className="searchable-dropdown">
                          <div
                            className={`searchable-option ${passedReportSelectedStepId === null ? 'selected' : ''}`}
                            onMouseDown={e => e.preventDefault()}
                            onClick={() => setPassedReportSelectedStepId(null)}
                          >
                            All Steps
                          </div>
                          {passedReportSteps.map(test => (
                            test.steps.map((step: any) => (
                              <div
                                key={`${test.testId}-${step.id}`}
                                className={`searchable-option ${passedReportSelectedStepId === step.id ? 'selected' : ''}`}
                                onMouseDown={e => e.preventDefault()}
                                onClick={() => setPassedReportSelectedStepId(step.id)}
                              >
                                {test.testName} — Step {step.step_number}: {step.description}
                              </div>
                            ))
                          ))}
                          {passedReportSteps.length === 0 && passedReportTestIds.length > 0 && (
                            <div className="searchable-no-results">No steps found</div>
                          )}
                        </div>
                      )}
                    </div>

                     <div className="searchable-select">
                       <label>Versions</label>
                       <input
                         type="text"
                         className="user-input"
                         placeholder={passedReportVersionIds.length === 0 ? 'All Versions' : 'Search versions...'}
                         value={showPassedTestVersionDropdown ? passedReportVersionSearch : (passedReportVersionIds.length > 0 ? passedReportVersionIds.map(id => versions.find(v => v.id === id)?.name).filter(Boolean).join(', ') : 'All Versions')}
                         onChange={e => setPassedReportVersionSearch(e.target.value)}
                         onFocus={() => setShowPassedTestVersionDropdown(true)}
                         onBlur={() => setTimeout(() => setShowPassedTestVersionDropdown(false), 150)}
                       />
                       {showPassedTestVersionDropdown && (
                         <div className="searchable-dropdown">
                           <label className="searchable-option" onMouseDown={e => e.preventDefault()}>
                             <input
                               type="checkbox"
                               checked={passedReportVersionIds.length === versions.length && versions.length > 0}
                               onChange={() => {
                                 if (passedReportVersionIds.length === versions.length) {
                                   setPassedReportVersionIds([]);
                                 } else {
                                   setPassedReportVersionIds(versions.map(v => v.id));
                                 }
                                 setPassedReportData(null);
                                 setPassedReportError('');
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
                                     setPassedReportVersionIds(prev => {
                                       if (prev.includes(v.id)) {
                                         return prev.filter(id => id !== v.id);
                                       }
                                       return [...prev, v.id];
                                     });
                                     setPassedReportData(null);
                                     setPassedReportError('');
                                   }}
                                 />
                                 {v.name} {v.is_current ? '(current)' : ''}
                               </label>
                             ))}
                           {versions.filter(v => v.name.toLowerCase().includes(passedReportVersionSearch.toLowerCase())).length === 0 && (
                             <div className="searchable-no-results">No versions found</div>
                           )}
                         </div>
                       )}
                     </div>
                </div>

                <div className="report-presets">
                  <button
                    className={`btn-secondary report-preset-btn ${passedReportPreset === 'current_month' ? 'active' : ''}`}
                    onClick={() => {
                      setPassedReportPreset('current_month');
                      const dates = getDefaultReportDates('current_month');
                      setPassedReportStartDate(dates.start);
                      setPassedReportEndDate(dates.end);
                      setPassedReportData(null);
                      setPassedReportError('');
                    }}
                  >
                    Current Month
                  </button>
                  <button
                    className={`btn-secondary report-preset-btn ${passedReportPreset === 'last_month' ? 'active' : ''}`}
                    onClick={() => {
                      setPassedReportPreset('last_month');
                      const dates = getDefaultReportDates('last_month');
                      setPassedReportStartDate(dates.start);
                      setPassedReportEndDate(dates.end);
                      setPassedReportData(null);
                      setPassedReportError('');
                    }}
                  >
                    Last Month
                  </button>
                  <button
                    className={`btn-secondary report-preset-btn ${passedReportPreset === 'current_year' ? 'active' : ''}`}
                    onClick={() => {
                      setPassedReportPreset('current_year');
                      const dates = getDefaultReportDates('current_year');
                      setPassedReportStartDate(dates.start);
                      setPassedReportEndDate(dates.end);
                      setPassedReportData(null);
                      setPassedReportError('');
                    }}
                  >
                    Current Year
                  </button>
                  <button
                    className={`btn-secondary report-preset-btn ${passedReportPreset === 'last_year' ? 'active' : ''}`}
                    onClick={() => {
                      setPassedReportPreset('last_year');
                      const dates = getDefaultReportDates('last_year');
                      setPassedReportStartDate(dates.start);
                      setPassedReportEndDate(dates.end);
                      setPassedReportData(null);
                      setPassedReportError('');
                    }}
                  >
                    Last Year
                  </button>
                  <button
                    className={`btn-secondary report-preset-btn ${passedReportPreset === 'custom' ? 'active' : ''}`}
                    onClick={() => {
                      setPassedReportPreset('custom');
                      setPassedReportData(null);
                      setPassedReportError('');
                    }}
                  >
                    Custom
                  </button>
                </div>

                <div className="report-dates">
                  <input
                    type="date"
                    className="user-input"
                    value={passedReportStartDate}
                    onChange={e => { setPassedReportStartDate(e.target.value); setPassedReportPreset('custom'); setPassedReportData(null); setPassedReportError(''); }}
                  />
                  <span className="report-date-sep">to</span>
                  <input
                    type="date"
                    className="user-input"
                    value={passedReportEndDate}
                    onChange={e => { setPassedReportEndDate(e.target.value); setPassedReportPreset('custom'); setPassedReportData(null); setPassedReportError(''); }}
                  />
                </div>

                <button
                  className="btn"
                  onClick={fetchPassedReport}
                  disabled={passedReportLoading || passedReportVersionIds.length === 0 || !passedReportStartDate || !passedReportEndDate}
                >
                  {passedReportLoading ? 'Generating...' : 'Generate Report'}
                </button>
              </div>

              {passedReportError && <p className="error-msg">{passedReportError}</p>}

              {passedReportData && (
                <div className="report-results">
                  <h4>
                    Passed Steps Report ({passedReportData.startDate} — {passedReportData.endDate})
                    {passedReportData.versionIds && passedReportData.versionIds.length > 0 && (
                      <span className="report-version-tag">
                        Versions {passedReportData.versionIds.map((vid: number) => versions.find(v => v.id === vid)?.name || vid).join(', ')}
                      </span>
                    )}
                  </h4>

                  {passedReportData.tests.length === 0 ? (
                    <p className="admin-hint">No passed steps with comments or files in this period.</p>
                  ) : (
                    <div className="report-tests-list">
                      {passedReportData.tests.map((test: any) => {
                        const isOpen = expandedPassedReportTests.has(test.testId);
                        const passedUsers = test.passedUsers || [];
                        return (
                          <div key={test.testId} className="report-test-row">
                            <div className="report-test-header" onClick={() => togglePassedTestReportExpand(test.testId)}>
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
                                {passedUsers.length === 0 ? (
                                  <p className="admin-hint" style={{ padding: '0.5rem 1rem' }}>No passed steps with comments or files in this period.</p>
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
                                      {passedUsers.map((pu: any) => {
                                        return pu.submissions.map((sub: any) => (
                                          <tr key={`${pu.userId}-${sub.stepId}-${sub.roundId}-${sub.executed_at}`} className="report-step-row-passed">
                                            <td>{pu.userName}</td>
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
                                                  📥 Download
                                                </a>
                                              ) : (
                                                '—'
                                              )}
                                            </td>
                                            <td>{sub.executed_at ? new Date(sub.executed_at).toLocaleString() : '—'}</td>
                                          </tr>
                                        ));
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

          {reportsSubTab === 'points' && (
            <>
              <h3>Points Report</h3>
              <p className="admin-hint">
                Select a user (or leave it as All Users) and a date range to count the total points earned in that period.
              </p>

              <div className="report-controls">
                <div className="report-selectors">
                  <div className="searchable-select">
                    <label>Users</label>
                    <input
                      type="text"
                      className="user-input"
                      placeholder="Search users..."
                      value={showPointsUserDropdown ? pointsUserSearch : (pointsUserIds.length > 0 ? pointsUserIds.map(id => nonAdminUsers.find(x => x.id === id)?.username).filter(Boolean).join(', ') : 'All Users')}
                      onChange={e => setPointsUserSearch(e.target.value)}
                      onFocus={() => { setShowPointsUserDropdown(true); setPointsUserSearch(''); }}
                      onBlur={() => setTimeout(() => setShowPointsUserDropdown(false), 150)}
                    />
                    {showPointsUserDropdown && (
                      <div className="searchable-dropdown">
                        <label className="searchable-option" onMouseDown={e => e.preventDefault()}>
                          <input
                            type="checkbox"
                            checked={pointsUserIds.length === nonAdminUsers.length && nonAdminUsers.length > 0}
                            onChange={toggleAllPointsUsers}
                          />
                          <strong>All Users</strong>
                        </label>
                        {nonAdminUsers
                          .filter(u => u.username.toLowerCase().includes(pointsUserSearch.toLowerCase()))
                          .map(u => (
                            <label
                              key={u.id}
                              className={`searchable-option ${pointsUserIds.includes(u.id) ? 'selected' : ''}`}
                              onMouseDown={e => e.preventDefault()}
                            >
                              <input
                                type="checkbox"
                                checked={pointsUserIds.includes(u.id)}
                                onChange={() => togglePointsUserSelect(u.id)}
                              />
                              {u.username}
                            </label>
                          ))}
                        {nonAdminUsers.filter(u => u.username.toLowerCase().includes(pointsUserSearch.toLowerCase())).length === 0 && (
                          <div className="searchable-no-results">No users found</div>
                        )}
                      </div>
                    )}
                    {pointsUserIds.length > 0 && (
                      <div className="selected-tags">
                        {pointsUserIds.map(id => {
                          const u = nonAdminUsers.find(x => x.id === id);
                          return u ? (
                            <span key={id} className="selected-tag">
                              {u.username}
                              <button type="button" onClick={() => togglePointsUserSelect(id)}>×</button>
                            </span>
                          ) : null;
                        })}
                      </div>
                    )}
                  </div>
                </div>

                <div className="report-presets">
                  <button
                    className={`btn-secondary report-preset-btn ${pointsPreset === 'current_month' ? 'active' : ''}`}
                    onClick={() => handlePointsPresetChange('current_month')}
                  >
                    Current Month
                  </button>
                  <button
                    className={`btn-secondary report-preset-btn ${pointsPreset === 'last_month' ? 'active' : ''}`}
                    onClick={() => handlePointsPresetChange('last_month')}
                  >
                    Last Month
                  </button>
                  <button
                    className={`btn-secondary report-preset-btn ${pointsPreset === 'current_year' ? 'active' : ''}`}
                    onClick={() => handlePointsPresetChange('current_year')}
                  >
                    Current Year
                  </button>
                  <button
                    className={`btn-secondary report-preset-btn ${pointsPreset === 'last_year' ? 'active' : ''}`}
                    onClick={() => handlePointsPresetChange('last_year')}
                  >
                    Last Year
                  </button>
                  <button
                    className={`btn-secondary report-preset-btn ${pointsPreset === 'custom' ? 'active' : ''}`}
                    onClick={() => handlePointsPresetChange('custom')}
                  >
                    Custom
                  </button>
                </div>

                <div className="report-dates">
                  <input
                    type="date"
                    className="user-input"
                    value={pointsStartDate}
                    onChange={e => { setPointsStartDate(e.target.value); setPointsPreset('custom'); setPointsData(null); setPointsError(''); }}
                  />
                  <span className="report-date-sep">to</span>
                  <input
                    type="date"
                    className="user-input"
                    value={pointsEndDate}
                    onChange={e => { setPointsEndDate(e.target.value); setPointsPreset('custom'); setPointsData(null); setPointsError(''); }}
                  />
                </div>

                <button
                  className="btn"
                  onClick={fetchPointsReport}
                  disabled={pointsLoading || !pointsStartDate || !pointsEndDate}
                >
                  {pointsLoading ? 'Counting...' : 'Count Points'}
                </button>
              </div>

              {pointsError && <p className="error-msg">{pointsError}</p>}

              {pointsData && (
                <div className="report-results">
                  <h4>
                    Points earned {pointsUserIds.length === 0 ? 'for All Users' : 'for ' + pointsUserIds.map(id => nonAdminUsers.find(x => x.id === id)?.username).filter(Boolean).join(', ')}
                    {' '}({pointsData.startDate} — {pointsData.endDate})
                  </h4>

                  <div className="report-summary">
                    <div className="report-summary-card">
                      <span className="report-summary-value">{pointsData.totalPointsEarned}</span>
                      <span className="report-summary-label">Total Points Earned</span>
                    </div>
                    <div className="report-summary-card">
                      <span className="report-summary-value">{pointsData.totalSteps}</span>
                      <span className="report-summary-label">Steps Logged</span>
                    </div>
                  </div>

                  {pointsData.users.length === 0 ? (
                    <p className="admin-hint">No points earned in this period.</p>
                  ) : (
                    <table className="report-steps-table">
                      <thead>
                        <tr>
                          <th>User</th>
                          <th>Points Earned</th>
                          <th>Steps Logged</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(pointsData.users || []).map((u: any) => (
                          <tr key={u.userId}>
                            <td>{u.userName}</td>
                            <td><span className="status-badge status-pass">{u.pointsEarned}</span></td>
                            <td>{u.steps}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )}
            </>
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
      {detailUser && (
        <div className="modal-overlay" onClick={() => setDetailUser(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Manage Tests — {detailUser.username}</h3>
              <button className="modal-close" onClick={() => setDetailUser(null)}>✕</button>
            </div>
            <div className="modal-body">
              {detailUserLoading ? (
                <p className="admin-hint">Loading...</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                  <div>
                    <h4>Assigned Tests</h4>
                    {tests.filter(t => detailUserAssignments[t.id]).length === 0 ? (
                      <p className="admin-hint">No assigned tests.</p>
                    ) : (
                      <div className="selected-tags">
                        {tests.filter(t => detailUserAssignments[t.id]).map(t => (
                          <span key={t.id} className="selected-tag" style={{ border: '1px solid #ef444455', background: '#ef444412', color: '#ef4444' }}>
                            {t.name}
                            <button type="button" onClick={() => toggleDetailAssignment(t.id, true)}>×</button>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div>
                    <h4>Unassigned Tests</h4>
                    {tests.filter(t => !detailUserAssignments[t.id]).length === 0 ? (
                      <p className="admin-hint">All tests are assigned.</p>
                    ) : (
                      <div className="selected-tags">
                        {tests.filter(t => !detailUserAssignments[t.id]).map(t => (
                          <span key={t.id} className="selected-tag" style={{ border: '1px solid #10b98155', background: '#10b98112', color: '#10b981' }}>
                            {t.name}
                            <button type="button" onClick={() => toggleDetailAssignment(t.id, false)}>+</button>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      {passwordTarget && (
        <div className="modal-overlay" onClick={() => setPasswordTarget(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Change Password — {passwordTarget.username}</h3>
              <button className="modal-close" onClick={() => setPasswordTarget(null)}>✕</button>
            </div>
            <div className="modal-body">
              <form onSubmit={handleChangePassword} className="create-user-form">
                <input
                  type="password"
                  placeholder="New password"
                  className="user-input"
                  value={newUserPassword}
                  onChange={e => { setNewUserPassword(e.target.value); setPasswordError(''); setPasswordSuccess(''); }}
                  autoFocus
                />
                <button type="submit" className="btn" disabled={passwordLoading || !newUserPassword.trim()}>
                  {passwordLoading ? 'Saving...' : 'Update Password'}
                </button>
              </form>
              {passwordError && <p className="error-msg">{passwordError}</p>}
              {passwordSuccess && <p className="success-msg">{passwordSuccess}</p>}
            </div>
          </div>
        </div>
      )}

      {payPointsUser && (
        <div className="modal-overlay" onClick={() => setPayPointsUser(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Pay Points — {payPointsUser.username}</h3>
              <button className="modal-close" onClick={() => setPayPointsUser(null)}>✕</button>
            </div>
            <div className="modal-body">
              {payPointsLoading ? (
                <p>Loading points report...</p>
              ) : payPointsData ? (
                <div>
                  <div style={{ marginBottom: '1rem', display: 'flex', flexDirection: 'column', gap: '0.5rem', padding: '1rem', background: 'rgba(0,0,0,0.2)', borderRadius: '6px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span>Total Earned Points:</span>
                      <strong>{payPointsData.users?.[0]?.pointsEarned || 0}</strong>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span>Total Paid Points:</span>
                      <strong>{payPointsData.users?.[0]?.pointsPaid || 0}</strong>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--accent-color, #4f46e5)', borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '0.5rem', marginTop: '0.5rem' }}>
                      <span>Unpaid Points:</span>
                      <strong>{payPointsData.users?.[0]?.unpaidPoints || 0}</strong>
                    </div>
                  </div>
                  <form onSubmit={handlePayPointsSubmit} className="create-user-form" style={{ display: 'flex', gap: '1rem' }}>
                    <input
                      type="number"
                      step="1"
                      placeholder="Amount to pay"
                      className="user-input"
                      style={{ flex: 1 }}
                      value={payPointsAmount}
                      onChange={e => { setPayPointsAmount(e.target.value); setPayPointsError(''); setPayPointsSuccess(''); }}
                      autoFocus
                    />
                    <button type="submit" className="btn" disabled={payPointsSubmitting || !payPointsAmount}>
                      {payPointsSubmitting ? 'Confirming...' : 'Confirm Payment'}
                    </button>
                  </form>
                  {payPointsError && <p className="error-msg">{payPointsError}</p>}
                  {payPointsSuccess && <p className="success-msg">{payPointsSuccess}</p>}
                </div>
              ) : (
                <p className="error-msg">{payPointsError}</p>
              )}
            </div>
          </div>
        </div>
      )}

      {activeTab === 'settings' && (
        <div className="admin-section">
          <h3>System Settings</h3>
          <p className="admin-hint">
            Configure application-wide business rules and time thresholds.
          </p>

          {settingsLoading ? (
            <p className="admin-hint">Loading settings...</p>
          ) : (
            <div style={{ maxWidth: '780px', margin: '1rem 0' }}>
              <div
                style={{
                  background: 'var(--card-bg, #1e2433)',
                  border: '1px solid var(--border-color, #2d3748)',
                  borderRadius: '10px',
                  padding: '1.5rem',
                  boxShadow: '0 4px 12px rgba(0,0,0,0.15)'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
                  <h4 style={{ margin: 0, fontSize: '1.15rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <span>⏱️</span> Consecutive Cross-Test Failure Time Threshold
                  </h4>
                  <span
                    style={{
                      background: 'rgba(99, 179, 237, 0.15)',
                      color: 'var(--accent, #63b3ed)',
                      border: '1px solid rgba(99, 179, 237, 0.3)',
                      padding: '0.2rem 0.65rem',
                      borderRadius: '12px',
                      fontSize: '0.8rem',
                      fontWeight: 600
                    }}
                  >
                    Default: 3 Minutes
                  </span>
                </div>

                <div
                  style={{
                    background: 'rgba(235, 130, 60, 0.08)',
                    borderLeft: '4px solid #ed8936',
                    borderRadius: '6px',
                    padding: '1rem 1.1rem',
                    marginBottom: '1.5rem',
                    fontSize: '0.92rem',
                    lineHeight: '1.5'
                  }}
                >
                  <strong style={{ color: '#ed8936', display: 'block', marginBottom: '0.4rem' }}>
                    💡 What does this setting mean?
                  </strong>
                  <p style={{ margin: '0 0 0.5rem 0' }}>
                    When a tester user is executing tests in sequence:
                  </p>
                  <ul style={{ margin: '0 0 0.5rem 1.2rem', padding: 0 }}>
                    <li>
                      If the user submits a <strong>failed step</strong> in one test, and then fails a step in a <strong>different test</strong> within this time window (e.g. 3 minutes), the system assumes the user relied on or repeated the prior test's failure pattern.
                    </li>
                    <li>
                      <strong>0 Points Awarded:</strong> The points for the second failed step are zeroed out in the points ledger.
                    </li>
                    <li>
                      <strong>Audit Warning Logged:</strong> A warning entry is recorded in the audit log explaining that the cross-test step points were withheld due to rapid consecutive failures.
                    </li>
                  </ul>
                  <p style={{ margin: 0, color: 'var(--text-muted)' }}>
                    <em>Changing this threshold adjusts the time window (in minutes) required between cross-test step failures for points eligibility.</em>
                  </p>
                </div>

                <form onSubmit={handleSaveSettings}>
                  <div style={{ marginBottom: '1.75rem' }}>
                    <label style={{ display: 'block', fontWeight: 600, marginBottom: '0.4rem' }}>
                      Consecutive Failure Time Threshold (Minutes)
                    </label>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                      <input
                        type="number"
                        step="0.5"
                        min="0"
                        className="user-input"
                        style={{ width: '160px', fontSize: '1rem', padding: '0.5rem 0.75rem' }}
                        value={thresholdMinutes}
                        onChange={e => setThresholdMinutes(e.target.value)}
                        required
                      />
                      <span style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
                        minutes (= {Math.round((parseFloat(thresholdMinutes) || 0) * 60)} seconds)
                      </span>
                    </div>
                  </div>

                  <hr style={{ border: 'none', borderTop: '1px solid var(--border-color, #2d3748)', margin: '1.75rem 0' }} />

                  <div style={{ marginBottom: '1.25rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
                      <h4 style={{ margin: 0, fontSize: '1.15rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <span>🔒</span> Maximum Test Rounds per Month
                      </h4>
                      <span
                        style={{
                          background: 'rgba(99, 179, 237, 0.15)',
                          color: 'var(--accent, #63b3ed)',
                          border: '1px solid rgba(99, 179, 237, 0.3)',
                          padding: '0.2rem 0.65rem',
                          borderRadius: '12px',
                          fontSize: '0.8rem',
                          fontWeight: 600
                        }}
                      >
                        Default: 8 Rounds
                      </span>
                    </div>

                    <div
                      style={{
                        background: 'rgba(66, 153, 225, 0.08)',
                        borderLeft: '4px solid #4299e1',
                        borderRadius: '6px',
                        padding: '1rem 1.1rem',
                        marginBottom: '1.25rem',
                        fontSize: '0.92rem',
                        lineHeight: '1.5'
                      }}
                    >
                      <strong style={{ color: '#4299e1', display: 'block', marginBottom: '0.4rem' }}>
                        💡 What does this setting mean?
                      </strong>
                      <p style={{ margin: '0 0 0.5rem 0' }}>
                        Specifies the maximum number of times (rounds) a tester user can start or attempt a specific test within the current calendar month (started, completed, or stopped due to a failed step or new version).
                      </p>
                      <ul style={{ margin: '0 0 0.5rem 1.2rem', padding: 0 }}>
                        <li>
                          <strong>Automatic Test Locking:</strong> Once a user visits/attempts a specific test for this number of rounds in the current month, that test will be locked for the user, and the system automatically advances to the next available assigned test.
                        </li>
                        <li>
                          <strong>Global User Lock:</strong> If all assigned tests for a user reach this monthly limit, all tests become locked and a clear message is displayed to the tester: <em>"You have consumed all your allowed test rounds for this month. Please refer to management."</em>
                        </li>
                      </ul>
                    </div>

                    <label style={{ display: 'block', fontWeight: 600, marginBottom: '0.4rem' }}>
                      Maximum Test Rounds per Month (per test per user)
                    </label>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                      <input
                        type="number"
                        step="1"
                        min="1"
                        className="user-input"
                        style={{ width: '160px', fontSize: '1rem', padding: '0.5rem 0.75rem' }}
                        value={maxMonthlyRounds}
                        onChange={e => setMaxMonthlyRounds(e.target.value)}
                        required
                      />
                      <span style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
                        rounds per month per test
                      </span>
                    </div>
                  </div>

                  <hr style={{ border: 'none', borderTop: '1px solid var(--border-color, #2d3748)', margin: '1.75rem 0' }} />

                  {/* Dropbox Storage Configuration */}
                  <div style={{ marginBottom: '1.25rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
                      <h4 style={{ margin: 0, fontSize: '1.15rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <span>📦</span> Dropbox Attachment Storage
                      </h4>
                      <span
                        style={{
                          background: dropboxEnabled ? 'rgba(72, 187, 120, 0.15)' : 'rgba(160, 174, 192, 0.15)',
                          color: dropboxEnabled ? '#48bb78' : 'var(--text-muted, #a0aec0)',
                          border: `1px solid ${dropboxEnabled ? 'rgba(72, 187, 120, 0.3)' : 'rgba(160, 174, 192, 0.3)'}`,
                          padding: '0.2rem 0.65rem',
                          borderRadius: '12px',
                          fontSize: '0.8rem',
                          fontWeight: 600
                        }}
                      >
                        {dropboxEnabled ? '● Enabled' : '○ Disabled'}
                      </span>
                    </div>

                    <div
                      style={{
                        background: 'rgba(66, 153, 225, 0.08)',
                        borderLeft: '4px solid #4299e1',
                        borderRadius: '6px',
                        padding: '1rem 1.1rem',
                        marginBottom: '1.25rem',
                        fontSize: '0.92rem',
                        lineHeight: '1.5'
                      }}
                    >
                      <strong style={{ color: '#4299e1', display: 'block', marginBottom: '0.4rem' }}>
                        💡 Direct Dropbox Storage Architecture
                      </strong>
                      <p style={{ margin: 0 }}>
                        When enabled, all user uploaded attachments (ZIP files, PDFs, etc.) are automatically stored directly in your Dropbox account under the designated folder path. The database will only store file metadata, saving database bandwidth and cost.
                      </p>
                    </div>

                    <div style={{ marginBottom: '1.25rem' }}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', cursor: 'pointer', fontWeight: 600 }}>
                        <input
                          type="checkbox"
                          checked={dropboxEnabled}
                          onChange={e => setDropboxEnabled(e.target.checked)}
                          style={{ width: '18px', height: '18px', cursor: 'pointer' }}
                        />
                        <span>Enable Dropbox Storage for Uploaded Files</span>
                      </label>
                    </div>

                    {dropboxEnabled && (
                      <div
                        style={{
                          background: 'rgba(255, 255, 255, 0.03)',
                          border: '1px solid var(--border-color, #2d3748)',
                          borderRadius: '8px',
                          padding: '1.25rem',
                          marginTop: '1rem',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '1.25rem'
                        }}
                      >
                        <div>
                          <label style={{ display: 'block', fontWeight: 600, marginBottom: '0.4rem' }}>
                            Dropbox Target Folder Path <span style={{ color: '#e53e3e' }}>*</span>
                          </label>
                          <input
                            type="text"
                            className="user-input"
                            style={{ width: '100%', maxWidth: '400px' }}
                            placeholder="/QualityCheck_Uploads"
                            value={dropboxFolderPath}
                            onChange={e => setDropboxFolderPath(e.target.value)}
                            required={dropboxEnabled}
                          />
                          <small style={{ display: 'block', color: 'var(--text-muted)', fontSize: '0.8rem', marginTop: '0.25rem' }}>
                            Target folder in Dropbox (must start with a slash <code>/</code>). Files will be saved inside this directory.
                          </small>
                        </div>

                        <div>
                          <label style={{ display: 'block', fontWeight: 600, marginBottom: '0.4rem' }}>
                            Dropbox App Key (Client ID) <span style={{ color: '#e53e3e' }}>*</span>
                          </label>
                          <input
                            type="text"
                            className="user-input"
                            style={{ width: '100%', maxWidth: '400px' }}
                            placeholder="Enter Dropbox App Key"
                            value={dropboxAppKey}
                            onChange={e => setDropboxAppKey(e.target.value)}
                            required={dropboxEnabled}
                          />
                        </div>

                        <div>
                          <label style={{ display: 'block', fontWeight: 600, marginBottom: '0.4rem' }}>
                            Dropbox App Secret (Client Secret) <span style={{ color: '#e53e3e' }}>*</span>
                          </label>
                          <input
                            type="password"
                            className="user-input"
                            style={{ width: '100%', maxWidth: '400px' }}
                            placeholder={dropboxIsConfigured ? 'App Secret configured (●●●●●●●●). Enter new to replace.' : 'Enter Dropbox App Secret'}
                            value={dropboxAppSecret}
                            onChange={e => setDropboxAppSecret(e.target.value)}
                            required={dropboxEnabled && !dropboxIsConfigured}
                          />
                        </div>

                        <div style={{
                          background: 'rgba(0, 97, 254, 0.08)',
                          border: '1px solid rgba(0, 97, 254, 0.3)',
                          borderRadius: '6px',
                          padding: '0.9rem 1rem',
                          fontSize: '0.88rem'
                        }}>
                          <div style={{ fontWeight: 600, color: '#60a5fa', marginBottom: '0.4rem' }}>
                            📋 Required Dropbox App Console Configuration:
                          </div>
                          <div style={{ marginBottom: '0.5rem' }}>
                            1. In <a href="https://www.dropbox.com/developers/apps" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent, #63b3ed)', textDecoration: 'underline' }}>Dropbox App Console</a>, create an app with <strong>Scoped access</strong> and <strong>Full Dropbox</strong> access.
                          </div>
                          <div style={{ marginBottom: '0.5rem' }}>
                            2. In the <strong>Permissions</strong> tab, check: <code>files.content.write</code> and <code>files.content.read</code>.
                          </div>
                          <div style={{ marginBottom: '0.25rem' }}>
                            3. In the <strong>Settings</strong> tab under <strong>OAuth 2 → Redirect URIs</strong>, add this exact URL:
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.35rem' }}>
                            <code style={{ background: 'rgba(0,0,0,0.3)', padding: '0.3rem 0.6rem', borderRadius: '4px', fontSize: '0.85rem', color: '#90cdf4', flex: 1, wordBreak: 'break-all' }}>
                              {window.location.origin}/admin
                            </code>
                            <button
                              type="button"
                              className="btn-secondary"
                              style={{ padding: '0.25rem 0.6rem', fontSize: '0.8rem', whiteSpace: 'nowrap' }}
                              onClick={() => {
                                navigator.clipboard.writeText(`${window.location.origin}/admin`);
                                alert(`Copied to clipboard: ${window.location.origin}/admin`);
                              }}
                            >
                              📋 Copy URI
                            </button>
                          </div>
                        </div>

                        <div style={{ marginTop: '0.5rem', display: 'flex', flexWrap: 'wrap', gap: '0.75rem', alignItems: 'center' }}>
                          <button
                            type="button"
                            className="btn"
                            style={{ background: '#0061FE', borderColor: '#0061FE' }}
                            onClick={async () => {
                              if (!dropboxAppKey.trim()) {
                                alert('Please enter your Dropbox App Key first.');
                                return;
                              }
                              if (!dropboxIsConfigured && (!dropboxAppSecret.trim() || dropboxAppSecret === '●●●●●●●●')) {
                                alert('Please enter your Dropbox App Secret first.');
                                return;
                              }

                              // Auto-save settings before redirecting so key and secret are stored
                              try {
                                await fetch(`${API_BASE}/api/settings`, {
                                  method: 'PUT',
                                  headers: { ...authHeaders, 'Content-Type': 'application/json' },
                                  body: JSON.stringify({ key: 'dropbox_enabled', value: 'true' })
                                });
                                await fetch(`${API_BASE}/api/settings`, {
                                  method: 'PUT',
                                  headers: { ...authHeaders, 'Content-Type': 'application/json' },
                                  body: JSON.stringify({ key: 'dropbox_folder_path', value: dropboxFolderPath.trim() || '/QualityCheck_Uploads' })
                                });
                                await fetch(`${API_BASE}/api/settings`, {
                                  method: 'PUT',
                                  headers: { ...authHeaders, 'Content-Type': 'application/json' },
                                  body: JSON.stringify({ key: 'dropbox_app_key', value: dropboxAppKey.trim() })
                                });
                                if (dropboxAppSecret.trim() && dropboxAppSecret !== '●●●●●●●●') {
                                  await fetch(`${API_BASE}/api/settings`, {
                                    method: 'PUT',
                                    headers: { ...authHeaders, 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ key: 'dropbox_app_secret', value: dropboxAppSecret.trim() })
                                  });
                                }
                              } catch (e) {
                                console.warn('Could not pre-save settings before redirect', e);
                              }

                              const redirectUri = encodeURIComponent(`${window.location.origin}/admin`);
                              window.location.href = `https://www.dropbox.com/oauth2/authorize?client_id=${encodeURIComponent(dropboxAppKey.trim())}&response_type=code&token_access_type=offline&redirect_uri=${redirectUri}`;
                            }}
                          >
                            🔗 Connect & Authorize with Dropbox
                          </button>

                          <button
                            type="button"
                            className="btn-secondary"
                            onClick={handleTestDropbox}
                            disabled={dropboxTesting || !dropboxFolderPath.trim()}
                          >
                            {dropboxTesting ? '🔄 Testing...' : '🔌 Test Connection'}
                          </button>
                        </div>

                        {dropboxTestResult && (
                          <div
                            style={{
                              padding: '0.75rem 1rem',
                              borderRadius: '6px',
                              fontSize: '0.9rem',
                              background: dropboxTestResult.success ? 'rgba(72, 187, 120, 0.12)' : 'rgba(229, 62, 62, 0.12)',
                              border: `1px solid ${dropboxTestResult.success ? '#48bb78' : '#e53e3e'}`,
                              color: dropboxTestResult.success ? '#48bb78' : '#feb2b2'
                            }}
                          >
                            {dropboxTestResult.success ? '✅ ' : '❌ '}
                            {dropboxTestResult.message}
                            {dropboxTestResult.accountName && (
                              <div style={{ marginTop: '0.25rem', fontSize: '0.85rem' }}>
                                Account: <strong>{dropboxTestResult.accountName}</strong>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  <hr style={{ border: 'none', borderTop: '1px solid var(--border-color, #2d3748)', margin: '1.75rem 0' }} />

                  {settingsError && <p className="error-msg" style={{ marginBottom: '1rem' }}>{settingsError}</p>}
                  {settingsSuccess && (
                    <p className="success-msg" style={{ color: '#48bb78', marginBottom: '1rem', fontWeight: 500 }}>
                      ✅ {settingsSuccess}
                    </p>
                  )}

                  <button type="submit" className="btn" disabled={settingsSaving}>
                    {settingsSaving ? 'Saving...' : 'Save Settings'}
                  </button>
                  </form>
              </div>
            </div>
          )}
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

interface AutoResizeTextareaProps {
  value: string;
  onChange: (val: string) => void;
  className?: string;
  placeholder?: string;
  title?: string;
  disabled?: boolean;
}

const AutoResizeTextarea: React.FC<AutoResizeTextareaProps> = ({
  value,
  onChange,
  className,
  placeholder,
  title,
  disabled
}) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const adjustHeight = () => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const newHeight = Math.max(28, el.scrollHeight);
    el.style.height = `${newHeight}px`;
  };

  useLayoutEffect(() => {
    adjustHeight();
  }, [value]);

  return (
    <textarea
      ref={textareaRef}
      rows={1}
      value={value}
      onChange={e => onChange(e.target.value)}
      onInput={adjustHeight}
      className={className}
      placeholder={placeholder}
      title={title}
      disabled={disabled}
      style={{ overflowY: 'hidden', resize: 'none' }}
    />
  );
};

interface ManageTestRowProps {
  test: Test;
  steps: TestStepAdmin[] | undefined;
  loading: boolean;
  authHeaders: Record<string, string>;
  onExpand: () => void;
  onSaveStep: (step: TestStepAdmin) => void;
  onDeleteStep: (stepId: number) => void;
  onAddStep: (payload: { afterStepNumber: number | null; description: string; success_symptom: string; points: number; on_failure: string; attachmentFile?: File | null }) => void;
  onUploadAttachment: (stepId: number, file: File) => Promise<void>;
  onRemoveAttachment: (stepId: number) => Promise<void>;
  onDelete: () => void;
}

const ManageTestRow: React.FC<ManageTestRowProps> = ({ test, steps, loading, authHeaders, onExpand, onSaveStep, onDeleteStep, onAddStep, onUploadAttachment, onRemoveAttachment, onDelete }) => {
  const [open, setOpen] = useState(false);
  const [drafts, setDrafts] = useState<Record<number, { description: string; success_symptom: string; points: string; on_failure: string }>>({});
  const [uploadingStepId, setUploadingStepId] = useState<number | null>(null);

  // Add-step form state
  const [newDesc, setNewDesc] = useState('');
  const [newSuccessSymptom, setNewSuccessSymptom] = useState('N/A');
  const [newPoints, setNewPoints] = useState('0');
  const [newOnFailure, setNewOnFailure] = useState<'continue' | 'stop'>('stop');
  const [insertAfter, setInsertAfter] = useState<string>('end');
  const [newAttachmentFile, setNewAttachmentFile] = useState<File | null>(null);
  const newAttachmentInputRef = useRef<HTMLInputElement>(null);
  const [adding, setAdding] = useState(false);

  const handleToggle = () => {
    if (!open) onExpand();
    setOpen(o => !o);
  };

  const handleStepAttachmentChange = async (stepId: number, file: File) => {
    setUploadingStepId(stepId);
    try {
      await onUploadAttachment(stepId, file);
    } finally {
      setUploadingStepId(null);
    }
  };

  const getDraft = (step: TestStepAdmin) =>
    drafts[step.id] || {
      description: step.description,
      success_symptom: (step.success_symptom && step.success_symptom.trim()) ? step.success_symptom.trim() : 'N/A',
      points: String(step.points !== undefined && step.points !== null ? step.points : (step.value ?? 0)),
      on_failure: step.on_failure || 'stop'
    };

  const setDraft = (step: TestStepAdmin, patch: Partial<{ description: string; success_symptom: string; points: string; on_failure: string }>) =>
    setDrafts(prev => ({ ...prev, [step.id]: { ...getDraft(step), ...patch } }));

  const handleSave = (step: TestStepAdmin) => {
    const d = getDraft(step);
    const rawPts = d.points;
    const pts = isNaN(Number(rawPts)) ? 0 : Number(rawPts);
    onSaveStep({
      ...step,
      description: d.description,
      success_symptom: d.success_symptom.trim() || 'N/A',
      value: pts,
      points: pts,
      on_failure: d.on_failure
    });
  };

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newDesc.trim()) return;
    setAdding(true);
    try {
      const rawPts = newPoints;
      const pts = isNaN(Number(rawPts)) ? 0 : Number(rawPts);
      await onAddStep({
        afterStepNumber: insertAfter === 'end' ? null : parseFloat(insertAfter),
        description: newDesc,
        success_symptom: newSuccessSymptom.trim() || 'N/A',
        points: pts,
        on_failure: newOnFailure,
        attachmentFile: newAttachmentFile
      });
      setNewDesc('');
      setNewSuccessSymptom('N/A');
      setNewPoints('0');
      setNewOnFailure('stop');
      setInsertAfter('end');
      setNewAttachmentFile(null);
      if (newAttachmentInputRef.current) newAttachmentInputRef.current.value = '';
    } finally {
      setAdding(false);
    }
  };

  const sortedSteps = steps ? steps.slice().sort((a, b) => a.step_number - b.step_number) : steps;

  const downloadStepsCsv = async () => {
    try {
      let currentSteps = sortedSteps;
      if (!currentSteps || currentSteps.length === 0) {
        const res = await fetch(`${API_BASE}/api/tests/${test.id}`, { headers: authHeaders });
        if (!res.ok) return;
        const data = await res.json();
        currentSteps = (data.steps || []).slice().sort((a: any, b: any) => a.step_number - b.step_number);
      }
      if (!currentSteps || currentSteps.length === 0) return;

      const header = 'Step #,Description,Success Symptom,Points';
      const rows = currentSteps.map((s: any) => {
        const desc = String(s.description || '').replace(/"/g, '""');
        const symptom = String(s.success_symptom || 'N/A').replace(/"/g, '""');
        const stepNum = s.step_number ?? '';
        const points = s.points ?? s.value ?? 0;
        return `"${stepNum}","${desc}","${symptom}","${points}"`;
      });
      const csv = [header, ...rows].join('\n');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${String(test.name || 'test').replace(/[^a-z0-9_-]/gi, '_')}_steps.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Failed to download steps CSV:', err);
    }
  };

  return (
    <div className="assignment-row">
      <div className="assignment-header" onClick={handleToggle}>
        <span className="test-name">{test.name}</span>
        <span className="assignment-summary">
          {steps !== undefined ? `${steps.filter(s => Number(s.points) !== -1 && Number(s.value) !== -1).length} step(s)` : ''}
          {steps !== undefined && steps.length > 0
            ? ` • ${steps.reduce((sum, s) => sum + (Number(s.points) > 0 ? Number(s.points) : (Number(s.value) > 0 ? Number(s.value) : 0)), 0)} pts`
            : (test.totalPoints !== undefined && test.totalPoints > 0 ? ` • ${test.totalPoints} pts` : '')}
        </span>
        <button
          className="btn-icon"
          title="Download steps as CSV"
          onClick={e => { e.stopPropagation(); downloadStepsCsv(); }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
        </button>
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
                  <th className="step-num-cell">#</th>
                  <th className="step-desc-cell">Description</th>
                  <th className="step-symptom-cell">Success Symptom</th>
                  <th className="step-attachment-cell">Attachment</th>
                  <th className="step-points-cell">Points</th>
                  <th className="step-failure-cell">If Fails</th>
                  <th className="step-actions-cell">Actions</th>
                </tr>
              </thead>
              <tbody>
                {sortedSteps.map(step => {
                  const d = getDraft(step);
                  const isSection = Number(d.points) === -1 || (d.points === '' && Number(step.points) === -1);
                  return (
                    <tr key={step.id} className={isSection ? 'section-step-row' : ''}>
                      <td className="step-num-cell">
                        {step.step_number}
                        {isSection && <span className="section-badge-inline" title="Section Header (-1 points)">[SECTION]</span>}
                      </td>
                      <td className="step-desc-cell">
                        <AutoResizeTextarea
                          className="step-desc-input"
                          value={d.description}
                          onChange={val => setDraft(step, { description: val })}
                          placeholder="Step description"
                        />
                      </td>
                      <td className="step-symptom-cell">
                        <AutoResizeTextarea
                          className="step-symptom-input"
                          value={d.success_symptom}
                          onChange={val => setDraft(step, { success_symptom: val })}
                          placeholder={isSection ? 'N/A (Section Header)' : 'Success Symptom'}
                        />
                      </td>
                      <td className="step-attachment-cell">
                        {step.attachment_path ? (
                          <div className="attachment-control-group">
                            <a
                              href={`${API_BASE}${step.attachment_path}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="attachment-pill"
                              title={`Download ${step.attachment_name || 'attachment'}`}
                              download={step.attachment_name || true}
                            >
                              📎 {step.attachment_name || 'File'}
                            </a>
                            <label className="btn-icon-replace" title="Replace reference file">
                              🔄
                              <input
                                type="file"
                                style={{ display: 'none' }}
                                disabled={uploadingStepId === step.id}
                                onChange={e => {
                                  const f = e.target.files?.[0];
                                  if (f) handleStepAttachmentChange(step.id, f);
                                  e.target.value = '';
                                }}
                              />
                            </label>
                            <button
                              type="button"
                              className="btn-icon-remove"
                              title="Remove reference file"
                              onClick={() => onRemoveAttachment(step.id)}
                            >
                              ✕
                            </button>
                          </div>
                        ) : (
                          <label className="btn-upload-attachment" title="Upload reference file for this step">
                            {uploadingStepId === step.id ? '⏳ Uploading...' : '📎 Upload'}
                            <input
                              type="file"
                              style={{ display: 'none' }}
                              disabled={uploadingStepId === step.id}
                              onChange={e => {
                                const f = e.target.files?.[0];
                                if (f) handleStepAttachmentChange(step.id, f);
                                e.target.value = '';
                              }}
                            />
                          </label>
                        )}
                      </td>
                      <td className="step-points-cell">
                        <input
                          type="number"
                          min={-1}
                          className="points-input"
                          value={d.points}
                          onChange={e => setDraft(step, { points: e.target.value })}
                          title="Points (-1 for Section Header)"
                        />
                      </td>
                      <td className="step-failure-cell">
                        <select
                          className="failure-select"
                          value={d.on_failure}
                          onChange={e => setDraft(step, { on_failure: e.target.value })}
                          disabled={isSection}
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
            <div className="add-step-header-row">
              <h4>Add Step</h4>
              <div className="add-step-insert-row">
                <label>Insert after:</label>
                <select value={insertAfter} onChange={e => setInsertAfter(e.target.value)}>
                  <option value="end">At the end</option>
                  {sortedSteps && sortedSteps.map(s => (
                    <option key={s.id} value={s.step_number}>After step {s.step_number}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="add-step-fields-row">
              <AutoResizeTextarea
                placeholder="Step description"
                className="user-input add-step-desc-input"
                value={newDesc}
                onChange={val => setNewDesc(val)}
              />
              <AutoResizeTextarea
                placeholder="Success symptom (defaults to N/A)"
                className="user-input add-step-symptom-input"
                value={newSuccessSymptom}
                onChange={val => setNewSuccessSymptom(val)}
              />
              <input
                type="number"
                min={-1}
                placeholder="Pts"
                title="Points (-1 for Section Header)"
                className="user-input add-step-points-input"
                value={newPoints}
                onChange={e => setNewPoints(e.target.value)}
              />
              <select className="failure-select add-step-failure-select" value={newOnFailure} onChange={e => setNewOnFailure(e.target.value as 'continue' | 'stop')}>
                <option value="continue">Continue</option>
                <option value="stop">Hard Stop</option>
              </select>
            </div>

            <div className="add-step-bottom-row">
              <div className="add-step-attachment-inline">
                <label className="add-step-attachment-label">📎 Reference Attachment (optional):</label>
                <input
                  ref={newAttachmentInputRef}
                  type="file"
                  className="file-input-compact"
                  onChange={e => setNewAttachmentFile(e.target.files?.[0] || null)}
                />
              </div>
              <button type="submit" className="btn btn-sm add-step-btn" disabled={adding || !newDesc.trim()}>
                {adding ? 'Adding...' : '+ Add Step'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};

export default AdminPanel;
