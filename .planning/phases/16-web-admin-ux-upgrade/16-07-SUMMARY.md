---
phase: 16-web-admin-ux-upgrade
plan: 07
subsystem: web-admin-frontend
tags: [logs, dedupe, context-menu, multi-select, route-staging, react]
dependency-graph:
  requires: [16-05]
  provides: [logs-dedupe-toggle, logs-context-menu, logs-batch-stage]
  affects: [routeStaging.js consumers, Routes.jsx diff preview]
tech-stack:
  added: []
  patterns:
    - "hand-rolled context menu (no new npm dependency) — fixed-position div, closed on outside click / Escape"
    - "dedupe/selection/staging as small local hooks (useSelection, useStageActions) shared between LogsLive and LogsHistory instead of duplicating state logic"
    - "raw log line kept as selection/staging identity key; display-only transforms (formatTs, dedupe) never mutate liveLines/histLines"
key-files:
  created: []
  modified:
    - src/admin/src/pages/Logs.jsx
    - src/admin/src/App.css
decisions:
  - "extractCidr always normalizes a log line's destination IP to its containing /24 subnet (toSubnet24, zero last octet) before staging — not a /32 host route, per user-reported bug found during Task 4 checkpoint verification"
  - "humanTime/interactive/selectMode props added to the shared LogBox component (used by StaticLog too) but default to false/off there — only LogsLive/LogsHistory opt in, keeping Install/Errors/Journal tabs behavior unchanged"
metrics:
  duration: "~35 min (plus checkpoint pause)"
  completed: "2026-08-10"
requirements-completed: [UI-LOGS]
---

# Phase 16 Plan 07: Logs Page UX Upgrade Summary

Extended `src/admin/src/pages/Logs.jsx` with a display-only hide-duplicates toggle, human-readable timestamps, a ✓/✗ status legend, per-row hover highlight, a hand-rolled right-click context menu (Copy / Add route to ISP / Add route to VPN), and multi-select batch staging — all route additions feed the shared `routeStaging` store (from plan 16-05) so they surface in the Routes page diff-preview + Apply flow.

## What Was Built

