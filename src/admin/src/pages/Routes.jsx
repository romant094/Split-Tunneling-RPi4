import { useState, useEffect } from 'react'
import { apiFetch } from '../api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import { Trash2, Pencil, Plus, List, ArrowUpDown, ArrowUp, ArrowDown, Search, Wand2 } from 'lucide-react'
import DiffPreview from '../components/DiffPreview'
import {
  subscribe as subscribeStaging, getPending, clearPending,
  stageDescriptions, getPendingDescriptions, clearPendingDescriptions,
} from '../routeStaging'

const CIDR_RE = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\/\d{1,2}$/

// CIDR_RE only checks digit-group shape (1-3 digits per octet, 1-2 digit prefix);
// it accepts out-of-range values like 999.999.999.999/99. isValidCidr adds octet
// (0-255) and prefix (0-32) range checks on top (WR-05).
function isValidCidr(cidr) {
  if (!CIDR_RE.test(cidr)) return false
  const [ip, prefix] = cidr.split('/')
  const octets = ip.split('.').map(Number)
  if (octets.some(o => o < 0 || o > 255)) return false
  const p = Number(prefix)
  return p >= 0 && p <= 32
}

// Registry of each RouteSection's reload() fn, keyed by endpoint (vpn/isp),
// so RoutesPage.applyRoutes() can refresh both sections after Apply.
const _reloaders = {}

function ipSortKey(cidr) {
  const [ip, prefix] = cidr.split('/')
  // Defensively pad/clamp to exactly 4 octets so a malformed CIDR (fewer/more
  // dot-separated groups, non-numeric octets) sorts predictably instead of
  // producing "NaN" segments (IN-03).
  const octets = ip.split('.')
  const parts = Array.from({ length: 4 }, (_, i) => {
    const n = parseInt(octets[i], 10)
    return (Number.isFinite(n) ? n : 0).toString().padStart(3, '0')
  })
  return parts.join('.') + '/' + (prefix || '').padStart(2, '0')
}

function parseBulkText(text) {
  const entries = []
  let pendingComment = ''
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim()
    if (!line) { pendingComment = ''; continue }
    if (line.startsWith('#')) {
      const comment = line.replace(/^#+\s*/, '')
      pendingComment = pendingComment ? pendingComment + ' ' + comment : comment
      continue
    }
    if (line.includes('#')) {
      const idx = line.indexOf('#')
      const cidr = line.slice(0, idx).trim()
      const desc = line.slice(idx + 1).trim() || pendingComment
      if (isValidCidr(cidr)) entries.push({ cidr, description: desc })
    } else {
      if (isValidCidr(line)) entries.push({ cidr: line, description: pendingComment })
    }
    pendingComment = ''
  }
  return entries
}

