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

export default function Dashboard() {
  const [status, setStatus] = useState(null)
  const [refreshing, setRefreshing] = useState(false)

  const load = useCallback(() => {
    return apiFetch('/api/status').then(r => r.json()).then(setStatus).catch(() => {})
  }, [])

  useEffect(() => {
    load()
    const id = setInterval(load, 10000)
    return () => clearInterval(id)
  }, [load])

  async function handleRefresh() {
    setRefreshing(true)
    await load()
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

        {/* Routes summary */}
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
    </div>
  )
}
