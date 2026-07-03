import { useState, useEffect } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { apiFetch } from '../api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import { Separator } from '@/components/ui/separator'

function KVEditor({ title, description, endpoint, note }) {
  const [vars, setVars] = useState({})
  const [edited, setEdited] = useState({})
  const [revealed, setRevealed] = useState({})
  const [msg, setMsg] = useState('')

  useEffect(() => {
    apiFetch(endpoint).then(r => r.json()).then(d => { setVars(d.vars || {}); setEdited({}) }).catch(() => {})
  }, [endpoint])

  function handleChange(k, v) { setEdited(e => ({ ...e, [k]: v })) }

  async function save() {
    const changed = {}
    for (const k in edited) { if (edited[k] !== '***') changed[k] = edited[k] }
    const r = await apiFetch(endpoint, { method: 'PUT', body: JSON.stringify({ vars: changed }) })
    setMsg(r.ok ? '✓ Saved' : '✗ Error')
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent className="space-y-3">
        {Object.entries(vars).map(([k, v]) => {
          const isMasked = v === '***'
          const val = edited[k] !== undefined ? edited[k] : v
          const isRevealed = revealed[k]
          return (
            <div key={k} className="grid grid-cols-[180px_1fr_auto] gap-2 items-center">
              <Label className="font-mono text-xs text-muted-foreground normal-case tracking-normal truncate">{k}</Label>
              <Input type={isMasked && !isRevealed ? 'password' : 'text'} value={val} onChange={e => handleChange(k, e.target.value)} />
              {isMasked && (
                <Button type="button" variant="ghost" size="icon" className="h-9 w-9" onClick={() => setRevealed(r => ({ ...r, [k]: !r[k] }))}>
                  {isRevealed ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
              )}
            </div>
          )
        })}
        <div className="flex items-center gap-3 pt-2">
          <Button size="sm" onClick={save}>Save</Button>
          {msg && <span className={`text-sm ${msg.startsWith('✓') ? 'text-primary' : 'text-destructive'}`}>{msg}</span>}
        </div>
        {note && <p className="text-muted-foreground text-xs">{note}</p>}
      </CardContent>
    </Card>
  )
}

function PasswordChange() {
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [msg, setMsg] = useState('')

  async function change() {
    if (pw !== pw2) { setMsg('Passwords do not match'); return }
    if (!pw) { setMsg('Password required'); return }
    const r = await apiFetch('/api/settings/password', { method: 'POST', body: JSON.stringify({ password: pw }) })
    setMsg(r.ok ? '✓ Password changed' : '✗ Error')
    if (r.ok) { setPw(''); setPw2('') }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Admin Password</CardTitle>
        <CardDescription>Change the password for this admin interface</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 gap-3 max-w-md">
          <div className="space-y-1.5">
            <Label>New password</Label>
            <Input type="password" value={pw} onChange={e => setPw(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Confirm</Label>
            <Input type="password" value={pw2} onChange={e => setPw2(e.target.value)} />
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Button size="sm" onClick={change}>Change Password</Button>
          {msg && <span className={`text-sm ${msg.startsWith('✓') ? 'text-primary' : 'text-destructive'}`}>{msg}</span>}
        </div>
      </CardContent>
    </Card>
  )
}

function RollbackSection() {
  const [open, setOpen] = useState(false)
  const [confirm, setConfirm] = useState('')
  const [msg, setMsg] = useState('')

  async function doRollback() {
    const r = await apiFetch('/api/settings/rollback', { method: 'POST', body: JSON.stringify({ confirmation: 'ROLLBACK' }) })
    const d = await r.json()
    setMsg(r.ok ? d.message : `Error: ${d.error}`)
    setOpen(false)
  }

  return (
    <Card className="border-destructive/30">
      <CardHeader>
        <CardTitle className="text-base text-destructive">Danger Zone</CardTitle>
        <CardDescription>Irreversible operations. Use with caution.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div>
          <p className="text-sm text-muted-foreground mb-3">Rollback removes the VPN gateway configuration and stops all services. The connection to this admin panel will be lost.</p>
          <Button variant="destructive" size="sm" onClick={() => setOpen(true)}>Rollback VPN Gateway</Button>
        </div>
        {msg && <p className="text-destructive text-sm">{msg}</p>}
      </CardContent>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm Rollback</DialogTitle>
            <DialogDescription>
              This will tear down the entire VPN gateway and is <strong>not reversible</strong> without re-running deploy.sh. The connection to this admin panel will drop immediately.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5 py-2">
            <Label>Type <span className="font-mono text-destructive">ROLLBACK</span> to confirm</Label>
            <Input value={confirm} onChange={e => setConfirm(e.target.value)} placeholder="ROLLBACK" className="font-mono" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setOpen(false); setConfirm('') }}>Cancel</Button>
            <Button variant="destructive" disabled={confirm !== 'ROLLBACK'} onClick={doRollback}>Confirm Rollback</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  )
}

export default function Settings() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Settings</h1>
      <KVEditor title="Environment Variables" description="vpn-gateway.env — runtime configuration" endpoint="/api/settings/env" />
      <KVEditor title="AWG Secrets" description="awg0.conf — WireGuard key material" endpoint="/api/settings/secrets" note="Changes take effect after restarting awg0 service" />
      <Separator />
      <PasswordChange />
      <Separator />
      <RollbackSection />
    </div>
  )
}
