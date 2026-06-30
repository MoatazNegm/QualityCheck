import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Link } from 'react-router-dom';

interface Test {
  id: number;
  name: string;
  description: string;
}

const Dashboard: React.FC = () => {
  const { token } = useAuth();
  const navigate = useNavigate();
  const [tests, setTests] = useState<Test[]>([]);
  const [loading, setLoading] = useState(true);

  const API_BASE = process.env.REACT_APP_API_URL || 'http://localhost:4006';

  useEffect(() => {
    fetchTests();
  }, [token]);

  const fetchTests = async () => {
    try {
      const response = await fetch(`${API_BASE}/api/tests`, {
        headers: { Authorization: `Bearer ${token}` }
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

  return (
    <div className='dashboard'>
      <h2>Available Tests</h2>
      <div className='tests-list'>
        {tests.map(test => (
          <div key={test.id} className='test-card'>
            <h3>{test.name}</h3>
            <p>{test.description}</p>
            <Link to={`/test/${test.id}`} className='btn'>
              Start Test
            </Link>
          </div>
        ))}
      </div>
    </div>
  );
};

export default Dashboard;