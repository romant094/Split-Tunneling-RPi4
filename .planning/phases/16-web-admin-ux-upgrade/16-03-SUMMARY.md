---
phase: 16-web-admin-ux-upgrade
plan: 03
subsystem: admin-frontend
tags: [auth, cookie-session, react, api.js, App.jsx]
requires:
  - "Plan 16-01: backend /api/auth/check endpoint + 30-day Max-Age sg_session cookie"
provides:
  - "checkAuth() cookie-first probe in api.js"
  - "Tri-state mount-time auth gate in App.jsx (checking/in/out)"
affects:
  - "src/admin/src/api.js"
  - "src/admin/src/App.jsx"
tech-stack:
  added: []
  patterns:
    - "Tri-state auth (checking/in/out) instead of boolean loggedIn — avoids login-flash and lets mount effect resolve session state before first render decision"
key-files:
  created: []
  modified:
    - src/admin/src/api.js
    - src/admin/src/App.jsx
decisions:
  - "checkAuth() kept as a lightweight boolean probe (fetch + r.ok) — no response body parsing needed since /api/auth/check's JSON payload isn't consumed client-side"
  - "apiFetch's Authorization header + window.location.reload() on 401 left unchanged — reload re-triggers the mount probe, which now correctly resolves to 'out' via checkAuth() rather than re-prompting via stale sessionStorage state"
metrics:
  duration: "~20 min (code) + checkpoint verification cycle"
  tasks_completed: 2
  tasks_total: 3
  files_changed: 2
  completed: 2026-07-14
---

# Phase 16 Plan 03: Cookie-First Auth Persistence (Frontend) Summary

Replaced the SPA's `sessionStorage`-keyed auth gate with a cookie-first mount probe: `api.js` gained `checkAuth()` (hits `/api/auth/check` with `credentials:'include'`, returns a boolean), and `App.jsx` now resolves a tri-state `authState` (`checking → in|out`) on mount instead of synchronously reading `sessionStorage.getItem('sg_auth')`. This makes the SPA actually rely on the persistent `sg_session` cookie set by the Plan 16-01 backend change, instead of re-prompting for a password on every new tab or browser restart.

## What Was Built

**Task 1 — `api.js`: `checkAuth()` cookie probe (commit `7a8ca03`):** Added `export async function checkAuth()` that fetches `/api/auth/check` with `credentials: 'include'` and returns `true` on a 200 response, `false` otherwise (including network errors, caught and treated as unauthenticated). `apiFetch` was left otherwise unchanged — it still sends `credentials: 'include'` on every request plus the `Authorization: getAuthHeader()` fallback header (harmless once a valid cookie exists, since the backend checks the cookie first), and still calls `clearAuth()` + `window.location.reload()` on a 401. No `WWW-Authenticate` handling was reintroduced.

**Task 2 — `App.jsx`: tri-state mount probe (commit `ed45d3c`):** Replaced `const [loggedIn, setLoggedIn] = useState(!!sessionStorage.getItem('sg_auth'))` with `const [authState, setAuthState] = useState('checking')` plus a `useEffect(() => { checkAuth().then(ok => setAuthState(ok ? 'in' : 'out')) }, [])`. While `authState === 'checking'`, the app renders a minimal centered loading placeholder (Shield icon, pulsing, "Loading…" label, same background gradient as the login screen) so there is no login-form flash before the probe resolves. `authState === 'out'` renders `LoginForm` (unchanged internals — it still does the initial Basic-Auth POST to establish the cookie server-side, then calls `onLogin()`). `authState === 'in'` renders the authenticated app shell. `handleLogout` now calls `apiLogout()` then `setAuthState('out')`.

`npx vite build` was run to confirm the change compiles cleanly; the worktree had no `node_modules` installed, so `npm ci` was run first (existing `package-lock.json`, no new packages — matches the plan's threat-model note that no new npm dependencies were introduced). The resulting `dist/` output was byte-identical to the prior committed build (deterministic Vite output for this change), so no `dist/` diff was staged or committed — only the `src/` changes.

## Task 3: Checkpoint — Verification Deferred

Task 3 (`checkpoint:human-verify`) asked the user to deploy the rebuilt admin UI and confirm that reopening the browser after closing the tab lands directly on the Dashboard without a password re-prompt.

**Result: verification could not be completed as designed — but not due to a defect in this plan's code.**

The user ran `bash src/deploy-admin.sh` and was still prompted for a password on every reopen (5 attempts). Root cause, identified by the orchestrator: this plan executes as a sequential worktree in a wave where each plan's worktree is merged into `develop` immediately after it completes. Plan 16-01 (backend: `/api/auth/check` endpoint + 30-day Max-Age cookie) had already been merged into `develop` before this checkpoint fired. However, this plan's own commits (`7a8ca03`, `ed45d3c` — the frontend `api.js`/`App.jsx` fix) existed only on this worktree branch, not yet merged to `develop`, at the time the user ran the deploy. `deploy-admin.sh` builds and deploys from `develop`, so it shipped the **old** frontend (`sessionStorage`-based auth, no `checkAuth()`/`/api/auth/check` call) against the **new** backend. The old frontend never probes the cookie and always re-sends the stale/absent `sessionStorage` state, so it correctly re-prompted — this is exactly the pre-fix behavior, deployed by ordering accident rather than a bug in the fix itself.

**No code changes were made in response to this report** — the `api.js`/`App.jsx` changes described above are correct and complete per the plan's acceptance criteria (both automated verifications in Task 1 and Task 2 passed, `vite build` succeeded). Task 3's live-browser verification is deferred until after this worktree is merged to `develop`, at which point the user can redeploy (`bash src/deploy-admin.sh`) with both the backend and frontend halves present together, and retest.

## Deviations from Plan

None in the implemented code — Tasks 1 and 2 executed exactly as written and passed their automated verification. Task 3 (checkpoint) did not reach an "approved" resume signal during this session; see above for why and what happens next.

## Verification

```
cd src/admin && node -e "...checkAuth export + /api/auth/check + credentials:'include'..."   # OK (Task 1)
cd src/admin && node -e "...checkAuth + 'checking' present in App.jsx..." && npx vite build   # OK, build exit 0 (Task 2)
```

## Self-Check: PASSED

- FOUND: src/admin/src/api.js (modified — checkAuth() present)
- FOUND: src/admin/src/App.jsx (modified — tri-state authState present)
- FOUND commit 7a8ca03 (Task 1 — checkAuth() probe)
- FOUND commit ed45d3c (Task 2 — App.jsx tri-state mount probe)

## Next Step (for orchestrator / user)

1. Merge this worktree into `develop` so the backend (16-01) and frontend (16-03) auth fixes ship together.
2. Redeploy: `bash src/deploy-admin.sh`.
3. Retest Task 3's verification steps (login once, close tab, reopen — should land on Dashboard without a prompt; logout returns to login form).
