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

  const authHeaders = { Authorization: `Bearer ${token}` };

  useEffect(() => {
    if (user) loadTest();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [testId, user?.id]);

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

      let currentRound = 1;
      if (roundRes.ok) {
        const roundData = await roundRes.json();
        currentRound = roundData.round || 1;
      }

      const doneIds = new Set<number>();
      if (resultsRes.ok) {
        const results = await resultsRes.json();
        results.forEach((r: any) => {
          if (r.round_id === currentRound) {
            doneIds.add(r.step_id);
          }
        });
      }
      setDoneStepIds(doneIds);

      const firstUnattempted = allSteps.findIndex(s => !doneIds.has(s.id));
      if (firstUnattempted === -1) {
        setStepIndex(0);
      } else {
        setStepIndex(firstUnattempted);
      }
      fetchSummary();
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
        await refreshUser();

        if (data.autoEnded) {
          navigate('/dashboard');
          return;
        }

        if (result === 'fail' && step.on_failure === 'stop') {
          await endTest(testId!);
          navigate('/dashboard');
          return;
        }

        const nextIndex = stepIndex + 1;
        setStepIndex(nextIndex);

        const allDone = steps.every(s => newDone.has(s.id));
        if (allDone) {
          await markComplete(testId!);
        }
      }
    } finally {
      setSubmitting(false);
    }
  };


  const goToPrev = async () => {
    if (stepIndex <= 0) return;
    const prevStep = steps[stepIndex - 1];
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
        setStepIndex(stepIndex - 1);
        resetForm();
        await fetchSummary();
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

  if (loading) return <div>Loading...</div>;

  const totalPoints = steps.reduce((sum, s) => sum + (Number(s.points) || Number(s.value) || 0), 0);
  const earnedInTest = steps
    .slice(0, stepIndex)
    .reduce((sum, s) => sum + (Number(s.points) || Number(s.value) || 0), 0);

  const isCompleted = stepIndex >= steps.length;
  const currentStep = steps[stepIndex] ?? null;
  const isAlreadyDone = currentStep ? doneStepIds.has(currentStep.id) : false;

  if (isCompleted) {
    return (
      <div className='test-completed'>
        <h2>Test Completed</h2>
        <p>You have completed all steps for <strong>{testName}</strong>.</p>
        <p className='points-summary'>Points earned in this test: <strong>{earnedInTest}/{totalPoints}</strong></p>
        <p className='points-summary'>Points earned this month: <strong>{monthEarned !== null ? monthEarned : '—'}</strong></p>
        <div className='test-completed-actions'>
          <button onClick={goToPrev} disabled={steps.length === 0 || submitting}>
            {submitting ? 'Reverting...' : '← Go to Last Step'}
          </button>
          <button onClick={() => navigate('/dashboard')}>Back to Dashboard</button>
        </div>
      </div>
    );
  }

  return (
    <div className='test-execution'>
      <div className='step-header'>
        <h2>{testName}</h2>
        <span className='step-counter'>Step {currentStep.step_number} of {steps.length}</span>
        <span className='test-total-points'>Earned: {earnedInTest}/{totalPoints} pts</span>
      </div>
      <div className='test-month-points'>Points earned this month: <strong>{monthEarned !== null ? monthEarned : '—'}</strong></div>

      <div className='step-info'>
        <h3>Step {currentStep.step_number}: {currentStep.description}</h3>
        {currentStep.success_symptom && (
          <p><strong>Expected Success:</strong> {currentStep.success_symptom}</p>
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
          <button type='button' className='btn-secondary' onClick={goToPrev} disabled={stepIndex === 0 || submitting || user?.isSuspended}>
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
