import { useState, useEffect } from 'react'
import { apiFetch } from '../api'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

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
      <h1 className="text-2xl font-semibold">Dashboard</h1>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">VPN Tunnel</CardTitle></CardHeader>
          <CardContent><Badge variant={status.tunnel_up ? 'success' : 'destructive'}>{status.tunnel_up ? 'UP' : 'DOWN'}</Badge></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Watch Daemon</CardTitle></CardHeader>
          <CardContent><Badge variant={status.daemon_up ? 'success' : 'destructive'}>{status.daemon_up ? 'running' : 'stopped'}</Badge></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">RU List Updated</CardTitle></CardHeader>
          <CardContent><span className="text-sm font-mono">{status.ru_list_updated || '—'}</span></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">VPN Routes</CardTitle></CardHeader>
          <CardContent><span className="text-3xl font-bold">{status.vpn_route_count}</span></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">ISP Routes</CardTitle></CardHeader>
          <CardContent><span className="text-3xl font-bold">{status.isp_route_count}</span></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">RU Routes</CardTitle></CardHeader>
          <CardContent><span className="text-3xl font-bold">{status.ru_route_count}</span></CardContent>
        </Card>
      </div>
    </div>
  )
}
