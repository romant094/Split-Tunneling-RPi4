---
phase: 16-web-admin-ux-upgrade
fixed_at: 2026-08-10T10:55:00Z
review_path: .planning/phases/16-web-admin-ux-upgrade/16-REVIEW.md
iteration: 1
findings_in_scope: 14
fixed: 14
skipped: 0
status: all_fixed
---

# Phase 16: Code Review Fix Report

**Fixed at:** 2026-08-10T10:55:00Z
**Source review:** .planning/phases/16-web-admin-ux-upgrade/16-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 14
- Fixed: 14
- Skipped: 0

## Fixed Issues

### CR-01: `/api/settings/env` writes unsanitized values into a file that is `source`d as root

**Files modified:** `src/scripts/splitgate-admin.py`
**Commit:** d92767c
**Applied fix:** Added `ENV_VALUE_RE` (rejects shell metacharacters and newlines) and validate every submitted value against it in `api_settings_env_put`, returning 400 before any write occurs. Matches the reviewer's suggested fix.

### CR-02: Staged pending routes are discarded on Apply even when the backend request fails

**Files modified:** `src/admin/src/pages/Routes.jsx`
**Commit:** b137448
**Applied fix:** `flushStagedList` now checks `r.ok` before calling `clearPending`, returning `true`/`false`. `applyRoutes` aborts (keeping staged entries) and shows an error message if either bulk write failed, instead of always proceeding to `/api/config/apply`. Matches the reviewer's suggested fix exactly.

### WR-01: `/api/settings/awg-config` accepts arbitrary content with no directive validation

**Files modified:** `src/scripts/splitgate-admin.py`, `src/admin/src/pages/Settings.jsx`
**Commit:** 604006c
**Applied fix:** Backend now requires `{"confirmation": "RUN_HOOKS"}` in the request body when submitted AWG config contains `PostUp`/`PreUp`/`PostDown`/`PreDown` directives (mirrors the existing rollback confirmation pattern), returning 400 otherwise. Frontend `AwgConfig.uploadConfig` detects hook directives client-side, shows a `window.confirm` warning describing the root-shell-execution risk, and only sends `confirmation: 'RUN_HOOKS'` if the user confirms. **Note:** this changes the API contract for `PUT /api/settings/awg-config` (previously always accepted; now requires confirmation when hooks present) — flagged for human verification that this doesn't break any other caller of this endpoint.

### WR-02: In-memory session set grows without bound

**Files modified:** `src/scripts/splitgate-admin.py`
**Commit:** 8819ce4
**Applied fix:** Changed `_sessions` from a bare `set()` to a `dict` mapping token -> creation timestamp. Added `_prune_sessions()` which expires entries older than 30 days (matching the cookie `max_age`) and evicts the oldest entries if the store exceeds 1000 sessions; called on every new Basic-Auth-derived session. Updated `/api/auth/logout` to use `_sessions.pop(token, None)` instead of the now-invalid `.discard()` (set method) on the dict.

### WR-03: Unescaped backreferences in `/api/settings/secrets` regex substitution

**Files modified:** `src/scripts/splitgate-admin.py`
**Commit:** 4a9b24e
**Applied fix:** Escape backslashes in the submitted value (`val.replace('\\', '\\\\')`) before interpolating it into the `re.sub` replacement pattern, preventing `re.error` crashes on values containing `\1`/`\g<...>`-like sequences. Matches the reviewer's suggested fix.

### WR-04: `write_env_file` does not quote or reject values with spaces/newlines

**Files modified:** `src/scripts/splitgate-admin.py`
**Commit:** 2a8197a
**Applied fix:** `write_env_file` now always double-quotes values (`KEY="value"`) and escapes any embedded double quotes, so values containing spaces survive `source`-time word-splitting and quoting is no longer silently lost on re-write (previously `strip_env_quotes` stripped quotes on read but the writer never re-added them). **Note:** this changes the on-disk format of `/etc/splitgate/vpn-gateway.env` (values are now always quoted) — flagged for human verification against `routing.sh`/`update-vpn-routes` which `source` this file, to confirm quoted values parse identically to the previous unquoted format for all existing keys.

### WR-05: `CIDR_RE`/`IP_RE` do not validate octet or prefix ranges (frontend + backend)

