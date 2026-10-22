import React, { useState, useEffect, useRef, useLayoutEffect, useMemo } from 'react';
import { useAuth } from '../context/AuthContext';
import { useApp } from '../context/AppContext';
import ReportsView from './ReportsView';

interface Test {
  id: number;
  name: string;
  description: string;
  totalPoints?: number;
  is_deleted?: number | boolean;
  app_id?: number;
}

interface User {
  id: number;
  username: string;
  is_admin: boolean;
  isSuspended: boolean;
  user_groups?: string[];
  api_keys?: ApiKeyItem[];
  assigned_apps?: number[];
  assigned_tests_by_app?: Record<number, number[]>;
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

interface ApiKeyItem {
  id: number;
  name: string;
  key_prefix: string;
  role: string;
  user_id: number;
  username: string;
  is_active: number;
  created_at: string;
  last_used_at: string | null;
  app_id?: number;
  app_name?: string;
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
  const { token, user } = useAuth();
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
  const [thresholdMinutes, setThresholdMinutes] = useState<string>('3');
  const [activeTab, setActiveTabState] = useState<'upload' | 'assign' | 'users' | 'manage' | 'disabled' | 'versions' | 'reports' | 'test-reports' | 'backup' | 'settings' | 'api-keys'>(() => {
    const saved = localStorage.getItem('qc_admin_active_tab');
    if (saved && ['upload', 'assign', 'users', 'manage', 'disabled', 'versions', 'reports', 'test-reports', 'backup', 'settings', 'api-keys'].includes(saved)) {
      return saved as any;
    }
    return 'upload';
  });

  const setActiveTab = (tab: 'upload' | 'assign' | 'users' | 'manage' | 'disabled' | 'versions' | 'reports' | 'test-reports' | 'backup' | 'settings' | 'api-keys') => {
    setActiveTabState(tab);
    localStorage.setItem('qc_admin_active_tab', tab);
  };
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

  // API Keys state for AI Agents and Developers
  const [apiKeys, setApiKeys] = useState<ApiKeyItem[]>([]);
  const [apiKeysLoading, setApiKeysLoading] = useState(false);
  const [keyName, setKeyName] = useState('');
  const [keyRole, setKeyRole] = useState<'tester' | 'developer' | 'admin'>('tester');
  const [keyUserMode, setKeyUserMode] = useState<'create' | 'existing'>('create');
  const [keyExistingUserId, setKeyExistingUserId] = useState<number | ''>('');
  const [keyCustomUsername, setKeyCustomUsername] = useState('');
  const [keyGenerating, setKeyGenerating] = useState(false);
  const [generatedRawKey, setGeneratedRawKey] = useState<string | null>(null);
  const [generatedKeyMeta, setGeneratedKeyMeta] = useState<ApiKeyItem | null>(null);
  const [apiKeySuccess, setApiKeySuccess] = useState('');
  const [apiKeyError, setApiKeyError] = useState('');
  const [copiedKey, setCopiedKey] = useState(false);
  const [userKeyModalData, setUserKeyModalData] = useState<{ username: string; rawKey: string; keyName: string; role: string } | null>(null);
  const [copiedUserKey, setCopiedUserKey] = useState(false);

  const {
    apps,
    archivedApps,
    currentApp,
    isAdminPanelMode,
    selectApp,
    selectAdminPanel,
    createApp,
    refreshApps,
    suspendApp,
    archiveApp,
    restoreApp,
    fetchArchivedApps
  } = useApp();

  // Scoped API Key creation app ID
  const [selectedKeyAppId, setSelectedKeyAppId] = useState<number>(1);

  // App Lifecycle Modals state
  const [suspendAppTarget, setSuspendAppTarget] = useState<any | null>(null);
  const [suspendingApp, setSuspendingApp] = useState(false);
  const [archiveAppTarget, setArchiveAppTarget] = useState<any | null>(null);
  const [archiveConfirmText, setArchiveConfirmText] = useState('');
  const [archivingApp, setArchivingApp] = useState(false);
  const [restoringAppId, setRestoringAppId] = useState<number | null>(null);

  const [globalTab, setGlobalTab] = useState<'apps' | 'users' | 'storage' | 'api-keys' | 'reports'>('apps');

  // Apps Overview State
  const [appStatsMap, setAppStatsMap] = useState<Record<number, any>>({});
  const [newAppName, setNewAppName] = useState('');
  const [newAppDescription, setNewAppDescription] = useState('');
  const [creatingApp, setCreatingApp] = useState(false);
  const [appCreateError, setAppCreateError] = useState('');
  const [appCreateSuccess, setAppCreateSuccess] = useState('');

  // Global Settings: User creation multi-app state
  const [newUserAppIds, setNewUserAppIds] = useState<number[]>([]);
  const [newUserCustomAssignments, setNewUserCustomAssignments] = useState<Record<number, number[]>>({});
  const [allAppTests, setAllAppTests] = useState<Record<number, Test[]>>({});
  const [customizeAppId, setCustomizeAppId] = useState<number | null>(null);

  // Global Settings: Existing user app assignments editing state
  const [editingUserAssignments, setEditingUserAssignments] = useState<User | null>(null);
  const [editUserAppIds, setEditUserAppIds] = useState<number[]>([]);
  const [editUserCustomAssignments, setEditUserCustomAssignments] = useState<Record<number, number[]>>({});
  const [savingUserAssignments, setSavingUserAssignments] = useState(false);
  const [editAssignmentsSuccess, setEditAssignmentsSuccess] = useState('');
  const [editAssignmentsError, setEditAssignmentsError] = useState('');
  const [customizeEditAppId, setCustomizeEditAppId] = useState<number | null>(null);

  const authHeaders = useMemo(() => {
    const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
    if (currentApp) {
      headers['x-app-id'] = String(currentApp.id);
    }
    return headers;
  }, [token, currentApp]);

  const fetchAllAppStats = async () => {
    if (!token || apps.length === 0) return;
    try {
      const res = await fetch(`${API_BASE}/api/apps/stats`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        setAppStatsMap(await res.json());
      }
    } catch (err) {
      console.error('Failed to fetch batch app stats:', err);
    }
  };

  const fetchAllAppTests = async () => {
    if (!token) return;
    try {
      const res = await fetch(`${API_BASE}/api/tests?appId=all`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        const data: Test[] = await res.json();
        const byApp: Record<number, Test[]> = {};
        for (const t of data) {
          const aid = t.app_id || 1;
          if (!byApp[aid]) byApp[aid] = [];
          byApp[aid].push(t);
        }
        setAllAppTests(byApp);
      }
    } catch {}
  };

