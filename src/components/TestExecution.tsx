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
}

const TestExecution: React.FC = () => {
  const { testId } = useParams<{ testId: string }>();
  const navigate = useNavigate();
  const { token } = useAuth();
  const [currentStep, setCurrentStep] = useState<TestStep | null>(null);
  const [result, setResult] = useState<'pass' | 'fail' | ''>('');
  const [comment, setComment] = useState('');
  const [configFile, setConfigFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(true);
  const [testCompleted, setTestCompleted] = useState(false);
  const [testName, setTestName] = useState('');

  const API_BASE = process.env.REACT_APP_API_URL || 'http://localhost:4006';

  useEffect(() => {
    fetchTestStep();
  }, [testId]);

  const fetchTestStep = async () => {
    try {
      const response = await fetch(`${API_BASE}/api/test-results/user/1/test/${testId}/next`, {
        headers: { Authorization: `Bearer ${token}` }
      });

      if (response.ok) {
        const data = await response.json();
        setCurrentStep(data.step);
        setTestName(data.test_name);
      } else {
        setTestCompleted(true);
      }
    } catch (error) {
      console.error('Error fetching step:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: any) => {
    e.preventDefault();
    setLoading(true);

    const formData = new FormData();
    formData.append('result', result);
    formData.append('comment', comment);
    if (configFile) {
      formData.append('configFile', configFile);
    }

    try {
      const response = await fetch(`${API_BASE}/api/test-results/${testId}/steps/${currentStep?.id}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData
      });

      if (response.ok) {
        if (result === 'pass' || currentStep?.on_failure === 'continue') {
          fetchTestStep();
        } else {
          alert('Test stopped due to failure. Proceeding to next test.');
          navigate('/dashboard');
        }
      }
    } catch (error: any) {
      alert('Error submitting result: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  if (loading) return <div>Loading...</div>;

  if (testCompleted || !currentStep) {
    return (
      <div className='test-completed'>
        <h2>Test Completed</h2>
        <p>You have successfully completed all steps for this test.</p>
        <button onClick={() => navigate('/dashboard')}>View All Tests</button>
      </div>
    );
  }

  return (
    <div className='test-execution'>
      <h2>{testName}</h2>
      <div className='step-info'>
        <h3>Step {currentStep.step_number}: {currentStep.description}</h3>
        <p><strong>Success Symptom:</strong> {currentStep.success_symptom}</p>
        <p><strong>Value:</strong> ${currentStep.value}</p>
        <p><strong>On Failure:</strong> {currentStep.on_failure === 'continue' ? 'Continue to next step' : 'Stop test'}</p>
      </div>

      <form onSubmit={handleSubmit}>
        <div className='result-selection'>
          <label>Result:</label>
          <div>
            <label>
              <input
                type='radio'
                name='result'
                value='pass'
                checked={result === 'pass'}
                onChange={() => setResult('pass')}
                required
              />{' '}
              Pass
            </label>
            <label>
              <input
                type='radio'
                name='result'
                value='fail'
                checked={result === 'fail'}
                onChange={() => setResult('fail')}
              />{' '}
              Fail
            </label>
          </div>
        </div>

        {result === 'fail' && (
          <div className='comment-section'>
            <label>Comment (required for failures):</label>
            <textarea
              value={comment}
              onChange={e => setComment(e.target.value)}
              required
              placeholder='Please describe what went wrong...'
            />
          </div>
        )}

        {result === 'fail' && (
          <div className='file-upload'>
            <label>Configuration File (required for failures):</label>
            <input
              type='file'
              onChange={e => setConfigFile(e.target.files?.[0] || null)}
              required
            />
          </div>
        )}

        <button type='submit' disabled={loading || !result}>
          {loading ? 'Submitting...' : 'Submit Result'}
        </button>
      </form>
    </div>
  );
};

export default TestExecution;