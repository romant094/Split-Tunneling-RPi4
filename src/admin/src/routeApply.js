// Flush-then-apply, shared by the Routes page's Apply Changes button and the
// Logs page's "Apply immediately" path. Extracted from Routes.jsx so the two
// callers cannot drift apart — the ordering rules below are easy to get wrong.

import { apiFetch } from './api'
import {
  getPending, clearPending,
  getPendingDescriptions, clearPendingDescriptions,
} from './routeStaging'

// Preference for staging actions on the Logs page: when on, adding routes there
// writes and activates them straight away instead of leaving them pending for a
// trip to the Routes page. Persisted, because having to re-tick it on every page
// load would make it useless.
const APPLY_IMMEDIATELY_KEY = 'sg_apply_immediately'

export function getApplyImmediately() {
  try {
    return localStorage.getItem(APPLY_IMMEDIATELY_KEY) === '1'
  } catch {
    // Storage can be unavailable (private mode, blocked cookies). Default off —
    // the safe direction is "stage it, let the user apply".
    return false
  }
}

export function setApplyImmediately(on) {
  try {
    localStorage.setItem(APPLY_IMMEDIATELY_KEY, on ? '1' : '0')
  } catch {
    // ignore — the toggle then only lasts for this page view
  }
}

async function flushStagedList(list) {
  const entries = getPending(list)
  if (!entries.length) return true
  const r = await apiFetch(`/api/routes/${list}/bulk`, { method: 'POST', body: JSON.stringify({ entries }) })
  if (!r.ok) return false
  // Only clear once the write actually succeeded, so a failed request never
  // silently discards pending routes (CR-02).
  clearPending(list)
  return true
}

async function flushStagedDescriptions(list) {
  const map = getPendingDescriptions(list)
  const entries = Object.entries(map)
  if (!entries.length) return
  // Sequential: each PUT rewrites the whole route file on the RPi, so concurrent
  // writes would race. A route deleted meanwhile 404s — ignore and continue.
  for (const [cidr, description] of entries) {
    try {
      await apiFetch(`/api/routes/${list}`, {
        method: 'PUT',
        body: JSON.stringify({ old_cidr: cidr, cidr, description }),
      })
    } catch {
      // ignore individual failures, continue flushing the rest
    }
  }
  clearPendingDescriptions(list)
}

/**
 * Write every staged change into the route files, then activate them.
 *
 * Returns {ok, error?, routesDirty?}. `routesDirty` comes from the apply
 * response so a caller can settle its Apply button without waiting for the next
 * /api/status poll.
 *
 * On a failed bulk write nothing is applied and the staged entries are kept, so
 * the user can retry rather than losing the routes.
 */
export async function flushAndApply() {
  try {
    const okVpn = await flushStagedList('vpn')
    const okIsp = await flushStagedList('isp')
    if (!okVpn || !okIsp) {
      return { ok: false, error: 'failed to save staged routes — not applied, changes kept pending' }
    }
    await flushStagedDescriptions('vpn')
    await flushStagedDescriptions('isp')
    const r = await apiFetch('/api/config/apply', { method: 'POST' })
    const d = await r.json().catch(() => ({}))
    if (!r.ok) return { ok: false, error: d.error || 'apply failed' }
    return { ok: true, routesDirty: d.routes_dirty }
  } catch {
    return { ok: false, error: 'apply failed' }
  }
}
