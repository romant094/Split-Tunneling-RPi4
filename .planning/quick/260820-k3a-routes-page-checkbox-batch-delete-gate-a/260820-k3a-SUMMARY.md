---
quick_id: 260820-k3a
slug: routes-page-checkbox-batch-delete-gate-a
date: 2026-08-20
status: complete
tasks_completed: 3
---

# Quick Task 260820-k3a — Summary

Part B of a three-part batch. Consumes the `routes_dirty` flag added in Part A
(`260820-juc`).

## Task 1 — Checkbox batch delete — `1881cec`

New `src/admin/src/components/ui/checkbox.jsx`: a native `<input>` rather than a
Radix primitive, because the only thing the primitive would add is styling, and
`indeterminate` — needed by the header checkbox for a partial selection — is a
DOM property with no attribute form, so it goes through a ref either way.

`RouteSection` gained a leading checkbox column. The header checkbox operates on
`sorted`, the filtered and sorted view, so "select all" under an active filter
means every matching row rather than the whole file. The selection is pruned
whenever the visible set changes, so a row the user cannot see is never swept up
by `Delete N`.

`DeleteConfirmDialog` now takes a CIDR list; a single entry keeps the previous
wording, several show the count plus a scrollable list of exactly what will go.
Deletion is sequential — every DELETE rewrites the whole route file on the RPi,
so concurrent requests would read-modify-write over each other, the same
constraint already documented on `flushStagedDescriptions`. A partial failure is
reported as `Removed X of N` with the first error, not swallowed.

## Task 2 — Apply Changes gating — `882bd52`

`RoutesPage` polls `/api/status` every 15s for `routes_dirty` and subscribes to
the staging store; the button is enabled iff either has pending work.

Failure modes deliberately favour a usable button: `undefined` `routes_dirty` —
an older backend without the field, or the first poll still in flight — reads as
pending, and a failed poll keeps the previous value. The worst case is today's
always-enabled button, never a permanently dead one.

Two paths avoid poll latency. `/api/config/apply` echoes the recomputed flag
(added in Part A) so the button settles the moment an apply succeeds. And
`RouteSection` reports server-side mutations through a new `onServerMutation`
prop, so an add, bulk import, edit or delete flips the button back on
immediately — necessary because those endpoints write to the route files at once
and are invisible to the staging store.

The disabled state carries a title explaining why, so a greyed-out button is not
a mystery.

## Task 3 — Fill Descriptions scope dialog — `e8720c9`

The button no longer starts a long sequential job on a single click.
`FillDescriptionsDialog` offers **Only missing (N)** (default, the previous
behaviour) and **All routes (M)**, which re-looks-up everything and replaces
existing descriptions. Both counts are shown up front because lookups are one
whois request per route, run one at a time.

The "all" option states that existing descriptions are replaced and that results
land in staging under Pending changes, so declining to apply is the undo. Scope
wording now distinguishes "in the current filtered selection" from "in this
list" — the previous silent behaviour always used the filtered view without
saying so. `Fill` is disabled when the chosen scope is empty.

Note on overwriting: `stageDescriptions` skips empty values, so a whois that
returns nothing leaves the existing description intact rather than blanking it.

## Verification

`npx oxlint src` introduces no new warnings — the single Routes.jsx warning
(`useEffect` missing `load`) predates this work and matches the existing pattern
in the file. `npm run build` succeeds.

Not exercised against a live RPi; `src/deploy-admin.sh` is unchanged and the
operator runs it.

## Note

`git push` failed part-way through this task — the SSH identity
(`~/.ssh/id_rsa`) is absent and the agent holds no key. Commits through `e8720c9`
are local only. Push once the key is loaded.
