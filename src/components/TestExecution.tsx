import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

interface TestStep {
  id: number;
  test_id: number;
  step_number: number;
  description: string;
  success_symptom: string;
  value: number;
  on_failure: string;
  points: number;
  attachment_path?: string | null;
  attachment_name?: string | null;
}

interface UserWarning {
  id: number;
  message: string;
  created_round: number;
  created_at: string;
}

const API_BASE = '';

const TestExecution: React.FC = () => {
  const { testId } = useParams<{ testId: string }>();
  const navigate = useNavigate();
  const { token, user, refreshUser } = useAuth();

  const [testName, setTestName] = useState('');
  const [steps, setSteps] = useState<TestStep[]>([]);
  const [stepIndex, setStepIndex] = useState(0);
  const [doneStepIds, setDoneStepIds] = useState<Set<number>>(new Set());
  const [result, setResult] = useState<'pass' | 'fail' | ''>('');
  const [comment, setComment] = useState('');
  const [configFile, setConfigFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const [monthEarned, setMonthEarned] = useState<number | null>(null);
  const [warnings, setWarnings] = useState<UserWarning[]>([]);
  const [isWarningsExpanded, setIsWarningsExpanded] = useState(false);

  const authHeaders = { Authorization: `Bearer ${token}` };

  const isSectionStep = (step: TestStep | null | undefined): boolean => {
    if (!step) return false;
    return Number(step.points) === -1 || Number(step.value) === -1;
  };

  const getActiveSectionForIndex = (stepList: TestStep[], index: number): string | null => {
    for (let i = index; i >= 0; i--) {
      if (isSectionStep(stepList[i])) {
        return stepList[i].description;
      }
    }
    return null;
  };

  useEffect(() => {
    if (user) loadTest();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [testId, user?.id]);

  // Safety fallback: auto-advance past any section headers
  useEffect(() => {
    if (!loading && steps.length > 0 && stepIndex < steps.length && isSectionStep(steps[stepIndex])) {
      let nextNonSection = stepIndex + 1;
      while (nextNonSection < steps.length && isSectionStep(steps[nextNonSection])) {
        nextNonSection++;
      }
      setStepIndex(nextNonSection);
    }
  }, [loading, steps, stepIndex]);

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

  const loadTest = async () => {
    setLoading(true);
    try {
      const [testRes, resultsRes, roundRes] = await Promise.all([
        fetch(`${API_BASE}/api/tests/${testId}`, { headers: authHeaders }),
        fetch(`${API_BASE}/api/test-results/user/${user!.id}/test/${testId}`, { headers: authHeaders }),
        fetch(`${API_BASE}/api/tests/${testId}/round`, { headers: authHeaders })
      ]);

      if (!testRes.ok) return;
      const testData = await testRes.json();
      setTestName(testData.name);
      const allSteps: TestStep[] = testData.steps || [];
      setSteps(allSteps);

      let currentRound = 0;
      if (roundRes.ok) {
        const roundData = await roundRes.json();
        currentRound = typeof roundData.round === 'number' ? roundData.round : 0;
      }

      const doneIds = new Set<number>();
      let hasHardStopFailure = false;
      if (resultsRes.ok) {
        const results = await resultsRes.json();
        results.forEach((r: any) => {
          if (r.round_id === currentRound) {
            doneIds.add(r.step_id);
            if (r.result === 'fail') {
              const matchedStep = allSteps.find(s => s.id === r.step_id);
              if (!matchedStep || !matchedStep.on_failure || matchedStep.on_failure === 'stop') {
                hasHardStopFailure = true;
              }
            }
          }
        });
      }
      setDoneStepIds(doneIds);

      if (hasHardStopFailure) {
        await endTest(testId!);
        navigate('/dashboard');
        return;
      }

      const firstUnattempted = allSteps.findIndex(s => !isSectionStep(s) && !doneIds.has(s.id));
      if (firstUnattempted === -1) {
        const anyRealRemaining = allSteps.some(s => !isSectionStep(s) && !doneIds.has(s.id));
        if (!anyRealRemaining && allSteps.some(s => !isSectionStep(s))) {
          setStepIndex(allSteps.length);
        } else {
          const firstReal = allSteps.findIndex(s => !isSectionStep(s));
          setStepIndex(firstReal >= 0 ? firstReal : 0);
        }
      } else {
        setStepIndex(firstUnattempted);
      }
      fetchSummary();
      fetchWarnings();
    } finally {
      setLoading(false);
    }
  };

  const resetForm = () => {
    setResult('');
    setComment('');
    setConfigFile(null);
  };

  const markComplete = async (tid: string) => {
    try {
      await fetch(`${API_BASE}/api/tests/${tid}/complete`, {
        method: 'POST',
        headers: authHeaders
      });
    } catch (err) {
      console.error('Failed to advance loop:', err);
    }
  };

  const endTest = async (tid: string) => {
    try {
      await fetch(`${API_BASE}/api/tests/${tid}/end`, {
        method: 'POST',
        headers: authHeaders
      });
    } catch (err) {
      console.error('Failed to end test:', err);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    const step = steps[stepIndex];
    if (!step || !result) return;

    setSubmitting(true);
    const formData = new FormData();
    formData.append('result', result);
    formData.append('comment', comment);
    if (configFile) formData.append('configFile', configFile);

    try {
      const res = await fetch(`${API_BASE}/api/test-results/${testId}/steps/${step.id}`, {
        method: 'POST',
        headers: authHeaders,
        body: formData
      });

      if (res.ok) {
        const data = await res.json();
        const newDone = new Set(doneStepIds);
        newDone.add(step.id);
        setDoneStepIds(newDone);
        resetForm();
        await fetchSummary();
        await fetchWarnings();
        await refreshUser();

        if (data.autoEnded || (result === 'fail' && (!step.on_failure || step.on_failure === 'stop'))) {
          if (!data.autoEnded) {
            await endTest(testId!);
          }
          navigate('/dashboard');
          return;
        }

        let nextIndex = stepIndex + 1;
        while (nextIndex < steps.length && isSectionStep(steps[nextIndex])) {
          nextIndex++;
        }
        setStepIndex(nextIndex);

        const realSteps = steps.filter(s => !isSectionStep(s));
        const allDone = realSteps.every(s => newDone.has(s.id));
        if (allDone) {
          await markComplete(testId!);
        }
      } else {
        const errorData = await res.json().catch(() => ({}));
        alert(errorData.error || 'Failed to submit step result. Please check the file size or parameters and try again.');
      }
    } catch (err) {
      console.error('Error submitting step:', err);
      alert('Network or server error submitting step result. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };


  const goToPrev = async () => {
    if (stepIndex <= 0) return;
    let prevIndex = stepIndex - 1;
    while (prevIndex >= 0 && isSectionStep(steps[prevIndex])) {
      prevIndex--;
    }
    if (prevIndex < 0) return;
    const prevStep = steps[prevIndex];
    if (!prevStep) return;

    setSubmitting(true);
    try {
      const res = await fetch(`${API_BASE}/api/test-results/${testId}/steps/${prevStep.id}`, {
        method: 'DELETE',
        headers: authHeaders
      });
      if (res.ok) {
        const newDone = new Set(doneStepIds);
        newDone.delete(prevStep.id);
        setDoneStepIds(newDone);
        setStepIndex(prevIndex);
        resetForm();
        await fetchSummary();
        await fetchWarnings();
      } else {
        alert('Failed to revert step result. Please try again.');
      }
    } catch (err) {
      console.error('Error reverting step:', err);
      alert('Network error reverting step.');
    } finally {
      setSubmitting(false);
    }
  };

  const downloadFullTestSheet = () => {
    if (!steps || steps.length === 0) {
      alert('No steps available to download for this test.');
      return;
    }
    const sorted = steps.slice().sort((a, b) => a.step_number - b.step_number);
    const header = ['Step #', 'Step Description', 'Success Symptom', 'Points'];
    const rows = sorted.map(s => {
      const stepNum = s.step_number ?? '';
      const desc = String(s.description || '').replace(/"/g, '""');
      const symptom = String(s.success_symptom || 'N/A').replace(/"/g, '""');
      const pts = isSectionStep(s) ? -1 : (s.points ?? s.value ?? 0);
      return `"${stepNum}","${desc}","${symptom}","${pts}"`;
    });
    const csvContent = '\uFEFF' + [header.join(','), ...rows].join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const safeName = String(testName || `test_${testId}`).replace(/[^a-z0-9_-]/gi, '_');
    a.download = `${safeName}_test_sheet.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  if (loading) return <div>Loading...</div>;

  const realSteps = steps.filter(s => !isSectionStep(s));
  const totalPoints = realSteps.reduce((sum, s) => {
    const pts = Number(s.points) || Number(s.value) || 0;
    return sum + (pts > 0 ? pts : 0);
  }, 0);
  const earnedInTest = steps
    .slice(0, stepIndex)
    .filter(s => !isSectionStep(s))
    .reduce((sum, s) => {
      const pts = Number(s.points) || Number(s.value) || 0;
      return sum + (pts > 0 ? pts : 0);
    }, 0);

  const isCompleted = stepIndex >= steps.length || (realSteps.length > 0 && realSteps.every(s => doneStepIds.has(s.id)) && stepIndex >= steps.length);
  const currentStep = steps[stepIndex] ?? null;
  const isAlreadyDone = currentStep ? doneStepIds.has(currentStep.id) : false;
  const currentRealIndex = currentStep ? realSteps.findIndex(s => s.id === currentStep.id) : 0;
  const activeSection = currentStep ? getActiveSectionForIndex(steps, stepIndex) : null;
  const canGoPrev = steps.slice(0, stepIndex).some(s => !isSectionStep(s));

  if (isCompleted || !currentStep) {
    return (
      <div className='test-completed'>
        <h2>Test Completed</h2>
        <p>You have completed all steps for <strong>{testName}</strong>.</p>
        <p className='points-summary'>Points earned in this test: <strong>{earnedInTest}/{totalPoints}</strong></p>
        <p className='points-summary'>Points earned this month: <strong>{monthEarned !== null ? monthEarned : '—'}</strong></p>
        <div className='test-completed-actions'>
          <button onClick={goToPrev} disabled={realSteps.length === 0 || submitting}>
            {submitting ? 'Reverting...' : '← Go to Last Step'}
          </button>
          <button type='button' className='btn-secondary' onClick={downloadFullTestSheet}>
            📥 Download Test Sheet
          </button>
          <button onClick={() => navigate('/dashboard')}>Back to Dashboard</button>
        </div>
      </div>
    );
  }

  return (
    <div className='test-execution'>
      {warnings.length > 0 && (
        <div className='user-warnings-area'>
          <div
            className='warning-banner warning-banner-collapsible'
            onClick={() => setIsWarningsExpanded(!isWarningsExpanded)}
            style={{ cursor: 'pointer', display: 'flex', flexDirection: 'column' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem' }}>
                <span className='warning-icon'>⚠️</span>
                <div className='warning-content'>
                  <strong style={{ margin: 0, fontSize: '0.98rem' }}>Points Not Counted ({warnings.length})</strong>
                  <p style={{ margin: 0, fontSize: '0.84rem', opacity: 0.85 }}>
                    {isWarningsExpanded ? 'Click to collapse penalty details ▲' : 'Click to view non-counted step penalties ▼'}
                  </p>
                </div>
              </div>
              <span className='btn btn-sm' style={{ fontSize: '0.8rem', padding: '0.2rem 0.6rem', background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.2)', color: 'inherit' }}>
                {isWarningsExpanded ? 'Close ▲' : 'View Penalties ▼'}
              </span>
            </div>

            {isWarningsExpanded && (
              <div style={{ marginTop: '0.85rem', paddingTop: '0.85rem', borderTop: '1px solid rgba(239, 68, 68, 0.3)', display: 'flex', flexDirection: 'column', gap: '0.6rem', width: '100%' }} onClick={e => e.stopPropagation()}>
                {warnings.map(w => (
                  <div key={w.id} style={{ background: 'rgba(0, 0, 0, 0.25)', border: '1px solid rgba(239, 68, 68, 0.25)', padding: '0.65rem 0.85rem', borderRadius: '6px', fontSize: '0.88rem' }}>
                    <p style={{ margin: '0 0 0.25rem 0', color: '#fef2f2', lineHeight: 1.4 }}>{w.message}</p>
                    {w.created_at && (
                      <span style={{ fontSize: '0.78rem', color: 'rgba(254, 242, 242, 0.65)' }}>
                        Logged in Round {w.created_round} on {new Date(w.created_at).toLocaleString()}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      <div className='step-header'>
        <div className='step-header-info'>
          <h2>{testName}</h2>
          <div className='step-header-meta'>
            <span className='step-counter'>Step {currentRealIndex + 1} of {realSteps.length}</span>
            <span className='test-total-points'>Earned: {earnedInTest}/{totalPoints} pts</span>
          </div>
        </div>
        <button
          type='button'
          className='btn-download-test-square'
          onClick={downloadFullTestSheet}
          title='Download complete test sheet (all steps, success symptoms, and points)'
          aria-label='Download Test Sheet'
        >
          <svg className='download-icon' width='18' height='18' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2' strokeLinecap='round' strokeLinejoin='round'>
            <path d='M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4' />
            <polyline points='7 10 12 15 17 10' />
            <line x1='12' y1='15' x2='12' y2='3' />
          </svg>
          <span className='download-btn-label'>Test Sheet</span>
        </button>
      </div>
      <div className='test-month-points'>Points earned this month: <strong>{monthEarned !== null ? monthEarned : '—'}</strong></div>

      <div className='step-info'>
        {activeSection && (
          <div className='step-section-callout'>
            <span className='section-callout-label'>section:</span>
            <span className='section-callout-text'>{activeSection}</span>
          </div>
        )}
        <h3>Step {currentRealIndex + 1}: {currentStep.description}</h3>
        <p className='step-symptom'>
          <strong>Success Symptom:</strong> {currentStep.success_symptom || 'N/A'}
        </p>
        {currentStep.attachment_path && (
          <div className='step-reference-attachment'>
            <span className='attachment-label'>Reference File:</span>
            <a
              href={`${API_BASE}${currentStep.attachment_path}`}
              target='_blank'
              rel='noopener noreferrer'
              className='btn-step-download'
              download={currentStep.attachment_name || true}
            >
              📥 Download {currentStep.attachment_name || 'Attachment'}
            </a>
          </div>
        )}
        <p className='step-points'>
          <span className='points-badge'>{currentStep.points ?? 10} pts</span>
        </p>
        {isAlreadyDone && (
          <p className='step-redo-warning'>⚠ You already submitted a result for this step. Submitting again will replace it.</p>
        )}
      </div>

      <form onSubmit={handleSubmit}>
        {user?.isSuspended && (
          <p className='admin-hint' style={{ color: 'red', marginBottom: '1rem' }}>
            Your account is suspended. You cannot submit results.
          </p>
        )}
        <div className='result-selection'>
          <label>Result:</label>
          <div>
            <label>
              <input type='radio' name='result' value='pass' checked={result === 'pass'} onChange={() => setResult('pass')} required disabled={user?.isSuspended} /> Pass
            </label>
            <label>
              <input type='radio' name='result' value='fail' checked={result === 'fail'} onChange={() => setResult('fail')} disabled={user?.isSuspended} /> Fail
            </label>
          </div>
        </div>

        {result && (
          <div className='comment-section'>
            <label>{result === 'fail' ? 'Comment (required for failures):' : 'Comment (optional):'}</label>
            <textarea value={comment} onChange={e => setComment(e.target.value)} required={result === 'fail'} placeholder='Describe what went wrong...' disabled={user?.isSuspended} />
          </div>
        )}

        {result && (
          <div className='file-upload'>
            <label>{result === 'fail' ? 'Configuration File (required for failures):' : 'Configuration File (optional):'}</label>
            <input type='file' onChange={e => setConfigFile(e.target.files?.[0] || null)} required={result === 'fail'} disabled={user?.isSuspended} />
          </div>
        )}

        <div className='step-nav'>
          <button type='button' className='btn-secondary' onClick={goToPrev} disabled={!canGoPrev || submitting || user?.isSuspended}>
            ← Previous Step
          </button>
          <button type='submit' disabled={submitting || !result || user?.isSuspended}>
            {submitting ? 'Submitting...' : isAlreadyDone ? 'Resubmit & Continue →' : 'Submit & Continue →'}
          </button>
        </div>
      </form>
    </div>
  );
};

export default TestExecution;
