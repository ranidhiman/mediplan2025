import React, { useState, useEffect } from 'react';
import Login from './components/Login';
import MedicalAARSystem from './components/MedicalAARSystem';

function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  // Check token validity on mount
  useEffect(() => {
    const token = localStorage.getItem('token');
    if (token) {
      fetch('http://localhost:5003/api/reports', {
        headers: { 'Authorization': `Bearer ${token}` }
      })
        .then(res => {
          if (res.ok) {
            try {
              const payload = JSON.parse(atob(token.split('.')[1]));
              setUser({ username: payload.username, role: payload.role });
            } catch {
              localStorage.removeItem('token');
            }
          } else {
            localStorage.removeItem('token');
          }
        })
        .catch(() => localStorage.removeItem('token'))
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, []);

  const handleLogin = (userData) => {
    setUser(userData);
  };

  const handleLogout = () => {
    localStorage.removeItem('token');
    setUser(null);
  };

  if (loading) {
    return <div className="min-h-screen bg-gray-900 flex items-center justify-center text-white">Loading...</div>;
  }

  if (!user) {
    return <Login onLogin={handleLogin} />;
  }

  return <MedicalAARSystem user={user} onLogout={handleLogout} />;
}

export default App;