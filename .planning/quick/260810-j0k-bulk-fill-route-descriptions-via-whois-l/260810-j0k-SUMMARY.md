---
phase: quick-260810-j0k
plan: 01
subsystem: admin-frontend
tags: [routes, whois, staging, diff-preview]
dependency-graph:
  requires: []
  provides:
    - "src/admin/src/routeStaging.js: stageDescription/stageDescriptions/getPendingDescriptions/clearPendingDescriptions"
    - "src/admin/src/pages/Routes.jsx: Fill Descriptions button + fillDescriptions + flushStagedDescriptions"
    - "src/admin/src/components/DiffPreview.jsx: modifications prop"
  affects:
    - src/admin/src/pages/Routes.jsx
tech-stack:
  added: []
  patterns:
    - "sequential for-of + await batch (no Promise.all) for whois lookups and PUT flushes to avoid concurrent RPi subprocess/file races"
key-files:
  created: []
  modified:
    - src/admin/src/routeStaging.js
    - src/admin/src/pages/Routes.jsx
    - src/admin/src/components/DiffPreview.jsx
    - README.md
    - docs/README.ru.md
    - docs/REFERENCE.md
decisions:
  - "dist/ not committed — src/admin/.gitignore already excludes it (chore(15) commit untracked it); deploy.sh copies from a local build at deploy time, so PLAN's D-02 assumption (dist committed to repo) is stale and was not followed"
metrics:
  duration: "~35m"
  completed: "2026-08-10"
---

# Quick Task 260810-j0k: Bulk-fill route descriptions via whois lookup Summary

Added a "Fill Descriptions" toolbar action to the Routes page that sequentially resolves org
names via the existing `/api/diag/whois` endpoint for every listed route with an empty
description, stages the results client-side, renders them in the table and as `~` lines in the
Pending changes diff, and persists them to the route files via `PUT /api/routes/{list}` only
when the user clicks Apply Changes.

## What Was Built

**`src/admin/src/routeStaging.js`** — added a second module-level store, `_descEdits`, separate
from the existing add-staging `_pending` store (the bulk-add endpoint silently skips CIDRs that
already exist, so it can never express a description edit to an existing route). New exports:
`stageDescription`, `stageDescriptions` (batch, single notify), `getPendingDescriptions`,
`clearPendingDescriptions`. The subscriber snapshot gained a `descriptions: { vpn, isp }` key
alongside the unchanged top-level `vpn`/`isp` arrays.

**`src/admin/src/components/DiffPreview.jsx`** — new optional `modifications` prop, rendered
between additions and removals as amber `~ {cidr}  # {after}` lines; included in the
empty-state guard.

**`src/admin/src/pages/Routes.jsx`** (`RouteSection`):
- `displayRoutes` overlays staged `descEdits` onto the fetched `routes` before the existing
  filter/sort pipeline, so filled-but-unapplied descriptions are visible, filterable, sortable.
- `modifications` derived from `descEdits` entries that exist in `routes`, fed to `DiffPreview`.
- `fillDescriptions()`: targets are the currently filtered/sorted list's routes whose effective
  description (server value or staged edit) is empty after trimming. Iterates strictly
  sequentially with `for...of` + `await` (never `Promise.all`/`map(async...)`) since each whois
  call spawns `asn-lookup.py` on the RPi (up to 12s timeout). Per-route failures (thrown error,
  non-ok response, missing/empty `.org`) are skipped without aborting the batch. Progress state
  `{ done, total }` drives a disabled button labelled `Looking up N/M...`; on completion, results
  are staged in one `stageDescriptions()` call and a muted summary message is shown.
- `msg`/`msgTone` split (`'error'` | `'info'`) so the fill summary renders muted while API error
  messages (add/edit) stay `text-destructive`.

**`RoutesPage.applyRoutes()`** — added `flushStagedDescriptions(list)`, which sequentially PUTs
each staged `{old_cidr, cidr, description}` triple (ignoring individual non-ok responses — e.g. a
route deleted meanwhile 404s) and clears the staged map after the loop. Wired in after both
`flushStagedList` calls (adds) and before `/api/config/apply`, so newly added routes exist before
their descriptions (if any get filled in a later session) are edited.

**Docs** — README.md, docs/README.ru.md, docs/REFERENCE.md updated to document the Fill
Descriptions button: reuses the single-route whois lookup, runs sequentially (can take a while
for long lists), stages results as pending diff entries, nothing written until Apply Changes.

## Deviations from Plan

### Auto-fixed Issues

None — implementation followed the plan's interfaces and file-by-file instructions as written.

### Plan Assumption Correction (not a Rule 1-3 fix, documented per Rule 4 spirit)

**1. `src/admin/dist/` not committed, despite the plan's Task 3 instruction to "commit the
regenerated `dist/`".**
- **Found during:** Task 3, before staging.
- **Issue:** The plan cited D-02 ("Built dist committed to repo — no Node.js on RPi, no build
  step at deploy time") from STATE.md's Phase 15 decisions section. However, a later commit —
  `1ceb50b chore(15): untrack src/admin/dist from git, add dist to .gitignore` — reversed that
  decision: `src/admin/.gitignore` now excludes `dist`, and `src/deploy.sh` (Stage 30,
  `ADMIN_DIST_LOCAL="admin/dist"`) copies the admin UI straight from the local filesystem build
  at deploy time via SCP, not from a git-tracked committed artifact. README.md's existing deploy
  instructions ("`cd src/admin && npm run build && cd ../..` then `bash src/deploy.sh`") confirm
  this is the live convention.
- **Resolution:** Ran `npm run build` locally (verified `dist/index.html` and `dist/assets/`
  regenerate cleanly with the new code) to satisfy the plan's verification command, but did NOT
  `git add`/commit `src/admin/dist/` — doing so would silently re-introduce a file the project
  explicitly chose to stop tracking. No files were force-added past `.gitignore`.
- **Files affected:** none committed (dist/ built and left in the gitignored state).
- **Commit:** N/A (no commit — dist stays untracked as before).

## Known Stubs

None.

## Threat Flags

None — no new network endpoints, auth paths, or trust-boundary changes. Reuses the existing
`/api/diag/whois` and `PUT /api/routes/{list}` endpoints unmodified by this plan.

## Self-Check: PASSED

- `src/admin/src/routeStaging.js` — FOUND, exports verified via python grep (3/3 new exports present)
- `src/admin/src/pages/Routes.jsx` — FOUND, `fillDescriptions` and `flushStagedDescriptions` present
- `src/admin/src/components/DiffPreview.jsx` — FOUND, `modifications` prop present
- `README.md`, `docs/README.ru.md`, `docs/REFERENCE.md` — FOUND, all mention "Fill Descriptions"
- Commit 748a32f — FOUND (`git log --oneline` confirms)
- Commit 86b972b — FOUND
- Commit 0dee1b9 — FOUND
- `npm run build` — succeeded, `dist/index.html` and `dist/assets/*` regenerated
- `npx oxlint` — 0 errors; all warnings pre-existing and unrelated to this task's files
