---
quick_id: 260820-juc
slug: fix-routing-sh-silently-dropping-web-adm
date: 2026-08-20
status: complete
tasks_completed: 3
---

# Quick Task 260820-juc — Summary

Part A of a three-part batch (A: backend/scripts, B: Routes page, C: Logs page).

## Task 1 — `routing.sh` silently dropped web-admin routes — `4fcb304`

**Root cause.** Stages 5, 5b and 5c skipped only lines *starting* with `#` and
passed the rest of the line verbatim to `ip route`. The web admin writes route
files in inline format (`splitgate-admin.py` `write_routes_with_desc`), so
`2.21.65.0/24 # Akamai` became
`ip route add "2.21.65.0/24 # Akamai" dev awg0` — rejected by iproute2, silenced
by `2>/dev/null || true`, and still counted in the stage total, so the summary
reported success.

**Blast radius.** Every route added through the web admin *with* a description
was never applied. Routes without a description worked. The repo-managed
`src/configs/*.txt` files use the leading-comment format, so nothing was broken
via `deploy-routes.sh` and the bug stayed invisible.

**Fix.** `normalize_route_line()` strips inline comments and trims, making both
file formats produce identical `ip route` calls. `add_route()` logs the rejected
CIDR and the iproute2 error to `install.log` instead of discarding it, tolerating
the expected `File exists`. Per-stage failure counters roll up into the Stage 9
summary.

**Verified.** `bash -n` parses. Ten normalisation cases pass, including inline
comments, tab separators, `#` with no surrounding space, indented comments and
blank lines. A stubbed `ip` confirms an inline-format entry now counts as added,
`File exists` is tolerated, and a genuinely malformed entry is logged and counted
as failed.

## Task 2 — `routes_dirty` — `26774a8`

`routing.sh` Stage 8b touches `/etc/splitgate/.last-apply` on every successful
run. Stamping in the script rather than the backend means all three apply paths
count: `/api/config/apply`, `update-vpn-routes` from cron, and the boot-time
`vpn-routing.service`.

`_routes_dirty()` compares the mtimes of the two custom-route files against that
stamp. A missing stamp means never-applied and counts as dirty; missing route
files contribute nothing; `stat` only, no reads, since `/api/status` is polled
and also streamed over SSE every 10s. Reported from `_collect_status()` — so it
reaches `/api/status` and `/api/status/watch` — and echoed from
`/api/config/apply` so the client can settle its button without waiting for the
next poll.

**Verified.** `py_compile` passes. Seven-state walkthrough on a scratch
directory: never applied, applied-then-edited (both files), re-stamped, and
files-removed all report as expected.

## Task 3 — Honest log-history cap — `2a2c4dd`

`/api/logs/history` now returns `{lines, count, total, truncated, day_cap}`.
`count_lines()` streams each file for the true total without a second full copy
in memory. Per-day cap raised to 50000 (`HISTORY_DAY_CAP`).

**Verified.** `py_compile` passes. Over-cap, under-cap, missing-file and mixed
multi-day cases produce the expected `count`/`total`/`truncated`, and the tail
keeps the *end* of the file.

## Notes for Parts B and C

- Part B consumes `routes_dirty` to gate the Apply Changes button.
- Part C consumes `total` / `truncated` / `day_cap` for an honest line counter,
  and the raised cap is what makes virtualization worth doing.

## Deployment

Not deployed. `src/deploy.sh` (routing.sh) and `src/deploy-admin.sh`
(splitgate-admin.py) are unchanged — the operator runs them. Until the new
`routing.sh` is on the RPi, `.last-apply` never appears and `routes_dirty` stays
`true`, which degrades to today's always-enabled button rather than a wrong one.
