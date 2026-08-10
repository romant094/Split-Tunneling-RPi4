---
phase: 16-web-admin-ux-upgrade
plan: 06
subsystem: web-admin-frontend
tags: [diagnostics, whois, traceroute, route-match, react, asn-lookup]
dependency-graph:
  requires: [16-01, 16-03]
  provides: [diagnostics-page, diagnostics-route-nav]
  affects: []
tech-stack:
  added: []
  patterns:
    - "IPForm reusable local component with client-side IP_RE validation before every /api/diag/* call — defense-in-depth alongside 16-01 server-side IP_RE"
    - "reuses LogBox from Logs.jsx for monospace traceroute output (no new output-container component)"
key-files:
  created:
    - src/admin/src/pages/Diagnostics.jsx
  modified:
    - src/admin/src/App.jsx
decisions:
  - "VPN/ISP route-match decision badge reuses the existing log-line-vpn/log-line-isp CSS color convention from App.css rather than introducing new badge colors"
  - "traceroute 503 (binary not installed) shown as a distinct message pointing at deploy.sh, not a generic error"
metrics:
  duration: "~20 min (plus checkpoint pause)"
  completed: "2026-08-10"
requirements-completed: [UI-DIAG]
---

# Phase 16 Plan 06: Diagnostics Page Summary

New Diagnostics page (whois/ASN lookup, traceroute, route-match checker) wired to the three `/api/diag/*` endpoints from plan 16-01, reachable via `/diagnostics` nav link.

## What Was Built

**Task 1 — `src/admin/src/pages/Diagnostics.jsx`**
Three `Card` sections, each with a shared local `IPForm` component that validates input against the client-side bare-IP regex (`/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/`) before calling the API — matching the pattern used elsewhere in this phase (D-09):
1. **Whois / ASN** — calls `GET /api/diag/whois?ip=<ip>`; renders `org`/`asn`, or "No data / lookup unavailable" for an empty `{}` response.
2. **Traceroute** — calls `GET /api/diag/traceroute?target=<ip>`; shows a "Tracing… (may take up to 60s)" loading state on the submit button; renders `lines` in the existing `LogBox` monospace container (imported from `Logs.jsx`, no new component). A 503 response is shown as "traceroute is not installed on the RPi — run deploy.sh to install it."
3. **Route-Match** — calls `GET /api/diag/route-match?ip=<ip>`; renders a `decision` badge (VPN/ISP) styled with the existing `log-line-vpn`/`log-line-isp` CSS classes, plus `matched_by` and `cidr` (falls back to "default route" when `cidr` is null).

Non-200 responses surface the JSON `error` field inline. No new npm dependency was added (per T-16-SC).

**Task 2 — `src/admin/src/App.jsx`**
- Imported `Diagnostics` from `./pages/Diagnostics`; added `Activity` to the existing `lucide-react` import.
- Added `{ to: '/diagnostics', icon: Activity, label: 'Diagnostics' }` to the `NAV` array (between Logs and Config).
- Added `<Route path="/diagnostics" element={<Diagnostics />} />` inside the top-level `<Routes>` block, sibling to `/config` and `/settings`.
- 16-03's `checkAuth`-based tri-state auth-persistence logic was left untouched (verified present, count >= 1).

## Verification

- `node -e` check confirms `Diagnostics.jsx` contains all three `diag/whois`, `diag/traceroute`, `diag/route-match` endpoint strings and a default export.
- `node -e` check on `App.jsx` confirms `Diagnostics` import, `/diagnostics` route, and that `checkAuth` (16-03's fix) is still present.
- `npm install` (no lockfile changes — worktree had no `node_modules`, installed from existing `package.json`/`package-lock.json`, no new packages) then `npx vite build` succeeds: `dist/` regenerated (461 KB JS, 2704 modules transformed), no build errors.
- All plan acceptance-criteria greps pass: `import Diagnostics` = 1, `path="/diagnostics"` = 1, `'/diagnostics'` (NAV entry) = 1, `checkAuth` >= 1.

## Task Commits

1. **Task 1: Build Diagnostics.jsx with whois, traceroute, and route-match sections** - `5767130` (feat)
2. **Task 2: Register /diagnostics route and nav link in App.jsx** - `402577e` (feat)

Task 3 (checkpoint:human-verify) did not produce a code commit — see "Deviations / Task 3 Status" below.

## Deviations from Plan

None in the code itself — plan executed as written for Tasks 1 and 2.

### Task 3 Status: verification deferred (deployment-ordering gap, not a code defect)

Task 3 is a `checkpoint:human-verify` gate requiring the user to exercise the live Diagnostics page against the deployed RPi backend. The user attempted this and got "No routes matched location /diagnostics" (blank page).

**Root cause:** this plan's Task 1/2 commits (`5767130`, `402577e`) exist only on this worktree branch (`worktree-agent-a1e2c767a56857fae`), not yet merged into `develop`. The user deployed from `develop`, whose `App.jsx` at the time had zero occurrences of `Diagnostics` — confirmed by the orchestrator via grep. This is the same pattern seen at plan 16-03's checkpoint: worktree-isolated commits are invisible to a deploy taken from `develop` until the orchestrator merges the worktree back.

This is **not a defect in this plan's code** — `Diagnostics.jsx` and the `App.jsx` route/nav wiring are correct and verified locally (build succeeds, all grep/acceptance checks pass). No code changes were made in response to this report, per the orchestrator's instruction.

**Path to resolution:** orchestrator merges this worktree into `develop`; user redeploys (`bash src/deploy.sh` then `bash src/deploy-admin.sh`) and retests Task 3's three verification steps (whois, traceroute, route-match) against `http://192.168.1.254:8080/#/diagnostics`.

## Threat Flags

None — the plan's `<threat_model>` register (T-16-13, T-16-14, T-16-SC) is fully addressed: client-side `IP_RE` validation is in place as defense-in-depth ahead of the 16-01 server-side validation; the traceroute UI shows a loading state (no parallel-call spamming); no new npm packages were introduced.

## Self-Check: PASSED

- FOUND: src/admin/src/pages/Diagnostics.jsx
- FOUND: src/admin/src/App.jsx (modified — Diagnostics import, /diagnostics route, NAV entry, checkAuth preserved)
- FOUND commit 5767130 (Diagnostics.jsx)
- FOUND commit 402577e (App.jsx wiring)
