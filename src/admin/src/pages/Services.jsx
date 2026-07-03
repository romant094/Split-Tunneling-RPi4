import { useState, useEffect, useRef } from 'react'
import { apiFetch } from '../api'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'

// Admin is excluded from this page (managed separately)
const DISPLAY_SERVICES = ['awg0', 'splitgate-watch', 'networking', 'dnsmasq']

const SERVICE_META = {
  'awg0': {
    label: 'AmneziaWG VPN',
    desc: 'VPN tunnel — encrypts all non-RU traffic and routes it through the VPN provider.',
    restartTime: '3–5 sec',
  },
  'splitgate-watch': {
    label: 'Splitgate Watch',
    desc: 'Traffic monitor — reads the routing log in real time and classifies flows by VPN or ISP path.',
    restartTime: '1–2 sec',
  },
  'networking': {
    label: 'Networking',
    desc: 'Debian network stack — manages physical interfaces, IP addresses, and static routes. Restart may briefly interrupt all LAN traffic.',
    restartTime: '10–30 sec',
  },
  'dnsmasq': {
    label: 'dnsmasq (DHCP)',
    desc: 'DHCP server for LAN devices — assigns IP addresses and sets the gateway. Active leases are unaffected during restart.',
    restartTime: '1–2 sec',
  },
}

function statusVariant(s) {
  if (s === 'active') return 'success'
  if (s === 'failed') return 'destructive'
  if (s === 'inactive') return 'secondary'
  return 'warning'
}

export default function Services() {
  const [services, setServices] = useState([])
  const [loading, setLoading] = useState({})
  const [bulkLoading, setBulkLoading] = useState(null)
  const [msg, setMsg] = useState('')

  const esRef = useRef(null)

  function load() {
    apiFetch('/api/services')
      .then(r => r.json())
      .then(all => setServices(all.filter(s => DISPLAY_SERVICES.includes(s.name))))
      .catch(() => {})
  }

  useEffect(() => {
    function connect() {
      const es = new EventSource('/api/services/watch')
      esRef.current = es
      es.onmessage = e => {
        try {
          const all = JSON.parse(e.data)
          setServices(all.filter(s => DISPLAY_SERVICES.includes(s.name)))
        } catch {}
      }
      es.onerror = () => { es.close(); setTimeout(connect, 5000) }
    }
    connect()
    return () => { esRef.current?.close() }
  }, [])

  async function action(name, act) {
    setLoading(l => ({ ...l, [name]: act }))
    setMsg('')
    const r = await apiFetch(`/api/services/${name}/${act}`, { method: 'POST' })
    if (!r.ok) {
      const d = await r.json()
      setMsg(`Error: ${d.error}`)
    }
    setLoading(l => ({ ...l, [name]: null }))
    load()
  }

  async function bulkAction(act) {
    setBulkLoading(act)
    setMsg('')
    const r = await apiFetch(`/api/services/bulk/${act}`, { method: 'POST' })
    if (!r.ok) {
      const d = await r.json()
      setMsg(`Bulk ${act} errors: ${(d.errors || []).join(', ')}`)
    } else {
      setMsg(`✓ ${act.charAt(0).toUpperCase() + act.slice(1)} all done`)
    }
    setBulkLoading(null)
    load()
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Services</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Manage VPN gateway services. Auto-refreshes every 5 s.
        </p>
      </div>
      {msg && <p className={`text-sm ${msg.startsWith('✓') ? 'text-primary' : 'text-destructive'}`}>{msg}</p>}
      <div className="space-y-3">
        {services.map(svc => {
          const busy = loading[svc.name]
          const isActive = svc.status === 'active'
          const isInactive = svc.status === 'inactive' || svc.status === 'unknown'
          const meta = SERVICE_META[svc.name] || { label: svc.name, desc: '', restartTime: '?' }
          return (
            <Card key={svc.name}>
              <CardContent className="pt-4 pb-4">
                <div className="flex flex-col sm:flex-row sm:items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-sm">{meta.label}</span>
                      <span className="font-mono text-xs text-muted-foreground">({svc.name})</span>
                      <Badge variant={statusVariant(svc.status)}>{busy || svc.status}</Badge>
                    </div>
                    <p className="text-muted-foreground text-sm mt-1">{meta.desc}</p>
                    <p className="text-xs text-muted-foreground/60 mt-0.5">
                      Restart time: <span className="text-muted-foreground">{meta.restartTime}</span>
                    </p>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <Button size="sm" disabled={isActive || !!busy} onClick={() => action(svc.name, 'start')}>
                      Start
                    </Button>
                    <Button size="sm" variant="destructive" disabled={isInactive || !!busy} onClick={() => action(svc.name, 'stop')}>
                      Stop
                    </Button>
                    <Button size="sm" variant="outline" disabled={isInactive || !!busy} onClick={() => action(svc.name, 'restart')}>
                      Restart
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>

      <Card>
        <CardContent className="pt-4 pb-4">
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <div className="flex-1 min-w-0">
              <span className="font-medium text-sm">Bulk Actions</span>
              <p className="text-muted-foreground text-sm mt-0.5">Apply action to all services (admin excluded).</p>
            </div>
            <div className="flex gap-2 shrink-0">
              <Button size="sm" disabled={!!bulkLoading} onClick={() => bulkAction('start')}>
                {bulkLoading === 'start' ? 'Starting…' : 'Start All'}
              </Button>
              <Button size="sm" variant="destructive" disabled={!!bulkLoading} onClick={() => bulkAction('stop')}>
                {bulkLoading === 'stop' ? 'Stopping…' : 'Stop All'}
              </Button>
              <Button size="sm" variant="outline" disabled={!!bulkLoading} onClick={() => bulkAction('restart')}>
                {bulkLoading === 'restart' ? 'Restarting…' : 'Restart All'}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
