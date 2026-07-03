import { useState, useEffect, useRef } from 'react'
import { Eye, EyeOff, Upload } from 'lucide-react'
import { apiFetch } from '../api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Separator } from '@/components/ui/separator'

// Only these env vars are surfaced in the UI
const ENV_CONFIG = [
  { key: 'RU_SUBNET_URL', label: 'Route list URL', hint: 'URL to fetch Russian IP ranges from (used by the daily update cron).' },
  { key: 'UPDATE_INTERVAL', label: 'Route update interval', hint: 'How often the RU IP list is refreshed (cron expression or interval).' },
]

function EnvVars() {
  const [vars, setVars] = useState({})
  const [edited, setEdited] = useState({})
  const [msg, setMsg] = useState('')

  useEffect(() => {
    apiFetch('/api/settings/env').then(r => r.json()).then(d => {
      setVars(d.vars || {})
      setEdited({})
    }).catch(() => {})
  }, [])

  function handleChange(k, v) {
    setEdited(e => ({ ...e, [k]: v }))
  }

  async function save() {
    const changed = {}
    for (const k in edited) { if (edited[k] !== '***') changed[k] = edited[k] }
    const r = await apiFetch('/api/settings/env', { method: 'PUT', body: JSON.stringify({ vars: changed }) })
    setMsg(r.ok ? '✓ Saved' : '✗ Error')
    if (r.ok) {
      setVars(v => ({ ...v, ...changed }))
      setEdited({})
    }
  }

  const visibleKeys = ENV_CONFIG.filter(c => c.key in vars)

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Environment Variables</CardTitle>
        <CardDescription>Runtime configuration from <code className="font-mono text-xs">vpn-gateway.env</code></CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {visibleKeys.length === 0 && (
          <p className="text-muted-foreground text-sm">No variables loaded.</p>
        )}
        {visibleKeys.map(({ key, label, hint }) => {
          const val = edited[key] !== undefined ? edited[key] : (vars[key] || '')
          return (
            <div key={key} className="space-y-1">
              <Label className="text-sm">
                {label}
                <span className="text-muted-foreground font-normal ml-1 font-mono text-xs">({key})</span>
              </Label>
              <Input
                value={val}
                onChange={e => handleChange(key, e.target.value)}
                className="max-w-sm font-mono text-sm"
              />
              <p className="text-xs text-muted-foreground">{hint}</p>
            </div>
          )
        })}
        <div className="flex items-center gap-3 flex-wrap pt-1">
          <Button size="sm" onClick={save}>Save</Button>
          {msg && <span className={`text-sm ${msg.startsWith('✓') ? 'text-primary' : 'text-destructive'}`}>{msg}</span>}
        </div>
      </CardContent>
    </Card>
  )
}

