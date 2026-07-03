// Singleton SSE manager — lives at module level, survives React navigation.
// setOnPage(true/false) is called by the Logs component on mount/unmount.
// setBgMode(true/false) keeps the connection alive even when not on the page.

const MAX_LINES = 2000

let _es = null
let _lines = []
let _bgMode = false
let _connected = false
let _onPage = false

const _lineListeners = new Set()
const _metaListeners = new Set()

function _notifyLines() {
  const snap = [..._lines]
  _lineListeners.forEach(fn => fn(snap))
}

function _notifyMeta() {
  const state = { connected: _connected, bgMode: _bgMode }
  _metaListeners.forEach(fn => fn(state))
}

function _open() {
  if (_es) return
  _es = new EventSource('/api/logs/watch', { withCredentials: true })
  _es.onopen = () => { _connected = true; _notifyMeta() }
  _es.onmessage = e => {
    _lines = [..._lines, e.data].slice(-MAX_LINES)
    _notifyLines()
  }
  _es.onerror = () => { _connected = false; _notifyMeta() }
}

function _close() {
  if (!_es) return
  _es.close()
  _es = null
  _connected = false
  _notifyMeta()
}

function _sync() {
  if (_onPage || _bgMode) _open()
  else _close()
}

export function setOnPage(active) {
  _onPage = active
  _sync()
}

export function setBgMode(active) {
  _bgMode = active
  _notifyMeta()
  _sync()
}

export function getBgMode() { return _bgMode }
export function getConnected() { return _connected }

export function subscribeLines(fn) {
  _lineListeners.add(fn)
  fn([..._lines])
  return () => _lineListeners.delete(fn)
}

export function subscribeMeta(fn) {
  _metaListeners.add(fn)
  fn({ connected: _connected, bgMode: _bgMode })
  return () => _metaListeners.delete(fn)
}

export function clearLines() {
  _lines = []
  _notifyLines()
}