function AddSingleDialog({ open, onClose, onAdd, existingCidrs }) {
  const [cidr, setCidr] = useState('')
  const [desc, setDesc] = useState('')
  const [err, setErr] = useState('')
  const [lookingUp, setLookingUp] = useState(false)

  function reset() { setCidr(''); setDesc(''); setErr(''); setLookingUp(false) }

  async function lookupOrg() {
    const c = cidr.trim()
    if (!isValidCidr(c)) return
    if (desc.trim() !== '') return // never clobber user-entered text
    const baseIp = c.split('/')[0]
    setLookingUp(true)
    try {
      const r = await apiFetch(`/api/diag/whois?ip=${encodeURIComponent(baseIp)}`)
      if (r.ok) {
        const d = await r.json()
        if (d && d.org && desc.trim() === '') setDesc(d.org)
      }
    } catch {
      // silent no-op on lookup failure
    } finally {
      setLookingUp(false)
    }
  }

  async function handleAdd() {
    const c = cidr.trim()
    if (!isValidCidr(c)) { setErr('Invalid CIDR format (e.g. 1.2.3.0/24)'); return }
    if (existingCidrs.has(c)) { setErr('This route already exists'); return }
    setErr('')
    const result = await onAdd({ cidr: c, description: desc.trim() })
    if (result && result.ok === false) return
    reset()
    onClose()
  }

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) { reset(); onClose() } }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add Route</DialogTitle>
          <DialogDescription>Enter a CIDR and optional description.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="space-y-1.5">
            <Label>CIDR</Label>
            <Input value={cidr} onChange={e => { setCidr(e.target.value); setErr('') }}
              placeholder="x.x.x.x/n" className="font-mono"
              onBlur={lookupOrg}
              onKeyDown={e => e.key === 'Enter' && handleAdd()} autoFocus />
          </div>
          <div className="space-y-1.5">
            <Label>Description <span className="text-muted-foreground font-normal">(optional)</span></Label>
            <Input value={desc} onChange={e => setDesc(e.target.value)}
              placeholder={lookingUp ? 'looking up…' : 'e.g. GitHub CDN'} />
          </div>
          {err && <p className="text-destructive text-sm">{err}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => { reset(); onClose() }}>Cancel</Button>
          <Button onClick={handleAdd}>Add</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function AddBulkDialog({ open, onClose, onBulkAdd }) {
  const [text, setText] = useState('')
  const [result, setResult] = useState(null)

  function reset() { setText(''); setResult(null) }

  async function handleAdd() {
    const entries = parseBulkText(text)
    if (entries.length === 0) { setResult({ error: 'No valid CIDRs found' }); return }
    const r = await onBulkAdd(entries)
    setResult(r)
    if (r.ok) { reset(); onClose() }
  }

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) { reset(); onClose() } }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Add Routes in Bulk</DialogTitle>
          <DialogDescription>
            Paste one CIDR per line. Lines starting with <code className="font-mono">#</code> become the description for the next CIDR. Duplicates are skipped automatically.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <Textarea
            value={text}
            onChange={e => { setText(e.target.value); setResult(null) }}
            placeholder={"# GitHub CDN\n185.199.108.0/22\n\n# Cloudflare\n1.0.0.0/24"}
            className="font-mono text-xs h-48"
          />
          {result && (
            <p className={`text-sm ${result.error ? 'text-destructive' : 'text-primary'}`}>
              {result.error || `✓ Added ${result.added} route(s)`}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => { reset(); onClose() }}>Cancel</Button>
          <Button onClick={handleAdd}>Import</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function EditDialog({ open, entry, onClose, onSave, existingCidrs }) {
  const [cidr, setCidr] = useState('')
  const [desc, setDesc] = useState('')
  const [err, setErr] = useState('')

  useEffect(() => {
    if (entry) { setCidr(entry.cidr); setDesc(entry.description || ''); setErr('') }
  }, [entry])

  async function handleSave() {
    const c = cidr.trim()
    if (!isValidCidr(c)) { setErr('Invalid CIDR format'); return }
    if (c !== entry.cidr && existingCidrs.has(c)) { setErr('A route with this CIDR already exists'); return }
    setErr('')
    const result = await onSave({ old_cidr: entry.cidr, cidr: c, description: desc.trim() })
    if (result && result.ok === false) return
    onClose()
  }

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose() }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Edit Route</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="space-y-1.5">
            <Label>CIDR</Label>
            <Input value={cidr} onChange={e => { setCidr(e.target.value); setErr('') }}
              className="font-mono" autoFocus />
          </div>
          <div className="space-y-1.5">
            <Label>Description <span className="text-muted-foreground font-normal">(optional)</span></Label>
            <Input value={desc} onChange={e => setDesc(e.target.value)} />
          </div>
          {err && <p className="text-destructive text-sm">{err}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function DeleteConfirmDialog({ open, cidr, onClose, onConfirm }) {
  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose() }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Remove Route</DialogTitle>
          <DialogDescription>
            Remove <code className="font-mono text-foreground">{cidr}</code>? This cannot be undone without re-adding it.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button variant="destructive" onClick={onConfirm}>Remove</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function SortIcon({ field, sortField, sortDir }) {
  if (sortField !== field) return <ArrowUpDown className="h-3 w-3 ml-1 text-muted-foreground/50" />
  return sortDir === 'asc'
    ? <ArrowUp className="h-3 w-3 ml-1 text-primary" />
    : <ArrowDown className="h-3 w-3 ml-1 text-primary" />
}

function RouteSection({ endpoint }) {
  const [routes, setRoutes] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('')
  const [sortField, setSortField] = useState('cidr')
  const [sortDir, setSortDir] = useState('asc')
  const [addSingle, setAddSingle] = useState(false)
  const [addBulk, setAddBulk] = useState(false)
  const [editEntry, setEditEntry] = useState(null)
  const [deleteEntry, setDeleteEntry] = useState(null)
  const [msg, setMsg] = useState('')
  const [msgTone, setMsgTone] = useState('error')
  const [staged, setStaged] = useState(() => getPending(endpoint))
  const [descEdits, setDescEdits] = useState(() => getPendingDescriptions(endpoint))
  const [fillProgress, setFillProgress] = useState(null)

  function load() {
    apiFetch(`/api/routes/${endpoint}`)
      .then(r => r.json())
      .then(d => { setRoutes(d.routes || []); setLoading(false) })
      .catch(() => { setLoading(false) })
  }

  useEffect(() => { setLoading(true); load() }, [endpoint])

  useEffect(() => {
    const unsub = subscribeStaging(state => {
      setStaged(state[endpoint] || [])
      setDescEdits(state.descriptions?.[endpoint] || {})
    })
    return unsub
  }, [endpoint])

  useEffect(() => {
    _reloaders[endpoint] = load
    return () => { if (_reloaders[endpoint] === load) delete _reloaders[endpoint] }
  })

  function toggleSort(field) {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortField(field); setSortDir('asc') }
  }

  const existingCidrs = new Set(routes.map(r => r.cidr))

  // Pattern 4 diff: additions are staged entries not already present server-side;
  // removals reserved for a future delete-staging feature (always empty for now).
  const additions = staged.filter(e => !existingCidrs.has(e.cidr))
  const removals = []

  // Overlay staged description edits onto the server-fetched routes so Fill
  // Descriptions results are visible/filterable/sortable before Apply.
  const displayRoutes = routes.map(r =>
    descEdits[r.cidr] !== undefined ? { ...r, description: descEdits[r.cidr] } : r
  )

  const modifications = Object.entries(descEdits)
    .filter(([cidr]) => existingCidrs.has(cidr))
    .map(([cidr, after]) => ({
      cidr,
      before: routes.find(r => r.cidr === cidr)?.description || '',
      after,
    }))

  const filtered = displayRoutes.filter(r =>
    !filter || r.cidr.includes(filter) || (r.description || '').toLowerCase().includes(filter.toLowerCase())
  )
  const sorted = [...filtered].sort((a, b) => {
    let va = sortField === 'cidr' ? ipSortKey(a.cidr) : (a.description || '').toLowerCase()
    let vb = sortField === 'cidr' ? ipSortKey(b.cidr) : (b.description || '').toLowerCase()
    return sortDir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va)
  })

  async function handleAdd(entry) {
    setMsg(''); setMsgTone('error')
    const r = await apiFetch(`/api/routes/${endpoint}`, { method: 'POST', body: JSON.stringify(entry) })
    if (!r.ok) { const d = await r.json(); setMsg(d.error); setMsgTone('error'); load(); return { ok: false } }
    load()
    return { ok: true }
  }

  async function handleBulkAdd(entries) {
    const r = await apiFetch(`/api/routes/${endpoint}/bulk`, { method: 'POST', body: JSON.stringify({ entries }) })
    const d = await r.json()
    if (r.ok) { load(); return { ok: true, added: d.added } }
    return { error: d.error || 'Error' }
  }

  async function handleEdit(payload) {
    setMsg(''); setMsgTone('error')
    const r = await apiFetch(`/api/routes/${endpoint}`, { method: 'PUT', body: JSON.stringify(payload) })
    if (!r.ok) { const d = await r.json(); setMsg(d.error); setMsgTone('error'); load(); return { ok: false } }
    load()
    return { ok: true }
  }

  async function fillDescriptions() {
    const targets = sorted.filter(r => !(r.description || '').trim())
    if (targets.length === 0) {
      setMsg('No routes are missing a description.'); setMsgTone('info')
      return
    }
    const n = targets.length
    setFillProgress({ done: 0, total: n })
    const results = {}
    try {
      let i = 0
      for (const r of targets) {
        try {
          const resp = await apiFetch(`/api/diag/whois?ip=${encodeURIComponent(r.cidr.split('/')[0])}`)
          if (resp.ok) {
            const d = await resp.json()
            if (d && typeof d.org === 'string' && d.org.trim()) results[r.cidr] = d.org.trim()
          }
        } catch {
          // skip this cidr, keep the batch going
        }
        i += 1
        setFillProgress({ done: i, total: n })
      }
      stageDescriptions(endpoint, results)
      setMsg(`Filled ${Object.keys(results).length} of ${n} description(s).`); setMsgTone('info')
    } finally {
      setFillProgress(null)
    }
  }

  async function handleDelete() {
    setMsg('')
    const r = await apiFetch(`/api/routes/${endpoint}`, { method: 'DELETE', body: JSON.stringify({ cidr: deleteEntry.cidr }) })
    if (!r.ok) { const d = await r.json(); setMsg(d.error) }
    setDeleteEntry(null)
    load()
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center gap-2">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
          <Input value={filter} onChange={e => setFilter(e.target.value)}
            placeholder="Filter by CIDR or description…" className="pl-8 h-8 text-sm" />
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => setAddSingle(true)}>
            <Plus className="h-3.5 w-3.5 mr-1" />Add
          </Button>
          <Button size="sm" variant="outline" onClick={() => setAddBulk(true)}>
            <List className="h-3.5 w-3.5 mr-1" />Add List
          </Button>
          <Button size="sm" variant="outline" onClick={fillDescriptions} disabled={!!fillProgress}>
            <Wand2 className="h-3.5 w-3.5 mr-1" />
            {fillProgress ? `Looking up ${fillProgress.done}/${fillProgress.total}...` : 'Fill Descriptions'}
          </Button>
        </div>
      </div>
      {(additions.length > 0 || removals.length > 0 || modifications.length > 0) && (
        <div className="space-y-1.5">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Pending changes</p>
          <DiffPreview additions={additions} removals={removals} modifications={modifications} />
        </div>
      )}
      {msg && <p className={`text-sm ${msgTone === 'error' ? 'text-destructive' : 'text-muted-foreground'}`}>{msg}</p>}
      {loading ? (
        <p className="text-muted-foreground text-sm py-4">Loading…</p>
      ) : sorted.length === 0 ? (
        <p className="text-muted-foreground text-sm py-4">
          {filter ? 'No routes match the filter.' : 'No routes configured.'}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-md border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>
                  <button className="flex items-center text-xs font-medium uppercase tracking-wide hover:text-foreground"
                    onClick={() => toggleSort('cidr')}>
                    CIDR <SortIcon field="cidr" sortField={sortField} sortDir={sortDir} />
                  </button>
                </TableHead>
                <TableHead>
                  <button className="flex items-center text-xs font-medium uppercase tracking-wide hover:text-foreground"
                    onClick={() => toggleSort('description')}>
                    Description <SortIcon field="description" sortField={sortField} sortDir={sortDir} />
                  </button>
                </TableHead>
                <TableHead className="w-20"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sorted.map(r => (
                <TableRow key={r.cidr}>
                  <TableCell className="font-mono text-sm w-40">{r.cidr}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{r.description || '—'}</TableCell>
                  <TableCell>
                    <div className="flex gap-1 justify-end">
                      <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground hover:text-foreground"
                        onClick={() => setEditEntry(r)}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground hover:text-destructive"
                        onClick={() => setDeleteEntry(r)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <p className="text-xs text-muted-foreground">{routes.length} total route{routes.length !== 1 ? 's' : ''}{filter && `, ${sorted.length} shown`}</p>

      <AddSingleDialog open={addSingle} onClose={() => setAddSingle(false)} onAdd={handleAdd} existingCidrs={existingCidrs} />
      <AddBulkDialog open={addBulk} onClose={() => setAddBulk(false)} onBulkAdd={handleBulkAdd} />
      <EditDialog open={!!editEntry} entry={editEntry} onClose={() => setEditEntry(null)} onSave={handleEdit} existingCidrs={existingCidrs} />
      <DeleteConfirmDialog open={!!deleteEntry} cidr={deleteEntry?.cidr} onClose={() => setDeleteEntry(null)} onConfirm={handleDelete} />
    </div>
  )
}

function downloadBackup(blob) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `splitgate-routes-backup-${new Date().toISOString().slice(0, 10)}.txt`
  document.body.appendChild(a); a.click()
  document.body.removeChild(a); URL.revokeObjectURL(url)
}

export default function RoutesPage() {
  const [applyMsg, setApplyMsg] = useState('')
  const [applying, setApplying] = useState(false)
  const [backingUp, setBackingUp] = useState(false)

  async function flushStagedList(list) {
    const entries = getPending(list)
    if (!entries.length) return true
    const r = await apiFetch(`/api/routes/${list}/bulk`, { method: 'POST', body: JSON.stringify({ entries }) })
    if (!r.ok) return false
    clearPending(list)
    return true
  }

  async function applyRoutes() {
    setApplying(true)
    setApplyMsg('Applying…')
    try {
      // Bulk-write-then-apply: flush any staged adds (from Routes edits or Logs
      // batch-add) into the route files first, then activate via config/apply.
      // Only clear staged entries once the bulk write actually succeeded, so a
      // failed write never silently discards pending routes (CR-02).
      const okVpn = await flushStagedList('vpn')
      const okIsp = await flushStagedList('isp')
      if (!okVpn || !okIsp) {
        setApplyMsg('Error: failed to save staged routes — not applied, changes kept pending')
        return
      }
      const r = await apiFetch('/api/config/apply', { method: 'POST' })
      const d = await r.json()
      setApplyMsg(r.ok ? '✓ Applied' : `Error: ${d.error}`)
      if (_reloaders.vpn) _reloaders.vpn()
      if (_reloaders.isp) _reloaders.isp()
    } catch {
      setApplyMsg('Error: apply failed')
    } finally {
      setApplying(false)
    }
  }

  async function downloadBackupNow() {
    setBackingUp(true)
    try {
      const r = await apiFetch('/api/routes/backup')
      if (r.ok) downloadBackup(await r.blob())
    } finally {
      setBackingUp(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-start gap-3">
        <div className="flex-1">
          <h1 className="text-2xl font-semibold">Routes</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Manage custom CIDR routes. <strong>VPN</strong> tab — force traffic through the tunnel.
            <strong> ISP</strong> tab — force traffic through the direct ISP connection. Click <em>Apply</em> to activate changes.
          </p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <Button onClick={downloadBackupNow} disabled={backingUp} size="sm" variant="outline">Download Backup</Button>
          <Button onClick={applyRoutes} disabled={applying} size="sm">Apply Changes</Button>
          {applyMsg && <span className={`text-sm ${applyMsg.startsWith('Error') ? 'text-destructive' : 'text-primary'}`}>{applyMsg}</span>}
        </div>
      </div>

      <Tabs defaultValue="vpn">
        <TabsList>
          <TabsTrigger value="vpn">VPN Routes</TabsTrigger>
          <TabsTrigger value="isp">ISP Routes</TabsTrigger>
        </TabsList>
        <TabsContent value="vpn" className="mt-4">
          <p className="text-sm text-muted-foreground mb-4">
            CIDRs in this list are force-routed through the AmneziaWG VPN tunnel — overrides the auto-downloaded RU list.
          </p>
          <RouteSection endpoint="vpn" />
        </TabsContent>
        <TabsContent value="isp" className="mt-4">
          <p className="text-sm text-muted-foreground mb-4">
            CIDRs in this list bypass the VPN and are routed directly via the ISP (Keenetic).
          </p>
          <RouteSection endpoint="isp" />
        </TabsContent>
      </Tabs>
    </div>
  )
}
