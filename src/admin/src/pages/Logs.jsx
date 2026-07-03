import { useState, useEffect, useRef } from 'react'
import { apiFetch } from '../api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'

function LogBox({ lines, colorize }) {
  const ref = useRef(null)
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight
  }, [lines])
  return (
    <div className="log-container" ref={ref}>
      {lines.map((line, i) => {
        let cls = ''
        if (colorize) {
          if (line.includes('[VPN]')) cls = 'log-line-vpn'
          else if (line.includes('[ISP]')) cls = 'log-line-isp'
        }
        return <div key={i} className={cls}>{line || ' '}</div>
      })}
      {lines.length === 0 && <div className="text-muted-foreground">No output</div>}
    </div>
  )
}

function WatchLive() {
  const [lines, setLines] = useState([])
  const [filter, setFilter] = useState('')
  const [tagFilter, setTagFilter] = useState('both')

  useEffect(() => {
    const es = new EventSource('/api/logs/watch', { withCredentials: true })
    es.onmessage = e => setLines(prev => [...prev, e.data].slice(-1000))
    return () => es.close()
  }, [])

  const visible = lines.filter(l => {
    if (filter && !l.includes(filter)) return false
    if (tagFilter === 'vpn' && !l.includes('[VPN]')) return false
    if (tagFilter === 'isp' && !l.includes('[ISP]')) return false
    return true
  })

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Input value={filter} onChange={e => setFilter(e.target.value)} placeholder="Filter…" className="max-w-[200px] h-8" />
        {['both', 'vpn', 'isp'].map(t => (
          <Button key={t} size="sm" variant={tagFilter === t ? 'default' : 'outline'} className="h-8 uppercase text-xs" onClick={() => setTagFilter(t)}>{t}</Button>
        ))}
        <Button size="sm" variant="ghost" className="h-8" onClick={() => setLines([])}>Clear</Button>
        <span className="text-muted-foreground text-xs ml-auto">{visible.length} lines</span>
      </div>
      <LogBox lines={visible} colorize />
    </div>
  )
}

function StaticLog({ endpoint }) {
  const [lines, setLines] = useState([])
  function load() {
    apiFetch(endpoint).then(r => r.json()).then(d => setLines(d.lines || [])).catch(() => {})
  }
  useEffect(() => { load() }, [endpoint])
  return (
    <div className="space-y-3">
      <Button size="sm" variant="outline" onClick={load}>Refresh</Button>
      <LogBox lines={lines} colorize={false} />
    </div>
  )
}

export default function Logs() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Logs</h1>
      <Tabs defaultValue="live">
        <TabsList>
          <TabsTrigger value="live">Watch Live</TabsTrigger>
          <TabsTrigger value="install">Install Log</TabsTrigger>
          <TabsTrigger value="errors">Watch Errors</TabsTrigger>
          <TabsTrigger value="journal">System Journal</TabsTrigger>
        </TabsList>
        <TabsContent value="live"><WatchLive /></TabsContent>
        <TabsContent value="install"><StaticLog endpoint="/api/logs/install" /></TabsContent>
        <TabsContent value="errors"><StaticLog endpoint="/api/logs/watch-errors" /></TabsContent>
        <TabsContent value="journal"><StaticLog endpoint="/api/logs/journal" /></TabsContent>
      </Tabs>
    </div>
  )
}
