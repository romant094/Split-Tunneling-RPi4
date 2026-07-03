import { useState, useEffect } from 'react'
import { apiFetch } from '../api'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'

export default function Config() {
  const [content, setContent] = useState('')
  const [saveMsg, setSaveMsg] = useState('')
  const [updateMsg, setUpdateMsg] = useState('')
  const [updating, setUpdating] = useState(false)
  const [ruUpdated, setRuUpdated] = useState(null)

  useEffect(() => {
    apiFetch('/api/config/exclude').then(r => r.json()).then(d => setContent(d.content || '')).catch(() => {})
    apiFetch('/api/status').then(r => r.json()).then(d => setRuUpdated(d.ru_list_updated || null)).catch(() => {})
  }, [])

  async function save() {
    const r = await apiFetch('/api/config/exclude', { method: 'PUT', body: JSON.stringify({ content }) })
    setSaveMsg(r.ok ? '✓ Saved' : '✗ Error saving')
  }

  async function refreshRUList() {
    setUpdating(true)
    setUpdateMsg('Updating…')
    const r = await apiFetch('/api/config/update', { method: 'POST' })
    const d = await r.json()
    setUpdateMsg(r.ok ? '✓ Done' : `✗ ${d.error}`)
    if (r.ok) {
      apiFetch('/api/status').then(r2 => r2.json()).then(s => setRuUpdated(s.ru_list_updated || null)).catch(() => {})
    }
    setUpdating(false)
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Config</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Manage the RU IP exclusion list and trigger upstream route updates.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">RU Exclude List</CardTitle>
          <CardDescription>
            <code className="font-mono text-xs">ru-list-exclude.txt</code> — one CIDR per line.
            These ranges are excluded from the auto-downloaded Russian IP list, meaning they route via VPN instead of ISP.
            Useful for non-Russian services that share IP space with Russian ranges.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Textarea
            rows={12}
            value={content}
            onChange={e => setContent(e.target.value)}
            placeholder="No exclusions configured. Add one CIDR per line, e.g.:&#10;185.199.108.0/22"
            className="font-mono text-xs"
          />
          <div className="flex items-center gap-3">
            <Button size="sm" onClick={save}>Save</Button>
            {saveMsg && <span className={`text-sm ${saveMsg.startsWith('✓') ? 'text-primary' : 'text-destructive'}`}>{saveMsg}</span>}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
          <div>
            <CardTitle className="text-base">RU IP List</CardTitle>
            <CardDescription>
              Fetch a fresh copy of Russian IP ranges from the upstream source configured in <code className="font-mono text-xs">RU_SUBNET_URL</code>.
              Runs the same script as the daily cron job.
              {ruUpdated && (
                <span className="block mt-1 font-mono text-xs text-muted-foreground/70">Last updated: {ruUpdated}</span>
              )}
            </CardDescription>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            {updateMsg && <span className={`text-sm ${updateMsg.startsWith('✗') ? 'text-destructive' : 'text-primary'}`}>{updateMsg}</span>}
            <Button size="sm" variant="outline" onClick={refreshRUList} disabled={updating}>
              {updating ? 'Updating…' : 'Refresh RU List'}
            </Button>
          </div>
        </CardHeader>
      </Card>
    </div>
  )
}
