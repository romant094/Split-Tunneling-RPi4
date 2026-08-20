import { useState, useEffect, useRef } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { NavLink, Outlet } from 'react-router-dom'
import { format, parseISO } from 'date-fns'
import { apiFetch } from '../api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Calendar } from '@/components/ui/calendar'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Checkbox } from '@/components/ui/checkbox'
import { Download, Plus, X, Filter, EyeOff, Copy, CalendarIcon, MousePointerClick } from 'lucide-react'
import { setOnPage, setBgMode as setStreamBgMode, subscribeLines, subscribeMeta, clearLines } from '../logStream'
import { stageAdd, stageAddMany } from '../routeStaging'
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

// Include terms are ANDed: a line must match every one of them to survive.
function applyFilters(lines, filters) {
  const active = filters.filter(f => f.trim())
  if (!active.length) return lines
  return lines.filter(line => active.every(f => line.toLowerCase().includes(f.toLowerCase())))
}

// Exclude terms are ORed: matching any one of them hides the line. OR is the
// useful default here — each field names one thing to get rid of, and requiring
// all of them to match would make a second term widen the view instead of
// narrowing it.
function applyExcludes(lines, excludes) {
  const active = excludes.filter(f => f.trim()).map(f => f.toLowerCase())
  if (!active.length) return lines
  return lines.filter(line => {
    const lower = line.toLowerCase()
    return !active.some(f => lower.includes(f))
  })
}

// Copies the same raw text Download writes — not the formatTs display form — so a
// pasted line keeps its ISO timestamp and stays greppable.
function CopyLinesButton({ lines, className }) {
  const [msg, setMsg] = useState('')

  async function copy() {
    try {
      await navigator.clipboard.writeText(lines.join('\n'))
      setMsg(`Copied ${lines.length} line${lines.length === 1 ? '' : 's'}`)
    } catch {
      // The Clipboard API is unavailable on insecure origins — say so rather
      // than silently doing nothing.
      setMsg('Clipboard unavailable')
    }
    setTimeout(() => setMsg(''), 2500)
  }

  return (
    <>
      <Button size="sm" variant="ghost" className={className} onClick={copy} disabled={!lines.length}
        title="Copy the filtered lines as raw text">
        <Copy className="h-3.5 w-3.5 mr-1" />Copy
      </Button>
      {msg && <span className="text-xs text-muted-foreground">{msg}</span>}
    </>
  )
}

