import { useState } from 'react'
import { HashRouter, Routes, Route, NavLink } from 'react-router-dom'
import { Shield, LayoutDashboard, Server, Route as RouteIcon, FileText, Settings2, LogOut } from 'lucide-react'
import { setAuth, clearAuth, apiFetch, apiLogout } from './api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { AlertCircle } from 'lucide-react'
import Dashboard from './pages/Dashboard'
import Services from './pages/Services'
import RoutesPage from './pages/Routes'
import Logs from './pages/Logs'
import Config from './pages/Config'
import Settings from './pages/Settings'
import './App.css'

function LoginForm({ onLogin }) {
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
      const r = await apiFetch('/api/status')
      if (r.status === 401) {
        clearAuth()
        setError('Wrong credentials')
      } else {
        onLogin()
      }
    } catch {
      setError('Connection failed')
    }
    setLoading(false)
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background" style={{ background: 'radial-gradient(ellipse at 50% 40%, hsl(122 20% 8%) 0%, hsl(0 0% 7%) 60%)' }}>
      <Card className="w-[380px] border-border/50 shadow-2xl">
        <CardHeader className="items-center text-center pb-2">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 border border-primary/20 mb-3">
            <Shield className="h-7 w-7 text-primary" />
          </div>
          <CardTitle className="text-2xl tracking-tight">Splitgate</CardTitle>
          <CardDescription className="uppercase tracking-widest text-xs">VPN Gateway Admin</CardDescription>
        </CardHeader>
        <CardContent className="pt-4">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="username">Username</Label>
              <Input id="username" value={user} onChange={e => setUser(e.target.value)} autoComplete="username" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">Password</Label>
              <Input id="password" type="password" value={pass} onChange={e => setPass(e.target.value)} autoComplete="current-password" autoFocus />
            </div>
            {error && (
              <Alert variant="destructive" className="py-2">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? 'Connecting…' : 'Sign in'}
            </Button>
          </form>
          <p className="text-center text-muted-foreground/40 text-xs mt-6 font-mono">192.168.1.254:8080</p>
        </CardContent>
      </Card>
    </div>
  )
}

const NAV = [
  { to: '/', end: true, icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/services', icon: Server, label: 'Services' },
  { to: '/routes', icon: RouteIcon, label: 'Routes' },
  { to: '/logs', icon: FileText, label: 'Logs' },
  { to: '/config', icon: Settings2, label: 'Config' },
  { to: '/settings', icon: Settings2, label: 'Settings' },
]

export default function App() {
  const [loggedIn, setLoggedIn] = useState(!!sessionStorage.getItem('sg_auth'))

  async function handleLogout() {
    await apiLogout()
    setLoggedIn(false)
  }

  if (!loggedIn) return <LoginForm onLogin={() => setLoggedIn(true)} />

  return (
    <HashRouter>
      <div className="min-h-screen flex flex-col">
        <nav className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-40">
          <div className="max-w-7xl mx-auto px-4 flex items-center h-14 gap-6">
            <div className="flex items-center gap-2 font-semibold text-primary">
              <Shield className="h-5 w-5" />
              <span>Splitgate</span>
            </div>
            <div className="flex items-center gap-1 flex-1">
              {NAV.map(({ to, end, icon: Icon, label }) => (
                <NavLink key={to} to={to} end={end}
                  className={({ isActive }) =>
                    `flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm transition-colors ${isActive ? 'bg-primary/10 text-primary font-medium' : 'text-muted-foreground hover:text-foreground hover:bg-accent'}`
                  }>
                  <Icon className="h-3.5 w-3.5" />
                  {label}
                </NavLink>
              ))}
            </div>
            <Button variant="ghost" size="sm" onClick={handleLogout} className="text-muted-foreground hover:text-foreground gap-1.5">
              <LogOut className="h-3.5 w-3.5" />
              Logout
            </Button>
          </div>
        </nav>
        <main className="flex-1 max-w-7xl mx-auto w-full px-4 py-6">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/services" element={<Services />} />
            <Route path="/routes" element={<RoutesPage />} />
            <Route path="/logs" element={<Logs />} />
            <Route path="/config" element={<Config />} />
            <Route path="/settings" element={<Settings />} />
          </Routes>
        </main>
      </div>
    </HashRouter>
  )
}
