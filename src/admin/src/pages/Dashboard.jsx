import { useState, useEffect, useCallback, useRef } from 'react'
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

function fmtMem(bytes) {
  if (!bytes) return '—'
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function fmtGB(bytes) {
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`
}

function useResourcesSSE() {
  const [resources, setResources] = useState(null)
  const esRef = useRef(null)

  useEffect(() => {
    function connect() {
      const es = new EventSource('/api/resources/watch')
      esRef.current = es
      es.onmessage = e => {
        try { setResources(JSON.parse(e.data)) } catch {}
      }
      es.onerror = () => { es.close(); setTimeout(connect, 5000) }
    }
    connect()
    return () => { esRef.current?.close() }
  }, [])

  return resources
}

export default function Dashboard() {
  const [status, setStatus] = useState(null)
  const [refreshing, setRefreshing] = useState(false)
  const resources = useResourcesSSE()

  const loadStatus = useCallback(() =>
    apiFetch('/api/status').then(r => r.json()).then(setStatus).catch(() => {}), [])

  useEffect(() => {
    loadStatus()
    const id = setInterval(loadStatus, 10000)
    return () => clearInterval(id)
  }, [loadStatus])

  async function handleRefresh() {
    setRefreshing(true)
    await loadStatus()
    setRefreshing(false)
  }

  if (!status) return <div className="text-muted-foreground text-sm p-4">Loading…</div>

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
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Routes</CardTitle>
          </CardHeader>
          <CardContent className="space-y-0">
            {/* Date right-aligned with separator */}
            <div className="flex justify-end pb-2">
              <span className="text-sm text-muted-foreground font-mono">
                {status.ru_list_updated || '—'}
              </span>
            </div>
            <div className="border-t border-border pt-3 space-y-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-2">ISP (direct)</p>
                <div className="space-y-2 pl-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">From RU IP list</span>
                    <span className="text-base font-mono">{status.ru_route_count ?? '—'}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Custom ISP routes</span>
                    <span className="text-base font-mono">{status.isp_route_count ?? '—'}</span>
                  </div>
                </div>
              </div>
              <div className="border-t border-border pt-3">
                <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-2">VPN (tunnel)</p>
                <div className="pl-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Custom VPN routes</span>
                    <span className="text-base font-mono">{status.vpn_custom_count ?? '—'}</span>
                  </div>
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
          <CardDescription>System and per-service usage. Live via SSE.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* System summary row */}
          <div className="grid grid-cols-3 gap-4 text-sm">
            <div>
              <span className="text-xs uppercase tracking-widest text-muted-foreground block mb-0.5">CPU</span>
              <span className="font-mono">{resources ? `${resources.cpu_percent}%` : '—'}</span>
            </div>
            <div>
              <span className="text-xs uppercase tracking-widest text-muted-foreground block mb-0.5">RAM</span>
              <span className="font-mono">
                {resources ? `${fmtGB(resources.mem_used)} / ${fmtGB(resources.mem_total)}` : '—'}
              </span>
            </div>
            <div>
              <span className="text-xs uppercase tracking-widest text-muted-foreground block mb-0.5">Disk</span>
              <span className="font-mono">
                {resources ? `${fmtGB(resources.disk_used)} / ${fmtGB(resources.disk_total)}` : '—'}
              </span>
            </div>
          </div>

          {/* Per-service table */}
          <div className="border-t border-border pt-3">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs uppercase tracking-widest text-muted-foreground">
                  <th className="text-left font-normal pb-2">Service</th>
                  <th className="text-right font-normal pb-2 w-20">CPU</th>
                  <th className="text-right font-normal pb-2 w-24">RAM</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {(resources?.services || []).map(svc => (
                  <tr key={svc.name}>
                    <td className="py-1.5 font-mono text-muted-foreground">{svc.name}</td>
                    <td className="py-1.5 text-right font-mono">{svc.cpu.toFixed(1)}%</td>
                    <td className="py-1.5 text-right font-mono">{fmtMem(svc.mem)}</td>
                  </tr>
                ))}
                {!resources && (
                  <tr><td colSpan={3} className="py-2 text-muted-foreground">Connecting…</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
