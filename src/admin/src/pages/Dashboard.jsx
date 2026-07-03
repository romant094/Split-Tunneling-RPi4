import { useState, useEffect, useCallback, useRef } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
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

function useSSE(url, onData) {
  const esRef = useRef(null)
  const onDataRef = useRef(onData)
  onDataRef.current = onData

  useEffect(() => {
    function connect() {
      const es = new EventSource(url)
      esRef.current = es
      es.onmessage = e => {
        try { onDataRef.current(JSON.parse(e.data)) } catch {}
      }
      es.onerror = () => { es.close(); setTimeout(connect, 5000) }
    }
    connect()
    return () => { esRef.current?.close() }
  }, [url])
}

export default function Dashboard() {
  const [status, setStatus] = useState(null)
  const [resources, setResources] = useState(null)
  const [refreshing, setRefreshing] = useState(false)

  useSSE('/api/status/watch', setStatus)
  useSSE('/api/resources/watch', setResources)

  async function handleRefresh() {
    setRefreshing(true)
    try {
      const [s, r] = await Promise.all([
        fetch('/api/status').then(r => r.json()),
        fetch('/api/status/resources').then(r => r.json()),
      ])
      setStatus(s)
      setResources(r)
    } catch {}
    setRefreshing(false)
  }

  if (!status) return <div className="text-muted-foreground text-sm p-4">Loading…</div>

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <p className="text-muted-foreground text-sm mt-1">Live status overview via SSE.</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* Services */}
        <Card>
          <CardHeader className="pb-3 flex flex-row items-start justify-between space-y-0">
            <CardTitle className="text-base">Services</CardTitle>
            <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0 -mt-0.5" onClick={handleRefresh} disabled={refreshing}>
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
          <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">Routes</CardTitle>
            <span className="text-sm font-mono text-muted-foreground">{status.ru_list_updated || '—'}</span>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="border-t border-border pt-3 space-y-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-2">ISP (direct)</p>
                <div className="space-y-1.5 pl-3">
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
        </CardHeader>
        <CardContent className="space-y-4">
          {/* System 3 rows */}
          <div className="space-y-2 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground w-12">CPU</span>
              <span className="font-mono">{resources ? `${resources.cpu_percent}%` : '—'}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground w-12">RAM</span>
              <span className="font-mono">
                {resources ? `${fmtGB(resources.mem_used)} / ${fmtGB(resources.mem_total)}` : '—'}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground w-12">Disk</span>
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
