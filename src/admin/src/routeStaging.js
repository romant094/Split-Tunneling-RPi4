// Singleton pending-route staging store — lives at module level, shared by
// Routes.jsx and Logs.jsx (batch/context-menu adds). Mirrors the subscribe
// pattern used by logStream.js. In-memory only, not persisted across reloads —
// staging is a session-scoped pending-changes list per CONTEXT D-05.

let _pending = { vpn: [], isp: [] }

// Staged description edits for routes that ALREADY exist server-side. The
// _pending add-staging store above cannot express these — the bulk-add
// endpoint silently skips any cidr that already exists, so an edited
// description has to be flushed via the per-route PUT path instead.
let _descEdits = { vpn: {}, isp: {} }

const _listeners = new Set()

function _notify() {
  const snap = {
    vpn: [..._pending.vpn],
    isp: [..._pending.isp],
    descriptions: { vpn: { ..._descEdits.vpn }, isp: { ..._descEdits.isp } },
  }
  _listeners.forEach(fn => fn(snap))
}

export function subscribe(fn) {
  _listeners.add(fn)
  fn({
    vpn: [..._pending.vpn],
    isp: [..._pending.isp],
    descriptions: { vpn: { ..._descEdits.vpn }, isp: { ..._descEdits.isp } },
  })
  return () => _listeners.delete(fn)
}

export function stageAdd(list, entry) {
  const arr = _pending[list]
  if (!arr) return
  if (arr.some(e => e.cidr === entry.cidr)) return
  _pending[list] = [...arr, { cidr: entry.cidr, description: entry.description || '' }]
  _notify()
}

export function stageAddMany(list, entries) {
  const arr = _pending[list]
  if (!arr) return
  const existing = new Set(arr.map(e => e.cidr))
  const additions = []
  for (const entry of entries) {
    if (existing.has(entry.cidr)) continue
    existing.add(entry.cidr)
    additions.push({ cidr: entry.cidr, description: entry.description || '' })
  }
  if (!additions.length) return
  _pending[list] = [...arr, ...additions]
  _notify()
}

export function getPending(list) {
  return [...(_pending[list] || [])]
}

export function clearPending(list) {
  if (!_pending[list]) return
  _pending[list] = []
  _notify()
}

export function stageDescription(list, cidr, description) {
  if (!_descEdits[list]) return
  const trimmed = (description || '').trim()
  if (!trimmed) return
  _descEdits[list] = { ..._descEdits[list], [cidr]: trimmed }
  _notify()
}

export function stageDescriptions(list, map) {
  if (!_descEdits[list]) return
  const merged = { ..._descEdits[list] }
  let changed = false
  for (const [cidr, description] of Object.entries(map || {})) {
    const trimmed = (description || '').trim()
    if (!trimmed) continue
    merged[cidr] = trimmed
    changed = true
  }
  if (!changed) return
  _descEdits[list] = merged
  _notify()
}

export function getPendingDescriptions(list) {
  return { ..._descEdits[list] || {} }
}

export function clearPendingDescriptions(list) {
  if (!_descEdits[list]) return
  _descEdits[list] = {}
  _notify()
}
