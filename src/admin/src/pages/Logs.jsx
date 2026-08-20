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
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import { Checkbox } from '@/components/ui/checkbox'
import { Download, Plus, X, Filter, EyeOff, Copy, ChevronDown, CalendarIcon, MousePointerClick } from 'lucide-react'
import { setOnPage, setBgMode as setStreamBgMode, subscribeLines, subscribeMeta, clearLines } from '../logStream'
import { stageAdd, stageAddMany } from '../routeStaging'
import { flushAndApply, getApplyImmediately, setApplyImmediately } from '../routeApply'
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
  // Placed after mount from the menu's measured size: right-clicking the last row
  // of the log box put the menu below the fold, so its lower items could not be
  // reached at all. Flip it above the cursor when it would overflow, and clamp
  // horizontally for the same reason.
  // `ready` keeps the menu hidden for the first paint only, while its size is
  // measured — otherwise it visibly jumps from the cursor to its corrected spot.
  const [pos, setPos] = useState({ top: y, left: x, ready: false })

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const { width, height } = el.getBoundingClientRect()
    const margin = 8
    const top = y + height + margin > window.innerHeight
      ? Math.max(margin, y - height)
      : y
    const left = x + width + margin > window.innerWidth
      ? Math.max(margin, x - width)
      : x
    setPos({ top, left, ready: true })
  }, [x, y])

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
      style={{ top: pos.top, left: pos.left, visibility: pos.ready ? 'visible' : 'hidden' }}>
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
  const [stageErr, setStageErr] = useState(false)

  function announce(msg, isError = false) {
    setStageMsg(msg)
    setStageErr(isError)
    // Errors linger — a failed apply is worth reading, and it is the one case
    // where the user needs to know to go and retry on the Routes page.
    setTimeout(() => setStageMsg(''), isError ? 8000 : 3000)
  }

  // When the "Apply immediately" preference is on, staging is followed straight
  // away by the same flush-then-apply the Routes page runs. On failure the
  // entries stay staged, so the Routes page is still a working fallback and the
  // message says so.
  async function maybeApply(what) {
    if (!getApplyImmediately()) {
      announce(`Staged ${what} (review in Routes)`)
      return
    }
    announce(`Staged ${what} — applying…`)
    const res = await flushAndApply()
    if (res.ok) announce(`✓ Applied ${what}`)
    else announce(`Staged ${what}, but apply failed: ${res.error}`, true)
  }

  function stage(list, cidr, org) {
    stageAdd(list, { cidr, description: org })
    maybeApply(`${cidr} → ${list.toUpperCase()}`)
  }

  function stageMany(list, entries) {
    if (!entries.length) return
    stageAddMany(list, entries)
    maybeApply(`${entries.length} route${entries.length === 1 ? '' : 's'} → ${list.toUpperCase()}`)
  }

  return { stageMsg, stageErr, stage, stageMany }
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

function SelectionBar({ selectMode, onEnter, count, routeCount, onClear, total, onToggleAll }) {
  if (!selectMode) {
    return (
      <Button size="sm" variant="outline" className="h-8" onClick={onEnter}>
        <MousePointerClick className="h-3.5 w-3.5 mr-1" />Select
      </Button>
    )
  }
  const allSelected = total > 0 && count === total
  // No Add buttons here: "Add all" is the single add entry point and switches to
  // the selection whenever there is one. Two competing add paths side by side
  // just crowded the toolbar.
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-xs text-muted-foreground">
        {count} selected
        {count !== routeCount && <> → {routeCount} route{routeCount === 1 ? '' : 's'}</>}
      </span>
      <label className="flex items-center gap-1.5 text-xs cursor-pointer select-none">
        <Checkbox checked={allSelected} indeterminate={count > 0 && !allSelected}
          disabled={total === 0} onChange={onToggleAll}
          aria-label={`Select all ${total} visible lines`} />
        Select all ({total})
      </label>
      <Button size="sm" variant="ghost" className="h-8" onClick={onClear}>Clear selection</Button>
    </div>
  )
}

