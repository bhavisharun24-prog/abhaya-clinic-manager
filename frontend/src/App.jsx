import React, { useState, useEffect, createContext, useContext } from 'react';
import Header from './components/Header';
import DoctorDashboard from './components/DoctorDashboard';
import PharmacistDashboard from './components/PharmacistDashboard';
import SplashScreen from './components/SplashScreen';

export const AppContext = createContext();

export default function App() {
  const [showSplash, setShowSplash] = useState(true);
  const [user, setUser] = useState(() => {
    try {
      const savedUser = localStorage.getItem('abhaya_user');
      return savedUser ? JSON.parse(savedUser) : null;
    } catch {
      return null;
    }
  });

  useEffect(() => {
    const timer = setTimeout(() => setShowSplash(false), 2500);
    return () => clearTimeout(timer);
  }, []);

  const [activeTab, setActiveTab] = useState(() => {
    return user?.role === 'doctor' ? 'patients' : 'calendar';
  });

  const [wsMessage, setWsMessage] = useState(null);
  const [wsStatus, setWsStatus] = useState('disconnected');
  const [loginError, setLoginError] = useState('');
  const [loginForm, setLoginForm] = useState({ username: 'doctor', role: 'doctor', password: '' });

  // Update default username based on role selection to speed up workflow
  const handleRoleChange = (role) => {
    setLoginForm({
      role,
      username: role === 'doctor' ? 'doctor' : 'pharmacist',
      password: ''
    });
  };

  // Login handler
  const handleLogin = async (e) => {
    e.preventDefault();
    setLoginError('');
    try {
      const host = window.location.hostname || 'localhost';
      const res = await fetch(`http://${host}:5000/api/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(loginForm)
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.detail || 'Login failed');
      }
      setUser(data.user);
      localStorage.setItem('abhaya_user', JSON.stringify(data.user));
      setActiveTab(data.user.role === 'doctor' ? 'patients' : 'calendar');
    } catch (err) {
      setLoginError(err.message);
    }
  };

  // Logout handler
  const handleLogout = () => {
    setUser(null);
    localStorage.removeItem('abhaya_user');
  };

  // WebSocket Connection with Auto-reconnection logic
  useEffect(() => {
    if (!user) return;

    let ws;
    let reconnectTimer;
    const hostname = window.location.hostname || 'localhost';
    const wsUrl = `ws://${hostname}:5000/ws`;

    function connect() {
      setWsStatus('connecting');
      ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        setWsStatus('connected');
        console.log('WebSocket Connection Opened.');
      };

      ws.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);
          setWsMessage(payload);
        } catch (err) {
          console.error('Failed to parse WebSocket message:', err);
        }
      };

      ws.onclose = () => {
        setWsStatus('disconnected');
        console.log('WebSocket Connection Closed. Attempting reconnect in 3s...');
        reconnectTimer = setTimeout(connect, 3000);
      };

      ws.onerror = (err) => {
        console.error('WebSocket Error:', err);
        ws.close();
      };
    }

    connect();

    return () => {
      if (ws) ws.close();
      clearTimeout(reconnectTimer);
    };
  }, [user]);

  // Clean consumed messages
  const clearWsMessage = () => setWsMessage(null);

  if (showSplash) {
    return <SplashScreen />;
  }

  if (!user) {
    // Login Screen View
    return (
      <div style={{
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'center', 
        height: '100vh', 
        backgroundColor: '#0b112c', 
        backgroundImage: 'radial-gradient(circle at 10% 20%, rgb(16, 27, 66) 0%, rgb(11, 17, 44) 90%)',
        fontFamily: "'Inter', sans-serif"
      }}>
        <div style={{
          backgroundColor: 'rgba(255, 255, 255, 0.05)',
          backdropFilter: 'blur(16px)',
          border: '1px solid rgba(255, 255, 255, 0.1)',
          borderRadius: '16px',
          padding: '2.5rem',
          width: '100%',
          maxWidth: '440px',
          boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.3)'
        }}>
          {/* Logo Signboard styling */}
          <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#d9383a" strokeWidth="2.5">
                <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
                <path d="M12 5v14M5 12h14" stroke="#ffffff" strokeWidth="1.5" />
              </svg>
              <span style={{ fontSize: '1.8rem', fontWeight: 800, color: 'white', fontFamily: "'Outfit', sans-serif" }}>Abhaya</span>
            </div>
            <p style={{ color: '#d9383a', fontWeight: 'bold', fontSize: '0.85rem', textTransform: 'uppercase', letterSpacing: '2px' }}>Medical Care</p>
            <p style={{ color: '#94a3b8', fontSize: '0.8rem', marginTop: '4px' }}>Compassion... Care... Cure...</p>
          </div>

          <form onSubmit={handleLogin}>
            <div style={{ display: 'flex', gap: '8px', marginBottom: '1.5rem', backgroundColor: 'rgba(255, 255, 255, 0.05)', padding: '4px', borderRadius: '8px' }}>
              <button 
                type="button" 
                onClick={() => handleRoleChange('doctor')}
                style={{
                  flex: 1, padding: '0.6rem', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 600,
                  backgroundColor: loginForm.role === 'doctor' ? '#d9383a' : 'transparent',
                  color: loginForm.role === 'doctor' ? 'white' : '#94a3b8',
                  transition: 'all 0.2s'
                }}
              >Doctor</button>
              <button 
                type="button" 
                onClick={() => handleRoleChange('pharmacist')}
                style={{
                  flex: 1, padding: '0.6rem', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 600,
                  backgroundColor: loginForm.role === 'pharmacist' ? '#d9383a' : 'transparent',
                  color: loginForm.role === 'pharmacist' ? 'white' : '#94a3b8',
                  transition: 'all 0.2s'
                }}
              >Pharmacist</button>
            </div>

            <div style={{ marginBottom: '1.25rem' }}>
              <label style={{ display: 'block', color: '#cbd5e1', fontSize: '0.85rem', marginBottom: '6px', fontWeight: 500 }}>Username</label>
              <input 
                type="text" 
                required
                value={loginForm.username}
                onChange={e => setLoginForm({ ...loginForm, username: e.target.value })}
                style={{
                  width: '100%', padding: '0.75rem 1rem', border: '1px solid rgba(255, 255, 255, 0.1)', borderRadius: '8px',
                  backgroundColor: 'rgba(0, 0, 0, 0.2)', color: 'white', fontSize: '1rem', outline: 'none'
                }}
              />
            </div>

            <div style={{ marginBottom: '1.5rem' }}>
              <label style={{ display: 'block', color: '#cbd5e1', fontSize: '0.85rem', marginBottom: '6px', fontWeight: 500 }}>Password</label>
              <input 
                type="password" 
                placeholder="e.g. doctor123 / pharmacist123"
                value={loginForm.password}
                onChange={e => setLoginForm({ ...loginForm, password: e.target.value })}
                style={{
                  width: '100%', padding: '0.75rem 1rem', border: '1px solid rgba(255, 255, 255, 0.1)', borderRadius: '8px',
                  backgroundColor: 'rgba(0, 0, 0, 0.2)', color: 'white', fontSize: '1rem', outline: 'none'
                }}
              />
            </div>

            {loginError && (
              <div style={{ color: '#fda29b', fontSize: '0.85rem', marginBottom: '1.25rem', textAlign: 'center', backgroundColor: 'rgba(240, 68, 56, 0.1)', padding: '8px', borderRadius: '6px' }}>
                {loginError}
              </div>
            )}

            <button 
              type="submit" 
              style={{
                width: '100%', padding: '0.8rem', border: 'none', borderRadius: '8px', backgroundColor: '#d9383a', color: 'white',
                fontSize: '1rem', fontWeight: 700, cursor: 'pointer', boxShadow: '0 4px 6px rgba(217, 56, 58, 0.2)'
              }}
            >
              Sign In
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <AppContext.Provider value={{ user, wsMessage, clearWsMessage, wsStatus, activeTab, setActiveTab }}>
      <div className="app-container">
        <Header handleLogout={handleLogout} />
        <div className="dashboard-layout">
          {user.role === 'doctor' ? (
            <DoctorDashboard />
          ) : (
            <PharmacistDashboard />
          )}
        </div>
      </div>
    </AppContext.Provider>
  );
}
