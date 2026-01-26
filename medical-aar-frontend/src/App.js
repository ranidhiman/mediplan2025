import React, { useState } from 'react';
import Login from './components/Login';
import MedicalAARSystem from './components/MedicalAARSystem';

function App() {
  const [user, setUser] = useState(null);

  const handleLogin = (userData) => {
    setUser(userData);
  };

  const handleLogout = () => {
    localStorage.removeItem('token');
    setUser(null);
  };

  if (!user) {
    return <Login onLogin={handleLogin} />;
  }

  return <MedicalAARSystem user={user} onLogout={handleLogout} />;
}

export default App;