**Task 1 — Dedupe toggle + human-readable timestamps + ✓/✗ legend**
- `dedupeSignature(line)` strips the leading ISO timestamp and `[VPN]`/`[ISP]` tag (confirmed daemon line format `{ts} [{tag}] {status} {src} → {dst_part} {port_part} | {org}` by re-grepping `watch-routes.py`'s `_write_daemon_line`/`format_line`), leaving the `{status} {src} → {dst} {port} | {org}` substring for comparison.
- `dedupeLines(lines)` keeps the first occurrence per signature across the whole current view (Set-based — D-03: ALL matching duplicates collapse, not just adjacent ones).
- "Hide duplicates" toggle added to both `LogsLive` and `LogsHistory` control bars, composed with the existing `applyFilters` result. Raw `liveLines`/`histLines` state is never mutated (D-04) — dedupe is applied only at render via a derived `visible` value.
- `formatTs(line)` replaces the leading ISO timestamp token with `date-fns` `format(parseISO(token), 'dd MMM HH:mm:ss')`, leaving the rest of the line intact; the raw line is preserved for Copy/download. Wired via a new `humanTime` prop on `LogBox` (opt-in, used by Live/History).
- `LogsLegend` renders "✓ = connection tracked (packets flowing) · ✗ = no conntrack entry (blocked/idle) · shown right after the [VPN]/[ISP] tag" — wording taken from `_check_conntrack`'s docstring in `watch-routes.py`.

**Task 2 — Row hover highlight + right-click context menu**
- `LogBox` rows get a `log-row` class; `.log-row:hover` background style added to `App.css` alongside the existing `.log-line-vpn`/`.log-line-isp` rules.
- `LogContextMenu` (local component, no new npm package — satisfies T-16-SC) opens on `onContextMenu` at cursor position, closes on outside click/Escape. Offers Copy (writes the raw line via `navigator.clipboard.writeText`), "Add route to ISP list", and "Add route to VPN list" — the latter two disabled when the row has no extractable destination IP.
- `extractCidr(line)` pulls the destination IP token after `→`; `extractOrg(line)` pulls the text after the last `|` as the pre-filled description.
- Staging goes through `stageAdd(list, {cidr, description})` (imported from `../routeStaging`, created in 16-05) — no direct-to-file writes from Logs (D-05). A brief inline confirmation ("Staged … → ISP/VPN (review in Routes)") is shown via a shared `useStageActions` hook, matching the Routes page's existing inline-message pattern.

**Task 3 — Multi-select + batch add-to-exceptions**
- `useSelection()` hook: per-row toggle selection (keyed by the raw line string, stable across dedupe/filter re-renders), a "Select" entry button, "Clear selection" exit action. Selection is display-only and resets on unmount.
- `SelectionBar` shows "Add N to ISP" / "Add N to VPN" buttons once in select mode; `selectedToEntries(selected)` maps each selected line to `{cidr, description}`, de-duplicating identical CIDRs before calling `stageAddMany('isp'|'vpn', entries)`. Lines with no extractable destination IP are skipped.
- Rows visually indicate selection via a `.log-row-selected` CSS class (added to `App.css`).

**Task 4 checkpoint fix — /24 subnet normalization (found during human verification)**
- User deployed and tested against `develop` (worktree already merged) and found that context-menu / batch "Add route" staged the exact destination IP as a `/32` (e.g. `188.93.21.60/32`) instead of the `/24` subnet containing it (e.g. `188.93.21.0/24`).
- Added `toSubnet24(ip)` — splits the dotted IPv4, zeroes the 4th octet, appends `/24`. `extractCidr(line)` (the single shared code path used by both the context-menu single-add and the multi-select batch-add) now calls `toSubnet24` instead of appending `/32` directly. No change to `routeStaging.js` itself — this is purely about what CIDR string `Logs.jsx` constructs before calling `stageAdd`/`stageAddMany`.

## Verification

- Task 1 automated check: `dedupeSignature`, `dedupeLines`, `Hide duplicates` present; ✓ and ✗ present in a legend string; `parseISO`/`format(` used for timestamp reformatting.
- Task 2 automated check: `onContextMenu`, `stageAdd`, `clipboard`, "Add route to ISP", "Add route to VPN" all present; no new context-menu npm package imported (`@radix-ui/react-context-menu` / `react-contextmenu` = 0 occurrences).
- Task 3 automated check: `stageAddMany` present, selection-state regex match present; `npx vite build` (after `npm ci` — worktree had no `node_modules`) succeeds, `dist/` regenerated (gitignored — `src/deploy-admin.sh` rebuilds it at deploy time, matching the existing convention from commit `1ceb50b`).
- /24 fix: rebuilt after the change — `npx vite build` succeeds; `toSubnet24` and a `.0/24` template literal confirmed present in the built source.
- Live verification (user, against deployed `develop`): timestamps, ✓/✗ legend, hide-duplicates toggle, hover highlight, context menu Copy/Add, and multi-select batch-add were all implicitly exercised while finding the /24 bug — no other defects reported.

## Task Commits

1. **Task 1: Dedupe toggle + human-readable timestamps + ✓/✗ legend** — `536aa0a` (feat)
2. **Task 2: Row hover highlight + right-click context menu (Copy / Add to ISP / Add to VPN)** — `a18e0c1` (feat)
3. **Task 3: Multi-select + batch add-to-exceptions** — `adc6709` (feat)
4. **Checkpoint fix: stage /24 subnet instead of /32 IP** — `9f2e934` (fix)

Task 4 (checkpoint:human-verify) itself produced no separate code commit — see "Deviations" below for the fix commit it triggered.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug, found during Task 4 checkpoint verification] Route additions staged a /32 host route instead of the intended /24 subnet**
- **Found during:** Task 4 (human-verify checkpoint) — user deployed to the live RPi and tested Add-route from both the context menu and multi-select batch flow.
- **Issue:** `extractCidr(line)` appended `/32` directly to the parsed destination IP, staging an exact-host CIDR (e.g. `188.93.21.60/32`) rather than the `/24` subnet containing it (e.g. `188.93.21.0/24`), which is the intended granularity for these route exceptions.
- **Fix:** Added `toSubnet24(ip)` (zero the 4th octet, append `/24`); `extractCidr` now returns `toSubnet24(m[1])` instead of `${m[1]}/32`. This is the single code path shared by both the context-menu single-add and the multi-select batch-add, so both call sites were fixed together.
- **Files modified:** `src/admin/src/pages/Logs.jsx`
- **Commit:** `9f2e934`

No other deviations — Tasks 1-3 executed as written; all acceptance criteria and automated verifications passed on first attempt.

## Threat Flags

None — the plan's `<threat_model>` register is addressed as designed: T-16-15 (CIDR derived from log line staged to routes) is mitigated by staged CIDRs going through `/api/routes/*/bulk`'s backend `CIDR_RE` validation (Phase 15) regardless of host-vs-subnet granularity; T-16-16 (clipboard copy) is accepted as originally scoped; T-16-SC (no new npm packages) holds — the context menu remains hand-rolled.

## Self-Check: PASSED

- FOUND: src/admin/src/pages/Logs.jsx (modified — dedupe, timestamps, legend, hover, context menu, multi-select, /24 normalization)
- FOUND: src/admin/src/App.css (modified — .log-row hover / .log-row-selected)
- FOUND commit 536aa0a (Task 1)
- FOUND commit a18e0c1 (Task 2)
- FOUND commit adc6709 (Task 3)
- FOUND commit 9f2e934 (checkpoint /24 fix)
