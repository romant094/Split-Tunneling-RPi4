import { useState, useEffect, useRef } from 'react'
import { apiFetch } from '../api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Badge } from '@/components/ui/badge'

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

function todayStr() {
  return new Date().toISOString().slice(0, 10)
}

export default function Logs() {
  const [activeTab, setActiveTab] = useState('live')

  // Live log state — lifted here so it persists across tab switches
  const [liveLines, setLiveLines] = useState([])
  const [liveFilter, setLiveFilter] = useState('')
  const [liveTag, setLiveTag] = useState('both')
  const [bgMode, setBgMode] = useState(false)
  const [connected, setConnected] = useState(false)
  const esRef = useRef(null)

  // Historical log state
  const [histDate, setHistDate] = useState(todayStr())
  const [histLines, setHistLines] = useState([])
  const [histLoading, setHistLoading] = useState(false)
  const [histMsg, setHistMsg] = useState('')

  // Connect SSE when on live tab OR background mode is on
  useEffect(() => {
    const shouldConnect = activeTab === 'live' || bgMode
    if (shouldConnect && !esRef.current) {
      const es = new EventSource('/api/logs/watch', { withCredentials: true })
      es.onopen = () => setConnected(true)
      es.onmessage = e => setLiveLines(prev => [...prev, e.data].slice(-1000))
      es.onerror = () => setConnected(false)
      esRef.current = es
      setConnected(true)
    }
    if (!shouldConnect && esRef.current) {
      esRef.current.close()
      esRef.current = null
      setConnected(false)
    }
  }, [activeTab, bgMode])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      esRef.current?.close()
      esRef.current = null
    }
  }, [])

  async function loadHistory() {
    setHistLoading(true)
    setHistMsg('')
    try {
      const r = await apiFetch(`/api/logs/history?date=${histDate}`)
      const d = await r.json()
      if (!r.ok) { setHistMsg(d.error || 'Error'); setHistLoading(false); return }
      setHistLines(d.lines || [])
      if (!d.found) setHistMsg(`No log file for ${histDate}`)
    } catch { setHistMsg('Connection error') }
    setHistLoading(false)
  }

  const visibleLive = liveLines.filter(l => {
    if (liveFilter && !l.includes(liveFilter)) return false
    if (liveTag === 'vpn' && !l.includes('[VPN]')) return false
    if (liveTag === 'isp' && !l.includes('[ISP]')) return false
    return true
  })

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Logs</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Real-time and historical traffic logs, install output, and system journal.
        </p>
      </div>
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="live">
            Watch Live
            {connected && <span className="ml-1.5 h-1.5 w-1.5 rounded-full bg-primary inline-block" />}
          </TabsTrigger>
          <TabsTrigger value="history">Historical</TabsTrigger>
          <TabsTrigger value="install">Install Log</TabsTrigger>
          <TabsTrigger value="errors">Watch Errors</TabsTrigger>
          <TabsTrigger value="journal">System Journal</TabsTrigger>
        </TabsList>

        <TabsContent value="live" className="mt-4">
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Input value={liveFilter} onChange={e => setLiveFilter(e.target.value)}
                placeholder="Filter…" className="max-w-[180px] h-8 text-sm" />
              {['both', 'vpn', 'isp'].map(t => (
                <Button key={t} size="sm" variant={liveTag === t ? 'default' : 'outline'}
                  className="h-8 uppercase text-xs" onClick={() => setLiveTag(t)}>{t}</Button>
              ))}
              <Button size="sm" variant="ghost" className="h-8" onClick={() => setLiveLines([])}>Clear</Button>
              <Button
                size="sm"
                variant={bgMode ? 'default' : 'outline'}
                className="h-8 ml-auto"
                onClick={() => setBgMode(b => !b)}
                title="Keep SSE stream alive when switching tabs"
              >
                {bgMode ? '● Background ON' : '○ Background'}
              </Button>
              <span className="text-muted-foreground text-xs">{visibleLive.length} lines</span>
            </div>
            {!connected && (
              <p className="text-muted-foreground text-xs">Connecting to live stream…</p>
            )}
            <LogBox lines={visibleLive} colorize />
          </div>
        </TabsContent>

        <TabsContent value="history" className="mt-4">
          <div className="space-y-3">
            <div className="flex items-center gap-2 flex-wrap">
              <input
                type="date"
                value={histDate}
                max={todayStr()}
                onChange={e => setHistDate(e.target.value)}
                className="h-8 rounded-md border border-input bg-background px-3 text-sm text-foreground"
              />
              <Button size="sm" variant="outline" onClick={loadHistory} disabled={histLoading}>
                {histLoading ? 'Loading…' : 'Load'}
              </Button>
              {histMsg && <span className="text-muted-foreground text-sm">{histMsg}</span>}
              {histLines.length > 0 && <span className="text-xs text-muted-foreground ml-auto">{histLines.length} lines</span>}
            </div>
            {histLines.length > 0 ? (
              <LogBox lines={histLines} colorize />
            ) : (
              <p className="text-muted-foreground text-sm py-4">Select a date and click Load to view historical traffic log.</p>
            )}
          </div>
        </TabsContent>

        <TabsContent value="install" className="mt-4">
          <StaticLog endpoint="/api/logs/install" />
        </TabsContent>
        <TabsContent value="errors" className="mt-4">
          <StaticLog endpoint="/api/logs/watch-errors" />
        </TabsContent>
        <TabsContent value="journal" className="mt-4">
          <StaticLog endpoint="/api/logs/journal" />
        </TabsContent>
      </Tabs>
    </div>
  )
}
