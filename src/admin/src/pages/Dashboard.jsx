import { useState, useEffect } from 'react'
import { apiFetch } from '../api'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

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

export default function Dashboard() {
  const [status, setStatus] = useState(null)

  useEffect(() => {
    function load() {
      apiFetch('/api/status').then(r => r.json()).then(setStatus).catch(() => {})
    }
    load()
    const id = setInterval(load, 10000)
    return () => clearInterval(id)
  }, [])

  if (!status) return <div className="text-muted-foreground text-sm p-4">Loading…</div>

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <p className="text-muted-foreground text-sm mt-1">Live status overview. Auto-refreshes every 10 s.</p>
      </div>

      {/* Services */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Services</CardTitle>
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

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* RU IP List */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">RU IP List</CardTitle>
            <CardDescription>Auto-downloaded Russian IP ranges</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm text-muted-foreground">Last updated</span>
              <span className="text-sm font-mono">{status.ru_list_updated || '—'}</span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm text-muted-foreground">Total routes</span>
              <span className="text-2xl font-bold">{status.ru_route_count}</span>
            </div>
          </CardContent>
        </Card>

        {/* Routes breakdown */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Routes</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-2">VPN</p>
              <div className="space-y-2 pl-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">From IP list</span>
                  <span className="text-xl font-semibold">{status.ru_route_count}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Custom (manual)</span>
                  <span className="text-xl font-semibold">{status.vpn_custom_count ?? '—'}</span>
                </div>
              </div>
            </div>
            <div className="border-t border-border pt-3">
              <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-2">ISP</p>
              <div className="pl-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">ISP exceptions</span>
                  <span className="text-xl font-semibold">{status.isp_route_count}</span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
