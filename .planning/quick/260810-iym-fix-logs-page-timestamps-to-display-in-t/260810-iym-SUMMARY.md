---
phase: quick/260810-iym
plan: 01
subsystem: web-admin-logs
tags: [watch-routes, timestamps, timezone, logs-page]
dependency-graph:
  requires: []
  provides: [_to_utc_z UTC-normalized daemon log timestamps]
  affects: [src/scripts/watch-routes.py, src/admin/src/pages/Logs.jsx]
tech-stack:
  added: []
  patterns: [offset-aware ISO parsing with datetime.fromisoformat + astimezone]
key-files:
  created: []
  modified:
    - src/scripts/watch-routes.py
    - src/tests/test_watch_routes_asn.py
    - src/admin/src/pages/Logs.jsx
    - README.md
    - docs/README.ru.md
    - docs/REFERENCE.md
decisions:
  - "_to_utc_z() lives at the single ts extraction point in main() — format_line()/_flush_entries() interpolate ts verbatim and inherit the fix without modification"
  - "_open_log_file()'s dated filename stays host-local (unchanged) so the Historical tab's date-based file selection keeps working"
metrics:
  duration: "~35m"
  completed: 2026-08-10
---

# Phase quick/260810-iym Plan 01: Fix Logs page timestamps timezone Summary

Normalized watch-routes.py's daemon log-line timestamps to explicit UTC (`...Z`) instants via a new `_to_utc_z()` helper, so the Logs page's existing date-fns `parseISO` + `format` pipeline renders them in the browser's local timezone instead of the RPi's OS timezone.

## What Was Built

**Task 1 — `_to_utc_z()` timestamp normalization (TDD RED/GREEN):**
- Extended `_LOG_RE`'s `ts` capture group to swallow an optional trailing zone marker (fractional seconds, then `Z` or `±HHMM`/`±HH:MM`) after the 19-char ISO core, so the journalctl `short-iso` offset (e.g. `+0300`) is captured instead of discarded.
- Added `_to_utc_z(raw: str) -> str`: normalizes a trailing `Z` to `+00:00`, inserts the missing colon in basic-format `±HHMM` offsets (Python 3.11 `fromisoformat` compatibility), attaches the host's local zone to naive input via `.astimezone()`, converts to UTC, and formats as `%Y-%m-%dT%H:%M:%SZ`. Wrapped in `try/except (ValueError, TypeError, OSError)` returning the raw token unchanged on any parse failure — a malformed journalctl line can never crash the daemon loop (T-260810-01).
- `main()`'s single extraction point now reads `ts = _to_utc_z(m.group("ts"))`. `format_line()` and `_flush_entries()` were left untouched — they interpolate `ts` verbatim and inherit the fix.
- `_open_log_file()` / `datetime.date.today()` (dated log filename) deliberately left on host-local date — the Historical tab's from/to file selection depends on it.
- Added `TestToUtcZ` (5 tests: `+0300`, `+03:00`, idempotent `Z`, naive host-local, garbage-never-raises) and `TestLogReOffsetCapture` (2 tests: offset captured, bare timestamp still matches) to `src/tests/test_watch_routes_asn.py`.

**Task 2 — Frontend verification (no functional change needed):**
- Confirmed `DAEMON_LINE_RE = /^\S+\s+\[(VPN|ISP)\]\s*/` already consumes a Z-suffixed leading token — `dedupeSignature()`/`dedupeLines()` needed no edit.
- Confirmed `formatTs()`'s `parseISO(token)` + `format(d, 'dd MMM HH:mm:ss')` already handles both the new `...Z` UTC instant and legacy naive (no-`Z`) lines, always rendering browser-local time. Updated the comment above `formatTs()` to document the UTC source and the known legacy-data artifact for pre-fix lines.
- `extractCidr()`/`extractOrg()` confirmed unaffected (key off `→` and the last `|`).
- `npm run build` (Vite) verified green; no new dependency added to `src/admin/package.json`.

**Task 3 — Docs sync:**
- Updated the daemon log-line sample timestamps in `README.md`, `docs/README.ru.md`, and `docs/REFERENCE.md` from naive (`2026-05-29T10:14:00`) to Z-suffixed UTC (`2026-05-29T07:14:00Z`), with a note that timestamps are stored UTC and rendered browser-local by the web admin.
- `docs/REFERENCE.md`'s `watch-routes.py` section now documents that the journalctl `short-iso` offset is captured by `_LOG_RE` and normalized via `_to_utc_z()`.
- Grepped the repo for other stale naive daemon-line timestamp samples in tracked docs/configs — none found outside historical `.planning/` plan/summary/context artifacts, which are intentionally left as-is (historical record, not living docs).

## Verification

- `python3 -m pytest src/tests/test_watch_routes_asn.py -q` → 24 passed (17 pre-existing + 7 new).
- `python3 src/scripts/watch-routes.py --help` exits 0.
- `grep -c "_to_utc_z" src/scripts/watch-routes.py` → 3 (definition, call site, comment).
- `npm run build` in `src/admin/` → succeeds (Vite, no dependency changes).
- `git diff src/admin/package.json src/admin/package-lock.json` → empty (no new deps).

## TDD Gate Compliance

Task 1 (`tdd="true"`) followed the full RED/GREEN cycle:
- RED commit `b58fbd8` — added 7 new tests against the pre-fix module; confirmed 6 failures (`AttributeError: no attribute '_to_utc_z'` × 5, offset-capture assertion mismatch × 1) before any implementation code was restored.
- GREEN commit `f759d53` — restored the `_LOG_RE`/`_to_utc_z()`/`main()` implementation; full suite (24 tests) passed.
No REFACTOR commit was needed — implementation required no cleanup after GREEN.

## Deviations from Plan

None - plan executed exactly as written. One environment note: `src/admin/node_modules/` was absent in this worktree; ran `npm install` (existing `package.json`/`package-lock.json`, no version changes) to make `npm run build` runnable for Task 2's verification step. This is standard dependency installation, not a new package addition, and produced no lockfile diff.

## Known Stubs

None.

## Threat Flags

None — the only new surface (`_to_utc_z()` parsing journalctl-derived text) was already identified and mitigated in the plan's threat model (T-260810-01, `try/except` guard verified present).

## Self-Check: PASSED

- FOUND: src/scripts/watch-routes.py (contains `_to_utc_z`, 3 occurrences)
- FOUND: src/tests/test_watch_routes_asn.py (contains `TestToUtcZ`, `TestLogReOffsetCapture`)
- FOUND: src/admin/src/pages/Logs.jsx (formatTs comment updated)
- FOUND: README.md, docs/README.ru.md, docs/REFERENCE.md (Z-suffixed samples)
- FOUND commit b58fbd8 (test RED)
- FOUND commit f759d53 (feat GREEN)
- FOUND commit 339fd70 (docs Logs.jsx comment)
- FOUND commit 23258c9 (docs README/REFERENCE sync)
