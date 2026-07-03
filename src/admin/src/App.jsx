import { useState } from 'react';
import { HashRouter, Routes, Route, NavLink } from 'react-router-dom';
import { setAuth, clearAuth, apiFetch, apiLogout } from './api';
import Dashboard from './pages/Dashboard';
import Services from './pages/Services';
import RoutesPage from './pages/Routes';
import Logs from './pages/Logs';
import Config from './pages/Config';
import Settings from './pages/Settings';
import './App.css';

function LoginForm({ onLogin }) {
  const [user, setUser] = useState('admin');
  const [pass, setPass] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setLoading(true);
    setError('');
    setAuth(user, pass);
    try {
      const r = await apiFetch('/api/status');
      if (r.status === 401) {
        clearAuth();
        setError('Wrong credentials');
      } else {
        onLogin();
      }
    } catch {
      setError('Connection failed');
    }
    setLoading(false);
  }

  return (
    <div className="login-bg">
      <div className="login-card">
        <div className="login-logo">
          <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
            <circle cx="20" cy="20" r="20" fill="#4caf50" fillOpacity="0.15"/>
            <path d="M20 8 L28 14 L28 22 C28 27 24 31 20 33 C16 31 12 27 12 22 L12 14 Z" stroke="#4caf50" strokeWidth="2" fill="none"/>
            <path d="M16 20 L19 23 L24 17" stroke="#4caf50" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </div>
        <h1 className="login-title">Splitgate</h1>
        <p className="login-subtitle">VPN Gateway Admin</p>
        <form onSubmit={handleSubmit} className="login-form">
          <div className="login-field">
            <label>Username</label>
            <input
              value={user}
              onChange={e => setUser(e.target.value)}
              autoComplete="username"
              spellCheck={false}
            />
          </div>
          <div className="login-field">
            <label>Password</label>
            <input
              type="password"
              value={pass}
              onChange={e => setPass(e.target.value)}
              autoComplete="current-password"
              autoFocus
            />
          </div>
          {error && (
            <div className="login-error">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <circle cx="7" cy="7" r="6" stroke="#f44336" strokeWidth="1.5"/>
                <path d="M7 4v3.5M7 9.5v.5" stroke="#f44336" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
              {error}
            </div>
          )}
          <button type="submit" className="login-btn" disabled={loading}>
            {loading ? (
              <span className="login-spinner">●●●</span>
            ) : 'Sign in'}
          </button>
        </form>
        <div className="login-hint">192.168.1.254:8080</div>
      </div>
    </div>
  );
}

export default function App() {
  const [loggedIn, setLoggedIn] = useState(!!sessionStorage.getItem('sg_auth'));

  async function handleLogout() {
    await apiLogout();
    setLoggedIn(false);
  }

  if (!loggedIn) return <LoginForm onLogin={() => setLoggedIn(true)} />;

  return (
    <HashRouter>
      <nav className="navbar">
        <span className="nav-brand">Splitgate</span>
        <div className="nav-links">
          <NavLink to="/" end className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}>Dashboard</NavLink>
          <NavLink to="/services" className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}>Services</NavLink>
          <NavLink to="/routes" className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}>Routes</NavLink>
          <NavLink to="/logs" className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}>Logs</NavLink>
          <NavLink to="/config" className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}>Config</NavLink>
          <NavLink to="/settings" className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}>Settings</NavLink>
        </div>
        <button className="logout-btn" onClick={handleLogout}>Logout</button>
      </nav>
      <main className="main-content">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/services" element={<Services />} />
          <Route path="/routes" element={<RoutesPage />} />
          <Route path="/logs" element={<Logs />} />
          <Route path="/config" element={<Config />} />
          <Route path="/settings" element={<Settings />} />
        </Routes>
      </main>
    </HashRouter>
  );
}
