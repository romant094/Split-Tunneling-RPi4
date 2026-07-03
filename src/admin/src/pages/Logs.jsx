import { useState, useEffect, useRef } from 'react'
import { NavLink, Outlet, Navigate } from 'react-router-dom'
import { format } from 'date-fns'
import { apiFetch } from '../api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Calendar } from '@/components/ui/calendar'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Download, Plus, X, Filter, CalendarIcon } from 'lucide-react'
import { setOnPage, setBgMode as setStreamBgMode, subscribeLines, subscribeMeta, clearLines } from '../logStream'
import { cn } from '@/lib/utils'

const MAX_FILTERS = 5

const SUBTABS = [
  { to: 'live', label: 'Watch Live' },
  { to: 'history', label: 'Historical' },
  { to: 'install', label: 'Install Log' },
  { to: 'errors', label: 'Watch Errors' },
  { to: 'journal', label: 'System Journal' },
]

// ── Shared utilities ────────────────────────────────────────────────────────

function applyFilters(lines, filters) {
  const active = filters.filter(f => f.trim())
  if (!active.length) return lines
  return lines.filter(line => active.every(f => line.toLowerCase().includes(f.toLowerCase())))
}

function downloadLines(lines, filename) {
  const blob = new Blob([lines.join('\n')], { type: 'text/plain' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename
  document.body.appendChild(a); a.click()
  document.body.removeChild(a); URL.revokeObjectURL(url)
}

export function LogBox({ lines, colorize = false }) {
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

function FilterBar({ filters, onChange }) {
  function set(i, val) { const n = [...filters]; n[i] = val; onChange(n) }
  function add() { if (filters.length < MAX_FILTERS) onChange([...filters, '']) }
  function remove(i) { onChange(filters.filter((_, j) => j !== i)) }
  function clearAll() { onChange(['']) }
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <Filter className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
      {filters.map((f, i) => (
        <div key={i} className="flex items-center gap-1">
          <Input value={f} onChange={e => set(i, e.target.value)}
            placeholder={`Filter ${i + 1}…`} className="h-7 text-xs w-36" />
          {filters.length > 1 && (
            <button onClick={() => remove(i)} className="text-muted-foreground hover:text-foreground cursor-pointer">
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
      ))}
      {filters.length < MAX_FILTERS && (
        <Button size="sm" variant="ghost" className="h-7 px-2" onClick={add}><Plus className="h-3 w-3" /></Button>
      )}
      {filters.some(f => f.trim()) && (
        <Button size="sm" variant="ghost" className="h-7 px-2 text-xs text-muted-foreground" onClick={clearAll}>Clear</Button>
      )}
    </div>
  )
}

function DateTimePicker({ label, date, time, onDateChange, onTimeChange, maxDate }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="space-y-1">
      {label && <Label className="text-xs text-muted-foreground">{label}</Label>}
      <div className="flex items-center gap-1">
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className={cn("h-8 justify-start text-left font-normal w-36", !date && "text-muted-foreground")}>
              <CalendarIcon className="mr-2 h-3.5 w-3.5 shrink-0" />
              {date ? format(date, 'dd MMM yyyy') : <span>Pick date</span>}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar mode="single" selected={date}
              onSelect={d => { onDateChange(d); setOpen(false) }}
              disabled={maxDate ? d => d > maxDate : undefined}
              initialFocus />
          </PopoverContent>
        </Popover>
        <Input type="time" value={time} onChange={e => onTimeChange(e.target.value)}
          className="h-8 w-24 text-sm font-mono" />
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
      <LogBox lines={lines} colorize={false} />
    </div>
  )
}

// ── Layout ──────────────────────────────────────────────────────────────────

export default function LogsLayout() {
  const [liveMeta, setLiveMeta] = useState({ connected: false, bgMode: false })
  useEffect(() => subscribeMeta(s => setLiveMeta(s)), [])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Logs</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Real-time and historical traffic logs.
        </p>
      </div>

      <div className="flex gap-1 flex-wrap border-b border-border pb-0">
        {SUBTABS.map(({ to, label }) => (
          <NavLink key={to} to={to}
            className={({ isActive }) =>
              `px-3 py-2 text-sm rounded-t-md border-b-2 transition-colors -mb-px ${
                isActive
                  ? 'border-primary text-primary font-medium'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`
            }>
            {label}
            {to === 'live' && liveMeta.connected && (
              <span className="ml-1.5 h-1.5 w-1.5 rounded-full bg-primary inline-block align-middle animate-pulse" />
            )}
          </NavLink>
        ))}
      </div>

      <Outlet />
    </div>
  )
}

// ── Sub-pages ────────────────────────────────────────────────────────────────

export function LogsLive() {
  const [liveLines, setLiveLines] = useState([])
  const [liveMeta, setLiveMeta] = useState({ connected: false, bgMode: false })
  const [filters, setFilters] = useState([''])

  useEffect(() => {
    const u1 = subscribeLines(setLiveLines)
    const u2 = subscribeMeta(setLiveMeta)
    setOnPage(true)
    return () => { setOnPage(false); u1(); u2() }
  }, [])

  const visible = applyFilters(liveLines, filters)
  const filename = `splitgate-live-${format(new Date(), 'yyyy-MM-dd')}.txt`

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <Button size="sm" variant={liveMeta.bgMode ? 'default' : 'outline'} className="h-8"
          onClick={() => setStreamBgMode(!liveMeta.bgMode)}
          title="Keep SSE stream alive when navigating away">
          {liveMeta.bgMode ? '● Background ON' : '○ Background'}
        </Button>
        <Button size="sm" variant="ghost" className="h-8" onClick={clearLines}>Clear</Button>
        <span className="text-muted-foreground text-xs ml-auto">{visible.length} / {liveLines.length} lines</span>
        <Button size="sm" variant="ghost" className="h-8" onClick={() => downloadLines(visible, filename)}>
          <Download className="h-3.5 w-3.5 mr-1" />Download
        </Button>
      </div>
      <FilterBar filters={filters} onChange={setFilters} />
      <LogBox lines={visible} colorize={true} />
    </div>
  )
}

export function LogsHistory() {
  const [filters, setFilters] = useState([''])
  const [histFromDate, setHistFromDate] = useState(() => { const d = new Date(); d.setHours(0,0,0,0); return d })
  const [histFromTime, setHistFromTime] = useState('00:00')
  const [histToDate, setHistToDate] = useState(null)
  const [histToTime, setHistToTime] = useState('23:59')
  const [histLines, setHistLines] = useState([])
  const [histLoading, setHistLoading] = useState(false)
  const [histMsg, setHistMsg] = useState('')

  async function loadHistory() {
    if (!histFromDate) { setHistMsg('Select a start date'); return }
    setHistLoading(true); setHistMsg('')
    const fromDate = format(histFromDate, 'yyyy-MM-dd')
    const toDate = histToDate ? format(histToDate, 'yyyy-MM-dd') : fromDate
    try {
      const r = await apiFetch(`/api/logs/history?from=${fromDate}&to=${toDate}`)
      const d = await r.json()
      if (!r.ok) { setHistMsg(d.error || 'Error'); setHistLoading(false); return }
      setHistLines(d.lines || [])
      setHistMsg(d.lines?.length ? `${d.lines.length} lines` : `No log data for ${fromDate}${toDate !== fromDate ? ` – ${toDate}` : ''}`)
    } catch { setHistMsg('Connection error') }
    setHistLoading(false)
  }

  const visible = applyFilters(histLines, filters)
  const filename = histFromDate
    ? `splitgate-hist-${format(histFromDate, 'yyyy-MM-dd')}${histToDate ? `-${format(histToDate, 'yyyy-MM-dd')}` : ''}.txt`
    : 'splitgate-hist.txt'

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <DateTimePicker label="From" date={histFromDate} time={histFromTime}
          onDateChange={setHistFromDate} onTimeChange={setHistFromTime} maxDate={new Date()} />
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">To <span className="font-normal">(optional)</span></Label>
          <div className="flex items-center gap-1">
            <DateTimePicker date={histToDate} time={histToTime}
              onDateChange={setHistToDate} onTimeChange={setHistToTime} maxDate={new Date()} />
            {histToDate && (
              <button onClick={() => setHistToDate(null)} className="text-muted-foreground hover:text-foreground cursor-pointer ml-1">
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>
        <Button size="sm" variant="outline" onClick={loadHistory} disabled={histLoading} className="h-8 self-end">
          {histLoading ? 'Loading…' : 'Load'}
        </Button>
        {histMsg && <span className="text-xs text-muted-foreground self-end pb-1">{histMsg}</span>}
        {histLines.length > 0 && (
          <Button size="sm" variant="ghost" className="h-8 self-end ml-auto"
            onClick={() => downloadLines(visible, filename)}>
            <Download className="h-3.5 w-3.5 mr-1" />Download
          </Button>
        )}
      </div>
      {histLines.length > 0 && (
        <>
          <FilterBar filters={filters} onChange={setFilters} />
          <p className="text-xs text-muted-foreground">{visible.length} / {histLines.length} lines shown</p>
          <LogBox lines={visible} colorize={true} />
        </>
      )}
      {histLines.length === 0 && !histLoading && (
        <p className="text-muted-foreground text-sm py-4">Select a date range and click Load.</p>
      )}
    </div>
  )
}

export function LogsInstall() { return <StaticLog endpoint="/api/logs/install" /> }
export function LogsErrors() { return <StaticLog endpoint="/api/logs/watch-errors" /> }
export function LogsJournal() { return <StaticLog endpoint="/api/logs/journal" /> }