// Turns the whole visible (filtered) view into staged routes without going
// through select mode — "I have narrowed the view down to what I want, take all
// of it". Two steps on purpose: the dropdown picks the destination list, then a
// dialog states the route count. Unfiltered, the visible set can be thousands of
// lines and hundreds of /24s, so the number has to be seen before it commits.
function AddAllButton({ lines, selected, onStageMany }) {
  const [open, setOpen] = useState(false)
  const [target, setTarget] = useState(null)   // 'isp' | 'vpn' | null
  // Read once per dialog open rather than on every render, so the checkbox is a
  // controlled input backed by the persisted preference.
  const [applyNow, setApplyNow] = useState(getApplyImmediately)

  // Re-read on open: the preference is shared with the right-click and selection
  // paths, so it can have changed since this component mounted.
  useEffect(() => { if (target) setApplyNow(getApplyImmediately()) }, [target])

  // A selection is a narrower statement of intent than the filtered view, so it
  // wins when present. This is also why SelectionBar no longer carries its own
  // Add buttons — one add path, one place to look.
  const fromSelection = selected && selected.size > 0
  const sourceLines = fromSelection ? [...selected] : lines
  const entries = selectedToEntries(sourceLines)

  function confirm() {
    setApplyImmediately(applyNow)
    onStageMany(target, entries)
    setTarget(null)
  }

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button size="sm" variant="outline" className="h-8" disabled={!entries.length}
            title={entries.length
              ? `Add ${entries.length} route(s) from ${fromSelection ? `the ${selected.size} selected line(s)` : 'the current view'}`
              : `Nothing in ${fromSelection ? 'the selection' : 'the current view'} resolves to a route`}>
            <Plus className="h-3.5 w-3.5 mr-1" />Add all
            {!!entries.length && <span className="ml-1 text-muted-foreground">({entries.length})</span>}
            <ChevronDown className="h-3.5 w-3.5 ml-1" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-52 p-1">
          <button className="w-full text-left px-2 py-1.5 text-sm rounded hover:bg-accent cursor-pointer"
            onClick={() => { setOpen(false); setTarget('isp') }}>
            Add to ISP routes
          </button>
          <button className="w-full text-left px-2 py-1.5 text-sm rounded hover:bg-accent cursor-pointer"
            onClick={() => { setOpen(false); setTarget('vpn') }}>
            Add to VPN routes
          </button>
        </PopoverContent>
      </Popover>

      <Dialog open={!!target} onOpenChange={v => { if (!v) setTarget(null) }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add {entries.length} route{entries.length === 1 ? '' : 's'} to {(target || '').toUpperCase()}</DialogTitle>
            <DialogDescription>
              {sourceLines.length} {fromSelection ? 'selected' : 'visible'} line{sourceLines.length === 1 ? '' : 's'} → {entries.length} route
              {entries.length === 1 ? '' : 's'}, since destinations in the same /24 collapse into one.
              {applyNow
                ? ' They will be written and activated right away — routing.sh runs on the RPi.'
                : ' These are staged only — review them under Pending changes on the Routes page and click Apply Changes to activate.'}
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-56 overflow-y-auto rounded-md border border-border bg-muted/40 p-2 text-xs space-y-0.5">
            {entries.map(e => (
              <div key={e.cidr} className="flex gap-2">
                <span className="font-mono shrink-0">{e.cidr}</span>
                <span className="text-muted-foreground truncate">{e.description || '—'}</span>
              </div>
            ))}
          </div>
          <label className="flex items-start gap-2 text-sm cursor-pointer select-none">
            <Checkbox className="mt-0.5" checked={applyNow} onChange={e => setApplyNow(e.target.checked)} />
            <span>
              Apply immediately
              <span className="block text-xs text-muted-foreground mt-0.5">
                Skip the trip to the Routes page. Remembered for next time, and also applies to
                right-click and selection adds.
              </span>
            </span>
          </label>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTarget(null)}>Cancel</Button>
            <Button onClick={confirm}>
              {applyNow ? 'Add and apply' : `Add ${entries.length} route${entries.length === 1 ? '' : 's'}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

// Counter on the left, Copy/Download on the right, sitting directly above the log
// box. These used to live in the top toolbar, which pushed them onto a second row
// once Select and Add all were added — and put the line count far away from the
// lines it counts.
function LogBoxBar({ shown, total, lines, filename, note }) {
  return (
    <div className="flex items-center justify-between gap-2 flex-wrap">
      <span className="text-xs text-muted-foreground">
        {shown} / {total} lines shown{note}
      </span>
      <div className="flex items-center gap-1">
        <CopyLinesButton lines={lines} className="h-8" />
        <Button size="sm" variant="ghost" className="h-8" onClick={() => downloadLines(lines, filename)}>
          <Download className="h-3.5 w-3.5 mr-1" />Download
        </Button>
      </div>
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
  const { stageMsg, stageErr, stage, stageMany } = useStageActions()
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
          total={visible.length} onToggleAll={() => selectAll(visible)} />
        <AddAllButton lines={visible} selected={selected} onStageMany={stageMany} />
      </div>
      <FilterBar filters={filters} onChange={setFilters} />
      <FilterBar filters={excludes} onChange={setExcludes} mode="exclude" />
      <LogsLegend />
      {stageMsg && <p className={`text-xs ${stageErr ? 'text-destructive' : 'text-primary'}`}>{stageMsg}</p>}
      <LogBoxBar shown={visible.length} total={liveLines.length} lines={visible} filename={filename} />
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
  const { stageMsg, stageErr, stage, stageMany } = useStageActions()
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
      // No success text: the count now lives in the bar directly above the log
      // box, and repeating it in the toolbar was what pushed that row over.
      setHistMsg(d.lines?.length ? '' : `No log data for ${fromDate}${toDate !== fromDate ? ` – ${toDate}` : ''}`)
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
            total={visible.length} onToggleAll={() => selectAll(visible)} />
        )}
        {histLines.length > 0 && (
          <AddAllButton lines={visible} selected={selected} onStageMany={stageMany} />
        )}
        {histMsg && <span className="text-xs text-muted-foreground self-end pb-1">{histMsg}</span>}
      </div>
      {histLines.length > 0 && (
        <>
          <FilterBar filters={filters} onChange={setFilters} />
          <FilterBar filters={excludes} onChange={setExcludes} mode="exclude" />
          <LogsLegend />
          {stageMsg && <p className={`text-xs ${stageErr ? 'text-destructive' : 'text-primary'}`}>{stageMsg}</p>}
          <LogBoxBar shown={visible.length} total={histLines.length} lines={visible} filename={filename}
            note={histMeta?.truncated
              ? ` — the last ${histLines.length} of ${histMeta.total} logged${histMeta.dayCap ? ` (capped at ${histMeta.dayCap} per day)` : ''}`
              : ''} />
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
