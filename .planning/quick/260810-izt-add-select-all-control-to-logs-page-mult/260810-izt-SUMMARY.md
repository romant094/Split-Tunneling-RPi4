---
phase: quick-260810-izt
plan: 01
subsystem: admin-ui
tags: [logs, multi-select, react]
requires: []
provides:
  - "selectAll toggle on useSelection hook"
  - "Select All / Deselect All button on SelectionBar"
affects:
  - src/admin/src/pages/Logs.jsx
tech-stack:
  added: []
  patterns:
    - "selectAll(lines) replaces the selected Set wholesale with the passed-in visible array (or empties it) rather than merging — keeps a single source of truth"
key-files:
  created: []
  modified:
    - src/admin/src/pages/Logs.jsx
decisions: []
metrics:
  duration: "~15 min"
  completed: "2026-08-10"
---

# Quick Task 260810-izt: Select All control for Logs multi-select Summary

Added a Select All / Deselect All toggle to the Logs page multi-select toolbar (Watch Live and Historical tabs), operating on each page's own `visible` (filtered + deduped) line array via the existing `useSelection` hook — no parallel selection mechanism introduced.

## What Was Built

- `useSelection()` gained `selectAll(lines)`: if every entry in `lines` is already selected (and `lines.length > 0`), it clears the selection; otherwise it replaces `selected` with exactly the passed-in `lines`.
- `SelectionBar` gained `total`/`onToggleAll` props. It computes `allSelected = total > 0 && count === total` and renders a `Select All (N)` / `Deselect All` button (disabled when `total === 0`) between the "{count} selected" label and the "Add {count} to ISP" button.
- `LogsLive` and `LogsHistory` each destructure `selectAll` from `useSelection()` and pass `total={visible.length}` / `onToggleAll={() => selectAll(visible)}` — each page closes over its own filtered/deduped `visible` array, so Select All only ever acts on what's currently rendered.

## Tasks Completed

| Task | Name | Commit |
|------|------|--------|
| 1 | Add selectAll toggle to useSelection and Select All button to SelectionBar | d1a2e36 |
| 2 | Wire Select All into LogsLive and LogsHistory | 4625532 |

## Verification

- `cd src/admin && npm run lint` — exit 0 (only pre-existing warnings unrelated to this change: unused imports in Settings.jsx/App.jsx/Dashboard.jsx, exhaustive-deps in Routes.jsx, and a pre-existing unused `clear` in LogsLive/`Navigate` import in Logs.jsx — none introduced by this task).
- `cd src/admin && npm run build` — succeeded, `dist/` output unchanged in git status (dist is gitignored per D-02 supersession in phase 15 SUMMARY).
- Task 1 automated verify (`grep -c "Select All"` etc.) passed.
- Manual runtime verification (dev server / browser click-through) was not performed in this headless environment; code review confirms the button wiring, `allSelected` computation, and `visible`-array closures match the plan's must_haves exactly.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Installed missing npm dependencies before running lint/build**
- **Found during:** Task 2 verification
- **Issue:** `src/admin/node_modules` was absent (0 packages installed), so `npm run lint` and `npm run build` could not execute.
- **Fix:** Ran `npm install` in `src/admin/` to install the packages already declared in the existing `package.json`/`package-lock.json` (no new dependency added, no version changes).
- **Files modified:** none (node_modules is gitignored, not committed)
- **Commit:** n/a (no tracked files changed by the install)

No other deviations — plan executed exactly as written otherwise.

## Docs Review (per CLAUDE.md convention)

Grepped `README.md`, `docs/README.ru.md`, `docs/REFERENCE.md` for "multi-select"/"Select All"/"Select mode" — no matches. The Logs multi-select toolbar (introduced in phase 16 plan 07) was never documented in these files, so no updates were needed for this quick task.

## Self-Check: PASSED

- FOUND: src/admin/src/pages/Logs.jsx (selectAll, onToggleAll, Select All all present)
- FOUND: d1a2e36
- FOUND: 4625532
