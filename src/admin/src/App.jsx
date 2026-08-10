import { useState, useEffect } from 'react'
import { HashRouter, Routes, Route, NavLink } from 'react-router-dom'
import { Shield, LayoutDashboard, Server, Route as RouteIcon, FileText, Settings2, Cog, LogOut, Menu, X, Activity } from 'lucide-react'
import { setAuth, clearAuth, apiFetch, apiLogout, checkAuth } from './api'
import { subscribeMeta } from './logStream'
import { useDocumentTitle, RouteTitle } from './hooks/useDocumentTitle'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { AlertCircle } from 'lucide-react'
import Dashboard from './pages/Dashboard'
import Services from './pages/Services'
import RoutesPage from './pages/Routes'
import LogsLayout, { LogsLive, LogsHistory, LogsInstall, LogsErrors, LogsJournal } from './pages/Logs'
import Config from './pages/Config'
import Diagnostics from './pages/Diagnostics'
import Settings from './pages/Settings'
import './App.css'

function LoginForm({ onLogin }) {
  useDocumentTitle('Sign in — Splitgate')
  const [user, setUser] = useState('admin')
  const [pass, setPass] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setLoading(true)
    setError('')
    setAuth(user, pass)
    try {
      const r = await fetch('/api/status', {
        credentials: 'include',
        headers: { 'Authorization': 'Basic ' + btoa(user + ':' + pass) },
      })
      if (r.status === 401) {
        clearAuth()
        setError('Wrong username or password')
      } else {
        onLogin()
      }
    } catch {
      clearAuth()
      setError('Cannot reach the server')
    }
    setLoading(false)
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4"
      style={{ background: 'radial-gradient(ellipse at 50% 35%, hsl(122 20% 8%) 0%, hsl(0 0% 6%) 65%)' }}>
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-8">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 border border-primary/20 mb-4">
            <Shield className="h-8 w-8 text-primary" />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">Splitgate</h1>
          <p className="text-muted-foreground text-xs uppercase tracking-widest mt-1">VPN Gateway Admin</p>
        </div>

        <Card className="border-border/50 shadow-2xl">
          <CardContent className="pt-6 pb-6">
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="username">Username</Label>
                <Input
                  id="username"
                  value={user}
                  onChange={e => setUser(e.target.value)}
                  autoComplete="username"
                  disabled={loading}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  value={pass}
                  onChange={e => setPass(e.target.value)}
                  autoComplete="current-password"
                  autoFocus
                  disabled={loading}
                />
              </div>
              {error && (
                <Alert variant="destructive" className="py-2">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}
              <Button type="submit" className="w-full mt-2" disabled={loading}>
                {loading ? 'Signing in…' : 'Sign in'}
              </Button>
            </form>
          </CardContent>
        </Card>

        <p className="text-center text-muted-foreground/30 text-xs mt-6 font-mono">192.168.1.254</p>
      </div>
    </div>
  )
}

const NAV = [
  { to: '/', end: true, icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/services', icon: Server, label: 'Services' },
  { to: '/routes', icon: RouteIcon, label: 'Routes' },
  { to: '/logs', icon: FileText, label: 'Logs' },
  { to: '/diagnostics', icon: Activity, label: 'Diagnostics' },
  { to: '/config', icon: Settings2, label: 'Config' },
  { to: '/settings', icon: Cog, label: 'Settings' },
]

function NavItems({ onNav }) {
  return NAV.map(({ to, end, icon: Icon, label }) => (
    <NavLink key={to} to={to} end={end} onClick={onNav}
      className={({ isActive }) =>
        `flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors ${isActive
          ? 'bg-primary/10 text-primary font-medium'
          : 'text-muted-foreground hover:text-foreground hover:bg-accent'}`
      }>
      <Icon className="h-4 w-4 shrink-0" />
      {label}
    </NavLink>
  ))
}

export default function App() {
  const [authState, setAuthState] = useState('checking')
  const [mobileOpen, setMobileOpen] = useState(false)
  const [logBgMode, setLogBgMode] = useState(false)

  useEffect(() => subscribeMeta(s => setLogBgMode(s.bgMode)), [])

  useEffect(() => {
    checkAuth().then(ok => setAuthState(ok ? 'in' : 'out'))
  }, [])

  async function handleLogout() {
    await apiLogout()
    setAuthState('out')
  }

  if (authState === 'checking') {
    return (
      <div className="min-h-screen flex items-center justify-center"
        style={{ background: 'radial-gradient(ellipse at 50% 35%, hsl(122 20% 8%) 0%, hsl(0 0% 6%) 65%)' }}>
        <div className="flex flex-col items-center gap-3 text-muted-foreground">
          <Shield className="h-8 w-8 text-primary animate-pulse" />
          <span className="text-xs uppercase tracking-widest">Loading…</span>
        </div>
      </div>
    )
  }

  if (authState === 'out') return <LoginForm onLogin={() => setAuthState('in')} />

  return (
    <HashRouter>
      <RouteTitle />
      <div className="min-h-screen flex flex-col">
        {/* Top nav */}
        <nav className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-40">
          <div className="max-w-7xl mx-auto px-4 flex items-center h-14 gap-4">
            <NavLink to="/" className="flex items-center gap-2 font-semibold text-primary shrink-0 hover:opacity-80 transition-opacity">
              <Shield className="h-5 w-5" />
              <span>Splitgate</span>
            </NavLink>

            {/* Desktop nav */}
            <div className="hidden md:flex items-center gap-1 flex-1">
              <NavItems />
            </div>

            {logBgMode && (
              <span className="hidden sm:flex items-center gap-1.5 text-xs text-primary ml-auto">
                <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse shrink-0" />
                Logs recording
              </span>
            )}
            <div className="flex items-center gap-2 ml-auto sm:ml-0">
              <Button variant="ghost" size="sm" onClick={handleLogout}
                className="hidden md:flex text-muted-foreground hover:text-foreground gap-1.5">
                <LogOut className="h-3.5 w-3.5" />
                Logout
              </Button>
              {/* Mobile menu toggle */}
              <Button variant="ghost" size="icon" className="md:hidden h-8 w-8"
                onClick={() => setMobileOpen(o => !o)}>
                {mobileOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
              </Button>
            </div>
          </div>

          {/* Mobile nav drawer */}
          {mobileOpen && (
            <div className="md:hidden border-t border-border bg-card px-4 py-3 flex flex-col gap-1">
              <NavItems onNav={() => setMobileOpen(false)} />
              <div className="mt-2 pt-2 border-t border-border">
                <Button variant="ghost" size="sm" onClick={handleLogout}
                  className="w-full justify-start text-muted-foreground hover:text-foreground gap-2">
                  <LogOut className="h-4 w-4" />
                  Logout
                </Button>
              </div>
            </div>
          )}
        </nav>

        <main className="flex-1 max-w-7xl mx-auto w-full px-4 py-6">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/services" element={<Services />} />
            <Route path="/routes" element={<RoutesPage />} />
            <Route path="/logs" element={<LogsLayout />}>
              <Route index element={<LogsLive />} />
              <Route path="live" element={<LogsLive />} />
              <Route path="history" element={<LogsHistory />} />
              <Route path="install" element={<LogsInstall />} />
              <Route path="errors" element={<LogsErrors />} />
              <Route path="journal" element={<LogsJournal />} />
            </Route>
            <Route path="/diagnostics" element={<Diagnostics />} />
            <Route path="/config" element={<Config />} />
            <Route path="/settings" element={<Settings />} />
          </Routes>
        </main>
      </div>
    </HashRouter>
  )
}
