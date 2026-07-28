// Singleton pending-route staging store — lives at module level, shared by
// Routes.jsx and Logs.jsx (batch/context-menu adds). Mirrors the subscribe
// pattern used by logStream.js. In-memory only, not persisted across reloads —
// staging is a session-scoped pending-changes list per CONTEXT D-05.

let _pending = { vpn: [], isp: [] }

const _listeners = new Set()

function _notify() {
  const snap = { vpn: [..._pending.vpn], isp: [..._pending.isp] }
  _listeners.forEach(fn => fn(snap))
}

export function subscribe(fn) {
  _listeners.add(fn)
  fn({ vpn: [..._pending.vpn], isp: [..._pending.isp] })
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

export function unstage(list, cidr) {
  const arr = _pending[list]
  if (!arr) return
  _pending[list] = arr.filter(e => e.cidr !== cidr)
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