function downloadLines(lines, filename) {
  const blob = new Blob([lines.join('\n')], { type: 'text/plain' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename
  document.body.appendChild(a); a.click()
  document.body.removeChild(a); URL.revokeObjectURL(url)
}

// Daemon line format (src/scripts/watch-routes.py _write_daemon_line / format_line):
//   {ts} [{tag}] {status} {src} → {dst_part} {port_part} | {org}
// `status` (✓/✗) may be empty when conntrack is unavailable.
const DAEMON_LINE_RE = /^\S+\s+\[(VPN|ISP)\]\s*/

// D-02/D-03: dedupe signature strips the leading timestamp and [VPN]/[ISP] tag,
// comparing only the "{status} {src} → {dst} {port} | {org}" substring. Hides
// ALL matching lines in the current view, not just adjacent repeats.
function dedupeSignature(line) {
  return line.replace(DAEMON_LINE_RE, '').trim()
}

function dedupeLines(lines) {
  const seen = new Set()
  const out = []
  for (const line of lines) {
    const sig = dedupeSignature(line)
    if (seen.has(sig)) continue
    seen.add(sig)
    out.push(line)
  }
  return out
}

// Human-readable timestamp: replace the leading ISO token in-place, keep the
// rest of the raw line untouched (used for display only — Copy/download use
// the raw line). The source token is a UTC instant ending in 'Z'
// (watch-routes.py _to_utc_z, quick task 260810-iym); date-fns `format()`
// always renders in the browser's local timezone. Pre-fix historical log
// lines without a trailing 'Z' are naive and rendered as-is by parseISO
// (browser-local interpretation) — their apparent offset vs. the RPi's
// wall clock is a known artifact of legacy data, not a bug.
function formatTs(line) {
  const idx = line.indexOf(' ')
  if (idx === -1) return line
  const token = line.slice(0, idx)
  const rest = line.slice(idx)
  try {
    const d = parseISO(token)
    if (isNaN(d.getTime())) return line
    return format(d, 'dd MMM HH:mm:ss') + rest
  } catch {
    return line
  }
}

// Normalize a dotted IPv4 to the /24 subnet containing it (zero the last octet).
function toSubnet24(ip) {
  const parts = ip.split('.')
  return `${parts[0]}.${parts[1]}.${parts[2]}.0/24`
}

// Destination IP token appears right after "→"; convert to its /24 subnet CIDR.
function extractCidr(line) {
  const arrowIdx = line.indexOf('→')
  if (arrowIdx === -1) return null
  const after = line.slice(arrowIdx + 1).trim()
  const m = after.match(/^(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})/)
  return m ? toSubnet24(m[1]) : null
}

// Org text (if present) appears after the last " | ".
function extractOrg(line) {
  const idx = line.lastIndexOf('|')
  if (idx === -1) return ''
  return line.slice(idx + 1).trim()
}

// Acts on the whole selection when the right-clicked line is part of it —
// otherwise a user who had just selected several rows would silently stage only
// the one under the cursor. `batchLines` is null for the single-line case.
function LogContextMenu({ x, y, line, batchLines, onClose, onStage, onStageMany }) {
  const ref = useRef(null)
  useEffect(() => {
    function handleClick(e) { if (ref.current && !ref.current.contains(e.target)) onClose() }
    function handleKey(e) { if (e.key === 'Escape') onClose() }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleKey)
    }
  }, [onClose])

  const batch = batchLines && batchLines.length > 1 ? batchLines : null
  const cidr = extractCidr(line)
  // Destinations collapse to their /24, so N selected lines can yield fewer
  // routes. Label the routes, not the lines.
  const batchEntries = batch ? selectedToEntries(batch) : []
  const canAct = batch ? batchEntries.length > 0 : !!cidr

  async function copy() {
    const text = batch ? batch.join('\n') : line
    try { await navigator.clipboard.writeText(text) } catch { /* clipboard unavailable — no-op */ }
    onClose()
  }
  function add(list) {
    if (!canAct) return
    if (batch) onStageMany(list, batchEntries)
    else onStage(list, cidr, extractOrg(line))
    onClose()
  }

  const n = batchEntries.length
  const label = batch
    ? l => `Add ${n} route${n === 1 ? '' : 's'} to ${l} list`
    : l => `Add route to ${l} list`

  return (
    <div ref={ref} className="fixed z-50 min-w-56 rounded-md border border-border bg-popover text-popover-foreground shadow-md py-1 text-sm"
      style={{ top: y, left: x }}>
      <button className="w-full text-left px-3 py-1.5 hover:bg-accent cursor-pointer" onClick={copy}>
        {batch ? `Copy ${batch.length} lines` : 'Copy'}
      </button>
      <button className="w-full text-left px-3 py-1.5 hover:bg-accent cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
        disabled={!canAct} onClick={() => add('isp')}>{label('ISP')}</button>
      <button className="w-full text-left px-3 py-1.5 hover:bg-accent cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
        disabled={!canAct} onClick={() => add('vpn')}>{label('VPN')}</button>
      {batch && batch.length !== n && (
        <p className="px-3 py-1 text-xs text-muted-foreground border-t border-border mt-1 pt-1.5">
          {batch.length} lines → {n} /24 route{n === 1 ? '' : 's'}
        </p>
      )}
    </div>
  )
}

