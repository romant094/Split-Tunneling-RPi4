import { useState, useEffect } from 'react'
import { apiFetch } from '../api'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

function statusVariant(s) {
  if (s === 'active') return 'success'
  if (s === 'failed') return 'destructive'
  if (s === 'inactive') return 'secondary'
  return 'warning'
}

export default function Services() {
  const [services, setServices] = useState([])
  const [loading, setLoading] = useState({})
  const [msg, setMsg] = useState('')

  function load() {
    apiFetch('/api/services').then(r => r.json()).then(setServices).catch(() => {})
  }

  useEffect(() => {
    load()
    const id = setInterval(load, 5000)
    return () => clearInterval(id)
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

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Services</h1>
      {msg && <p className="text-destructive text-sm">{msg}</p>}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Service</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {services.map(svc => {
            const busy = loading[svc.name]
            const isActive = svc.status === 'active'
            const isInactive = svc.status === 'inactive' || svc.status === 'unknown'
            return (
              <TableRow key={svc.name}>
                <TableCell className="font-mono text-sm">{svc.name}</TableCell>
                <TableCell><Badge variant={statusVariant(svc.status)}>{busy || svc.status}</Badge></TableCell>
                <TableCell className="flex gap-2">
                  <Button size="sm" disabled={isActive || !!busy} onClick={() => action(svc.name, 'start')}>Start</Button>
                  <Button size="sm" variant="destructive" disabled={isInactive || !!busy} onClick={() => action(svc.name, 'stop')}>Stop</Button>
                  <Button size="sm" variant="outline" disabled={isInactive || !!busy} onClick={() => action(svc.name, 'restart')}>Restart</Button>
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}
