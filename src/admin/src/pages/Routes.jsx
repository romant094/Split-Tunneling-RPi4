import { useState, useEffect } from 'react'
import { apiFetch } from '../api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Trash2, Plus } from 'lucide-react'

const CIDR_RE = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\/\d{1,2}$/

function RouteSection({ title, endpoint }) {
  const [routes, setRoutes] = useState([])
  const [input, setInput] = useState('')
  const [msg, setMsg] = useState('')

  function load() {
    apiFetch(`/api/routes/${endpoint}`).then(r => r.json()).then(d => setRoutes(d.routes || [])).catch(() => {})
  }

  useEffect(() => { load() }, [endpoint])

  async function addRoute() {
    const cidr = input.trim()
    if (!CIDR_RE.test(cidr)) { setMsg('Invalid CIDR'); return }
    setMsg('')
    const r = await apiFetch(`/api/routes/${endpoint}`, { method: 'POST', body: JSON.stringify({ cidr }) })
    const d = await r.json()
    if (!r.ok) { setMsg(d.error); return }
    setInput('')
    load()
  }

  async function removeRoute(cidr) {
    await apiFetch(`/api/routes/${endpoint}`, { method: 'DELETE', body: JSON.stringify({ cidr }) })
    load()
  }

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">{title}</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <div className="flex gap-2">
          <Input value={input} onChange={e => setInput(e.target.value)} placeholder="x.x.x.x/n"
            className="max-w-[200px]" onKeyDown={e => e.key === 'Enter' && addRoute()} />
          <Button size="sm" onClick={addRoute}><Plus className="h-4 w-4 mr-1" />Add</Button>
          {msg && <span className="text-destructive text-sm self-center">{msg}</span>}
        </div>
        {routes.length === 0 ? (
          <p className="text-muted-foreground text-sm">No routes configured</p>
        ) : (
          <Table>
            <TableHeader><TableRow><TableHead>CIDR</TableHead><TableHead className="w-16"></TableHead></TableRow></TableHeader>
            <TableBody>
              {routes.map(cidr => (
                <TableRow key={cidr}>
                  <TableCell className="font-mono text-sm">{cidr}</TableCell>
                  <TableCell>
                    <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={() => removeRoute(cidr)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}

export default function RoutesPage() {
  const [applyMsg, setApplyMsg] = useState('')
  const [applying, setApplying] = useState(false)

  async function applyRoutes() {
    setApplying(true)
    setApplyMsg('Applying…')
    const r = await apiFetch('/api/config/apply', { method: 'POST' })
    const d = await r.json()
    setApplyMsg(r.ok ? '✓ Applied' : `Error: ${d.error}`)
    setApplying(false)
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <h1 className="text-2xl font-semibold">Routes</h1>
        <Button onClick={applyRoutes} disabled={applying} size="sm">Apply Changes</Button>
        {applyMsg && <span className={`text-sm ${applyMsg.startsWith('Error') ? 'text-destructive' : 'text-primary'}`}>{applyMsg}</span>}
      </div>
      <RouteSection title="VPN Force-Routes (vpn-routes-custom.txt)" endpoint="vpn" />
      <RouteSection title="ISP Exception Routes (isp-routes-custom.txt)" endpoint="isp" />
    </div>
  )
}
