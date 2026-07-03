import { useState, useEffect, useRef, useCallback } from 'react'
import { apiFetch } from '../api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Download, Plus, X, Filter } from 'lucide-react'
import { setOnPage, setBgMode as setStreamBgMode, getBgMode, subscribeLines, subscribeMeta, clearLines } from '../logStream'

const MAX_FILTERS = 5

function todayStart() {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d.toISOString().slice(0, 16)
}

function nowStr() {
  return new Date().toISOString().slice(0, 16)
}

function applyFilters(lines, filters) {
  const active = filters.filter(f => f.trim())
  if (!active.length) return lines
  return lines.filter(line => active.every(f => line.toLowerCase().includes(f.toLowerCase())))
}

function downloadLines(lines, filename) {
  const blob = new Blob([lines.join('\n')], { type: 'text/plain' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

function LogBox({ lines }) {
  const ref = useRef(null)
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight
  }, [lines])
  return (
    <div className="log-container" ref={ref}>
      {lines.map((line, i) => {
        let cls = ''
        if (line.includes('[VPN]')) cls = 'log-line-vpn'
        else if (line.includes('[ISP]')) cls = 'log-line-isp'
        return <div key={i} className={cls}>{line || ' '}</div>
      })}
      {lines.length === 0 && <div className="text-muted-foreground">No output</div>}
    </div>
  )
}

function FilterBar({ filters, onChange }) {
  function set(i, val) {
    const next = [...filters]
    next[i] = val
    onChange(next)
  }
  function add() { if (filters.length < MAX_FILTERS) onChange([...filters, '']) }
  function remove(i) { onChange(filters.filter((_, j) => j !== i)) }
  function clearAll() { onChange(['']) }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <Filter className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        {filters.map((f, i) => (
          <div key={i} className="flex items-center gap-1">
            <Input
              value={f}
              onChange={e => set(i, e.target.value)}
              placeholder={`Filter ${i + 1}…`}
              className="h-7 text-xs w-36"
            />
            {filters.length > 1 && (
              <button onClick={() => remove(i)} className="text-muted-foreground hover:text-foreground">
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
        ))}
        {filters.length < MAX_FILTERS && (
          <Button size="sm" variant="ghost" className="h-7 px-2" onClick={add}>
            <Plus className="h-3 w-3" />
          </Button>
        )}
        {(filters.some(f => f.trim())) && (
          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs text-muted-foreground" onClick={clearAll}>
            Clear filters
          </Button>
        )}
      </div>
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
      <LogBox lines={lines} />
    </div>
  )
}

export default function Logs() {
  const [activeTab, setActiveTab] = useState('live')

  // Live log state — backed by the module singleton
  const [liveLines, setLiveLines] = useState([])
  const [liveMeta, setLiveMeta] = useState({ connected: false, bgMode: false })

  // Shared filter state across live and historical tabs
  const [filters, setFilters] = useState([''])

  // Historical state
  const [histFrom, setHistFrom] = useState(todayStart())
  const [histTo, setHistTo] = useState('')
  const [histLines, setHistLines] = useState([])
  const [histLoading, setHistLoading] = useState(false)
  const [histMsg, setHistMsg] = useState('')

  // Subscribe to singleton on mount, unsubscribe on unmount
  useEffect(() => {
    const unsubLines = subscribeLines(setLiveLines)
    const unsubMeta = subscribeMeta(setLiveMeta)
    setOnPage(true)
    return () => {
      setOnPage(false)
      unsubLines()
      unsubMeta()
    }
  }, [])

  function toggleBgMode() {
    setStreamBgMode(!liveMeta.bgMode)
  }

  async function loadHistory() {
    setHistLoading(true)
    setHistMsg('')
    const fromDate = histFrom.slice(0, 10)
    const toDate = histTo ? histTo.slice(0, 10) : fromDate
    try {
      const r = await apiFetch(`/api/logs/history?from=${fromDate}&to=${toDate}`)
      const d = await r.json()
      if (!r.ok) { setHistMsg(d.error || 'Error'); setHistLoading(false); return }
      setHistLines(d.lines || [])
      if (!d.lines?.length) setHistMsg(`No log data for ${fromDate}${toDate !== fromDate ? ` – ${toDate}` : ''}`)
      else setHistMsg(`${d.lines.length} lines`)
    } catch { setHistMsg('Connection error') }
    setHistLoading(false)
  }

  const visibleLive = applyFilters(liveLines, filters)
  const visibleHist = applyFilters(histLines, filters)

  const liveFilename = `splitgate-live-${new Date().toISOString().slice(0, 10)}.txt`
  const histFilename = `splitgate-hist-${histFrom.slice(0, 10)}${histTo ? `-${histTo.slice(0, 10)}` : ''}.txt`

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Logs</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Real-time and historical traffic logs. Up to 5 AND-conditions, partial match.
        </p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="live">
            Watch Live
            {liveMeta.connected && <span className="ml-1.5 h-1.5 w-1.5 rounded-full bg-primary inline-block animate-pulse" />}
          </TabsTrigger>
          <TabsTrigger value="history">Historical</TabsTrigger>
          <TabsTrigger value="install">Install Log</TabsTrigger>
          <TabsTrigger value="errors">Watch Errors</TabsTrigger>
          <TabsTrigger value="journal">System Journal</TabsTrigger>
        </TabsList>

        {/* Live */}
        <TabsContent value="live" className="mt-4 space-y-3">
          <div className="flex items-center gap-2 flex-wrap">
            <Button
              size="sm"
              variant={liveMeta.bgMode ? 'default' : 'outline'}
              className="h-8"
              onClick={toggleBgMode}
              title="Keep SSE stream alive when navigating away"
            >
              {liveMeta.bgMode ? '● Background ON' : '○ Background'}
            </Button>
            <Button size="sm" variant="ghost" className="h-8" onClick={clearLines}>Clear</Button>
            <span className="text-muted-foreground text-xs ml-auto">
              {visibleLive.length} / {liveLines.length} lines
            </span>
            <Button size="sm" variant="ghost" className="h-8" onClick={() => downloadLines(visibleLive, liveFilename)}>
              <Download className="h-3.5 w-3.5 mr-1" />Download
            </Button>
          </div>
          <FilterBar filters={filters} onChange={setFilters} />
          <LogBox lines={visibleLive} />
        </TabsContent>

        {/* Historical */}
        <TabsContent value="history" className="mt-4 space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">From</Label>
              <input
                type="datetime-local"
                value={histFrom}
                max={nowStr()}
                onChange={e => setHistFrom(e.target.value)}
                className="h-8 rounded-md border border-input bg-background px-3 text-sm text-foreground"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">To <span className="font-normal">(optional)</span></Label>
              <div className="flex items-center gap-1">
                <input
                  type="datetime-local"
                  value={histTo}
                  max={nowStr()}
                  onChange={e => setHistTo(e.target.value)}
                  className="h-8 rounded-md border border-input bg-background px-3 text-sm text-foreground"
                />
                {histTo && (
                  <button onClick={() => setHistTo('')} className="text-muted-foreground hover:text-foreground">
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </div>
            <Button size="sm" variant="outline" onClick={loadHistory} disabled={histLoading} className="h-8">
              {histLoading ? 'Loading…' : 'Load'}
            </Button>
            {histMsg && <span className="text-xs text-muted-foreground self-center">{histMsg}</span>}
            {histLines.length > 0 && (
              <Button size="sm" variant="ghost" className="h-8 ml-auto"
                onClick={() => downloadLines(visibleHist, histFilename)}>
                <Download className="h-3.5 w-3.5 mr-1" />Download
              </Button>
            )}
          </div>
          {histLines.length > 0 && (
            <>
              <FilterBar filters={filters} onChange={setFilters} />
              <p className="text-xs text-muted-foreground">{visibleHist.length} / {histLines.length} lines shown</p>
              <LogBox lines={visibleHist} />
            </>
          )}
          {histLines.length === 0 && !histLoading && (
            <p className="text-muted-foreground text-sm py-4">Select a date range and click Load.</p>
          )}
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