function AwgConfig() {
  const [showDialog, setShowDialog] = useState(false)
  const [sections, setSections] = useState([])
  const [revealed, setRevealed] = useState({})
  const [uploadText, setUploadText] = useState('')
  const [uploadMsg, setUploadMsg] = useState('')
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef(null)

  function loadConfig() {
    apiFetch('/api/settings/awg-config').then(r => r.json()).then(d => {
      setSections(d.sections || [])
      setRevealed({})
    }).catch(() => {})
  }

  function openDialog() { loadConfig(); setShowDialog(true) }

  function toggleReveal(section, key) {
    const k = `${section}::${key}`
    setRevealed(r => ({ ...r, [k]: !r[k] }))
  }

  function handleFileSelect(e) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = ev => setUploadText(ev.target.result || '')
    reader.readAsText(file)
  }

  async function uploadConfig() {
    if (!uploadText.trim()) { setUploadMsg('No content to upload'); return }
    setUploading(true)
    setUploadMsg('')
    const r = await apiFetch('/api/settings/awg-config', { method: 'PUT', body: JSON.stringify({ content: uploadText }) })
    const d = await r.json()
    setUploadMsg(r.ok ? '✓ Config uploaded' : `✗ ${d.error}`)
    setUploading(false)
    if (r.ok) { setUploadText(''); loadConfig() }
  }

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
          <div>
            <CardTitle className="text-base">AWG Config</CardTitle>
            <CardDescription>
              AmneziaWG tunnel configuration from <code className="font-mono text-xs">awg0.conf</code>.
              Sensitive keys (PrivateKey, PresharedKey) are masked by default.
            </CardDescription>
          </div>
          <Button size="sm" variant="outline" onClick={openDialog} className="shrink-0">
            Show Config
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <p className="text-sm text-muted-foreground mb-3">Upload a complete <code className="font-mono text-xs">awg0.conf</code> to replace the current configuration.</p>
            <div className="flex flex-wrap items-center gap-2">
              <input type="file" ref={fileRef} accept=".conf,text/plain" onChange={handleFileSelect} className="hidden" />
              <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()}>
                <Upload className="h-3.5 w-3.5 mr-1" />
                Select File
              </Button>
              {uploadText && (
                <Button size="sm" onClick={uploadConfig} disabled={uploading}>
                  {uploading ? 'Uploading…' : 'Upload Config'}
                </Button>
              )}
              {uploadMsg && <span className={`text-sm ${uploadMsg.startsWith('✓') ? 'text-primary' : 'text-destructive'}`}>{uploadMsg}</span>}
            </div>
            {uploadText && (
              <div className="mt-3">
                <p className="text-xs text-muted-foreground mb-1">Preview:</p>
                <pre className="text-xs font-mono bg-muted rounded-md p-3 max-h-40 overflow-y-auto whitespace-pre-wrap">{uploadText.slice(0, 800)}{uploadText.length > 800 ? '\n…' : ''}</pre>
              </div>
            )}
          </div>
          <p className="text-xs text-muted-foreground">After uploading, restart the <code className="font-mono">awg0</code> service on the Services page.</p>
        </CardContent>
      </Card>

      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="max-w-[600px] w-[90vw]">
          <DialogHeader>
            <DialogTitle>AWG Config</DialogTitle>
            <DialogDescription>Current contents of awg0.conf. Sensitive values are masked.</DialogDescription>
          </DialogHeader>
          <div className="max-h-[60vh] overflow-y-auto space-y-4">
            {sections.length === 0 && <p className="text-muted-foreground text-sm">Config not found on server.</p>}
            {sections.map((section, si) => (
              <div key={si}>
                <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-2">[{section.name}]</p>
                <Table>
                  <TableBody>
                    {section.keys.map(({ key, value, masked }) => {
                      const revKey = `${section.name}::${key}`
                      const isRevealed = revealed[revKey]
                      const displayVal = masked && !isRevealed ? '•••••••••••••••••••••••' : value
                      return (
                        <TableRow key={key} className="text-xs">
                          <TableCell className="font-mono font-medium w-40 py-1.5">{key}</TableCell>
                          <TableCell className="font-mono text-muted-foreground py-1.5 break-all">{displayVal}</TableCell>
                          {masked && (
                            <TableCell className="py-1.5 w-8">
                              <button onClick={() => toggleReveal(section.name, key)} className="text-muted-foreground hover:text-foreground">
                                {isRevealed ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                              </button>
                            </TableCell>
                          )}
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDialog(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
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
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-md">
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
          <p className="text-sm text-muted-foreground mb-3">
            Rollback removes the VPN gateway configuration and stops all services.
            The connection to this admin panel will be lost.
          </p>
          <Button variant="destructive" size="sm" onClick={() => setOpen(true)}>Rollback VPN Gateway</Button>
        </div>
        {msg && <p className="text-destructive text-sm">{msg}</p>}
      </CardContent>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm Rollback</DialogTitle>
            <DialogDescription>
              This will tear down the entire VPN gateway and is <strong>not reversible</strong> without re-running deploy.sh.
              The connection to this admin panel will drop immediately.
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
      <div>
        <h1 className="text-2xl font-semibold">Settings</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Runtime configuration, VPN keys, admin password, and system rollback.
        </p>
      </div>
      <EnvVars />
      <AwgConfig />
      <Separator />
      <PasswordChange />
      <Separator />
      <RollbackSection />
    </div>
  )
}
