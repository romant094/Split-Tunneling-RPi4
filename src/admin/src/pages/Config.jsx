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

  useEffect(() => {
    apiFetch('/api/config/exclude').then(r => r.json()).then(d => setContent(d.content || '')).catch(() => {})
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
    setUpdateMsg(r.ok ? `✓ Done` : `✗ ${d.error}`)
    setUpdating(false)
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Config</h1>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">RU Exclude List</CardTitle>
          <CardDescription>ru-list-exclude.txt — one CIDR per line to exclude from RU routes</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Textarea rows={12} value={content} onChange={e => setContent(e.target.value)} />
          <div className="flex items-center gap-3">
            <Button size="sm" onClick={save}>Save</Button>
            {saveMsg && <span className={`text-sm ${saveMsg.startsWith('✓') ? 'text-primary' : 'text-destructive'}`}>{saveMsg}</span>}
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">RU IP List</CardTitle>
          <CardDescription>Fetch fresh RU IP ranges from upstream source</CardDescription>
        </CardHeader>
        <CardContent className="flex items-center gap-3">
          <Button size="sm" variant="outline" onClick={refreshRUList} disabled={updating}>Refresh RU List</Button>
          {updateMsg && <span className={`text-sm ${updateMsg.startsWith('✗') ? 'text-destructive' : 'text-primary'}`}>{updateMsg}</span>}
        </CardContent>
      </Card>
    </div>
  )
}
