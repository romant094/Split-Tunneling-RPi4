---
phase: quick/260810-iym
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/scripts/watch-routes.py
  - src/tests/test_watch_routes_asn.py
  - src/admin/src/pages/Logs.jsx
  - README.md
  - docs/README.ru.md
  - docs/REFERENCE.md
autonomous: true
requirements: [UI-LOGS]

must_haves:
  truths:
    - "New daemon log lines carry an unambiguous UTC timestamp ending in Z"
    - "Logs page (Watch Live + Historical) renders timestamps in the browser's local timezone"
    - "Old naive (no-Z) log lines still render without crashing"
    - "Hide-duplicates and Add-route-to-ISP/VPN still work on Z-suffixed lines"
  artifacts:
    - path: "src/scripts/watch-routes.py"
      provides: "UTC-normalized timestamp emitted into every daemon/stdout line"
      contains: "_to_utc_z"
    - path: "src/tests/test_watch_routes_asn.py"
      provides: "regression tests for offset capture + UTC normalization"
      contains: "_to_utc_z"
  key_links:
    - from: "src/scripts/watch-routes.py"
      to: "_LOG_RE ts group"
      via: "offset-aware capture then _to_utc_z conversion in main()"
      pattern: "_to_utc_z\\("
    - from: "src/admin/src/pages/Logs.jsx"
      to: "date-fns parseISO/format"
      via: "formatTs() renders the UTC instant in browser-local time"
      pattern: "parseISO\\(token\\)"
---

<objective>
Logs page timestamps are off by the offset between the RPi's OS timezone and the
browser's timezone (~2h). Fix by making the timestamp in every watch-routes.py
output line an explicit UTC instant (`...Z`), so the frontend's existing
date-fns `parseISO` + `format` pipeline renders browser-local time automatically.

Purpose: correct wall-clock display of traffic logs for the operator.
Output: offset-aware timestamp handling in watch-routes.py, regression tests,
verified frontend parsing, updated docs.
</objective>

<execution_context>
@/Users/antonromankov/Projects/my-projects/split-tunneling-v2/.claude/get-shit-done/workflows/execute-plan.md
@/Users/antonromankov/Projects/my-projects/split-tunneling-v2/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@src/scripts/watch-routes.py
@src/admin/src/pages/Logs.jsx
@src/tests/test_watch_routes_asn.py

<confirmed_root_cause>
The pre-plan diagnosis assumed watch-routes.py generates its own `datetime.now()`
timestamp. It does NOT. Confirmed actual mechanism:

- `main()` spawns `journalctl -f -k --no-pager -o short-iso`, which emits lines like
  `2026-05-21T11:36:21+0300 raspberrypi kernel: [VPN] IN=eth0 ...` — the offset IS present.
- `_LOG_RE` (watch-routes.py ~line 299) captures only the first 19 characters:
  `r"^(?P<ts>\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})"` — the `+0300` offset is DISCARDED.
- `ts = m.group("ts")` in `main()` is passed verbatim into `format_line()` (stdout mode)
  and into the `_pending` entry tuple consumed by `_flush_entries()` (daemon mode).
- Result: emitted lines carry a naive RPi-wall-clock string. date-fns `parseISO` treats a
  no-offset string as browser-local, so no conversion happens and the RPi/browser offset
  delta shows up as the ~2h error.

So the fix is offset capture + UTC normalization at the single point where `ts` is
extracted — not a change to any `datetime.now()` call (there is none in the line path).
`_open_log_file()`'s `datetime.date.today()` (dated filename `watch-YYYY-MM-DD.log`) stays
local — the Historical tab selects files by that local date and must not shift.
</confirmed_root_cause>

<interfaces>
From src/scripts/watch-routes.py:
```python
_LOG_RE = re.compile(r"^(?P<ts>\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})" ...)
def format_line(ts: str, tag: str, src: str, dst: str, proto: str, dpt: str, no_dns: bool, *, enable_asn: bool = True) -> str
def _flush_entries(entries: list, asn_result: dict) -> None   # entry = (enqueue_ts, ts, tag, src, dst, proto, dpt, no_dns[, status])
def _write_daemon_line(line: str) -> None
```
Both output builders interpolate `ts` verbatim as the leading token.