**Files modified:** `src/scripts/splitgate-admin.py`, `src/admin/src/pages/Routes.jsx`, `src/admin/src/pages/Diagnostics.jsx`
**Commit:** 2eaa1e0
**Applied fix:** Backend: added `is_valid_cidr()`/`is_valid_ip()` helpers using `ipaddress.IPv4Network`/`IPv4Address` (strict=False) and swapped them in at all user-input validation call sites (route add/edit/delete/bulk endpoints and diagnostics IP endpoints), leaving the loose `CIDR_RE.match()` used for parsing trusted local route files untouched. Frontend: added matching `isValidCidr()` (octet 0-255, prefix 0-32) in `Routes.jsx` and `isValidIp()` (octet 0-255) in `Diagnostics.jsx`, swapped into the add/edit/bulk-paste validation paths while leaving the plain `CIDR_RE`/`IP_RE` shape-check regexes in place for use inside the new validators.

### WR-06: Route bulk-add endpoints crash on non-object entries

**Files modified:** `src/scripts/splitgate-admin.py`
**Commit:** 340bbb9
**Applied fix:** Both `api_routes_vpn_bulk` and `api_routes_isp_bulk` now `continue` (skip) any entry in the `entries` list that isn't a `dict`, before calling `.get()` on it, preventing the unhandled `AttributeError` -> 500. Matches the reviewer's suggested fix.

### WR-07: Add/Edit dialogs close and reset even when the underlying request fails

**Files modified:** `src/admin/src/pages/Routes.jsx`
**Commit:** f97ceda
**Applied fix:** `RouteSection.handleAdd`/`handleEdit` now return `{ ok: true }`/`{ ok: false }` based on the response status (in addition to setting `msg` and reloading on failure). `AddSingleDialog.handleAdd` and `EditDialog.handleSave` now check the returned result and only call `reset()`/`onClose()` when the operation succeeded, keeping the dialog open with the error visible on failure.

### WR-08: Delete has no error handling — dialog closes and list "succeeds" even on failure

**Files modified:** `src/admin/src/pages/Routes.jsx`
**Commit:** 24e37d6
**Applied fix:** `handleDelete` now checks `r.ok` and sets the section's `msg` state with the server error on failure, mirroring the pattern already used by `handleAdd`/`handleEdit`, before closing the confirm dialog and reloading.

### WR-09: Docs are out of sync with the new API surface and pages added in this phase

**Files modified:** `docs/README.ru.md`, `docs/REFERENCE.md`
**Commit:** f1cf357
**Applied fix:** Added a **Diagnostics** entry to the `README.ru.md` "Страницы" list. Extended the `REFERENCE.md` "API Endpoints" table with all endpoints called out in the review: `GET /api/status/watch`, `GET /api/status/resources`, `GET /api/resources/watch`, `GET /api/services/watch`, `POST /api/services/bulk/{action}`, `PUT /api/routes/{vpn,isp}`, `POST /api/routes/{vpn,isp}/bulk`, `GET /api/routes/backup`, `GET /api/logs/history`, a new Diagnostics section (`GET /api/diag/whois`, `/traceroute`, `/route-match`), and `GET`/`PUT /api/settings/awg-config` + `POST /api/settings/restart-admin`, based on reading each handler's actual implementation for accurate descriptions.

### IN-01: `unstage()` in `routeStaging.js` is exported but never called

**Files modified:** `src/admin/src/routeStaging.js`
**Commit:** efff036
**Applied fix:** Took the reviewer's simpler sanctioned option and removed the dead `unstage()` export (confirmed via grep that no other file in `src/admin/src` referenced it), rather than wiring a new per-entry "remove staged route" UI affordance, since the latter is a larger UX feature addition outside the scope of a code-review fix pass.

### IN-02: `Progress` component does not guard against `NaN`

**Files modified:** `src/admin/src/components/ui/progress.jsx`
**Commit:** fd1e913
**Applied fix:** Replaced `Math.min(100, Math.max(0, value ?? 0))` with `Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : 0`, exactly as suggested by the reviewer, so a `NaN` value (e.g. `0/0` division) renders as 0% instead of producing invalid `width: NaN%` CSS.

### IN-03: `ipSortKey` does not handle malformed CIDR input

**Files modified:** `src/admin/src/pages/Routes.jsx`
**Commit:** 18ff7a3
**Applied fix:** `ipSortKey` now defensively builds exactly 4 octet segments via `Array.from({length: 4}, ...)`, substituting `0` for any missing/non-numeric octet, instead of relying on `ip.split('.')` producing exactly 4 well-formed parts. Prevents `"NaN"` segments from appearing in the sort key for malformed CIDRs.

## Skipped Issues

None — all findings were fixed.

---

_Fixed: 2026-08-10T10:55:00Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
