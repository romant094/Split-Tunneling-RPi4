import { useState, useEffect, useCallback } from 'react'
import { apiFetch } from '../api'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { RefreshCw } from 'lucide-react'

const SERVICE_LABELS = {
  'awg0': 'AmneziaWG VPN',
  'splitgate-watch': 'Watch Daemon',
  'splitgate-admin': 'Admin Interface',
  'networking': 'Networking',
  'dnsmasq': 'DHCP (dnsmasq)',
}

function statusVariant(s) {
  if (s === 'active') return 'success'
  if (s === 'failed') return 'destructive'
  if (s === 'inactive') return 'secondary'
  return 'warning'
}

function fmt(bytes) {
  if (bytes === 0) return '—'
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function fmtGB(bytes) {
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`
}

function UsageBar({ pct, className = '' }) {
  const color = pct > 85 ? 'bg-destructive' : pct > 60 ? 'bg-amber-500' : 'bg-primary'
  return (
    <div className={`h-1.5 rounded-full bg-border overflow-hidden ${className}`}>
      <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${Math.min(pct, 100)}%` }} />
    </div>
  )
}

export default function Dashboard() {
  const [status, setStatus] = useState(null)
  const [resources, setResources] = useState(null)
  const [refreshing, setRefreshing] = useState(false)

  const loadStatus = useCallback(() => {
    return apiFetch('/api/status').then(r => r.json()).then(setStatus).catch(() => {})
  }, [])

  const loadResources = useCallback(() => {
    return apiFetch('/api/status/resources').then(r => r.json()).then(setResources).catch(() => {})
  }, [])

  useEffect(() => {
    loadStatus()
    loadResources()
    const id1 = setInterval(loadStatus, 10000)
    const id2 = setInterval(loadResources, 5000)
    return () => { clearInterval(id1); clearInterval(id2) }
  }, [loadStatus, loadResources])

  async function handleRefresh() {
    setRefreshing(true)
    await Promise.all([loadStatus(), loadResources()])
    setRefreshing(false)
  }

  if (!status) return <div className="text-muted-foreground text-sm p-4">Loading…</div>

  const memPct = resources ? Math.round(resources.mem_used / resources.mem_total * 100) : 0
  const diskPct = resources ? Math.round(resources.disk_used / resources.disk_total * 100) : 0

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <p className="text-muted-foreground text-sm mt-1">Live status overview. Auto-refreshes every 10 s.</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* Services */}
        <Card>
          <CardHeader className="pb-3 flex flex-row items-start justify-between space-y-0">
            <div>
              <CardTitle className="text-base">Services</CardTitle>
              <CardDescription className="mt-0.5">Systemd unit status</CardDescription>
            </div>
            <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0" onClick={handleRefresh} disabled={refreshing}>
              <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            </Button>
          </CardHeader>
          <CardContent>
            <div className="space-y-2.5">
              {(status.services || []).map(svc => (
                <div key={svc.name} className="flex items-center justify-between gap-4">
                  <div>
                    <span className="text-sm">{SERVICE_LABELS[svc.name] || svc.name}</span>
                    <span className="text-xs text-muted-foreground ml-2 font-mono">({svc.name})</span>
                  </div>
                  <Badge variant={statusVariant(svc.status)}>{svc.status}</Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Routes */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Routes</CardTitle>
            <CardDescription>
              RU list updated: <span className="font-mono text-xs text-foreground">{status.ru_list_updated || '—'}</span>
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-2">ISP (direct)</p>
              <div className="space-y-2 pl-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">From RU IP list</span>
                  <span className="text-xl font-semibold">{status.ru_route_count ?? '—'}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Custom ISP routes</span>
                  <span className="text-xl font-semibold">{status.isp_route_count ?? '—'}</span>
                </div>
              </div>
            </div>
            <div className="border-t border-border pt-3">
              <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-2">VPN (tunnel)</p>
              <div className="pl-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Custom VPN routes</span>
                  <span className="text-xl font-semibold">{status.vpn_custom_count ?? '—'}</span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Resources */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Resources</CardTitle>
          <CardDescription>System and per-service usage. Refreshes every 5 s.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {/* System metrics */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">CPU</span>
                <span className="font-mono font-semibold">{resources ? `${resources.cpu_percent}%` : '—'}</span>
              </div>
              <UsageBar pct={resources?.cpu_percent ?? 0} />
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">RAM</span>
                <span className="font-mono font-semibold">
                  {resources ? `${fmtGB(resources.mem_used)} / ${fmtGB(resources.mem_total)} (${memPct}%)` : '—'}
                </span>
              </div>
              <UsageBar pct={memPct} />
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Disk</span>
                <span className="font-mono font-semibold">
                  {resources ? `${fmtGB(resources.disk_used)} / ${fmtGB(resources.disk_total)} (${diskPct}%)` : '—'}
                </span>
              </div>
              <UsageBar pct={diskPct} />
            </div>
          </div>

          {/* Per-service table */}
          <div className="border-t border-border pt-4">
            <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-3">Per service</p>
            <div className="space-y-2">
              {(resources?.services || []).map(svc => (
                <div key={svc.name} className="flex items-center gap-3">
                  <span className="text-sm text-muted-foreground w-40 shrink-0 font-mono">{svc.name}</span>
                  <div className="flex-1 space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground w-8">CPU</span>
                      <UsageBar pct={svc.cpu} className="flex-1" />
                      <span className="text-xs font-mono w-10 text-right">{svc.cpu.toFixed(1)}%</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground w-8">MEM</span>
                      <UsageBar pct={svc.mem / (resources.mem_total || 1) * 100} className="flex-1" />
                      <span className="text-xs font-mono w-10 text-right">{fmt(svc.mem)}</span>
                    </div>
                  </div>
                </div>
              ))}
              {!resources && <p className="text-sm text-muted-foreground">Loading…</p>}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
