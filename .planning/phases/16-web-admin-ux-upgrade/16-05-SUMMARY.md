---
phase: 16-web-admin-ux-upgrade
plan: 05
subsystem: web-admin-frontend
tags: [routes, staging, diff-preview, whois-lookup, backup, react]
dependency-graph:
  requires: [16-01]
  provides: [routeStaging-store, diff-preview-component, routes-page-diff-lookup-backup]
  affects: [16-07]
tech-stack:
  added: []
  patterns:
    - "module-level singleton store (routeStaging.js) mirroring existing logStream.js subscribe pattern"
    - "bulk-write-then-apply: flush staged adds via /api/routes/{list}/bulk before calling /api/config/apply"
key-files:
  created:
    - src/admin/src/routeStaging.js
    - src/admin/src/components/DiffPreview.jsx
  modified:
    - src/admin/src/pages/Routes.jsx
decisions:
  - "removals side of the diff is always empty in this phase (no delete-staging API yet) — DiffPreview still handles it generically so no future rewrite is needed"
  - "Apply Changes now performs a 3-step sequence: flush staged vpn/isp adds via bulk endpoint, POST /api/config/apply, then clearPending both lists and reload both RouteSections via a small module-level reloader registry"
metrics:
  duration: "~35 min"
  completed: "2026-07-28"
---

# Phase 16 Plan 05: Route Staging Store, Diff Preview, Auto-Lookup & Backup Summary

Shared client-side pending-route staging store (`routeStaging.js`) plus a git-diff-style preview, CIDR-owner auto-lookup, and one-click route-list backup wired into the Routes page.

## What Was Built

**Task 1 — `src/admin/src/routeStaging.js`**
Module-level singleton keyed by `vpn`/`isp`, mirroring the `logStream.js` subscribe pattern. Exports `subscribe(fn)`, `stageAdd(list, entry)`, `stageAddMany(list, entries)`, `unstage(list, cidr)`, `getPending(list)`, `clearPending(list)`. In-memory only — no persistence across reloads. `stageAddMany` is the batch entry point the Logs page (plan 16-07) will use for multi-select/context-menu adds.

**Task 2 — `src/admin/src/components/DiffPreview.jsx`**
Presentation-only `DiffPreview({ additions, removals })`. Additions render first as green `+` lines, removals after as red `-` lines, monospace, `# description` suffix when present. Per D-06, whichever block is empty is omitted entirely; if both are empty it renders a muted "No pending changes" line.

**Task 3 — `src/admin/src/pages/Routes.jsx`**
- `RouteSection` now subscribes to `routeStaging` for its own list (`vpn`/`isp`), computes `additions` (staged CIDRs not already on the server list) and `removals` (currently always `[]` — reserved for a future delete-staging feature per the interface note in the plan), and renders `<DiffPreview>` above the route table whenever there is a pending change.
- `AddSingleDialog` gained an `onBlur` handler on the CIDR field: derives the base IP (CIDR minus `/prefix`), calls `GET /api/diag/whois?ip=<baseIP>`, and — only when the description field is still empty — pre-fills it with the returned `org`. Silently no-ops on `{}` or network failure; shows a `looking up…` placeholder while in flight.
- `RoutesPage.applyRoutes` now performs bulk-write-then-apply: flushes any staged `vpn`/`isp` adds via `POST /api/routes/{list}/bulk`, then calls `POST /api/config/apply`, then calls `clearPending` for both lists and reloads both `RouteSection`s (via a small module-level `_reloaders` registry keyed by endpoint, since there's no shared parent state to trigger a re-render otherwise).
- `RoutesPage` gained a "Download Backup" button next to "Apply Changes": calls `GET /api/routes/backup`, reads the response as a `.blob()`, and triggers a synthetic `<a download>` anchor with filename `splitgate-routes-backup-<YYYY-MM-DD>.txt` (client-computed date, mirroring the `Logs.jsx` `downloadLines` pattern).

## Verification

- `node -e` checks for all three files pass (exports present, green/red styling present, empty-block guards present, whois/backup/routeStaging/DiffPreview markers present in Routes.jsx, empty-description guard present).
- `npm ci` (lockfile-exact install, no new packages — matches T-16-SC disposition) then `npx vite build` succeeds: `dist/` regenerated, no build errors.
- `git status --short` confirms no stray untracked files; `dist/` is gitignored (per prior commit `1ceb50b chore(15): untrack src/admin/dist from git, add dist to .gitignore`) so it is correctly not part of any commit in this plan.

## Deviations from Plan

None — plan executed as written, with one clarifying note:

- **[Note, not a deviation] `dist/` not committed.** The plan's `<output>` section says "committed `dist/`", but a prior commit (`1ceb50b`, Phase 15) intentionally untracked `dist/` and added it to `.gitignore`. This plan's build was verified to succeed (`vite build` exits 0, regenerates `dist/`) but no `dist/` commit was made, consistent with the current (later) repo convention that supersedes the plan's stale instruction.

## Threat Flags

None — all three threats in the plan's `<threat_model>` (T-16-10, T-16-11, T-16-12, T-16-SC) are satisfied by existing backend validation (delivered in 16-01) and the frontend's own `CIDR_RE`/IP-derivation guard; no new network surface, auth path, or schema change was introduced beyond what the threat model already covers.

## Self-Check: PASSED

- FOUND: src/admin/src/routeStaging.js
- FOUND: src/admin/src/components/DiffPreview.jsx
- FOUND: src/admin/src/pages/Routes.jsx (modified, diff verified)
- FOUND commit ffe125b (routeStaging.js)
- FOUND commit 2baa0fe (DiffPreview.jsx)
- FOUND commit 9e523c3 (Routes.jsx wiring)