  const handleCreateApp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newAppName.trim()) return;
    setCreatingApp(true);
    setAppCreateError('');
    setAppCreateSuccess('');
    try {
      const app = await createApp(newAppName.trim(), newAppDescription.trim());
      setAppCreateSuccess(`Application "${app.name}" created successfully!`);
      setNewAppName('');
      setNewAppDescription('');
      await refreshApps();
      fetchAllAppStats();
    } catch (err: any) {
      setAppCreateError(err.message || 'Failed to create application');
    } finally {
      setCreatingApp(false);
    }
  };

  const copyToClipboard = async (text: string): Promise<boolean> => {
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch (err) {
      console.warn('navigator.clipboard failed, falling back to execCommand', err);
    }
    try {
      const textArea = document.createElement('textarea');
      textArea.value = text;
      textArea.style.position = 'fixed';
      textArea.style.left = '-9999px';
      textArea.style.top = '-9999px';
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();
      const successful = document.execCommand('copy');
      document.body.removeChild(textArea);
      return successful;
    } catch (err) {
      console.error('execCommand copy failed', err);
      return false;
    }
  };

  const openEditUserAssignments = (u: User) => {
    setEditingUserAssignments(u);
    const assignedIds = (u.assigned_apps || [])
      .map((a: any) => typeof a === 'object' && a !== null ? Number(a.id) : Number(a))
      .filter((n: number) => !isNaN(n));
    setEditUserAppIds(assignedIds.length > 0 ? assignedIds : (apps.length > 0 ? [apps[0].id] : [1]));
    setEditUserCustomAssignments(u.assigned_tests_by_app || {});
    setEditAssignmentsError('');
    setEditAssignmentsSuccess('');
    setCustomizeEditAppId(null);
  };

  const handleSaveUserAssignments = async () => {
    if (!editingUserAssignments) return;
    setSavingUserAssignments(true);
    setEditAssignmentsError('');
    setEditAssignmentsSuccess('');
    try {
      const res = await fetch(`${API_BASE}/api/users/${editingUserAssignments.id}`, {
        method: 'PUT',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          appIds: editUserAppIds,
          testAssignmentsByApp: editUserCustomAssignments
        })
      });
      const data = await res.json();
      if (!res.ok) {
        setEditAssignmentsError(data.error || 'Failed to save assignments');
      } else {
        setEditAssignmentsSuccess('App and test assignments saved successfully!');
        setTimeout(() => {
          setEditingUserAssignments(null);
          setEditAssignmentsSuccess('');
        }, 1200);
        fetchUsers();
      }
    } catch {
      setEditAssignmentsError('Network error');
    } finally {
      setSavingUserAssignments(false);
    }
  };

  useEffect(() => {
    fetchTests();
    fetchUsers();
    fetchVersions();
    fetchSettings();
    fetchApiKeys();
    fetchAllAppTests();
    fetchAllAppStats();
    fetchArchivedApps();
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
  }, [token, currentApp?.id]);

  useEffect(() => {
    if (apps.length > 0) {
      fetchAllAppStats();
      if (newUserAppIds.length === 0) {
        setNewUserAppIds(apps.map(a => a.id));
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apps]);

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
        body: JSON.stringify({
          username: newUsername.trim(),
          password: newPassword,
          isAdmin,
          user_groups: newUserGroups,
          appIds: newUserAppIds.length > 0 ? newUserAppIds : [1],
          testAssignmentsByApp: newUserCustomAssignments
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setUserError(data.error || 'Failed to create user');
      } else {
        setUserSuccess(`User "${newUsername.trim()}" created successfully and assigned to selected applications.`);
        setNewUsername('');
        setNewPassword('');
        setNewUserGroups(['testers']);
        setNewUserAppIds(apps.map(a => a.id));
        setNewUserCustomAssignments({});
        setCustomizeAppId(null);
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

  const [enablingTestId, setEnablingTestId] = useState<number | null>(null);
  const [enableMessage, setEnableMessage] = useState<string>('');

  const refreshAssignments = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/tests/assignments/bulk`, { headers: authHeaders });
      if (res.ok) {
        setAssignments(await res.json());
      }
    } catch {
      // ignore
    }
  };

  const handleDisableTest = async (testId: number, testName: string) => {
    if (!window.confirm(`Disable test "${testName}"? It will be moved to the Disabled Tests tab and can be re-enabled at any time.`)) return;
    await fetch(`${API_BASE}/api/tests/${testId}`, { method: 'DELETE', headers: authHeaders });
    setTests(prev => prev.map(t => t.id === testId ? { ...t, is_deleted: 1 } : t));
    setManagedSteps(prev => { const n = { ...prev }; delete n[testId]; return n; });
  };

  const handleEnableTest = async (testId: number) => {
    setEnablingTestId(testId);
    setEnableMessage('');
    try {
      const res = await fetch(`${API_BASE}/api/tests/${testId}/enable`, {
        method: 'POST',
        headers: authHeaders
      });
      if (res.ok) {
        setTests(prev => prev.map(t => t.id === testId ? { ...t, is_deleted: 0 } : t));
        await refreshAssignments();
        setEnableMessage('Test enabled successfully and assigned to all users.');
        setTimeout(() => setEnableMessage(''), 4000);
      } else {
        const data = await res.json().catch(() => ({}));
        alert(data.error || 'Failed to enable test');
      }
    } catch {
      alert('Network error while enabling test');
    } finally {
      setEnablingTestId(null);
    }
  };

  const handleEnableAllTests = async () => {
    if (!window.confirm('Enable all disabled tests and assign all users to them by default?')) return;
    setEnablingTestId(-1);
    setEnableMessage('');
    try {
      const res = await fetch(`${API_BASE}/api/tests/enable-all`, {
        method: 'POST',
        headers: authHeaders
      });
      if (res.ok) {
        setTests(prev => prev.map(t => ({ ...t, is_deleted: 0 })));
        await refreshAssignments();
        setEnableMessage('All disabled tests enabled and assigned to all users.');
        setTimeout(() => setEnableMessage(''), 4000);
      } else {
        const data = await res.json().catch(() => ({}));
        alert(data.error || 'Failed to enable tests');
      }
    } catch {
      alert('Network error while enabling tests');
    } finally {
      setEnablingTestId(null);
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

  const fetchApiKeys = async () => {
    setApiKeysLoading(true);
    try {
      const url = (!isAdminPanelMode && currentApp)
        ? `${API_BASE}/api/api-keys?appId=${currentApp.id}`
        : `${API_BASE}/api/api-keys`;
      const res = await fetch(url, { headers: authHeaders });
      if (res.ok) {
        const data = await res.json();
        setApiKeys(Array.isArray(data) ? data : []);
      }
    } catch (err) {
      console.error('Failed to fetch API keys:', err);
    } finally {
      setApiKeysLoading(false);
    }
  };

  const handleGenerateApiKey = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!keyName.trim()) {
      setApiKeyError('Please enter a descriptive key name / agent identifier');
      return;
    }
    setKeyGenerating(true);
    setApiKeyError('');
    setApiKeySuccess('');
    try {
      const targetAppId = (!isAdminPanelMode && currentApp) ? currentApp.id : (selectedKeyAppId || 1);
      const payload: any = {
        name: keyName.trim(),
        role: keyRole,
        appId: targetAppId
      };
      if (keyUserMode === 'existing' && keyExistingUserId) {
        payload.userId = keyExistingUserId;
      } else if (keyCustomUsername.trim()) {
        payload.userName = keyCustomUsername.trim();
      } else {
        payload.userName = keyName.trim();
      }

      const res = await fetch(`${API_BASE}/api/api-keys`, {
        method: 'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to generate API key');
      }

      setGeneratedRawKey(data.key);
      setGeneratedKeyMeta(data.apiKey);
      setUserKeyModalData({
        username: data.apiKey?.username || payload.userName,
        rawKey: data.key,
        keyName: data.apiKey?.name || keyName.trim(),
        role: data.apiKey?.role || keyRole
      });
      setCopiedUserKey(false);
      setApiKeySuccess('API key generated successfully!');
      setKeyName('');
      setKeyCustomUsername('');
      fetchApiKeys();
      fetchUsers();
    } catch (err: any) {
      setApiKeyError(err.message || 'Error generating API key');
    } finally {
      setKeyGenerating(false);
    }
  };

  const handleToggleSuspend = async (target: any) => {
    setSuspendingApp(true);
    try {
      await suspendApp(target.id, !target.is_suspended);
      setSuspendAppTarget(null);
      await fetchAllAppStats();
    } catch (err: any) {
      alert(err.message || 'Failed to update suspension status');
    } finally {
      setSuspendingApp(false);
    }
  };

  const handleConfirmArchiveApp = async () => {
    if (!archiveAppTarget) return;
    if (archiveConfirmText.trim() !== archiveAppTarget.name) return;
    setArchivingApp(true);
    try {
      await archiveApp(archiveAppTarget.id);
      setArchiveAppTarget(null);
      setArchiveConfirmText('');
      await fetchAllAppStats();
    } catch (err: any) {
      alert(err.message || 'Failed to archive application');
    } finally {
      setArchivingApp(false);
    }
  };

  const handleRestoreApp = async (appId: number) => {
    setRestoringAppId(appId);
    try {
      await restoreApp(appId);
      await fetchAllAppStats();
    } catch (err: any) {
      alert(err.message || 'Failed to restore application');
    } finally {
      setRestoringAppId(null);
    }
  };

  const handleToggleApiKey = async (id: number) => {
    try {
      const res = await fetch(`${API_BASE}/api/api-keys/${id}/toggle`, {
        method: 'PATCH',
        headers: authHeaders
      });
      if (res.ok) {
        fetchApiKeys();
      } else {
        const data = await res.json();
        alert(data.error || 'Failed to update key status');
      }
    } catch (err) {
      console.error('Failed to toggle API key:', err);
    }
  };

  const handleRevokeUserKey = async (u: User) => {
    if (!window.confirm(`Are you sure you want to revoke the generated key for user "${u.username}"? The user will immediately be unable to logon through that key, but the user account, test assignments, and history will be preserved. You can generate another key for him later.`)) {
      return;
    }
    try {
      const res = await fetch(`${API_BASE}/api/users/${u.id}/revoke-key`, {
        method: 'DELETE',
        headers: authHeaders
      });
      const data = await res.json();
      if (res.ok) {
        setUserSuccess(data.message || `Key revoked for "${u.username}". User account preserved.`);
        fetchApiKeys();
        fetchUsers();
      } else {
        setUserError(data.error || 'Failed to revoke key');
      }
    } catch (err: any) {
      setUserError(err.message || 'Error revoking key');
    }
  };

  const handleGenerateKeyForUser = async (u: User) => {
    try {
      const userRole = u.is_admin ? 'admin' : (u.user_groups || []).includes('developers') ? 'developer' : 'tester';
      const targetAppId = (!isAdminPanelMode && currentApp) ? currentApp.id : 1;
      const res = await fetch(`${API_BASE}/api/users/${u.id}/generate-key`, {
        method: 'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: userRole, appId: targetAppId })
      });
      const data = await res.json();
      if (res.ok) {
        setUserKeyModalData({
          username: u.username,
          rawKey: data.key,
          keyName: data.apiKey?.name || `${u.username}-key`,
          role: data.apiKey?.role || userRole
        });
        setCopiedUserKey(false);
        setUserSuccess(`New key generated successfully for user "${u.username}"!`);
        fetchApiKeys();
        fetchUsers();
      } else {
        alert(data.error || 'Failed to generate key');
      }
    } catch (err: any) {
      alert(err.message || 'Error generating key');
    }
  };

  const handleDeleteApiKey = async (id: number, name: string) => {
    if (!window.confirm(`Are you sure you want to permanently revoke API key "${name}"? The user will no longer be able to logon through this key, but the user account, assignments, and test history will be preserved. You can generate another key for him later.`)) {
      return;
    }
    try {
      const res = await fetch(`${API_BASE}/api/api-keys/${id}`, {
        method: 'DELETE',
        headers: authHeaders
      });
      if (res.ok) {
        const data = await res.json();
        setApiKeySuccess(data.message || 'API key revoked successfully. User account preserved.');
        fetchApiKeys();
        fetchUsers();
      } else {
        const data = await res.json();
        alert(data.error || 'Failed to revoke API key');
      }
    } catch (err) {
      console.error('Failed to revoke API key:', err);
    }
  };

  const renderApiKeysManagement = (isAppMode: boolean) => {
    return (
      <div className="admin-section">
        <div style={{ marginBottom: '1.25rem' }}>
          <h3 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', margin: '0 0 0.5rem 0' }}>
            <span>🔑</span> {isAppMode ? `API Keys & Autonomous Agents — ${currentApp?.name || 'This App'}` : 'Global API Key Management & Developer Documentation'}
          </h3>
          <p className="admin-hint" style={{ margin: 0 }}>
            {isAppMode
              ? `Generate API keys scoped strictly to ${currentApp?.name || 'this application'}. Any AI bot user created here is assigned exclusively to this application and its active tests.`
              : 'Generate and manage scoped API keys for autonomous AI agents, developer scripts, and CI/CD tools. All test executions, yes/no step results, and file uploads performed with an API key are automatically attributed to the key’s assigned user identity.'}
          </p>
        </div>

        {/* REST API Documentation & Swagger UI Quick-Link */}
        <div
          style={{
            background: 'var(--card-bg, #1e2433)',
            border: '1px solid var(--border-color, #2d3748)',
            borderRadius: '10px',
            padding: '1.5rem',
            marginBottom: '1.5rem'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem' }}>
            <div style={{ flex: '1 1 300px' }}>
              <h4 style={{ margin: 0, fontSize: '1.15rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span>📚</span> Interactive REST API Documentation (Swagger UI)
              </h4>
              <p style={{ margin: '0.5rem 0 0 0', color: 'var(--text-muted, #a0aec0)', fontSize: '0.9rem', lineHeight: '1.5' }}>
                Explore complete OpenAPI 3.0 specifications with live execution testing for AI agents, developers, and CI/CD pipelines.
              </p>
            </div>
            <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
              <button
                type="button"
                className="btn-secondary"
                onClick={async () => {
                  try {
                    const res = await fetch(`${API_BASE}/api/docs/get_user_guide?token=${encodeURIComponent(token || '')}`, { headers: authHeaders });
                    if (!res.ok) { alert('Failed to download API user guide'); return; }
                    const blob = await res.blob();
                    const url = window.URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = 'QualityCheck_API_User_Guide.md';
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    window.URL.revokeObjectURL(url);
                  } catch { alert('Error downloading API user guide'); }
                }}
              >
                <span>📥 Download User Guide (.md)</span>
              </button>
              <a
                href={`/api/docs?token=${encodeURIComponent(token || '')}`}
                target="_blank"
                rel="noopener noreferrer"
                className="btn"
                style={{ textDecoration: 'none' }}
              >
                <span>🚀 Open Swagger UI</span>
                <span style={{ fontSize: '0.85rem' }}>↗</span>
              </a>
            </div>
          </div>
        </div>

        {/* Generate Scoped API Key Form */}
        <div
          style={{
            background: 'var(--card-bg, #1e2433)',
            border: '1px solid var(--border-color, #2d3748)',
            borderRadius: '10px',
            padding: '1.5rem',
            marginBottom: '1.5rem'
          }}
        >
          <h4 style={{ margin: '0 0 0.5rem 0', fontSize: '1.15rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span>➕</span> Generate Scoped API Key / AI Agent Key
          </h4>
          <p className="admin-hint" style={{ margin: '0 0 1.25rem 0' }}>
            Keys are cryptographically hashed and linked to a user identity. If creating a new AI bot, the user is automatically granted permission only to the designated application and its active tests.
          </p>

          <form onSubmit={handleGenerateApiKey} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1rem' }}>
              <div>
                <label style={{ display: 'block', fontWeight: 600, fontSize: '0.88rem', marginBottom: '0.35rem' }}>
                  Key Name / Agent Identifier <span style={{ color: '#e53e3e' }}>*</span>
                </label>
                <input
                  type="text"
                  placeholder="e.g. AI-Regression-Bot or CI-Runner"
                  className="user-input"
                  style={{ width: '100%' }}
                  value={keyName}
                  onChange={e => { setKeyName(e.target.value); setApiKeyError(''); setApiKeySuccess(''); }}
                  required
                />
              </div>

              <div>
                <label style={{ display: 'block', fontWeight: 600, fontSize: '0.88rem', marginBottom: '0.35rem' }}>
                  Role Permission <span style={{ color: '#e53e3e' }}>*</span>
                </label>
                <select
                  className="user-input"
                  style={{ width: '100%' }}
                  value={keyRole}
                  onChange={e => setKeyRole(e.target.value as any)}
                >
                  <option value="tester">Tester (Execute tests, step pass/fail, upload files)</option>
                  <option value="developer">Developer (Test execution + developer logs)</option>
                  <option value="admin">Administrator (Full API capabilities)</option>
                </select>
              </div>

              <div>
                <label style={{ display: 'block', fontWeight: 600, fontSize: '0.88rem', marginBottom: '0.35rem' }}>
                  Application Scope <span style={{ color: '#e53e3e' }}>*</span>
                </label>
                {isAppMode ? (
                  <div style={{
                    padding: '0.55rem 0.85rem',
                    background: 'rgba(59, 130, 246, 0.12)',
                    border: '1px solid #3b82f6',
                    borderRadius: '6px',
                    color: '#60a5fa',
                    fontWeight: 600,
                    fontSize: '0.9rem',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.4rem'
                  }}>
                    <span>📱</span> {currentApp?.name || 'TopStor'} (Locked to this application)
                  </div>
                ) : (
                  <select
                    className="user-input"
                    style={{ width: '100%' }}
                    value={selectedKeyAppId}
                    onChange={e => setSelectedKeyAppId(Number(e.target.value))}
                  >
                    {apps.map(a => (
                      <option key={a.id} value={a.id}>
                        📱 {a.name} {a.is_suspended ? '[Suspended]' : ''}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            </div>

            <div style={{ background: 'rgba(0,0,0,0.18)', borderRadius: '8px', padding: '1rem', border: '1px solid var(--border-color, #2d3748)' }}>
              <label style={{ display: 'block', fontWeight: 600, fontSize: '0.88rem', marginBottom: '0.5rem' }}>
                User Identity Association
              </label>
              <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer', fontSize: '0.88rem' }}>
                  <input
                    type="radio"
                    name={`keyUserMode_${isAppMode ? 'app' : 'global'}`}
                    value="create"
                    checked={keyUserMode === 'create'}
                    onChange={() => setKeyUserMode('create')}
                  />
                  <span>Create New Dedicated AI / Bot User</span>
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer', fontSize: '0.88rem' }}>
                  <input
                    type="radio"
                    name={`keyUserMode_${isAppMode ? 'app' : 'global'}`}
                    value="existing"
                    checked={keyUserMode === 'existing'}
                    onChange={() => setKeyUserMode('existing')}
                  />
                  <span>Attach Key to Existing User Account</span>
                </label>
              </div>

              {keyUserMode === 'create' ? (
                <div>
                  <input
                    type="text"
                    placeholder="Custom Bot Username (optional, defaults to Key Name)"
                    className="user-input"
                    style={{ maxWidth: '380px', width: '100%' }}
                    value={keyCustomUsername}
                    onChange={e => setKeyCustomUsername(e.target.value)}
                  />
                  <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.3rem' }}>
                    A dedicated bot user account will be created and assigned <strong>only</strong> to {isAppMode ? (currentApp?.name || 'this application') : 'the selected application'} and its active tests.
                  </div>
                </div>
              ) : (
                <div>
                  <select
                    className="user-input"
                    style={{ maxWidth: '380px', width: '100%' }}
                    value={keyExistingUserId}
                    onChange={e => setKeyExistingUserId(e.target.value ? Number(e.target.value) : '')}
                    required={keyUserMode === 'existing'}
                  >
                    <option value="">-- Select an Existing User --</option>
                    {users.map(u => (
                      <option key={u.id} value={u.id}>
                        {u.username} ({u.is_admin ? 'Admin' : (u.user_groups || []).join(', ') || 'tester'})
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
              <button
                type="submit"
                className="btn"
                disabled={keyGenerating || !keyName.trim() || (keyUserMode === 'existing' && !keyExistingUserId)}
                style={{ padding: '0.6rem 1.4rem' }}
              >
                {keyGenerating ? 'Generating...' : '+ Generate Scoped API Key'}
              </button>
            </div>

            {apiKeyError && <p className="error-msg" style={{ margin: 0 }}>{apiKeyError}</p>}
            {apiKeySuccess && <p className="success-msg" style={{ margin: 0 }}>{apiKeySuccess}</p>}
          </form>
        </div>

        {/* API Key Table */}
        <div
          style={{
            background: 'var(--card-bg, #1e2433)',
            border: '1px solid var(--border-color, #2d3748)',
            borderRadius: '10px',
            padding: '1.5rem'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.5rem' }}>
            <h4 style={{ margin: 0, fontSize: '1.15rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span>🔑</span> Active API Keys {isAppMode && currentApp ? `(${currentApp.name})` : ''}
            </h4>
            <button
              type="button"
              className="btn-secondary"
              style={{ fontSize: '0.85rem', padding: '0.3rem 0.75rem' }}
              onClick={fetchApiKeys}
              disabled={apiKeysLoading}
            >
              {apiKeysLoading ? 'Refreshing...' : '🔄 Refresh Keys'}
            </button>
          </div>

          {apiKeys.length === 0 ? (
            <p className="admin-hint">No API keys found for this application scope.</p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className="versions-table" style={{ width: '100%' }}>
                <thead>
                  <tr>
                    <th>Key Name</th>
                    <th>Prefix</th>
                    <th>App Scope</th>
                    <th>User Identity</th>
                    <th>Role</th>
                    <th>Created</th>
                    <th>Status</th>
                    <th style={{ textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {apiKeys.map(k => (
                    <tr key={k.id}>
                      <td><strong>{k.name}</strong></td>
                      <td><code>{k.key_prefix}</code></td>
                      <td>
                        <span style={{ fontSize: '0.85rem', color: '#63b3ed', fontWeight: 600 }}>
                          📱 {k.app_name || 'TopStor'}
                        </span>
                      </td>
                      <td>{k.username}</td>
                      <td><span className="user-summary-badge">{k.role}</span></td>
                      <td>{new Date(k.created_at).toLocaleDateString()}</td>
                      <td>
                        <span style={{ color: k.is_active ? '#48bb78' : '#a0aec0', fontWeight: 600 }}>
                          {k.is_active ? '● Active' : '○ Inactive'}
                        </span>
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <div style={{ display: 'inline-flex', gap: '0.4rem' }}>
                          <button
                            type="button"
                            className="btn-secondary"
                            style={{ padding: '0.2rem 0.5rem', fontSize: '0.8rem' }}
                            onClick={() => handleToggleApiKey(k.id)}
                          >
                            {k.is_active ? 'Disable' : 'Enable'}
                          </button>
                          <button
                            type="button"
                            className="btn-danger"
                            style={{ padding: '0.2rem 0.5rem', fontSize: '0.8rem' }}
                            onClick={() => handleDeleteApiKey(k.id, k.name)}
                          >
                            Revoke
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="admin-panel">
      {isAdminPanelMode ? (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
            <div>
              <h2 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                <span>⚙️</span> Global Admin Panel
              </h2>
              <p style={{ margin: '0.25rem 0 0 0', color: 'var(--text-muted, #a0aec0)', fontSize: '0.9rem' }}>
                Manage all applications, global user assignments, system storage, API keys, and multi-app reporting.
              </p>
            </div>
            {currentApp && (
              <button
                type="button"
                className="btn-secondary"
                style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.5rem 1rem' }}
                onClick={() => selectApp(currentApp.id)}
              >
                <span>📱</span> Return to {currentApp.name} Solution ➔
              </button>
            )}
          </div>

          <div className="admin-tabs" style={{ marginBottom: '1.5rem' }}>
            <button
              className={`tab-btn ${globalTab === 'apps' ? 'active' : ''}`}
              onClick={() => { setGlobalTab('apps'); fetchAllAppStats(); }}
            >
              📱 Applications ({apps.length})
            </button>
            <button
              className={`tab-btn ${globalTab === 'users' ? 'active' : ''}`}
              onClick={() => { setGlobalTab('users'); fetchUsers(); fetchAllAppTests(); }}
            >
              👥 Global User Settings
            </button>
            <button
              className={`tab-btn ${globalTab === 'storage' ? 'active' : ''}`}
              onClick={() => { setGlobalTab('storage'); fetchSettings(); }}
            >
              💾 Storage & Backup
            </button>
            <button
              className={`tab-btn ${globalTab === 'api-keys' ? 'active' : ''}`}
              onClick={() => { setGlobalTab('api-keys'); fetchApiKeys(); }}
              style={{ fontWeight: 600, color: globalTab === 'api-keys' ? '#63b3ed' : undefined }}
            >
              🔑 API Keys & Agents
            </button>
            <button
              className={`tab-btn ${globalTab === 'reports' ? 'active' : ''}`}
              onClick={() => setGlobalTab('reports')}
            >
              📊 Multi-App Reports
            </button>
          </div>

          {globalTab === 'apps' && (
            <div className="admin-section">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem', marginBottom: '1.5rem' }}>
                <div>
                  <h3 style={{ margin: 0 }}>Applications Overview</h3>
                  <p className="admin-hint" style={{ margin: '0.25rem 0 0 0' }}>
                    Each application encapsulates its own testing solution, versions, tests, steps, and assigned users.
                  </p>
                </div>
                <button
                  type="button"
                  className="btn-secondary"
                  style={{ fontSize: '0.85rem', padding: '0.4rem 0.8rem' }}
                  onClick={fetchAllAppStats}
                >
                  🔄 Refresh Stats
                </button>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '1.25rem', marginBottom: '2.5rem' }}>
                {apps.map(app => {
                  const stats = appStatsMap[app.id] || {};
                  const isSelected = currentApp?.id === app.id;
                  const isSuspended = Boolean(app.is_suspended);

                  return (
                    <div
                      key={app.id}
                      style={{
                        background: 'var(--card-bg, #1e2433)',
                        border: `1.5px solid ${isSuspended ? '#f59e0b' : isSelected ? '#3b82f6' : 'var(--border-color, #2d3748)'}`,
                        borderRadius: '10px',
                        padding: '1.25rem',
                        display: 'flex',
                        flexDirection: 'column',
                        justifyContent: 'space-between',
                        boxShadow: isSelected ? '0 0 15px rgba(59, 130, 246, 0.2)' : '0 4px 12px rgba(0,0,0,0.1)'
                      }}
                    >
                      <div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.5rem', marginBottom: '0.5rem' }}>
                          <h4 style={{ margin: 0, fontSize: '1.2rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                            <span>📱</span> {app.name}
                          </h4>
                          <div style={{ display: 'flex', gap: '0.35rem', alignItems: 'center', flexWrap: 'wrap' }}>
                            {isSuspended ? (
                              <span style={{ fontSize: '0.72rem', padding: '0.15rem 0.5rem', borderRadius: '10px', background: 'rgba(245, 158, 11, 0.2)', color: '#fbbf24', border: '1px solid #f59e0b', fontWeight: 600 }}>
                                ⏸️ Suspended
                              </span>
                            ) : (
                              <span style={{ fontSize: '0.72rem', padding: '0.15rem 0.5rem', borderRadius: '10px', background: 'rgba(72, 187, 120, 0.2)', color: '#48bb78', border: '1px solid #48bb78', fontWeight: 600 }}>
                                ● Active
                              </span>
                            )}
                            {isSelected && (
                              <span style={{ fontSize: '0.72rem', padding: '0.15rem 0.5rem', borderRadius: '10px', background: 'rgba(59, 130, 246, 0.2)', color: '#60a5fa', border: '1px solid #3b82f6' }}>
                                Selected
                              </span>
                            )}
                          </div>
                        </div>
                        <p style={{ margin: '0 0 1rem 0', color: 'var(--text-muted, #a0aec0)', fontSize: '0.88rem', minHeight: '38px' }}>
                          {app.description || 'No description provided.'}
                        </p>

                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.6rem', marginBottom: '1.25rem' }}>
                          <div style={{ background: 'rgba(0,0,0,0.2)', padding: '0.6rem', borderRadius: '6px' }}>
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Current Version</div>
                            <div style={{ fontWeight: 600, fontSize: '0.95rem', color: '#63b3ed' }}>
                              {stats.currentVersion || 'None set'}
                            </div>
                          </div>
                          <div style={{ background: 'rgba(0,0,0,0.2)', padding: '0.6rem', borderRadius: '6px' }}>
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Active Tests</div>
                            <div style={{ fontWeight: 600, fontSize: '0.95rem', color: '#48bb78' }}>
                              {stats.testsCount ?? 0} tests
                            </div>
                          </div>
                          <div style={{ background: 'rgba(0,0,0,0.2)', padding: '0.6rem', borderRadius: '6px' }}>
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Assigned Users</div>
                            <div style={{ fontWeight: 600, fontSize: '0.95rem', color: '#ecc94b' }}>
                              {stats.usersCount ?? 0} users
                            </div>
                          </div>
                          <div style={{ background: 'rgba(0,0,0,0.2)', padding: '0.6rem', borderRadius: '6px' }}>
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Total Executions</div>
                            <div style={{ fontWeight: 600, fontSize: '0.95rem', color: '#9f7aea' }}>
                              {stats.executionsCount ?? 0}
                            </div>
                          </div>
                        </div>
                      </div>

                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                        <button
                          type="button"
                          className="btn"
                          style={{ width: '100%', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '0.5rem', padding: '0.55rem' }}
                          onClick={() => selectApp(app.id)}
                        >
                          <span>Open App Solution</span>
                          <span>➔</span>
                        </button>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                          <button
                            type="button"
                            className="btn-secondary"
                            style={{ padding: '0.4rem', fontSize: '0.8rem', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '0.3rem' }}
                            onClick={() => setSuspendAppTarget(app)}
                          >
                            <span>{app.is_suspended ? '▶️ Resume' : '⏸️ Suspend'}</span>
                          </button>
                          <button
                            type="button"
                            className="btn-danger"
                            style={{ padding: '0.4rem', fontSize: '0.8rem', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '0.3rem' }}
                            onClick={() => { setArchiveAppTarget(app); setArchiveConfirmText(''); }}
                          >
                            <span>🗑️ Archive</span>
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))', gap: '1.5rem', alignItems: 'start' }}>
                {/* Create Application Card */}
                <div style={{ background: 'var(--card-bg, #1e2433)', border: '1px solid var(--border-color, #2d3748)', borderRadius: '10px', padding: '1.5rem' }}>
                  <h4 style={{ margin: '0 0 0.5rem 0', fontSize: '1.1rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                    <span>➕</span> Create New Application
                  </h4>
                  <p className="admin-hint" style={{ margin: '0 0 1rem 0' }}>
                    Create an application for a different product or module. You can then import tests, define versions, and assign users to it.
                  </p>

                  <form onSubmit={handleCreateApp} style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
                    <input
                      type="text"
                      placeholder="Application Name (e.g. TopStor V2, StorageHub)"
                      className="user-input"
                      value={newAppName}
                      onChange={e => { setNewAppName(e.target.value); setAppCreateError(''); setAppCreateSuccess(''); }}
                      required
                    />
                    <input
                      type="text"
                      placeholder="Description (optional)"
                      className="user-input"
                      value={newAppDescription}
                      onChange={e => setNewAppDescription(e.target.value)}
                    />
                    <button
                      type="submit"
                      className="btn"
                      disabled={creatingApp || !newAppName.trim()}
                      style={{ alignSelf: 'flex-start', padding: '0.55rem 1.25rem' }}
                    >
                      {creatingApp ? 'Creating...' : '+ Create Application'}
                    </button>
                  </form>
                  {appCreateError && <p className="error-msg" style={{ marginTop: '0.75rem' }}>{appCreateError}</p>}
                  {appCreateSuccess && <p className="success-msg" style={{ marginTop: '0.75rem' }}>{appCreateSuccess}</p>}
                </div>

                {/* Archived Applications (Archive Settings) */}
                <div style={{ background: 'var(--card-bg, #1e2433)', border: '1px solid var(--border-color, #2d3748)', borderRadius: '10px', padding: '1.5rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem', flexWrap: 'wrap', gap: '0.5rem' }}>
                    <h4 style={{ margin: 0, fontSize: '1.1rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                      <span>📦</span> Archived Applications (Archive Settings)
                    </h4>
                    <button
                      type="button"
                      className="btn-secondary"
                      style={{ fontSize: '0.75rem', padding: '0.25rem 0.55rem' }}
                      onClick={fetchArchivedApps}
                    >
                      🔄 Refresh Archive
                    </button>
                  </div>
                  <p className="admin-hint" style={{ margin: '0 0 1rem 0' }}>
                    Archiving performs a <strong>safe soft-delete</strong>. No records are deleted from the database. Archived apps are hidden from logon and reporting, and can be restored at any time.
                  </p>

                  {archivedApps.length === 0 ? (
                    <div style={{ padding: '1rem', background: 'rgba(0,0,0,0.15)', borderRadius: '6px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.88rem' }}>
                      No archived applications. All applications are active or suspended.
                    </div>
                  ) : (
                    <div style={{ overflowX: 'auto' }}>
                      <table className="versions-table" style={{ width: '100%', fontSize: '0.85rem' }}>
                        <thead>
                          <tr>
                            <th>Application</th>
                            <th>Archived Date</th>
                            <th style={{ textAlign: 'right' }}>Action</th>
                          </tr>
                        </thead>
                        <tbody>
                          {archivedApps.map(archived => (
                            <tr key={archived.id}>
                              <td>
                                <strong>📱 {archived.name}</strong>
                                {archived.description && (
                                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{archived.description}</div>
                                )}
                              </td>
                              <td>
                                {archived.deleted_at ? new Date(archived.deleted_at).toLocaleDateString() : 'Archived'}
                              </td>
                              <td style={{ textAlign: 'right' }}>
                                <button
                                  type="button"
                                  className="btn"
                                  style={{ fontSize: '0.78rem', padding: '0.25rem 0.6rem', background: '#38a169' }}
                                  onClick={() => handleRestoreApp(archived.id)}
                                  disabled={restoringAppId === archived.id}
                                >
                                  {restoringAppId === archived.id ? 'Restoring...' : '♻️ Restore'}
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {globalTab === 'users' && (
            <div className="admin-section">
              <h3>Create New User (Global)</h3>
              <p className="admin-hint">
                Users must be added here in Global Settings. Assign the user to one or more applications.
                By default, assigning an application automatically assigns all of that application's non-deleted tests.
              </p>

              <form onSubmit={handleCreateUser} className="create-user-form" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: '1.25rem' }}>
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

                {/* Application & Test Assignments */}
                <div style={{ width: '100%', background: 'rgba(0,0,0,0.15)', border: '1px solid var(--border-color)', borderRadius: '8px', padding: '1rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                    <div>
                      <span style={{ fontWeight: 600, fontSize: '0.95rem' }}>Assign to Applications & Tests:</span>
                      <p style={{ margin: '0.2rem 0 0 0', fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                        Selecting an app automatically assigns all non-deleted tests of that app by default.
                      </p>
                    </div>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                    {apps.map(app => {
                      const isAssigned = newUserAppIds.includes(app.id);
                      const appTests = (allAppTests[app.id] || []).filter(t => !t.is_deleted);
                      const customList = newUserCustomAssignments[app.id];
                      const isCustomized = Array.isArray(customList);
                      const isExpanded = customizeAppId === app.id;

                      return (
                        <div key={app.id} style={{ background: isAssigned ? 'rgba(59, 130, 246, 0.08)' : 'rgba(255,255,255,0.02)', border: `1px solid ${isAssigned ? '#3b82f6' : 'var(--border-color)'}`, borderRadius: '6px', padding: '0.75rem' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
                            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontWeight: 600 }}>
                              <input
                                type="checkbox"
                                checked={isAssigned}
                                onChange={() => {
                                  if (isAssigned) {
                                    setNewUserAppIds(prev => prev.filter(id => id !== app.id));
                                    setNewUserCustomAssignments(prev => {
                                      const next = { ...prev };
                                      delete next[app.id];
                                      return next;
                                    });
                                    if (customizeAppId === app.id) setCustomizeAppId(null);
                                  } else {
                                    setNewUserAppIds(prev => [...prev, app.id]);
                                  }
                                }}
                              />
                              <span>📱 {app.name}</span>
                            </label>

                            {isAssigned && (
                              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                <span style={{ fontSize: '0.75rem', padding: '0.15rem 0.5rem', borderRadius: '10px', background: isCustomized ? 'rgba(237, 137, 54, 0.15)' : 'rgba(72, 187, 120, 0.15)', color: isCustomized ? '#ed8936' : '#48bb78' }}>
                                  {isCustomized ? `Custom: ${customList.length}/${appTests.length} tests` : `✓ Default: All ${appTests.length} tests`}
                                </span>
                                <button
                                  type="button"
                                  className="btn-secondary"
                                  style={{ fontSize: '0.75rem', padding: '0.2rem 0.5rem' }}
                                  onClick={() => setCustomizeAppId(isExpanded ? null : app.id)}
                                >
                                  {isExpanded ? '▲ Done' : '▼ Customize Tests'}
                                </button>
                              </div>
                            )}
                          </div>

                          {isAssigned && isExpanded && (
                            <div style={{ marginTop: '0.75rem', paddingTop: '0.75rem', borderTop: '1px solid var(--border-color)' }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                                <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Customize tests for {app.name}:</span>
                                <div style={{ display: 'flex', gap: '0.4rem' }}>
                                  <button
                                    type="button"
                                    className="btn-secondary"
                                    style={{ fontSize: '0.72rem', padding: '0.15rem 0.4rem' }}
                                    onClick={() => setNewUserCustomAssignments(prev => ({ ...prev, [app.id]: appTests.map(t => t.id) }))}
                                  >
                                    Select All
                                  </button>
                                  <button
                                    type="button"
                                    className="btn-secondary"
                                    style={{ fontSize: '0.72rem', padding: '0.15rem 0.4rem' }}
                                    onClick={() => setNewUserCustomAssignments(prev => ({ ...prev, [app.id]: [] }))}
                                  >
                                    Deselect All
                                  </button>
                                  {isCustomized && (
                                    <button
                                      type="button"
                                      className="btn-secondary"
                                      style={{ fontSize: '0.72rem', padding: '0.15rem 0.4rem' }}
                                      onClick={() => setNewUserCustomAssignments(prev => {
                                        const next = { ...prev };
                                        delete next[app.id];
                                        return next;
                                      })}
                                    >
                                      Reset to Default
                                    </button>
                                  )}
                                </div>
                              </div>

                              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '0.4rem', maxHeight: '160px', overflowY: 'auto', padding: '0.2rem' }}>
                                {appTests.map(t => {
                                  const currentList = isCustomized ? customList : appTests.map(x => x.id);
                                  const isChecked = currentList.includes(t.id);
                                  return (
                                    <label key={t.id} style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.8rem', padding: '0.3rem', borderRadius: '4px', background: isChecked ? 'rgba(59, 130, 246, 0.12)' : 'rgba(0,0,0,0.1)', cursor: 'pointer' }}>
                                      <input
                                        type="checkbox"
                                        checked={isChecked}
                                        onChange={() => {
                                          const current = isCustomized ? [...customList] : appTests.map(x => x.id);
                                          const next = isChecked ? current.filter(id => id !== t.id) : [...current, t.id];
                                          setNewUserCustomAssignments(prev => ({ ...prev, [app.id]: next }));
                                        }}
                                      />
                                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={t.name}>{t.name}</span>
                                    </label>
                                  );
                                })}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>

                <button type="submit" className="btn" disabled={creatingUser || !newUsername.trim() || !newPassword.trim() || newUserGroups.length === 0 || newUserAppIds.length === 0}>
                  {creatingUser ? 'Creating...' : 'Create User'}
                </button>
              </form>
              {userError && <p className="error-msg">{userError}</p>}
              {userSuccess && <p className="success-msg">{userSuccess}</p>}

              <h3 style={{ marginTop: '2.5rem' }}>All System Users</h3>
              <p className="admin-hint">View all registered users, their roles, and assigned applications.</p>
              {users.length === 0 ? (
                <p className="admin-hint">No users yet.</p>
              ) : (
                <div className="users-list">
                  {users.map(u => {
                    const currentGroups = u.user_groups || (u.is_admin ? ['admins'] : ['testers']);
                    const userActiveKeys = (u.api_keys && u.api_keys.length > 0)
                      ? u.api_keys.filter(k => k.is_active)
                      : apiKeys.filter(k => k.user_id === u.id && k.is_active);
                    const hasActiveKey = userActiveKeys.length > 0;

                    return (
                      <div key={u.id} className="user-row" style={{ flexWrap: 'wrap' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                          <span className="user-row-name" style={{ fontWeight: 600, fontSize: '1rem' }}>{u.username}</span>
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

                        {/* Assigned Apps Badges */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
                          {u.is_admin ? (
                            <span className="user-summary-badge" style={{ background: 'rgba(99, 179, 237, 0.15)', color: '#63b3ed', border: '1px solid rgba(99, 179, 237, 0.3)' }}>
                              👑 All Apps (Admin)
                            </span>
                          ) : (
                            (u.assigned_apps && u.assigned_apps.length > 0) ? (
                              u.assigned_apps.map((appItem: any) => {
                                const appId = typeof appItem === 'object' && appItem !== null ? Number(appItem.id) : Number(appItem);
                                const appObj = apps.find(a => a.id === appId) || (typeof appItem === 'object' ? appItem : null);
                                const appName = appObj?.name || `App #${appId}`;
                                return (
                                  <span key={appId} className="user-summary-badge" style={{ background: 'rgba(59, 130, 246, 0.12)', color: '#60a5fa', border: '1px solid rgba(59, 130, 246, 0.3)' }}>
                                    📱 {appName}
                                  </span>
                                );
                              })
                            ) : (
                              <span className="user-summary-badge" style={{ color: 'var(--text-muted)' }}>No Apps</span>
                            )
                          )}
                          {!u.is_admin && hasActiveKey && (
                            <span className="user-summary-badge" style={{ background: 'rgba(72, 187, 120, 0.15)', color: '#48bb78', border: '1px solid rgba(72, 187, 120, 0.4)' }} title={`Active Key: ${userActiveKeys[0].key_prefix}`}>
                              🔑 {userActiveKeys[0].key_prefix}
                            </span>
                          )}
                        </div>

                        <div className="user-row-actions">
                          <button
                            type="button"
                            className="btn-secondary"
                            style={{ padding: '0.25rem 0.65rem', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '0.35rem', whiteSpace: 'nowrap' }}
                            title="Manage assigned applications and test permissions"
                            onClick={() => openEditUserAssignments(u)}
                          >
                            <span>📱</span> Apps & Tests
                          </button>
                          {!u.is_admin && hasActiveKey && (
                            <button
                              type="button"
                              className="btn-danger"
                              style={{ padding: '0.22rem 0.55rem', fontSize: '0.78rem', whiteSpace: 'nowrap' }}
                              title="Revoke generated key"
                              onClick={() => handleRevokeUserKey(u)}
                            >
                              Revoke Key
                            </button>
                          )}
                          {!u.is_admin && (
                            <button
                              type="button"
                              className="btn-secondary"
                              style={{ padding: '0.22rem 0.55rem', fontSize: '0.78rem', whiteSpace: 'nowrap' }}
                              onClick={() => handleGenerateKeyForUser(u)}
                            >
                              {hasActiveKey ? "New Key" : "+ Key"}
                            </button>
                          )}
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

          {globalTab === 'storage' && (
            <div className="admin-section">
              <h3>System Storage & Backup</h3>
              <p className="admin-hint">
                Configure cloud attachment storage (Dropbox) and generate full database backups.
              </p>

              {/* Dropbox Storage Configuration */}
              <div
                style={{
                  background: 'var(--card-bg, #1e2433)',
                  border: '1px solid var(--border-color, #2d3748)',
                  borderRadius: '10px',
                  padding: '1.5rem',
                  marginBottom: '2rem'
                }}
              >
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

                <form onSubmit={handleSaveSettings}>
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
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginBottom: '1.25rem' }}>
                      <div>
                        <label style={{ display: 'block', fontWeight: 600, marginBottom: '0.4rem' }}>
                          Dropbox Target Folder Path
                        </label>
                        <input
                          type="text"
                          className="user-input"
                          style={{ width: '100%', maxWidth: '400px' }}
                          value={dropboxFolderPath}
                          onChange={e => setDropboxFolderPath(e.target.value)}
                          placeholder="/QualityCheck_Uploads"
                        />
                      </div>
                      <div>
                        <label style={{ display: 'block', fontWeight: 600, marginBottom: '0.4rem' }}>
                          Dropbox App Key
                        </label>
                        <input
                          type="text"
                          className="user-input"
                          style={{ width: '100%', maxWidth: '400px' }}
                          value={dropboxAppKey}
                          onChange={e => setDropboxAppKey(e.target.value)}
                        />
                      </div>
                      <div>
                        <label style={{ display: 'block', fontWeight: 600, marginBottom: '0.4rem' }}>
                          Dropbox App Secret
                        </label>
                        <input
                          type="password"
                          className="user-input"
                          style={{ width: '100%', maxWidth: '400px' }}
                          placeholder={dropboxIsConfigured ? 'App Secret configured. Enter new to replace.' : 'Enter Secret'}
                          value={dropboxAppSecret}
                          onChange={e => setDropboxAppSecret(e.target.value)}
                        />
                      </div>
                    </div>
                  )}

                  <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
                    <button type="submit" className="btn" disabled={settingsSaving}>
                      {settingsSaving ? 'Saving...' : 'Save Storage Settings'}
                    </button>
                    {dropboxEnabled && (
                      <button
                        type="button"
                        className="btn-secondary"
                        onClick={handleTestDropbox}
                        disabled={dropboxTesting}
                      >
                        {dropboxTesting ? 'Testing...' : '⚡ Test Dropbox'}
                      </button>
                    )}
                  </div>
                  {settingsSuccess && <p className="success-msg" style={{ marginTop: '0.75rem' }}>{settingsSuccess}</p>}
                  {settingsError && <p className="error-msg" style={{ marginTop: '0.75rem' }}>{settingsError}</p>}
                </form>
              </div>

              {/* Full System Backup & Restore */}
              <div
                style={{
                  background: 'var(--card-bg, #1e2433)',
                  border: '1px solid var(--border-color, #2d3748)',
                  borderRadius: '10px',
                  padding: '1.5rem'
                }}
              >
                <h4 style={{ margin: '0 0 0.5rem 0', fontSize: '1.15rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <span>💾</span> Backup & Restore All System Data
                </h4>
                <p className="admin-hint" style={{ margin: '0 0 1rem 0' }}>
                  Download a JSON backup containing all apps, users, tests, steps, results, points, and attachments, or restore a previous snapshot.
                </p>

                <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '1.5rem' }}>
                  <button className="btn" onClick={handleBackupExport} disabled={backupLoading}>
                    {backupLoading ? 'Preparing...' : '📥 Download Backup'}
                  </button>
                </div>

                <h5 style={{ margin: '1rem 0 0.5rem 0', fontSize: '1rem' }}>Restore from File:</h5>
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
                {backupError && <p className="error-msg" style={{ marginTop: '0.75rem' }}>{backupError}</p>}
                {backupMessage && <p className="success-msg" style={{ marginTop: '0.75rem' }}>{backupMessage}</p>}
              </div>
            </div>
          )}

          {globalTab === 'api-keys' && renderApiKeysManagement(false)}

          {globalTab === 'reports' && (
            <ReportsView />
          )}
        </>
      ) : (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
            <div>
              <h2 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                <span>📱</span> App Solution: {currentApp?.name || 'TopStor'}
                {currentApp?.is_suspended ? (
                  <span style={{ fontSize: '0.8rem', padding: '0.2rem 0.6rem', borderRadius: '12px', background: 'rgba(245, 158, 11, 0.25)', color: '#fbbf24', border: '1px solid #f59e0b', fontWeight: 600 }}>
                    ⏸️ SUSPENDED
                  </span>
                ) : null}
              </h2>
              <p style={{ margin: '0.25rem 0 0 0', color: 'var(--text-muted, #a0aec0)', fontSize: '0.9rem' }}>
                {currentApp?.description || `Manage tests, versions, users, and execution for ${currentApp?.name || 'this application'}.`}
              </p>
            </div>
            {(user?.isAdmin || (user as any)?.is_admin) && (
              <button
                type="button"
                className="btn-secondary"
                style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.5rem 1rem' }}
                onClick={selectAdminPanel}
              >
                <span>⚙️</span> Switch to Global Admin Panel
              </button>
            )}
          </div>

          {currentApp?.is_suspended && (
            <div style={{
              background: 'rgba(245, 158, 11, 0.12)',
              border: '1.5px solid #f59e0b',
              borderRadius: '8px',
              padding: '0.85rem 1.25rem',
              marginBottom: '1.25rem',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: '0.75rem'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <span style={{ fontSize: '1.5rem' }}>⚠️</span>
                <div>
                  <strong style={{ color: '#fbbf24' }}>This Application is Currently Suspended</strong>
                  <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                    Testers and developers are blocked from logging in to this application. Only administrators have access.
                  </div>
                </div>
              </div>
              <button
                type="button"
                className="btn"
                style={{ fontSize: '0.85rem', padding: '0.4rem 0.9rem', background: '#38a169' }}
                onClick={() => handleToggleSuspend(currentApp)}
                disabled={suspendingApp}
              >
                {suspendingApp ? 'Resuming...' : '▶️ Resume Application'}
              </button>
            </div>
          )}

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
              App Users
            </button>
            <button
              className={`tab-btn ${activeTab === 'manage' ? 'active' : ''}`}
              onClick={() => setActiveTab('manage')}
            >
              Manage Tests
            </button>
            <button
              className={`tab-btn ${activeTab === 'disabled' ? 'active' : ''}`}
              onClick={() => setActiveTab('disabled')}
            >
              Disabled Tests {tests.filter(t => t.is_deleted).length > 0 ? `(${tests.filter(t => t.is_deleted).length})` : ''}
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
              className={`tab-btn ${activeTab === 'settings' ? 'active' : ''}`}
              onClick={() => setActiveTab('settings')}
            >
              Settings
            </button>
            <button
              className={`tab-btn ${activeTab === 'api-keys' ? 'active' : ''}`}
              onClick={() => { setActiveTab('api-keys'); fetchApiKeys(); }}
            >
              API Keys
            </button>
          </div>

      {activeTab === 'upload' && (
        <div className="admin-section">
          <h3>Import Tests from Excel or CSV</h3>
          <p className="admin-hint">
            Upload an Excel (.xlsx, .xls) or CSV (.csv) file. Each sheet or CSV file becomes a test.
            Columns are mapped automatically regardless of header labels:
            if the first column contains numbers, it is considered the Step # (followed by Description, Success Symptom, and Points);
            if the first column contains words, steps are auto-numbered (Description, Success Symptom, and Points).
          </p>
          <form onSubmit={handleImport} className="upload-form">
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls,.csv"
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
          <div style={{
            background: 'rgba(59, 130, 246, 0.1)',
            border: '1px solid rgba(59, 130, 246, 0.3)',
            borderRadius: '8px',
            padding: '1rem 1.25rem',
            marginBottom: '1.5rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '1rem'
          }}>
            <div>
              <strong style={{ color: '#60a5fa', display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.98rem' }}>
                <span>ℹ️</span> Global User Management
              </strong>
              <p style={{ margin: '0.35rem 0 0 0', fontSize: '0.88rem', color: 'var(--text-muted, #a0aec0)' }}>
                Users are added through <strong>Global Settings only</strong>. Below are the users currently assigned to <strong>{currentApp?.name || 'this application'}</strong>.
              </p>
            </div>
            {(user?.isAdmin || (user as any)?.is_admin) && (
              <button
                type="button"
                className="btn"
                style={{ fontSize: '0.85rem', padding: '0.45rem 0.9rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}
                onClick={() => {
                  selectAdminPanel();
                  setGlobalTab('users');
                }}
              >
                <span>👥</span> Manage in Global User Settings ➔
              </button>
            )}
          </div>

          <h3>Users Assigned to {currentApp?.name || 'Application'}</h3>
          {users.filter(u => u.is_admin || u.assigned_apps?.includes(currentApp?.id || 1)).length === 0 ? (
            <p className="admin-hint">No users currently assigned to this application.</p>
          ) : (
            <div className="users-list">
              {users.filter(u => u.is_admin || u.assigned_apps?.includes(currentApp?.id || 1)).map(u => {
                const summary = userSummaries[u.id];
                const currentGroups = u.user_groups || (u.is_admin ? ['admins'] : ['testers']);
                const userActiveKeys = (u.api_keys && u.api_keys.length > 0)
                  ? u.api_keys.filter(k => k.is_active)
                  : apiKeys.filter(k => k.user_id === u.id && k.is_active);
                const hasActiveKey = userActiveKeys.length > 0;

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
                      {!u.is_admin && (hasActiveKey ? (
                        <span
                          className="user-summary-badge"
                          style={{ background: 'rgba(72, 187, 120, 0.15)', color: '#48bb78', border: '1px solid rgba(72, 187, 120, 0.4)' }}
                          title={`Active Key: ${userActiveKeys[0].key_prefix} (Role: ${userActiveKeys[0].role})`}
                        >
                          🔑 {userActiveKeys[0].key_prefix}
                        </span>
                      ) : (
                        <span
                          className="user-summary-badge"
                          style={{ background: 'rgba(160, 174, 192, 0.08)', color: 'var(--text-muted, #a0aec0)' }}
                          title="No active key issued"
                        >
                          No Key
                        </span>
                      ))}
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
                      {!u.is_admin && hasActiveKey && (
                        <button
                          type="button"
                          className="btn-danger"
                          style={{ padding: '0.22rem 0.55rem', fontSize: '0.78rem', whiteSpace: 'nowrap' }}
                          title="Revoke generated key (preserves user account and all test records)"
                          onClick={() => handleRevokeUserKey(u)}
                        >
                          Revoke Key
                        </button>
                      )}
                      {!u.is_admin && (
                        <button
                          type="button"
                          className="btn-secondary"
                          style={{ padding: '0.22rem 0.55rem', fontSize: '0.78rem', whiteSpace: 'nowrap' }}
                          title={hasActiveKey ? "Generate another key for this user" : "Generate a new key for this user"}
                          onClick={() => handleGenerateKeyForUser(u)}
                        >
                          {hasActiveKey ? "New Key" : "+ Key"}
                        </button>
                      )}
                      <label className="suspend-toggle" title={u.isSuspended ? 'Unsuspend user' : 'Suspend user'}>
                        <input
                          type="checkbox"
                          checked={!!u.isSuspended}
                          onChange={() => toggleSuspension(u)}
                        />
                        <span>{u.isSuspended ? 'Suspended' : 'Active'}</span>
                      </label>
                      {!u.is_admin && (
                        <button
                          className="btn-icon"
                          title="Pay points"
                          onClick={() => openPayPoints(u)}
                        >
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
                        </button>
                      )}
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
          {tests.filter(t => !t.is_deleted).length === 0 ? (
            <p>No tests available. Upload an Excel file first.</p>
          ) : (
            <div className="assignment-list">
              {tests.filter(t => !t.is_deleted).map(test => (
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
                  onDelete={() => handleDisableTest(test.id, test.name)}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === 'disabled' && (
        <div className="admin-section">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem', marginBottom: '1rem' }}>
            <div>
              <h3>Disabled Tests</h3>
              <p className="admin-hint" style={{ margin: 0 }}>
                These tests are currently disabled. They are hidden from active tester loops and step investigation reports, while their historical points remain intact in user points totals.
                Re-enabling a test restores it to Manage Tests and assigns all users to it by default.
              </p>
            </div>
            {tests.filter(t => t.is_deleted).length > 0 && (
              <button
                className="btn btn-secondary"
                disabled={enablingTestId !== null}
                onClick={handleEnableAllTests}
                style={{ whiteSpace: 'nowrap' }}
              >
                {enablingTestId === -1 ? 'Enabling All...' : '✓ Enable All Disabled Tests'}
              </button>
            )}
          </div>

          {enableMessage && <p className="success-msg">{enableMessage}</p>}

          {tests.filter(t => t.is_deleted).length === 0 ? (
            <div style={{ padding: '2rem', textAlign: 'center', background: 'var(--card-bg, #1e293b)', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
              <p style={{ margin: 0, color: 'var(--text-muted)' }}>No disabled tests. All tests are currently active.</p>
            </div>
          ) : (
            <div className="assignment-list">
              {tests.filter(t => t.is_deleted).map(test => {
                const stepCount = managedSteps[test.id] ? managedSteps[test.id].filter(s => Number(s.points) !== -1 && Number(s.value) !== -1).length : null;
                const totalPts = test.totalPoints ?? (managedSteps[test.id] ? managedSteps[test.id].reduce((sum, s) => sum + (Number(s.points) > 0 ? Number(s.points) : 0), 0) : 0);
                const isEnabling = enablingTestId === test.id;

                return (
                  <div key={test.id} className="assignment-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.85rem 1.2rem', gap: '1rem', flexWrap: 'wrap' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                      <span className="test-name" style={{ fontWeight: 600, fontSize: '1rem' }}>{test.name}</span>
                      <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                        {stepCount !== null ? `${stepCount} step(s)` : ''}
                        {totalPts > 0 ? ` • ${totalPts} pts total` : ''}
                        {test.description ? ` • ${test.description}` : ''}
                      </span>
                    </div>
                    <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
                      <button
                        className="btn"
                        style={{ padding: '0.4rem 0.9rem', fontSize: '0.85rem' }}
                        disabled={enablingTestId !== null}
                        onClick={() => handleEnableTest(test.id)}
                      >
                        {isEnabling ? 'Enabling...' : '✓ Enable Test'}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {activeTab === 'assign' && (
        <div className="admin-section">
          <h3>Assign Tests to Users</h3>
          {tests.filter(t => !t.is_deleted).length === 0 ? (
            <p>No tests available. Upload an Excel file first.</p>
          ) : (
            <div className="assignment-list">
              {tests.filter(t => !t.is_deleted).map(test => (
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
      {activeTab === 'settings' && (
        <div className="admin-section">
          <h3>System Settings</h3>
          <p className="admin-hint">
            Configure application business rules and time thresholds.
          </p>

          {settingsLoading && <p className="admin-hint">Loading settings...</p>}

          <div style={{ maxWidth: '960px', margin: '1rem 0' }}>
            {!settingsLoading && (
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
                      If the user submits a <strong>failed step</strong> in one test, and then fails a step in a <strong>different test</strong> within this time window (e.g. 3 minutes), the points for the second failed step are withheld.
                    </li>
                    <li>
                      <strong>Audit Warning Logged:</strong> A warning entry is recorded in the audit log explaining that the cross-test step points were withheld due to rapid consecutive failures.
                    </li>
                  </ul>
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
                            placeholder={dropboxIsConfigured ? 'App Secret configured. Enter new to replace.' : 'Enter Dropbox App Secret'}
                            value={dropboxAppSecret}
                            onChange={e => setDropboxAppSecret(e.target.value)}
                            required={dropboxEnabled && !dropboxIsConfigured}
                          />
                        </div>
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

                  <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
                    <button type="submit" className="btn" disabled={settingsSaving}>
                      {settingsSaving ? 'Saving...' : 'Save Settings'}
                    </button>
                    {dropboxEnabled && (
                      <button
                        type="button"
                        className="btn-secondary"
                        onClick={handleTestDropbox}
                        disabled={dropboxTesting}
                      >
                        {dropboxTesting ? 'Testing...' : '⚡ Test Dropbox'}
                      </button>
                    )}
                  </div>
                </form>
              </div>
            )}
          </div>
        </div>
      )}
      {activeTab === 'api-keys' && renderApiKeysManagement(true)}
        </>
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
                    {tests.filter(t => !t.is_deleted && detailUserAssignments[t.id]).length === 0 ? (
                      <p className="admin-hint">No assigned tests.</p>
                    ) : (
                      <div className="selected-tags">
                        {tests.filter(t => !t.is_deleted && detailUserAssignments[t.id]).map(t => (
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
                    {tests.filter(t => !t.is_deleted && !detailUserAssignments[t.id]).length === 0 ? (
                      <p className="admin-hint">All tests are assigned.</p>
                    ) : (
                      <div className="selected-tags">
                        {tests.filter(t => !t.is_deleted && !detailUserAssignments[t.id]).map(t => (
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


      {/* User Key Modal */}
      {userKeyModalData && (
        <div className="modal-backdrop" style={{ zIndex: 1000 }} onClick={() => setUserKeyModalData(null)}>
          <div className="modal" style={{ maxWidth: '520px', width: '90%' }} onClick={e => e.stopPropagation()}>
            <h3 style={{ marginTop: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span>🔑</span> Generated Key for {userKeyModalData.username}
            </h3>
            <p style={{ fontSize: '0.88rem', color: 'var(--text-muted, #a0aec0)', lineHeight: '1.4' }}>
              A new key was generated for <strong>{userKeyModalData.username}</strong> ({userKeyModalData.role} role).
              Copy and share it now so the user can log on. You can revoke it anytime later without removing their account.
            </p>
            <div style={{ margin: '1.25rem 0' }}>
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                <input
                  type="text"
                  readOnly
                  value={userKeyModalData.rawKey}
                  onClick={e => e.currentTarget.select()}
                  style={{
                    flex: 1,
                    background: 'rgba(0, 0, 0, 0.45)',
                    border: '1.5px solid #4a5568',
                    padding: '0.75rem 0.85rem',
                    borderRadius: '6px',
                    fontFamily: 'monospace',
                    fontSize: '0.95rem',
                    color: '#63b3ed',
                    cursor: 'text'
                  }}
                  title="Click to select all, then Ctrl+C to copy"
                />
                <button
                  type="button"
                  className="btn"
                  style={{
                    background: copiedUserKey ? '#38a169' : undefined,
                    padding: '0.75rem 1rem',
                    whiteSpace: 'nowrap',
                    fontWeight: 600
                  }}
                  onClick={async () => {
                    const success = await copyToClipboard(userKeyModalData.rawKey);
                    if (success) {
                      setCopiedUserKey(true);
                      setTimeout(() => setCopiedUserKey(false), 3000);
                    } else {
                      alert('Could not copy automatically. Please select the key text in the box and press Ctrl+C.');
                    }
                  }}
                >
                  {copiedUserKey ? '✓ Copied!' : '📋 Copy Key'}
                </button>
              </div>
              <small style={{ display: 'block', color: 'var(--text-muted)', fontSize: '0.78rem', marginTop: '0.4rem' }}>
                💡 Tip: Click inside the box to select all text, or use the <strong>Copy Key</strong> button.
              </small>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setUserKeyModalData(null)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit User App & Test Assignments Modal */}
      {editingUserAssignments && (
        <div className="modal-overlay" onClick={() => setEditingUserAssignments(null)}>
          <div className="modal" style={{ maxWidth: '650px', width: '95%', maxHeight: '90vh', overflowY: 'auto' }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', margin: 0 }}>
                <span>📱</span> Manage Applications & Tests — {editingUserAssignments.username}
              </h3>
              <button className="modal-close" onClick={() => setEditingUserAssignments(null)}>✕</button>
            </div>
            <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              <p className="admin-hint" style={{ margin: 0 }}>
                Select which applications <strong>{editingUserAssignments.username}</strong> is assigned to.
                By default, all non-deleted tests of an assigned application are included. You can customize test assignments per application.
              </p>

              {editAssignmentsError && <p className="error-msg">{editAssignmentsError}</p>}
              {editAssignmentsSuccess && <p className="success-msg">{editAssignmentsSuccess}</p>}

              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                {apps.map(app => {
                  const isAssigned = editUserAppIds.includes(app.id);
                  const appTests = (allAppTests[app.id] || []).filter(t => !t.is_deleted);
                  const customList = editUserCustomAssignments[app.id];
                  const isCustomized = Array.isArray(customList);
                  const assignedCount = isCustomized ? customList.length : appTests.length;
                  const isExpanded = customizeEditAppId === app.id;

                  return (
                    <div
                      key={app.id}
                      style={{
                        background: isAssigned ? 'rgba(59, 130, 246, 0.08)' : 'rgba(255, 255, 255, 0.02)',
                        border: `1px solid ${isAssigned ? '#3b82f6' : 'var(--border-color, #2d3748)'}`,
                        borderRadius: '8px',
                        padding: '1rem',
                        transition: 'all 0.2s ease'
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem' }}>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', cursor: 'pointer', fontWeight: 600, fontSize: '1rem' }}>
                          <input
                            type="checkbox"
                            checked={isAssigned}
                            onChange={() => {
                              if (isAssigned) {
                                setEditUserAppIds(prev => prev.filter(id => id !== app.id));
                                setEditUserCustomAssignments(prev => {
                                  const next = { ...prev };
                                  delete next[app.id];
                                  return next;
                                });
                                if (customizeEditAppId === app.id) setCustomizeEditAppId(null);
                              } else {
                                setEditUserAppIds(prev => [...prev, app.id]);
                              }
                            }}
                            style={{ width: '18px', height: '18px', cursor: 'pointer' }}
                          />
                          <span>📱 {app.name}</span>
                        </label>

                        {isAssigned && (
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                            <span
                              style={{
                                fontSize: '0.8rem',
                                padding: '0.2rem 0.6rem',
                                borderRadius: '12px',
                                background: isCustomized ? 'rgba(237, 137, 54, 0.15)' : 'rgba(72, 187, 120, 0.15)',
                                color: isCustomized ? '#ed8936' : '#48bb78',
                                border: `1px solid ${isCustomized ? 'rgba(237, 137, 54, 0.3)' : 'rgba(72, 187, 120, 0.3)'}`
                              }}
                            >
                              {isCustomized ? `Custom: ${assignedCount}/${appTests.length} tests` : `✓ Default: All ${appTests.length} tests`}
                            </span>
                            <button
                              type="button"
                              className="btn-secondary"
                              style={{ fontSize: '0.78rem', padding: '0.25rem 0.6rem' }}
                              onClick={() => setCustomizeEditAppId(isExpanded ? null : app.id)}
                            >
                              {isExpanded ? '▲ Done' : '▼ Customize Tests'}
                            </button>
                          </div>
                        )}
                      </div>

                      {isAssigned && isExpanded && (
                        <div style={{ marginTop: '0.85rem', paddingTop: '0.85rem', borderTop: '1px solid var(--border-color, #2d3748)' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                            <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                              Select specific tests to assign for {app.name}:
                            </span>
                            <div style={{ display: 'flex', gap: '0.5rem' }}>
                              <button
                                type="button"
                                className="btn-secondary"
                                style={{ fontSize: '0.75rem', padding: '0.2rem 0.5rem' }}
                                onClick={() => {
                                  setEditUserCustomAssignments(prev => ({
                                    ...prev,
                                    [app.id]: appTests.map(t => t.id)
                                  }));
                                }}
                              >
                                Select All
                              </button>
                              <button
                                type="button"
                                className="btn-secondary"
                                style={{ fontSize: '0.75rem', padding: '0.2rem 0.5rem' }}
                                onClick={() => {
                                  setEditUserCustomAssignments(prev => ({
                                    ...prev,
                                    [app.id]: []
                                  }));
                                }}
                              >
                                Deselect All
                              </button>
                              {isCustomized && (
                                <button
                                  type="button"
                                  className="btn-secondary"
                                  style={{ fontSize: '0.75rem', padding: '0.2rem 0.5rem' }}
                                  onClick={() => {
                                    setEditUserCustomAssignments(prev => {
                                      const next = { ...prev };
                                      delete next[app.id];
                                      return next;
                                    });
                                  }}
                                >
                                  Reset to Default
                                </button>
                              )}
                            </div>
                          </div>

                          {appTests.length === 0 ? (
                            <p className="admin-hint" style={{ margin: 0 }}>No active tests in this application.</p>
                          ) : (
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '0.5rem', maxHeight: '180px', overflowY: 'auto', padding: '0.25rem' }}>
                              {appTests.map(t => {
                                const currentList = isCustomized ? customList : appTests.map(x => x.id);
                                const isChecked = currentList.includes(t.id);
                                return (
                                  <label
                                    key={t.id}
                                    style={{
                                      display: 'flex',
                                      alignItems: 'center',
                                      gap: '0.4rem',
                                      fontSize: '0.85rem',
                                      padding: '0.35rem 0.5rem',
                                      borderRadius: '4px',
                                      background: isChecked ? 'rgba(59, 130, 246, 0.12)' : 'rgba(0,0,0,0.1)',
                                      cursor: 'pointer'
                                    }}
                                  >
                                    <input
                                      type="checkbox"
                                      checked={isChecked}
                                      onChange={() => {
                                        const current = isCustomized ? [...customList] : appTests.map(x => x.id);
                                        const next = isChecked ? current.filter(id => id !== t.id) : [...current, t.id];
                                        setEditUserCustomAssignments(prev => ({ ...prev, [app.id]: next }));
                                      }}
                                    />
                                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={t.name}>
                                      {t.name}
                                    </span>
                                  </label>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '1rem' }}>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setEditingUserAssignments(null)}
                  disabled={savingUserAssignments}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={handleSaveUserAssignments}
                  disabled={savingUserAssignments || editUserAppIds.length === 0}
                >
                  {savingUserAssignments ? 'Saving...' : 'Save Assignments'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Suspend / Resume Application Modal */}
      {suspendAppTarget && (
        <div className="modal-overlay" onClick={() => setSuspendAppTarget(null)}>
          <div className="modal" style={{ maxWidth: '480px', width: '90%' }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span>{suspendAppTarget.is_suspended ? '▶️' : '⏸️'}</span>
                {suspendAppTarget.is_suspended ? 'Resume Application' : 'Suspend Application'}
              </h3>
              <button className="modal-close" onClick={() => setSuspendAppTarget(null)}>✕</button>
            </div>
            <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginTop: '0.75rem' }}>
              <p style={{ margin: 0, lineHeight: 1.5 }}>
                {suspendAppTarget.is_suspended ? (
                  <>
                    Are you sure you want to resume <strong>{suspendAppTarget.name}</strong>? Non-admin users assigned to this application will immediately be able to log in and perform tests normally.
                  </>
                ) : (
                  <>
                    Are you sure you want to suspend <strong>{suspendAppTarget.name}</strong>?
                    <br /><br />
                    <span style={{ color: '#fbbf24' }}>
                      ⚠️ <strong>Impact:</strong> Non-admin testers and developers will be <strong>blocked from logging into this application</strong>. It will remain visible in the left pane (with a [PAUSED] badge) and in global reporting for admins.
                    </span>
                  </>
                )}
              </p>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '0.5rem' }}>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setSuspendAppTarget(null)}
                  disabled={suspendingApp}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className={suspendAppTarget.is_suspended ? 'btn' : 'btn-danger'}
                  onClick={() => handleToggleSuspend(suspendAppTarget)}
                  disabled={suspendingApp}
                >
                  {suspendingApp ? 'Processing...' : (suspendAppTarget.is_suspended ? 'Resume Application' : 'Confirm Suspend')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Archive Application (Soft Delete) Double-Check Modal */}
      {archiveAppTarget && (
        <div className="modal-overlay" onClick={() => { setArchiveAppTarget(null); setArchiveConfirmText(''); }}>
          <div className="modal modal-danger" style={{ maxWidth: '520px', width: '90%' }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span>⚠️</span> Double-Check: Archive Application
              </h3>
              <button className="modal-close" onClick={() => { setArchiveAppTarget(null); setArchiveConfirmText(''); }}>✕</button>
            </div>
            <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginTop: '0.75rem' }}>
              <div style={{ background: 'rgba(229, 62, 62, 0.12)', borderLeft: '4px solid #e53e3e', padding: '0.85rem 1rem', borderRadius: '4px' }}>
                <strong style={{ color: '#feb2b2' }}>Major Application Archive Confirmation</strong>
                <p style={{ margin: '0.4rem 0 0 0', fontSize: '0.88rem', lineHeight: '1.4' }}>
                  Archiving <strong>{archiveAppTarget.name}</strong> will remove it from the active left pane, logon selectors, and active reports.
                  <br /><br />
                  <strong>Database Safety Guarantee:</strong> No database records (tests, execution history, points, versions, or user accounts) will be deleted. You can restore this application at any time from <em>Archive Settings</em>.
                </p>
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '0.88rem', marginBottom: '0.4rem' }}>
                  To confirm archival, please type the exact application name <strong>{archiveAppTarget.name}</strong> below:
                </label>
                <input
                  type="text"
                  className="user-input"
                  style={{ width: '100%' }}
                  placeholder={archiveAppTarget.name}
                  value={archiveConfirmText}
                  onChange={e => setArchiveConfirmText(e.target.value)}
                  autoFocus
                />
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '0.5rem' }}>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => { setArchiveAppTarget(null); setArchiveConfirmText(''); }}
                  disabled={archivingApp}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn-danger"
                  onClick={handleConfirmArchiveApp}
                  disabled={archivingApp || archiveConfirmText.trim() !== archiveAppTarget.name}
                >
                  {archivingApp ? 'Archiving...' : 'Confirm Archival (Soft Delete)'}
                </button>
              </div>
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
          title="Disable this test"
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
