---
quick_id: 260820-kcg
slug: logs-page-context-menu-acts-on-selection
date: 2026-08-20
status: complete
tasks_completed: 5
---

# Quick Task 260820-kcg — Summary

Part C of a three-part batch. Consumes `total` / `truncated` / `day_cap` from
`/api/logs/history`, added in Part A (`260820-juc`).

## Task 1 — Context menu acts on the selection — `4af6053`

`LogContextMenu` now receives the selection. When select mode is on and the
right-clicked line belongs to it, the items become `Add N routes to ISP / VPN`
and `Copy N lines`, routed through the same batch path as the toolbar; a
right-click outside the selection keeps the single-line behaviour.

The count discrepancy that made this confusing is also fixed. `selectedToEntries`
collapses each destination to its /24, so three Akamai lines from one subnet
stage one route — while `Add N to ISP` promised N. Both the bar and the menu now
label the **resulting route count** and show `N lines → M routes` whenever the two
differ. That was likely the original report: selecting several lines and getting
one route was the /24 collapse, not a lost write.

## Task 2 — Exclude filters — `671c81f`

Second filter row with an `EyeOff` icon, up to `MAX_FILTERS` fields, built from
the same `FilterBar` via a `mode` prop. Include terms stay ANDed; exclude terms
are ORed, so each field names one thing to drop and a second term narrows rather
than widens.

Ordering is include → exclude → dedupe. That order matters: dedupe keeps the
first occurrence of each signature, so excluding after dedupe could remove the
kept line and leave its visible duplicates suppressed by a line no longer shown.

## Task 3 — Copy filtered — `97ff1ac`

`CopyLinesButton` beside `Download` on both sub-pages. Copies the visible lines
as **raw** text — the same content `Download` writes, not the `formatTs` display
form — so pasted lines keep their ISO timestamp and stay greppable. Confirms with
`Copied N lines`, and says `Clipboard unavailable` rather than silently doing
nothing when the Clipboard API is denied on an insecure origin.

## Task 4 — Virtualized log view and honest counters — `a52b87f`

`LogBox` renders through `@tanstack/react-virtual` (new dependency). Fixed row
height required `.log-row { white-space: pre }` plus horizontal container scroll:
lines previously wrapped, which would make row heights variable and defeat a
fixed `estimateSize`. One line per row is also the conventional log-viewer
behaviour, and it is what makes Part A's 50000-line cap usable.

Auto-scroll now sticks to the bottom only when the view is already there (4px
slack for fractional row heights), so reading back through history is no longer
yanked away by the next SSE line — a bug the old unconditional
`scrollTop = scrollHeight` had all along.

Context menu, click-to-select and the `log-line-vpn` / `log-line-isp` classes are
unchanged. The Historical counter consumes `total` / `truncated` / `day_cap`, so a
capped result reads `loaded the last 5000 of 12483 logged (capped at 50000 per
day)` instead of `5000 / 5000`.

## Task 5 — Documentation — `600b663`

The stale claim was worth fixing on its own: `docs/REFERENCE.md` and both
`.example` headers stated that inline comments after a CIDR are unsupported —
precisely the assumption that let the Part A silent-drop bug hide.

`README.md` and `docs/README.ru.md` updated in sync for the Routes and Logs
pages. `REFERENCE.md` gained `normalize_route_line`/`add_route` and the Stage 9
failure tally, Stage 8b and the `.last-apply` → `routes_dirty` chain, why batch
delete is sequential, include-AND/exclude-OR ordering, the /24 collapse, why
`.log-row` is `white-space: pre`, `HISTORY_DAY_CAP`, the new response fields on
`/api/logs/history` and `/api/config/apply`, `.last-apply` and `admin/` in the
filesystem layout, and the three quick tasks.

`ru-list-exclude.txt` was deliberately left alone — Stage 1 appends its lines to
the download URL rather than to `ip route`, so whole-line comments really are
required there. `REFERENCE.md` now says so explicitly, so the difference does not
read as an oversight.

Rollback needs no change: `vpn-rollback.sh` Step 7b removes the whole
`/etc/splitgate/` tree, which covers `.last-apply`.

## Verification

`npx oxlint src` introduces no new warnings — the four remaining Logs.jsx
warnings all predate this work. `npm run build` succeeds. A project-wide grep for
stale references to the renamed/changed concepts comes back clean.

**Not verified at runtime.** The virtualized `LogBox`, the exclude rows, Copy and
the selection-aware menu were not exercised in a browser against a live RPi —
that needs a deploy. The virtualizer in particular is worth a look on first use:
fixed-height rows and `white-space: pre` are a visible behaviour change (long
lines scroll sideways instead of wrapping).

## Note

`git push` is still blocked — the SSH identity (`~/.ssh/id_rsa`) is absent and
the agent holds no key. Everything from `1881cec` onward is local only.