From src/admin/src/pages/Logs.jsx:
```js
const DAEMON_LINE_RE = /^\S+\s+\[(VPN|ISP)\]\s*/   // leading token matched as \S+ — Z-safe
function formatTs(line)                            // splits on first space, parseISO(token), format(d, 'dd MMM HH:mm:ss')
function dedupeSignature(line)                     // strips DAEMON_LINE_RE prefix
```
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Capture the journalctl offset and normalize ts to UTC Z</name>
  <files>src/scripts/watch-routes.py, src/tests/test_watch_routes_asn.py</files>
  <behavior>
    - `_to_utc_z("2026-05-21T11:36:21+0300")` → `"2026-05-21T08:36:21Z"`
    - `_to_utc_z("2026-05-21T11:36:21+03:00")` → `"2026-05-21T08:36:21Z"`
    - `_to_utc_z("2026-05-21T08:36:21Z")` → `"2026-05-21T08:36:21Z"` (idempotent)
    - `_to_utc_z("2026-05-21T11:36:21")` (no offset) → treated as host-local, converted to UTC, ends with `Z`
    - `_to_utc_z("garbage")` → returns the input unchanged (never raises)
    - `_LOG_RE` matches a journalctl short-iso line with `+0300` and its `ts` group includes the offset
    - `_LOG_RE` still matches a line whose timestamp has no offset (`ts` group = bare 19 chars)
  </behavior>
  <action>
    In `src/scripts/watch-routes.py`:

    1. Extend the `ts` group in `_LOG_RE` to swallow an optional trailing zone marker after
       the 19-character ISO core: an optional fractional-seconds part, then optionally `Z`
       or `±HHMM` / `±HH:MM`. Keep the rest of the pattern (the `[^\[]*` filler, tag, SRC,
       DST, PROTO, DPT groups) byte-for-byte unchanged, and keep the group name `ts`.
       Update the comment block above `_LOG_RE` (currently says "ISO timestamp prefix
       (19 chars)") to state that the offset is captured and normalized downstream.

    2. Add a module-level helper `_to_utc_z(raw: str) -> str` near the other timestamp
       helpers. Implementation notes: normalize a trailing `Z` to `+00:00` and insert the
       missing colon in a basic-format `±HHMM` offset so `datetime.datetime.fromisoformat`
       accepts it (the RPi runs Python 3.11 per Phase 7 notes — do not rely on 3.11+
       `fromisoformat` offset leniency). If the parsed datetime is naive, attach the host
       local zone via `.astimezone()`. Convert with `.astimezone(datetime.timezone.utc)` and
       return `strftime("%Y-%m-%dT%H:%M:%SZ")` (seconds precision, drop microseconds — the
       frontend token split assumes a single space-delimited token). Wrap the whole body in
       `try/except (ValueError, TypeError, OSError)` returning `raw` unchanged on failure —
       a malformed timestamp must never kill the daemon loop.
       Use `datetime.timezone.utc` (module `datetime` is already imported); do NOT use the
       deprecated naive `datetime.utcnow()`.

    3. In `main()`, at the single extraction point `ts = m.group("ts")`, wrap it:
       `ts = _to_utc_z(m.group("ts"))`. Do not touch `format_line()` or `_flush_entries()` —
       they interpolate `ts` verbatim and inherit the fix.

    4. Leave `_open_log_file()` / `datetime.date.today()` untouched — the dated log filename
       stays on host-local date so the Historical tab's from/to file selection keeps working.

    Then in `src/tests/test_watch_routes_asn.py`, append a new test class covering every case
    in `<behavior>` above. Follow the existing importlib module-loading pattern at the top of
    that file (module attribute access, e.g. `watch_routes._to_utc_z`). For the naive-input
    case, assert only that the result ends with `Z` and parses back to the same instant as the
    input interpreted in host-local time — do not hardcode a host-timezone-dependent literal.
  </action>
  <verify>
    <automated>cd /Users/antonromankov/Projects/my-projects/splitgate && python3 -m pytest src/tests/test_watch_routes_asn.py -q && python3 src/scripts/watch-routes.py --help >/dev/null && grep -c "_to_utc_z" src/scripts/watch-routes.py</automated>
  </verify>
  <done>Full existing pytest suite still passes, new timestamp tests pass, `--help` still exits 0, and `_to_utc_z` appears at least 3 times (definition + call in main + comment/test reference).</done>
</task>

<task type="auto">
  <name>Task 2: Verify frontend parsing tolerates Z and mixed-format history</name>
  <files>src/admin/src/pages/Logs.jsx</files>
  <action>
    Confirm and, only where needed, adjust `src/admin/src/pages/Logs.jsx`:

    1. `DAEMON_LINE_RE` = `/^\S+\s+\[(VPN|ISP)\]\s*/` — `\S+` already consumes a Z-suffixed
       token, so `dedupeSignature()` / `dedupeLines()` need no change. Verify by reasoning
       against the regex; do not modify unless it demonstrably fails.

    2. `formatTs()` splits on the first space and calls `parseISO(token)`. date-fns `parseISO`
       handles both `2026-08-10T11:18:11` (interpreted as browser-local — the legacy lines
       already on the RPi) and `2026-08-10T09:18:11Z` (a true UTC instant). `format(d, 'dd MMM
       HH:mm:ss')` always renders in browser-local time. Keep the existing `isNaN` guard and
       `try/catch` raw-line fallback. Update the comment above `formatTs()` to document that
       the source token is now UTC (`Z`) and that pre-fix historical lines without `Z` are
       rendered as-is (their apparent offset is a known artifact of legacy data, not a bug).

    3. `extractCidr()` / `extractOrg()` key off `→` and the last `|` — unaffected by the
       timestamp change. Confirm, no edit.

    Do NOT add any timezone library or npm dependency, and do not rebuild `src/admin/dist/`
    unless the file actually changed in a behavior-affecting way (comment-only edits still
    require a rebuild for dist parity — run `npm run build` in `src/admin/` if any edit was made).
  </action>
  <verify>
    <automated>cd /Users/antonromankov/Projects/my-projects/splitgate/src/admin && npm run build 2>&1 | tail -5 && cd /Users/antonromankov/Projects/my-projects/splitgate && grep -n "parseISO(token)" src/admin/src/pages/Logs.jsx</automated>
  </verify>
  <done>Vite build succeeds; `formatTs()` still guards with `isNaN` + `try/catch`; no new dependency added to `src/admin/package.json`.</done>
</task>

<task type="auto">
  <name>Task 3: Sync docs with the new UTC log-line format</name>
  <files>README.md, docs/README.ru.md, docs/REFERENCE.md</files>
  <action>
    Per the project convention (grep the whole project for every changed concept before
    closing a task), update the documented daemon log-line format:

    - `README.md` ~lines 176-177, `docs/README.ru.md` ~lines 176-177, `docs/REFERENCE.md`
      ~lines 629-630: change the sample timestamps from `2026-05-29T10:14:00` /
      `2026-05-29T10:14:05` to their `Z`-suffixed UTC form and add one short sentence stating
      that log-line timestamps are UTC (`Z`) and the web admin renders them in the browser's
      local timezone. Keep README.md and docs/README.ru.md in sync (Russian wording in the
      `.ru` file, English elsewhere — no Russian in the English docs).
    - `docs/REFERENCE.md` ~line 617 (`watch-routes.py` section): note that the journalctl
      `short-iso` offset is captured and normalized to UTC.
    - Re-grep for any other stale `\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}` daemon-line samples in
      tracked files (docs, example configs, inline comments) and update them too.
  </action>
  <verify>
    <automated>cd /Users/antonromankov/Projects/my-projects/splitgate && grep -rn "\[ISP\] ✓\|\[ISP\] ✗" README.md docs/README.ru.md docs/REFERENCE.md | grep -v "Z \[" | wc -l | grep -q '^ *0$' && echo "all doc samples Z-suffixed"</automated>
  </verify>
  <done>Every daemon log-line sample in README.md, docs/README.ru.md, and docs/REFERENCE.md carries a `Z`-suffixed timestamp; both READMEs describe UTC storage + browser-local display; no stale naive samples remain.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| journalctl stdout → watch-routes.py | Kernel log text parsed by regex; malformed/hostile timestamp tokens cross here |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-260810-01 | Denial of Service | `_to_utc_z()` in watch-routes.py | mitigate | Wrap parse in `try/except (ValueError, TypeError, OSError)` returning the raw token — a malformed journalctl timestamp cannot crash the daemon loop |
| T-260810-02 | Tampering | Logs.jsx `formatTs()` | accept | Display-only transform of already-rendered text; raw line is preserved for Copy/Download; no injection surface (React escapes text nodes) |
| T-260810-SC | Tampering | npm/pip installs | accept | No new dependencies added by this plan (explicit constraint) — no package-manager install tasks |
</threat_model>

<verification>
1. `python3 -m pytest src/tests/test_watch_routes_asn.py -q` — all green including new timestamp tests.
2. `python3 src/scripts/watch-routes.py --help` exits 0.
3. `npm run build` in `src/admin/` succeeds; `src/admin/dist/` updated if Logs.jsx changed.
4. No new entries in `src/admin/package.json` dependencies.
5. Post-deploy manual sanity (operator, not blocking): after `cd src && ./deploy.sh`, a fresh
   line in `/etc/splitgate/logs/watch-*.log` ends its timestamp with `Z`, and the Logs page
   Watch Live tab shows that line at the correct browser wall-clock time.
</verification>

<success_criteria>
- Every new watch-routes.py output line's leading token matches `\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z`
- Logs page Watch Live and Historical tabs display times matching the browser's local clock
- Legacy no-Z lines still render (no crash, no blank rows)
- Hide-duplicates and Add-route-to-ISP/VPN unaffected
- README.md, docs/README.ru.md, docs/REFERENCE.md consistent with the new format
</success_criteria>

<output>
Create `.planning/quick/260810-iym-fix-logs-page-timestamps-to-display-in-t/260810-iym-SUMMARY.md` when done
</output>
