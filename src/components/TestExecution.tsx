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

const API_BASE = process.env.REACT_APP_API_URL || 'http://localhost:4006';

const TestExecution: React.FC = () => {
  const { testId } = useParams<{ testId: string }>();
  const navigate = useNavigate();
  const { token, user } = useAuth();

  const [testName, setTestName] = useState('');
  const [steps, setSteps] = useState<TestStep[]>([]);
  const [stepIndex, setStepIndex] = useState(0);
  const [doneStepIds, setDoneStepIds] = useState<Set<number>>(new Set());
  const [result, setResult] = useState<'pass' | 'fail' | ''>('');
  const [comment, setComment] = useState('');
  const [configFile, setConfigFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [restarting, setRestarting] = useState(false);

  const authHeaders = { Authorization: `Bearer ${token}` };

  useEffect(() => {
    if (user) loadTest();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [testId, user]);

  const loadTest = async () => {
    setLoading(true);
    try {
      const [testRes, resultsRes] = await Promise.all([
        fetch(`${API_BASE}/api/tests/${testId}`, { headers: authHeaders }),
        fetch(`${API_BASE}/api/test-results/user/${user!.id}/test/${testId}`, { headers: authHeaders })
      ]);

      if (!testRes.ok) return;
      const testData = await testRes.json();
      setTestName(testData.name);
      const allSteps: TestStep[] = testData.steps || [];
      setSteps(allSteps);

      const doneIds = new Set<number>();
      if (resultsRes.ok) {
        const results = await resultsRes.json();
        results.forEach((r: any) => doneIds.add(r.step_id));
      }
      setDoneStepIds(doneIds);

      const firstUnattempted = allSteps.findIndex(s => !doneIds.has(s.id));
      setStepIndex(firstUnattempted === -1 ? allSteps.length : firstUnattempted);
    } finally {
      setLoading(false);
    }
  };

  const resetForm = () => {
    setResult('');
    setComment('');
    setConfigFile(null);
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
        const newDone = new Set(doneStepIds);
        newDone.add(step.id);
        setDoneStepIds(newDone);
        resetForm();

        if (result === 'fail' && step.on_failure === 'stop') {
          navigate('/dashboard');
          return;
        }
        setStepIndex(i => i + 1);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleRestart = async () => {
    if (!user) return;
    if (!window.confirm('Restart this test from the beginning? All previous results for this test will be cleared.')) return;
    setRestarting(true);
    try {
      await fetch(`${API_BASE}/api/test-results/user/${user.id}/test/${testId}`, {
        method: 'DELETE',
        headers: authHeaders
      });
      setDoneStepIds(new Set());
      setStepIndex(0);
      resetForm();
    } finally {
      setRestarting(false);
    }
  };

  const goToPrev = () => {
    if (stepIndex <= 0) return;
    setStepIndex(i => i - 1);
    resetForm();
  };

  if (loading) return <div>Loading...</div>;

  const isCompleted = stepIndex >= steps.length;
  const currentStep = steps[stepIndex] ?? null;
  const isAlreadyDone = currentStep ? doneStepIds.has(currentStep.id) : false;

  if (isCompleted) {
    return (
      <div className='test-completed'>
        <h2>Test Completed</h2>
        <p>You have completed all steps for <strong>{testName}</strong>.</p>
        <div className='test-completed-actions'>
          <button onClick={goToPrev} disabled={steps.length === 0}>
            ← Go to Last Step
          </button>
          <button onClick={handleRestart} disabled={restarting}>
            {restarting ? 'Restarting...' : 'Restart from Beginning'}
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
      </div>

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
        <div className='result-selection'>
          <label>Result:</label>
          <div>
            <label>
              <input type='radio' name='result' value='pass' checked={result === 'pass'} onChange={() => setResult('pass')} required /> Pass
            </label>
            <label>
              <input type='radio' name='result' value='fail' checked={result === 'fail'} onChange={() => setResult('fail')} /> Fail
            </label>
          </div>
        </div>

        {result === 'fail' && (
          <div className='comment-section'>
            <label>Comment (required for failures):</label>
            <textarea value={comment} onChange={e => setComment(e.target.value)} required placeholder='Describe what went wrong...' />
          </div>
        )}

        {result === 'fail' && (
          <div className='file-upload'>
            <label>Configuration File (required for failures):</label>
            <input type='file' onChange={e => setConfigFile(e.target.files?.[0] || null)} required />
          </div>
        )}

        <div className='step-nav'>
          <button type='button' className='btn-secondary' onClick={goToPrev} disabled={stepIndex === 0 || submitting}>
            ← Previous Step
          </button>
          <button type='submit' disabled={submitting || !result}>
            {submitting ? 'Submitting...' : isAlreadyDone ? 'Resubmit & Continue →' : 'Submit & Continue →'}
          </button>
        </div>
      </form>
    </div>
  );
};

export default TestExecution;
