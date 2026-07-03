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
        setError('Wrong password');
      } else {
        onLogin();
      }
    } catch {
      setError('Connection failed');
    }
    setLoading(false);
  }

  return (
    <div className="login-container">
      <h1>Splitgate Admin</h1>
      <form onSubmit={handleSubmit} className="login-form">
        <input value={user} onChange={e => setUser(e.target.value)} placeholder="Username" autoComplete="username" />
        <input type="password" value={pass} onChange={e => setPass(e.target.value)} placeholder="Password" autoComplete="current-password" autoFocus />
        {error && <div className="error">{error}</div>}
        <button type="submit" disabled={loading}>{loading ? 'Connecting...' : 'Login'}</button>
      </form>
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
