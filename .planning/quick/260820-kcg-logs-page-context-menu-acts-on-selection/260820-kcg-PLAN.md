---
quick_id: 260820-kcg
slug: logs-page-context-menu-acts-on-selection
date: 2026-08-20
mode: quick
status: planned
---

# Quick Task 260820-kcg — Logs page

Part C of a three-part batch. Consumes `total` / `truncated` / `day_cap` from
`/api/logs/history`, added in Part A (`260820-juc`).

## Task 1 — Context menu acts on the selection; honest batch counts

**Files:** `src/admin/src/pages/Logs.jsx`

**Problem.** With several rows selected, right-clicking one of them stages just
that row — the menu is blind to the selection. Separately, `Add N to ISP` in the
`SelectionBar` promises N while `selectedToEntries` collapses destinations to
their /24, so fewer routes actually arrive. Two ways to select three Akamai lines
and get one route, neither of them explained.

**Action.**
1. `LogContextMenu` takes the selection. When select mode is on and the
   right-clicked line is part of it, the items become
   `Add N routes to ISP / VPN` and route through the same batch path. A
   right-click outside the selection keeps today's single-line behaviour.
2. `SelectionBar` labels the **resulting route count**, not the line count, and
   shows both when they differ (`3 lines → 1 route`) so the /24 collapse is
   visible rather than surprising.
3. `Copy` in the context menu copies all selected lines when acting on a
   selection.

**Verify.** `npx oxlint src`, `npm run build`.

**Done.** Both batch paths agree, and the number on the button is the number of
routes that will be staged.

## Task 2 — Exclude filters

**Files:** `src/admin/src/pages/Logs.jsx`

**Action.**
1. Second filter row with an `EyeOff` icon, up to `MAX_FILTERS` fields, built
   from the same component as the include row.
2. Semantics: include terms are ANDed (existing `applyFilters`); exclude terms
   are ORed — a line matching any hide term is dropped. Applied after include and
   before dedupe.
3. Both sub-pages, and the line counters must reflect the result.

**Verify.** `npx oxlint src`, `npm run build`.

**Done.** A noisy source can be hidden without having to construct an include
filter that happens to exclude it.

## Task 3 — Copy filtered

**Files:** `src/admin/src/pages/Logs.jsx`

**Action.** `Copy` button beside `Download` in the same right-aligned row, on
both sub-pages. Copies the currently visible lines as **raw** text — the same
content `Download` writes, not the `formatTs` display form, so a pasted line
still carries its ISO timestamp. Brief `Copied N lines` confirmation, and an
honest failure message when the clipboard is unavailable (non-HTTPS origins deny
it).

**Verify.** `npx oxlint src`, `npm run build`.

**Done.** The filtered view can be pasted elsewhere without a download round-trip.

## Task 4 — Virtualized log view and honest counters

**Files:** `src/admin/src/pages/Logs.jsx`, `src/admin/src/App.css`,
`src/admin/package.json`

**Action.**
1. `LogBox` renders through `@tanstack/react-virtual` (new dependency).
2. Fixed row height. This requires `.log-row { white-space: pre }` plus
   horizontal scroll on the container: today long lines wrap, which would make
   row heights variable and defeat a fixed `estimateSize`. One line per row is
   also the conventional log-viewer behaviour, and it is what makes the 50000-line
   cap from Part A usable.
3. Preserve every existing behaviour: auto-scroll to bottom on new lines,
   `onContextMenu`, click-to-select, and the `log-line-vpn` / `log-line-isp`
   colour classes.
4. Auto-scroll must not fight the user: only stick to the bottom when the view is
   already at the bottom, so scrolling back through history is not yanked away by
   the next SSE line.
5. Historical counter consumes `total` / `truncated` / `day_cap`:
   `5000 / 12483 lines (truncated to the last 50000 per day)` instead of today's
   `5000 / 5000`.

**Verify.** `npx oxlint src`, `npm run build`.

**Done.** Tens of thousands of lines render without stalling the page, and the
counter distinguishes a complete day from a tail.

## Task 5 — Documentation sweep

**Files:** `README.md`, `docs/README.ru.md`, `docs/REFERENCE.md`

Per CLAUDE.md, grep the project for every concept this three-part batch added or
changed and update all affected docs — `normalize_route_line`, `add_route`,
`.last-apply`, `routes_dirty`, `HISTORY_DAY_CAP`, the route-file format
tolerance, batch delete, exclude filters, Copy filtered, the Fill Descriptions
scopes. Keep `README.md` and `docs/README.ru.md` in sync with each other.

## Notes

- CLAUDE.md: English-only repo artifacts, no `Co-Authored-By`, `git push` after
  every commit — currently blocked, see the Part B summary.