// Must match .log-row in App.css: font-size 12px x line-height 1.6. The row is
// `white-space: pre` so a long line scrolls horizontally instead of wrapping,
// which is what keeps every row exactly one line tall and makes a fixed
// estimateSize exact. Wrapping rows would need per-row measurement and would
// defeat the point of virtualizing a 50000-line day.
const LOG_ROW_HEIGHT = 19.2

export function LogBox({
  lines, colorize = false, humanTime = false,
  interactive = false, selectMode = false, selected, onToggleSelect, onRowContextMenu,
}) {
  const ref = useRef(null)
  // Only stick to the bottom when the view is already there, so scrolling back
  // through history is not yanked away by the next SSE line.
  const atBottom = useRef(true)

  const virtualizer = useVirtualizer({
    count: lines.length,
    getScrollElement: () => ref.current,
    estimateSize: () => LOG_ROW_HEIGHT,
    overscan: 24,
  })

  function onScroll() {
    const el = ref.current
    if (!el) return
    // 4px slack: fractional row heights mean scrollTop rarely lands exactly.
    atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 4
  }

  useEffect(() => {
    if (!lines.length || !atBottom.current) return
    virtualizer.scrollToIndex(lines.length - 1, { align: 'end' })
  }, [lines, virtualizer])

  const items = virtualizer.getVirtualItems()

  return (
    <div className="log-container" ref={ref} onScroll={onScroll}>
      {lines.length === 0 ? (
        <div className="text-muted-foreground">No output</div>
      ) : (
        <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
          {items.map(item => {
            const line = lines[item.index]
            let cls = 'log-row'
            if (colorize) {
              if (line.includes('[VPN]')) cls += ' log-line-vpn'
              else if (line.includes('[ISP]')) cls += ' log-line-isp'
            }
            if (interactive && selectMode && selected && selected.has(line)) cls += ' log-row-selected'
            const display = humanTime ? formatTs(line) : line
            const showCheckbox = interactive && selectMode
            return (
                <div key={item.key} className={cls}
                  style={{
                    position: 'absolute', top: 0, left: 0,
                    width: '100%', height: item.size,
                    transform: `translateY(${item.start}px)`,
                    display: showCheckbox ? 'flex' : undefined,
                    alignItems: showCheckbox ? 'center' : undefined,
                  }}
                  onContextMenu={interactive ? (e) => { e.preventDefault(); onRowContextMenu && onRowContextMenu(e, line) } : undefined}
                  onClick={showCheckbox ? () => onToggleSelect && onToggleSelect(line) : undefined}
                >
                  {showCheckbox && (
                    // sticky so the checkbox stays put when a long line is
                    // scrolled sideways — rows are white-space: pre and scroll
                    // horizontally, so a static checkbox would slide off-screen.
                    <Checkbox
                      className="log-row-check"
                      checked={!!(selected && selected.has(line))}
                      onChange={() => onToggleSelect && onToggleSelect(line)}
                      onClick={e => e.stopPropagation()}
                      aria-label="Select this line" />
                  )}
                <span style={{ whiteSpace: 'pre' }}>{display || ' '}</span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// Shared staging helper: brief inline confirmation after Add-to-ISP/VPN
// (single or batch), matching the Routes page's inline-message pattern.
function useStageActions() {
  const [stageMsg, setStageMsg] = useState('')
  function announce(msg) {
    setStageMsg(msg)
    setTimeout(() => setStageMsg(''), 3000)
  }
  function stage(list, cidr, org) {
    stageAdd(list, { cidr, description: org })
    announce(`Staged ${cidr} → ${list.toUpperCase()} (review in Routes)`)
  }
  function stageMany(list, entries) {
    if (!entries.length) return
    stageAddMany(list, entries)
    announce(`Staged ${entries.length} route${entries.length === 1 ? '' : 's'} → ${list.toUpperCase()} (review in Routes)`)
  }
  return { stageMsg, stage, stageMany }
}

// Multi-select mode: clicking a row toggles selection; state is display-only
// and resets on unmount (component-local useState).
function useSelection() {
  const [selectMode, setSelectMode] = useState(false)
  const [selected, setSelected] = useState(new Set())

  function toggle(line) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(line)) next.delete(line); else next.add(line)
      return next
    })
  }
  function clear() { setSelected(new Set()) }
  function exit() { setSelectMode(false); clear() }
  function selectAll(lines) {
    setSelected(prev => {
      const allSelected = lines.length > 0 && lines.every(line => prev.has(line))
      return allSelected ? new Set() : new Set(lines)
    })
  }

  return { selectMode, setSelectMode, selected, toggle, clear, exit, selectAll }
}

// Selected lines -> deduped {cidr, description} entries ready for stageAddMany.
function selectedToEntries(selected) {
  const entries = []
  const seen = new Set()
  for (const line of selected) {
    const cidr = extractCidr(line)
    if (!cidr || seen.has(cidr)) continue
    seen.add(cidr)
    entries.push({ cidr, description: extractOrg(line) })
  }
  return entries
}

function SelectionBar({ selectMode, onEnter, count, routeCount, onClear, onAddIsp, onAddVpn, total, onToggleAll }) {
  if (!selectMode) {
    return (
      <Button size="sm" variant="outline" className="h-8" onClick={onEnter}>
        <MousePointerClick className="h-3.5 w-3.5 mr-1" />Select
      </Button>
    )
  }
  const allSelected = total > 0 && count === total
  // The buttons promise routeCount, not count: selectedToEntries collapses each
  // destination to its /24, so several selected lines from one subnet stage a
  // single route. Labelling the line count made the button overstate the result.
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-xs text-muted-foreground">
        {count} selected
        {count !== routeCount && <> → {routeCount} route{routeCount === 1 ? '' : 's'}</>}
      </span>
      <Button size="sm" variant="outline" className="h-8" disabled={total === 0} onClick={onToggleAll}>
        {allSelected ? 'Deselect All' : `Select All (${total})`}
      </Button>
      <Button size="sm" variant="outline" className="h-8" disabled={!routeCount} onClick={onAddIsp}>
        Add {routeCount} to ISP
      </Button>
      <Button size="sm" variant="outline" className="h-8" disabled={!routeCount} onClick={onAddVpn}>
        Add {routeCount} to VPN
      </Button>
      <Button size="sm" variant="ghost" className="h-8" onClick={onClear}>Clear selection</Button>
    </div>
  )
}

// Inline legend explaining the ✓/✗ status icon shown right after [VPN]/[ISP]
// (meaning per watch-routes.py _check_conntrack docstring).
function LogsLegend() {
  return (
    <p className="text-xs text-muted-foreground">
      ✓ = connection tracked (packets flowing) · ✗ = no conntrack entry (blocked/idle) · shown right after the [VPN]/[ISP] tag
    </p>
  )
}

// One component for both filter rows. mode 'include' keeps lines that match all
// terms; mode 'exclude' hides lines matching any term.
function FilterBar({ filters, onChange, mode = 'include' }) {
  const exclude = mode === 'exclude'
  const Icon = exclude ? EyeOff : Filter
  function set(i, val) { const n = [...filters]; n[i] = val; onChange(n) }
  function add() { if (filters.length < MAX_FILTERS) onChange([...filters, '']) }
  function remove(i) { onChange(filters.filter((_, j) => j !== i)) }
  function clearAll() { onChange(['']) }
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0"
        title={exclude ? 'Hide lines matching any of these' : 'Show only lines matching all of these'} />
      {filters.map((f, i) => (
        <div key={i} className="flex items-center gap-1">
          <Input value={f} onChange={e => set(i, e.target.value)}
            placeholder={exclude ? `Hide ${i + 1}…` : `Filter ${i + 1}…`} className="h-7 text-xs w-36" />
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
  const [excludes, setExcludes] = useState([''])
  const [dedupe, setDedupe] = useState(false)
  const [ctxMenu, setCtxMenu] = useState(null)
  const { stageMsg, stage, stageMany } = useStageActions()
  const { selectMode, setSelectMode, selected, toggle, clear, exit, selectAll } = useSelection()

  useEffect(() => {
    const u1 = subscribeLines(setLiveLines)
    const u2 = subscribeMeta(setLiveMeta)
    setOnPage(true)
    return () => { setOnPage(false); u1(); u2() }
  }, [])

  // include (AND) -> exclude (OR) -> dedupe, so a hidden line is never the one
  // that survives dedupe and suppresses its visible duplicates.
  const filtered = applyExcludes(applyFilters(liveLines, filters), excludes)
  const visible = dedupe ? dedupeLines(filtered) : filtered
  const filename = `splitgate-live-${format(new Date(), 'yyyy-MM-dd')}.txt`

  // Right-clicking a row that is part of the selection acts on the whole
  // selection; right-clicking outside it stays a single-line action.
  function onRowContextMenu(e, line) {
    const batchLines = selectMode && selected.has(line) ? [...selected] : null
    setCtxMenu({ x: e.clientX, y: e.clientY, line, batchLines })
  }
  function batchStage(list, entries) {
    stageMany(list, entries || selectedToEntries(selected))
    exit()
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <Button size="sm" variant={liveMeta.bgMode ? 'default' : 'outline'} className="h-8"
          onClick={() => setStreamBgMode(!liveMeta.bgMode)}
          title="Keep SSE stream alive when navigating away">
          {liveMeta.bgMode ? '● Background ON' : '○ Background'}
        </Button>
        <Button size="sm" variant="ghost" className="h-8" onClick={clearLines}>Clear</Button>
        <Button size="sm" variant={dedupe ? 'default' : 'outline'} className="h-8"
          onClick={() => setDedupe(v => !v)} title="Collapse all lines sharing a content signature">
          Hide duplicates
        </Button>
        <SelectionBar selectMode={selectMode} onEnter={() => setSelectMode(true)}
          count={selected.size} routeCount={selectedToEntries(selected).length} onClear={exit}
          onAddIsp={() => batchStage('isp')} onAddVpn={() => batchStage('vpn')}
          total={visible.length} onToggleAll={() => selectAll(visible)} />
        <span className="text-muted-foreground text-xs ml-auto">{visible.length} / {liveLines.length} lines</span>
        <CopyLinesButton lines={visible} className="h-8" />
        <Button size="sm" variant="ghost" className="h-8" onClick={() => downloadLines(visible, filename)}>
          <Download className="h-3.5 w-3.5 mr-1" />Download
        </Button>
      </div>
      <FilterBar filters={filters} onChange={setFilters} />
      <FilterBar filters={excludes} onChange={setExcludes} mode="exclude" />
      <LogsLegend />
      {stageMsg && <p className="text-xs text-primary">{stageMsg}</p>}
      <LogBox lines={visible} colorize={true} humanTime={true}
        interactive selectMode={selectMode} selected={selected} onToggleSelect={toggle}
        onRowContextMenu={onRowContextMenu} />
      {ctxMenu && (
        <LogContextMenu x={ctxMenu.x} y={ctxMenu.y} line={ctxMenu.line} batchLines={ctxMenu.batchLines}
          onClose={() => setCtxMenu(null)} onStage={stage} onStageMany={batchStage} />
      )}
    </div>
  )
}

export function LogsHistory() {
  const [filters, setFilters] = useState([''])
  const [excludes, setExcludes] = useState([''])
  const [histFromDate, setHistFromDate] = useState(() => { const d = new Date(); d.setHours(0,0,0,0); return d })
  const [histFromTime, setHistFromTime] = useState('00:00')
  const [histToDate, setHistToDate] = useState(null)
  const [histToTime, setHistToTime] = useState('23:59')
  const [histLines, setHistLines] = useState([])
  // Truncation metadata from /api/logs/history (260820-juc): the endpoint caps
  // each day's tail, so `count` alone cannot tell a complete day from a tail.
  const [histMeta, setHistMeta] = useState(null)
  const [histLoading, setHistLoading] = useState(false)
  const [histMsg, setHistMsg] = useState('')
  const [dedupe, setDedupe] = useState(false)
  const [ctxMenu, setCtxMenu] = useState(null)
  const { stageMsg, stage, stageMany } = useStageActions()
  const { selectMode, setSelectMode, selected, toggle, exit, selectAll } = useSelection()

  function onRowContextMenu(e, line) {
    const batchLines = selectMode && selected.has(line) ? [...selected] : null
    setCtxMenu({ x: e.clientX, y: e.clientY, line, batchLines })
  }
  function batchStage(list, entries) {
    stageMany(list, entries || selectedToEntries(selected))
    exit()
  }

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
      setHistMeta({ total: d.total, truncated: d.truncated, dayCap: d.day_cap })
      setHistMsg(d.lines?.length ? `${d.lines.length} lines` : `No log data for ${fromDate}${toDate !== fromDate ? ` – ${toDate}` : ''}`)
    } catch { setHistMsg('Connection error') }
    setHistLoading(false)
  }

  const filtered = applyExcludes(applyFilters(histLines, filters), excludes)
  const visible = dedupe ? dedupeLines(filtered) : filtered
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
        {histLines.length > 0 && (
          <Button size="sm" variant={dedupe ? 'default' : 'outline'} className="h-8 self-end"
            onClick={() => setDedupe(v => !v)} title="Collapse all lines sharing a content signature">
            Hide duplicates
          </Button>
        )}
        {histLines.length > 0 && (
          <SelectionBar selectMode={selectMode} onEnter={() => setSelectMode(true)}
            count={selected.size} routeCount={selectedToEntries(selected).length} onClear={exit}
            onAddIsp={() => batchStage('isp')} onAddVpn={() => batchStage('vpn')}
            total={visible.length} onToggleAll={() => selectAll(visible)} />
        )}
        {histMsg && <span className="text-xs text-muted-foreground self-end pb-1">{histMsg}</span>}
        {histLines.length > 0 && (
          <div className="flex items-center gap-2 self-end ml-auto">
            <CopyLinesButton lines={visible} className="h-8" />
            <Button size="sm" variant="ghost" className="h-8"
              onClick={() => downloadLines(visible, filename)}>
              <Download className="h-3.5 w-3.5 mr-1" />Download
            </Button>
          </div>
        )}
      </div>
      {histLines.length > 0 && (
        <>
          <FilterBar filters={filters} onChange={setFilters} />
          <FilterBar filters={excludes} onChange={setExcludes} mode="exclude" />
          <LogsLegend />
          {stageMsg && <p className="text-xs text-primary">{stageMsg}</p>}
          <p className="text-xs text-muted-foreground">
            {visible.length} / {histLines.length} lines shown
            {histMeta?.truncated && (
              <> — loaded the last {histLines.length} of {histMeta.total} logged
                {histMeta.dayCap ? ` (capped at ${histMeta.dayCap} per day)` : ''}</>
            )}
          </p>
          <LogBox lines={visible} colorize={true} humanTime={true}
            interactive selectMode={selectMode} selected={selected} onToggleSelect={toggle}
            onRowContextMenu={onRowContextMenu} />
          {ctxMenu && (
            <LogContextMenu x={ctxMenu.x} y={ctxMenu.y} line={ctxMenu.line} batchLines={ctxMenu.batchLines}
              onClose={() => setCtxMenu(null)} onStage={stage} onStageMany={batchStage} />
          )}
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
