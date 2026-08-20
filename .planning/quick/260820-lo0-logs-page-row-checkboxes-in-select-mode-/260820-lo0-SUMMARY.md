---
quick_id: 260820-lo0
slug: logs-page-row-checkboxes-in-select-mode-
date: 2026-08-20
status: complete
tasks_completed: 4
---

# Quick Task 260820-lo0 — Summary

Follow-up to `260820-kcg`. Scope grew during the task as three more reports came
in; all are covered below.

## Task 1 — Row checkboxes and Select All as a checkbox — `a6ddb82`, `561f0d1`

Select mode now shows a checkbox per row; clicking the row still toggles it. The
checkbox is `position: sticky; left: 0`, which `260820-kcg` made necessary —
rows became `white-space: pre` and scroll sideways, so a statically positioned
checkbox slid off the left edge on any long line. The row is a flex container
with the text in a `pre` span, and the fixed 19.2px height is preserved so the
virtualizer's `estimateSize` stays exact.

`Select All` is now a tri-state `Checkbox` instead of a button, so it reports
state as well as offering an action — the same component and semantics as the
Routes table header.

## Task 2 — `Add all` dropdown with confirmation — `561f0d1`

New `Add all ▾` in the toolbar, built on `Popover` (already a dependency) with
`Add to ISP routes` / `Add to VPN routes`. It acts on the current visible set —
after include filters, exclude filters and Hide duplicates — so a filtered view
becomes routes without entering select mode.

The confirmation dialog is unconditional rather than size-gated: unfiltered, the
visible set can be thousands of lines and hundreds of /24s, so
`N visible lines → M routes` plus the full CIDR list has to be readable before
anything is staged.

## Task 3 — `Apply immediately` — `afc5a5b`

Requested after the batch-add path was confirmed working. Adding a route from
Logs previously left it pending until a separate trip to the Routes page, which
is the wrong default for the common case: spot a leak in the log, fix it now.

`routeApply.js` is new and holds `flushAndApply`, extracted from `Routes.jsx`.
Extraction rather than duplication was the point — the ordering and failure rules
are easy to get subtly wrong (bulk-write first; clear staging only after the write
succeeds, per CR-02; then `POST /api/config/apply`), and two copies would drift.
`RoutesPage.applyRoutes` now calls it too, so the Apply button and the Logs path
are the same code.

The checkbox lives in the Add all confirmation dialog but the preference
(`localStorage` `sg_apply_immediately`) governs all three staging paths —
right-click, selection batch, Add all. Its help text says so, since a preference
that reaches beyond the dialog it is set in would otherwise be a surprise. The
confirm button and dialog wording change with it, so the outcome is stated before
it happens. On failure the entries stay staged, the message says so, and errors
linger 8s instead of 3s.

## Task 4 — Two reported UI bugs — `a6ddb82`

**Watch Live tab not highlighted.** `/logs` rendered `LogsLive` through an index
route while the URL stayed `/logs`; the sub-tab `NavLink`s match on the URL, so
nothing highlighted even though Watch Live was the visible pane. Now redirects to
`/logs/live`. The unused `Navigate` import in `Logs.jsx` that oxlint had been
flagging was evidently meant for exactly this — moved to `App.jsx`, dropped from
`Logs.jsx`.

**Routes table grew the page.** Now `max-h-[60vh]` with internal scroll and a
sticky header, so the toolbar, Apply button and row counter stay on screen while
working through a few hundred routes, and the column labels and select-all
checkbox stay reachable.

## Documentation — `53c500e`

`README.md` and `docs/README.ru.md` updated in sync. `REFERENCE.md` gained why the
confirmation dialog is unconditional, that `sg_apply_immediately` reaches all
three staging paths, why `routeApply.js` exists, the sticky row checkbox, the
Routes table scrolling and the `/logs` redirect with its reason.

## Verification

`npx oxlint src` adds no new warnings — the three remaining `Logs.jsx` warnings
and the one in `Routes.jsx` all predate this work. `npm run build` succeeds.

**Not verified in a browser.** The Chrome extension is not connected, for this
session or for a delegated agent, so none of this was exercised against a running
page. A stub API server on the production bundle was prepared for that purpose and
could not be driven. Worth a careful look on first use: the sticky row checkbox,
the Popover dropdown placement, and the sticky table header inside a scrolling
container are all layout-sensitive.

## Investigation that did not resolve

**"Apply Changes inactive after staging from Logs" did not reproduce.** On the
build the user is now running, the Routes page shows `Pending changes` with the
staged route and Apply Changes is enabled. The gating logic
(`routesDirty !== false || stagedCount > 0`) was traced line by line and no defect
was found: the staging store is a module-level singleton, `NavLink` navigation
does not reset it, and `clearPending` runs only after a successful apply. The most
likely explanation is that an older frontend was deployed at the time of the
report. Left unresolved rather than declared fixed.

## Still open, outside this task

`routing.sh` Stage 5c still rejects one route on the user's device
(`VPN-force routes added: 68 routes via awg0 (1 failed)`), and
`ip route get 2.21.65.19` still resolves via the ISP. The `260820-juc`
normalisation fix made the failure visible but did not eliminate it; the iproute2
error line from `install.log` is needed to go further.
